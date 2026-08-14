import {
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_PROPOSAL_JSON_SCHEMA,
  validateSemanticProposal,
} from "./proposal-schema.mjs";
import {
  conspicuouslySyntheticFallback,
  isConspicuouslySynthetic,
  isLegalAcceptanceField,
} from "./proposal-safety.mjs";
import { reasoningEffortFor, reasoningRequestFor } from "../llm-reasoning.mjs";
import { uniquifyActionProposalIds } from "./proposal-normalization.mjs";

function outputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        throw new Error(`OpenAI declined semantic generation: ${content.refusal}`);
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI returned no semantic proposal.");
}

function canonicalStrings(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function observedControlType(facts) {
  const rawTypes = new Set(
    facts
      .map((fact) => String(fact.rawType || "").toLowerCase())
      .filter(Boolean),
  );
  const tags = new Set(
    facts.map((fact) => String(fact.tag || "").toLowerCase()),
  );
  if (rawTypes.has("radio")) return "radio";
  if (rawTypes.has("checkbox")) return "checkbox";
  if (rawTypes.has("custom")) return "custom";
  if (tags.has("select")) return "select";
  if (tags.has("textarea")) return "textarea";
  const supported = [
    "date",
    "datetime-local",
    "email",
    "file",
    "hidden",
    "month",
    "number",
    "password",
    "tel",
    "text",
    "time",
    "url",
    "week",
  ].find((type) => rawTypes.has(type));
  return supported || null;
}

function compiledFieldSelectors(sourceFacts) {
  if (sourceFacts.length === 0) return [];
  if (sourceFacts.length === 1) {
    const candidates = sourceFacts[0].selectorCandidates || [];
    return [
      candidates.find((selector) => selector.startsWith("#")) ||
        candidates.find((selector) => selector.includes(":nth-of-type(")) ||
        candidates[0],
    ].filter(Boolean);
  }
  const common = (sourceFacts[0].selectorCandidates || []).filter(
    (selector) =>
      sourceFacts
        .slice(1)
        .every((fact) =>
          (fact.selectorCandidates || []).includes(selector),
        ),
  );
  return [
    common.find(
      (selector) =>
        selector.includes("[name=") && selector.includes("[type="),
    ) ||
      common.find((selector) => selector.includes("[name=")) ||
      common[0],
  ].filter(Boolean);
}

function mergeRepairCollection(prior = [], correction = [], identity) {
  const correctedByIdentity = new Map();
  const appended = [];
  for (const item of correction || []) {
    const key = identity(item);
    if (key) correctedByIdentity.set(key, item);
    else appended.push(item);
  }
  const priorIdentities = new Set();
  const merged = (prior || []).map((item) => {
    const key = identity(item);
    if (key) priorIdentities.add(key);
    return key && correctedByIdentity.has(key)
      ? correctedByIdentity.get(key)
      : item;
  });
  for (const item of correction || []) {
    const key = identity(item);
    if (key && !priorIdentities.has(key)) merged.push(item);
  }
  return [...merged, ...appended];
}

function composeTargetedRepairDraft(input, observation) {
  const feedback = observation?.runtimeValidationFeedback;
  const prior = feedback?.priorProposal;
  if (
    !prior ||
    typeof prior !== "object" ||
    Array.isArray(prior) ||
    feedback?.kind
  ) {
    return { proposal: input, normalization: null };
  }

  const current = structuredClone(input);
  const base = structuredClone(prior);
  const proposal = {
    ...base,
    ...current,
    state: current.state || base.state,
    fields: mergeRepairCollection(
      base.fields,
      current.fields,
      (item) => String(item?.key || ""),
    ),
    sections: mergeRepairCollection(
      base.sections,
      current.sections,
      (item) => String(item?.key || ""),
    ),
    guidance: mergeRepairCollection(
      base.guidance,
      current.guidance,
      (item) => String(item?.key || ""),
    ),
    mechanics: {
      ...(base.mechanics || {}),
      ...(current.mechanics || {}),
      fieldTargets: mergeRepairCollection(
        base.mechanics?.fieldTargets,
        current.mechanics?.fieldTargets,
        (item) => String(item?.fieldKey || ""),
      ),
      progressionTarget:
        current.mechanics?.progressionTarget ??
        base.mechanics?.progressionTarget ??
        null,
    },
    proposedActions: mergeRepairCollection(
      base.proposedActions,
      current.proposedActions,
      (item) => String(item?.targetKey || item?.proposalId || ""),
    ),
  };
  return {
    proposal,
    normalization: {
      path: "$",
      kind: "compose_targeted_repair_with_prior_candidate",
      issueTargetKeys: [
        ...new Set(
          (feedback.issues || [])
            .map((issue) => String(issue?.targetKey || ""))
            .filter(Boolean),
        ),
      ].sort(),
      priorCounts: {
        fields: base.fields?.length || 0,
        fieldTargets: base.mechanics?.fieldTargets?.length || 0,
        actions: base.proposedActions?.length || 0,
      },
      correctionCounts: {
        fields: current.fields?.length || 0,
        fieldTargets: current.mechanics?.fieldTargets?.length || 0,
        actions: current.proposedActions?.length || 0,
      },
      composedCounts: {
        fields: proposal.fields.length,
        fieldTargets: proposal.mechanics.fieldTargets.length,
        actions: proposal.proposedActions.length,
      },
    },
  };
}

export function canonicalizeSemanticProposal(
  input,
  existingContract = null,
  observation = null,
) {
  const composed = composeTargetedRepairDraft(input, observation);
  const proposal = structuredClone(composed.proposal);
  const normalizations = composed.normalization
    ? [composed.normalization]
    : [];
  const normalize = (owner, key, path) => {
    if (!Array.isArray(owner?.[key])) return;
    const before = owner[key];
    const after = canonicalStrings(before);
    if (
      after.length !== before.length ||
      after.some((value, index) => value !== before[index])
    ) {
      owner[key] = after;
      normalizations.push({
        path,
        kind: "canonical_string_set",
        beforeCount: before.length,
        afterCount: after.length,
      });
    }
  };

  normalize(proposal.state, "visibleControlKeys", "$.state.visibleControlKeys");
  normalize(proposal.state, "sectionKeys", "$.state.sectionKeys");
  for (const [index, field] of (proposal.fields || []).entries()) {
    normalize(field, "guidanceRefs", `$.fields[${index}].guidanceRefs`);
    normalize(field, "resolutionHints", `$.fields[${index}].resolutionHints`);
    normalize(field, "sourceFactIds", `$.fields[${index}].sourceFactIds`);
  }
  for (const [index, section] of (proposal.sections || []).entries()) {
    normalize(section, "guidanceRefs", `$.sections[${index}].guidanceRefs`);
    normalize(section, "fieldKeys", `$.sections[${index}].fieldKeys`);
  }
  for (const [index, guidance] of (proposal.guidance || []).entries()) {
    normalize(
      guidance,
      "sourceFactIds",
      `$.guidance[${index}].sourceFactIds`,
    );
  }
  for (const [index, target] of (
    proposal.mechanics?.fieldTargets || []
  ).entries()) {
    normalize(
      target,
      "selectors",
      `$.mechanics.fieldTargets[${index}].selectors`,
    );
  }
  normalize(
    proposal.mechanics?.progressionTarget,
    "selectors",
    "$.mechanics.progressionTarget.selectors",
  );

  if (existingContract) {
    const existingFieldKeys = new Set(
      (existingContract.fields || []).map((field) => field.key),
    );
    const repeatedFieldKeys = new Set(
      (proposal.fields || [])
        .filter((field) => existingFieldKeys.has(field.key))
        .map((field) => field.key),
    );
    if (repeatedFieldKeys.size > 0) {
      const beforeCount = proposal.fields.length;
      proposal.fields = proposal.fields.filter(
        (field) => !repeatedFieldKeys.has(field.key),
      );
      proposal.mechanics.fieldTargets = (
        proposal.mechanics?.fieldTargets || []
      ).filter((target) => !repeatedFieldKeys.has(target.fieldKey));
      proposal.proposedActions = (proposal.proposedActions || []).filter(
        (action) => !repeatedFieldKeys.has(action.targetKey),
      );
      normalizations.push({
        path: "$.fields",
        kind: "drop_repeated_immutable_contract_fields",
        fieldKeys: [...repeatedFieldKeys].sort(),
        beforeCount,
        afterCount: proposal.fields.length,
      });
    }
    for (const collection of ["sections", "guidance"]) {
      const existingKeys = new Set(
        (existingContract[collection] || []).map((item) => item.key),
      );
      const before = proposal[collection] || [];
      const after = before.filter((item) => !existingKeys.has(item.key));
      if (after.length !== before.length) {
        proposal[collection] = after;
        normalizations.push({
          path: `$.${collection}`,
          kind: "drop_repeated_immutable_contract_records",
          beforeCount: before.length,
          afterCount: after.length,
        });
      }
    }
  }

  const observedFacts = new Map(
    (observation?.controls || []).map((fact) => [fact.factId, fact]),
  );
  const actionControlTypes = new Set([
    "button",
    "hidden",
    "image",
    "reset",
    "submit",
  ]);
  const hasObservedControlInventory = Array.isArray(observation?.controls);
  const unsupportedFieldKeys = new Set(
    (proposal.fields || [])
      .filter((field) => {
        if (!hasObservedControlInventory) return false;
        const sourceFacts = (field.sourceFactIds || [])
          .map((factId) => observedFacts.get(factId))
          .filter(Boolean);
        return (
          sourceFacts.length === 0 ||
          sourceFacts.every((fact) =>
            actionControlTypes.has(
              String(fact.rawType || fact.tag || "").toLowerCase(),
            ),
          )
        );
      })
      .map((field) => field.key),
  );
  if (unsupportedFieldKeys.size > 0) {
    const beforeCount = proposal.fields.length;
    proposal.fields = proposal.fields.filter(
      (field) => !unsupportedFieldKeys.has(field.key),
    );
    proposal.mechanics.fieldTargets = (
      proposal.mechanics?.fieldTargets || []
    ).filter((target) => !unsupportedFieldKeys.has(target.fieldKey));
    proposal.proposedActions = (proposal.proposedActions || []).filter(
      (action) =>
        !unsupportedFieldKeys.has(action.targetKey) ||
        ["advance", "terminal_submit"].includes(action.kind),
    );
    proposal.sections = (proposal.sections || []).map((section) => ({
      ...section,
      fieldKeys: (section.fieldKeys || []).filter(
        (key) => !unsupportedFieldKeys.has(key),
      ),
    }));
    proposal.state.visibleControlKeys = (
      proposal.state?.visibleControlKeys || []
    ).filter((key) => !unsupportedFieldKeys.has(key));
    normalizations.push({
      path: "$.fields",
      kind: "remove_unsupported_or_action_fields",
      beforeCount,
      afterCount: proposal.fields.length,
      removedKeys: [...unsupportedFieldKeys].sort(),
    });
  }

  const fieldGroups = new Map();
  for (const [index, field] of (proposal.fields || []).entries()) {
    const current = fieldGroups.get(field.key) || [];
    current.push({ field, index });
    fieldGroups.set(field.key, current);
  }
  const mergedRadioFields = new Map();
  for (const [fieldKey, group] of fieldGroups) {
    if (group.length < 2) continue;
    const factsByField = group.map(({ field }) =>
      (field.sourceFactIds || [])
        .map((factId) => observedFacts.get(factId))
        .filter(Boolean),
    );
    const sourceFacts = factsByField.flat();
    const groupNames = new Set(
      sourceFacts.map((fact) => String(fact.name || "")).filter(Boolean),
    );
    if (
      sourceFacts.length !== group.length ||
      sourceFacts.some(
        (fact) => String(fact.rawType || "").toLowerCase() !== "radio",
      ) ||
      groupNames.size !== 1
    ) {
      continue;
    }
    const options = [];
    const optionValues = new Set();
    for (const fact of sourceFacts) {
      for (const option of fact.options || []) {
        const value = String(option.value ?? "");
        if (optionValues.has(value)) continue;
        optionValues.add(value);
        options.push({ value, label: String(option.label || value) });
      }
    }
    if (options.length === 0) continue;
    const selectedIndex = group.findIndex(
      ({ field }) => field.testValue === true,
    );
    const authoredStringValue = group
      .map(({ field }) => field.testValue)
      .find(
        (value) =>
          typeof value === "string" && optionValues.has(value),
      );
    const selectedFact =
      selectedIndex >= 0 ? factsByField[selectedIndex][0] : null;
    const testValue =
      authoredStringValue ??
      selectedFact?.options?.[0]?.value ??
      options[0].value;
    const representative = group[0].field;
    const merged = {
      ...representative,
      controlType: "radio",
      required: group.some(({ field }) => field.required === true),
      options,
      guidanceRefs: canonicalStrings(
        group.flatMap(({ field }) => field.guidanceRefs || []),
      ),
      testValue: String(testValue),
      sensitive: group.some(({ field }) => field.sensitive === true),
      administrative: group.every(
        ({ field }) => field.administrative === true,
      ),
      resolutionHints: canonicalStrings(
        group.flatMap(({ field }) => field.resolutionHints || []),
      ),
      sourceFactIds: canonicalStrings(sourceFacts.map((fact) => fact.factId)),
    };
    mergedRadioFields.set(fieldKey, {
      firstIndex: group[0].index,
      merged,
      sourceFacts,
    });
    normalizations.push({
      path: "$.fields",
      kind: "merge_observed_radio_group",
      fieldKey,
      beforeCount: group.length,
      afterCount: 1,
      sourceFactIds: merged.sourceFactIds,
    });
  }
  if (mergedRadioFields.size > 0) {
    proposal.fields = proposal.fields.flatMap((field, index) => {
      const merged = mergedRadioFields.get(field.key);
      if (!merged) return [field];
      return index === merged.firstIndex ? [merged.merged] : [];
    });
    const emittedTargets = new Set();
    proposal.mechanics.fieldTargets = (
      proposal.mechanics?.fieldTargets || []
    ).flatMap((target) => {
      const merged = mergedRadioFields.get(target.fieldKey);
      if (!merged) return [target];
      if (emittedTargets.has(target.fieldKey)) return [];
      emittedTargets.add(target.fieldKey);
      return [
        {
          ...target,
          selectors:
            compiledFieldSelectors(merged.sourceFacts).length > 0
              ? compiledFieldSelectors(merged.sourceFacts)
              : target.selectors,
        },
      ];
    });
    const emittedActions = new Set();
    proposal.proposedActions = (proposal.proposedActions || []).flatMap(
      (action) => {
        const merged = mergedRadioFields.get(action.targetKey);
        if (!merged || action.kind !== "field_actuation") return [action];
        if (emittedActions.has(action.targetKey)) return [];
        emittedActions.add(action.targetKey);
        return [{ ...action, value: merged.merged.testValue }];
      },
    );
  }

  const observedRadioGroups = new Map();
  for (const fact of observedFacts.values()) {
    if (
      !fact.visible ||
      String(fact.rawType || "").toLowerCase() !== "radio" ||
      !fact.name
    ) {
      continue;
    }
    const current = observedRadioGroups.get(fact.name) || [];
    current.push(fact);
    observedRadioGroups.set(fact.name, current);
  }
  for (const [rawName, sourceFacts] of observedRadioGroups) {
    if (sourceFacts.length < 2) continue;
    const factIds = new Set(sourceFacts.map((fact) => fact.factId));
    const represented = (proposal.fields || [])
      .map((field, index) => ({ field, index }))
      .filter(({ field }) =>
        (field.sourceFactIds || []).some((factId) => factIds.has(factId)),
      );
    if (represented.length === 0) continue;
    const representative = represented[0];
    const field = representative.field;
    const representedKeys = new Set(
      represented.map(({ field: candidate }) => candidate.key),
    );
    const removedKeys = new Set(
      represented
        .slice(1)
        .map(({ field: candidate }) => candidate.key)
        .filter((key) => key !== field.key),
    );
    const observedOptions = [];
    const observedOptionValues = new Set();
    for (const fact of sourceFacts) {
      for (const option of fact.options || []) {
        const value = String(option.value ?? "");
        if (observedOptionValues.has(value)) continue;
        observedOptionValues.add(value);
        observedOptions.push({
          value,
          label: String(option.label || value),
        });
      }
    }
    if (observedOptions.length === 0) continue;
    const completeFactIds = canonicalStrings(
      sourceFacts.map((fact) => fact.factId),
    );
    const authoredValue = String(field.testValue ?? "");
    const testValue = observedOptionValues.has(authoredValue)
      ? authoredValue
      : observedOptions[0].value;
    const groupLegend = sourceFacts
      .map((fact) => String(fact.groupLegend || "").trim())
      .find(Boolean);
    const changed =
      represented.length !== 1 ||
      field.controlType !== "radio" ||
      JSON.stringify(field.sourceFactIds) !== JSON.stringify(completeFactIds) ||
      JSON.stringify(field.options) !== JSON.stringify(observedOptions) ||
      field.testValue !== testValue;
    if (!changed) continue;
    const beforeFactCount = field.sourceFactIds?.length || 0;
    const beforeOptionCount = field.options?.length || 0;
    field.controlType = "radio";
    field.sourceFactIds = completeFactIds;
    field.options = observedOptions;
    field.testValue = testValue;
    field.required = sourceFacts.some((fact) => fact.required === true);
    field.guidanceRefs = canonicalStrings(
      represented.flatMap(({ field: candidate }) => candidate.guidanceRefs || []),
    );
    field.sensitive = represented.some(
      ({ field: candidate }) => candidate.sensitive === true,
    );
    field.administrative = represented.every(
      ({ field: candidate }) => candidate.administrative === true,
    );
    field.resolutionHints = canonicalStrings([
      ...represented.flatMap(
        ({ field: candidate }) => candidate.resolutionHints || [],
      ),
      ...sourceFacts.flatMap((fact) => fact.selectorCandidates || []),
    ]);
    if (groupLegend) field.rawLabel = groupLegend;
    const removedIndexes = new Set(
      represented.slice(1).map(({ index }) => index),
    );
    proposal.fields = (proposal.fields || []).filter(
      (_candidate, index) => !removedIndexes.has(index),
    );

    const compiledSelectors = compiledFieldSelectors(sourceFacts);
    let emittedTarget = false;
    proposal.mechanics.fieldTargets = (
      proposal.mechanics?.fieldTargets || []
    ).flatMap((target) => {
      if (!representedKeys.has(target.fieldKey)) return [target];
      if (emittedTarget) return [];
      emittedTarget = true;
      return [{
        ...target,
        fieldKey: field.key,
        selectors:
          compiledSelectors.length > 0
            ? compiledSelectors
            : target.selectors,
      }];
    });
    let emittedAction = false;
    proposal.proposedActions = (proposal.proposedActions || []).flatMap(
      (candidate) => {
        if (
          candidate.kind !== "field_actuation" ||
          !representedKeys.has(candidate.targetKey)
        ) {
          return [candidate];
        }
        if (emittedAction) return [];
        emittedAction = true;
        return [{ ...candidate, targetKey: field.key, value: testValue }];
      },
    );
    proposal.state.visibleControlKeys = canonicalStrings(
      (proposal.state?.visibleControlKeys || []).map((key) =>
        removedKeys.has(key) ? field.key : key,
      ),
    );
    proposal.sections = (proposal.sections || []).map((section) => ({
      ...section,
      fieldKeys: canonicalStrings(
        (section.fieldKeys || []).map((key) =>
          removedKeys.has(key) ? field.key : key,
        ),
      ),
    }));
    if (!proposal.state.visibleControlKeys.includes(field.key)) {
      proposal.state.visibleControlKeys = canonicalStrings([
        ...proposal.state.visibleControlKeys,
        field.key,
      ]);
    }
    normalizations.push({
      path: "$.fields",
      kind:
        represented.length > 1
          ? "merge_observed_radio_group_by_raw_name"
          : "complete_observed_radio_group",
      fieldKey: field.key,
      rawName,
      mergedFieldKeys: [...representedKeys].sort(),
      beforeFactCount,
      afterFactCount: completeFactIds.length,
      beforeOptionCount,
      afterOptionCount: observedOptions.length,
    });
  }

  const validGuidanceKeys = new Set([
    ...(proposal.guidance || []).map((item) => item.key),
    ...(existingContract?.guidance || []).map((item) => item.key),
  ]);
  for (const [index, field] of (proposal.fields || []).entries()) {
    const before = field.guidanceRefs || [];
    const after = before.filter((key) => validGuidanceKeys.has(key));
    if (after.length !== before.length) {
      field.guidanceRefs = after;
      normalizations.push({
        path: `$.fields[${index}].guidanceRefs`,
        kind: "drop_unknown_guidance_references",
        before,
        after,
      });
    }
  }

  const proposalActionsByTarget = new Map(
    (proposal.proposedActions || []).map((action) => [action.targetKey, action]),
  );
  for (const [index, field] of (proposal.fields || []).entries()) {
    const sourceFacts = (field.sourceFactIds || [])
      .map((factId) => observedFacts.get(factId))
      .filter(Boolean);
    const fact = sourceFacts.find((item) => item.visible) || sourceFacts[0];
    const action = proposalActionsByTarget.get(field.key);
    if (!fact || !action) continue;
    if (
      action.kind === "field_actuation" &&
      isLegalAcceptanceField(field, fact)
    ) {
      const before = { kind: action.kind, value: action.value };
      action.kind = "legal_acceptance_interaction";
      action.value = true;
      field.testValue = true;
      normalizations.push({
        path: `$.proposedActions[${index}]`,
        kind: "typed_acceptance_action_boundary",
        before,
        after: { kind: action.kind, value: true },
      });
      continue;
    }
    if (
      action.kind === "legal_acceptance_interaction" &&
      isLegalAcceptanceField(field, fact) &&
      action.value !== true
    ) {
      const before = action.value;
      action.value = true;
      field.testValue = true;
      normalizations.push({
        path: `$.proposedActions[${index}].value`,
        kind: "one_way_acceptance_value",
        before,
        after: true,
      });
      continue;
    }
    if (
      action.kind === "field_actuation" &&
      !isConspicuouslySynthetic(action.value, field, fact)
    ) {
      const fallback = conspicuouslySyntheticFallback(field, fact);
      if (fallback !== null) {
        const before = action.value;
        action.value = fallback;
        field.testValue = fallback;
        normalizations.push({
          path: `$.proposedActions[${index}].value`,
          kind: "policy_synthetic_text_fallback",
          before,
          after: fallback,
        });
      }
    }
  }
  for (const [index, section] of (proposal.sections || []).entries()) {
    const before = section.guidanceRefs || [];
    const after = before.filter((key) => validGuidanceKeys.has(key));
    if (after.length !== before.length) {
      section.guidanceRefs = after;
      normalizations.push({
        path: `$.sections[${index}].guidanceRefs`,
        kind: "drop_unknown_guidance_references",
        before,
        after,
      });
    }
  }

  const validSectionKeys = new Set([
    ...(proposal.sections || []).map((section) => section.key),
    ...(existingContract?.sections || []).map((section) => section.key),
  ]);
  if (Array.isArray(proposal.state?.sectionKeys)) {
    const before = proposal.state.sectionKeys;
    const after = before.filter((key) => validSectionKeys.has(key));
    if (after.length !== before.length) {
      proposal.state.sectionKeys = after;
      normalizations.push({
        path: "$.state.sectionKeys",
        kind: "drop_unknown_section_references",
        before,
        after,
      });
    }
  }
  for (const [index, field] of (proposal.fields || []).entries()) {
    if (field.sectionKey && !validSectionKeys.has(field.sectionKey)) {
      const before = field.sectionKey;
      field.sectionKey = null;
      normalizations.push({
        path: `$.fields[${index}].sectionKey`,
        kind: "drop_unknown_section_reference",
        before,
        after: null,
      });
    }
  }

  const choiceProbeCount = (proposal.proposedActions || []).filter(
    (action) => action.kind === "choice_probe",
  ).length;
  if (choiceProbeCount > 0) {
    proposal.proposedActions = proposal.proposedActions.filter(
      (action) => action.kind !== "choice_probe",
    );
    normalizations.push({
      path: "$.proposedActions",
      kind: "remove_model_authored_choice_probes",
      removedCount: choiceProbeCount,
    });
  }
  const targetsByField = new Map(
    (proposal.mechanics?.fieldTargets || []).map((target) => [
      target.fieldKey,
      target,
    ]),
  );
  for (const [index, field] of (proposal.fields || []).entries()) {
    const sourceFacts = (field.sourceFactIds || [])
      .map((factId) => observedFacts.get(factId))
      .filter(Boolean);
    if (sourceFacts.length === 0) continue;
    const controlType = observedControlType(sourceFacts);
    if (controlType && field.controlType !== controlType) {
      const before = field.controlType;
      field.controlType = controlType;
      normalizations.push({
        path: `$.fields[${index}].controlType`,
        kind: "dom_authoritative_control_type",
        before,
        after: controlType,
      });
    }
    if (controlType === "select") {
      const observedOptions = [
        ...new Map(
          sourceFacts
            .flatMap((fact) => fact.options || [])
            .map((option) => {
              const canonical = {
                value: String(option.value ?? ""),
                label: String(option.label || option.value || ""),
              };
              return [
                `${canonical.value}\u0000${canonical.label}`,
                canonical,
              ];
            }),
        ).values(),
      ];
      if (
        observedOptions.length > 0 &&
        JSON.stringify(field.options || []) !== JSON.stringify(observedOptions)
      ) {
        const beforeCount = field.options?.length || 0;
        field.options = observedOptions;
        normalizations.push({
          path: `$.fields[${index}].options`,
          kind: "dom_authoritative_select_options",
          fieldKey: field.key,
          sourceFactIds: [...(field.sourceFactIds || [])],
          beforeCount,
          afterCount: observedOptions.length,
        });
      }
      if (observedOptions.length > 0) {
        const selected = observedOptions.find(
          (option) =>
            option.value !== "" &&
            String(option.value) === String(field.testValue ?? ""),
        );
        const fallback = observedOptions.find(
          (option) => option.value !== "",
        );
        const exactValue = selected?.value ?? fallback?.value ?? null;
        const action = proposalActionsByTarget.get(field.key);
        const actionNeedsRebind =
          action?.kind === "field_actuation" && action.value !== exactValue;
        if (
          exactValue !== null &&
          (field.testValue !== exactValue || actionNeedsRebind)
        ) {
          const before = field.testValue;
          field.testValue = exactValue;
          if (action?.kind === "field_actuation") action.value = exactValue;
          normalizations.push({
            path: `$.fields[${index}].testValue`,
            kind: "dom_authoritative_select_test_value",
            fieldKey: field.key,
            sourceFactIds: [...(field.sourceFactIds || [])],
            beforeType: before === null ? "null" : typeof before,
            after: exactValue,
          });
        }
      }
    }
    const required = sourceFacts.some((fact) => fact.required === true);
    if (required && field.required !== true) {
      const before = field.required;
      field.required = true;
      normalizations.push({
        path: `$.fields[${index}].required`,
        kind: "dom_authoritative_requiredness",
        before,
        after: true,
      });
    }
    const target = targetsByField.get(field.key);
    const compiledSelectors = compiledFieldSelectors(sourceFacts);
    if (
      target &&
      compiledSelectors.length > 0 &&
      JSON.stringify(target.selectors) !==
        JSON.stringify(compiledSelectors)
    ) {
      const before = target.selectors;
      target.selectors = compiledSelectors;
      normalizations.push({
        path: `$.mechanics.fieldTargets[${index}].selectors`,
        kind: "compile_declared_field_facts_to_locator",
        before,
        after: compiledSelectors,
      });
    }
  }

  const progressionFact = (observation?.actions || []).find(
    (action) =>
      action.factId ===
      proposal.mechanics?.progressionTarget?.sourceFactId,
  );
  if (progressionFact) {
    const candidates = progressionFact.selectorCandidates || [];
    const compiledSelectors = [
      candidates.find((selector) => selector.includes(":nth-of-type(")) ||
        candidates.find((selector) => selector.startsWith("#")) ||
        candidates[0],
    ].filter(Boolean);
    const progressionTarget = proposal.mechanics.progressionTarget;
    if (
      compiledSelectors.length > 0 &&
      JSON.stringify(progressionTarget.selectors) !==
        JSON.stringify(compiledSelectors)
    ) {
      const before = progressionTarget.selectors;
      progressionTarget.selectors = compiledSelectors;
      normalizations.push({
        path: "$.mechanics.progressionTarget.selectors",
        kind: "compile_declared_action_fact_to_locator",
        before,
        after: compiledSelectors,
      });
    }
  }

  const branchScope = observation?.runtimeBranchScope;
  if (
    branchScope &&
    Array.isArray(branchScope.scopedSourceFactIds) &&
    Array.isArray(proposal.fields)
  ) {
    const allowedFacts = new Set(branchScope.scopedSourceFactIds);
    const beforeFields = proposal.fields;
    const retainedFields = beforeFields.filter((field) =>
      (field.sourceFactIds || []).some((factId) => allowedFacts.has(factId)),
    );
    if (retainedFields.length !== beforeFields.length) {
      const retainedKeys = new Set(retainedFields.map((field) => field.key));
      const removedKeys = new Set(
        beforeFields
          .filter((field) => !retainedKeys.has(field.key))
          .map((field) => field.key),
      );
      proposal.fields = retainedFields;
      proposal.mechanics.fieldTargets = (
        proposal.mechanics?.fieldTargets || []
      ).filter((target) => retainedKeys.has(target.fieldKey));
      proposal.proposedActions = (proposal.proposedActions || []).filter(
        (action) => !removedKeys.has(action.targetKey),
      );
      proposal.sections = (proposal.sections || [])
        .map((section) => ({
          ...section,
          fieldKeys: (section.fieldKeys || []).filter((key) =>
            retainedKeys.has(key),
          ),
        }))
        .filter((section) => section.fieldKeys.length > 0);
      const retainedSectionKeys = new Set(
        proposal.sections.map((section) => section.key),
      );
      proposal.fields = proposal.fields.map((field) => ({
        ...field,
        sectionKey:
          field.sectionKey && retainedSectionKeys.has(field.sectionKey)
            ? field.sectionKey
            : null,
      }));
      proposal.state.sectionKeys = (proposal.state.sectionKeys || []).filter(
        (key) => retainedSectionKeys.has(key),
      );
      proposal.state.visibleControlKeys = (
        proposal.state.visibleControlKeys || []
      ).filter((key) => retainedKeys.has(key));
      const referencedGuidance = new Set([
        ...proposal.fields.flatMap((field) => field.guidanceRefs || []),
        ...proposal.sections.flatMap(
          (section) => section.guidanceRefs || [],
        ),
      ]);
      proposal.guidance = (proposal.guidance || []).filter((item) =>
        referencedGuidance.has(item.key),
      );
      normalizations.push({
        path: "$.fields",
        kind: "enforce_runtime_branch_scope",
        beforeCount: beforeFields.length,
        afterCount: retainedFields.length,
      });
    }
  }

  if (Array.isArray(proposal.state?.visibleControlKeys)) {
    const contractFieldKeys = new Set([
      ...(proposal.fields || []).map((field) => field.key),
      ...(existingContract?.fields || []).map((field) => field.key),
    ]);
    const fieldKeysBySourceFact = new Map();
    for (const field of proposal.fields || []) {
      for (const sourceFactId of field.sourceFactIds || []) {
        const current = fieldKeysBySourceFact.get(sourceFactId) || [];
        current.push(field.key);
        fieldKeysBySourceFact.set(sourceFactId, current);
      }
    }
    const before = proposal.state.visibleControlKeys;
    const resolvedExistingKeys = before
        .map((key) => {
          if (
            (existingContract?.fields || []).some(
              (field) => field.key === key,
            )
          ) {
            return key;
          }
          const linked = fieldKeysBySourceFact.get(key) || [];
          return linked.length === 1 ? linked[0] : null;
        })
        .filter(Boolean);
    const after = canonicalStrings([
      ...(proposal.fields || []).map((field) => field.key),
      ...resolvedExistingKeys,
    ]).filter((key) => contractFieldKeys.has(key));
    if (
      after.length !== before.length ||
      after.some((key, index) => key !== before[index])
    ) {
      proposal.state.visibleControlKeys = after;
      normalizations.push({
        path: "$.state.visibleControlKeys",
        kind: "map_contract_field_keys",
        beforeCount: before.length,
        afterCount: after.length,
      });
    }
  }

  const observedProgressionTarget = proposal.mechanics?.progressionTarget;
  const progressionText = String(progressionFact?.rawText || "")
    .trim()
    .toLocaleLowerCase("en-US");
  const observedTerminalSubmit =
    String(progressionFact?.rawType || "").toLocaleLowerCase("en-US") ===
      "submit" &&
    /\b(submit|send|apply|finish|complete|confirm|place\s+order)\b/.test(
      progressionText,
    ) &&
    !/\b(next|continue|review|preview|save|draft|back)\b/.test(
      progressionText,
    );
  if (
    observedTerminalSubmit &&
    proposal.state?.progression?.kind !== "terminal_submit"
  ) {
    const before = proposal.state.progression.kind;
    proposal.state.progression.kind = "terminal_submit";
    if (observedProgressionTarget) {
      observedProgressionTarget.kind = "terminal_submit";
    }
    for (const action of proposal.proposedActions || []) {
      if (action.targetKey === proposal.state.progression.key) {
        action.kind = "terminal_submit";
      }
    }
    normalizations.push({
      path: "$.state.progression.kind",
      kind: "align_with_observed_terminal_submit",
      before,
      after: "terminal_submit",
      sourceFactId: progressionFact.factId,
    });
  }

  const declaredProgressionKind = proposal.state?.progression?.kind;
  if (
    typeof proposal.state?.kind === "string" &&
    typeof declaredProgressionKind === "string"
  ) {
    const canonicalStateKind =
      declaredProgressionKind === "terminal_submit"
        ? "terminal"
        : proposal.state.kind === "terminal"
          ? "form"
          : proposal.state.kind;
    if (proposal.state.kind !== canonicalStateKind) {
      const before = proposal.state.kind;
      proposal.state.kind = canonicalStateKind;
      normalizations.push({
        path: "$.state.kind",
        kind: "align_with_declared_progression",
        before,
        after: canonicalStateKind,
      });
    }
  }

  normalizations.push(...uniquifyActionProposalIds(proposal));

  return { proposal, normalizations };
}

export function semanticConfiguration() {
  const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "";
  return {
    apiKey,
    configured: Boolean(apiKey),
    model:
      process.env.OPENAI_SEMANTIC_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.4-mini",
    reasoningEffort: reasoningEffortFor("semantic"),
    promptVersion: SEMANTIC_PROMPT_VERSION,
  };
}

function promptText(observation) {
  return [
    "Generate one conservative FormWeave semantic-state proposal from the supplied live observations.",
    "This is metadata generation only. Do not claim that any proposed action has happened.",
    "Use only the DOM facts, accessibility snapshot, screenshot, prior states, and existing expand-only contract supplied here.",
    "Never assume hidden fixture metadata, answer keys, expected test behavior, or facts not visible in the supplied observation.",
    "Return only additions. Never repeat, rename, modify, or delete an existing contract key. On a later state, fields/sections/guidance arrays contain only newly revealed records; state.visibleControlKeys and section membership may reference existingContract keys without redeclaring those records or their field actions/mechanics.",
    "Every state, progression, section, guidance, and field key must be globally unique across prior states and the existing contract.",
    "Preserve exact displayed option labels and raw option values.",
    "For native select and radio controls, option values and labels are browser facts. Copy them exactly from the linked control facts; never trim punctuation, rewrite values, or invent a selectable option.",
    "Keep grouped option meaning separate from the group legend.",
    "Represent guidance once at form, section, or question scope with source fact IDs.",
    "Resolution hints must be selectors copied exactly from selectorCandidates in the raw facts.",
    "Prefer the full structural :nth-of-type selector candidate for progression and any otherwise-ambiguous control. If runtimeValidationFeedback reports an ambiguous locator, replace it with a supplied selector candidate that identifies exactly that intended element.",
    "Every visible applicant control should have a canonical field and a format-valid, obviously synthetic test value. Satisfying the observed field format and constraints is mandatory; add conspicuous test wording only where that format permits it.",
    "Never model submit, reset, image-button, hidden, or ordinary button controls as applicant fields. They belong only to observed actions and, when selected, the one declared progression action.",
    "Discovery must expose conditional behavior rather than avoid it. For visible select, radio, checkbox, switch, and button-like applicant controls, choose the format-valid option or boolean state most likely to reveal dependent questions. Never justify a value because it avoids revealing controls.",
    "Do not propose choice_probe actions. Shared deterministic code derives the complete safe probe set directly from observed option facts, excluding numeric and calendar-month selects under the centralized traversal rules. The model is responsible for one primary action per applicant field and for interpreting a rendered difference only after deterministic probing finds one.",
    "A visible terminal-looking action does not prove the current contract is complete while an unprobed choice control could reveal more applicant controls. The runtime will re-sense visibility after proposed field actions.",
    "Propose exactly one primary typed action for every visible applicant control: field_actuation for ordinary controls and the matching protected action kind for uploads, legal acceptance, credentials, login, payment, or CAPTCHA.",
    "Propose exactly one action for the declared progression target. mechanics.progressionTarget.sourceFactId must identify the one observed visible action fact chosen by the model. Selectors must come from that same fact; deterministic compilation will bind the chosen fact to its unique structural locator without changing the chosen action.",
    "This crawl serves OneDegree's resource-access mission. Select exactly one public form journey that most directly helps a person obtain an essential service or coordinate a referral: housing, food, healthcare, financial assistance, employment, education, legal aid, childcare, transportation, or another basic support service.",
    "Form-entry priority is: intake/application/enrollment/service-request/referral/eligibility form; then public registration that directly grants access to the resource; only when none is available, a contact or request-information form that can accelerate access. Prefer the form for the person seeking service over provider, partner, administrator, donation, volunteer, newsletter, survey, marketing, or general-feedback forms.",
    "A landing or introduction surface with no applicant controls may be a nonterminal form state only when the model selects one exact observed action that advances toward that single resource-access form. Once a form journey is selected, do not explore alternate forms, unrelated information pages, or other same-site links. Current-page links are observation facts, not permission for heuristic page discovery.",
    "At the onset of each new page, before this model receives its observation, shared deterministic Playwright code performs a fixed pointer sweep and reversibly scrolls the main document and accessible child-frame documents for lazy rendering. It never clicks a control and never scrolls a nested application region. Every visible collapsed details, accordion, expando, or disclosure therefore remains a semantic decision: select its exact observed fact as an advance before unrelated progression or terminal submission, then let the generated script actuate and verify it; never repeat an already-expanded disclosure.",
    "A link whose href already points to a confirmation, success, submitted, or thank-you route is terminal-looking, not a disclosure; never use such a link to bypass still-hidden applicant controls or a disabled real submit control.",
    "Cookie and consent-management banners are session traversal infrastructure, not applicant questions. When one blocks or obscures the form, select the exact observed reject-non-essential or necessary-only action when available; otherwise select the minimum acceptance action required to expose the public form. Do not add cookie choices to fields, sections, the applicant contract, or API inputs.",
    "Treat deterministic page-onset pointer and document scrolling only as browser physics that exposes rendered state before sensing. A scrollRegions fact is intentionally unactuated evidence. If reaching the end of such a region is mechanically required to enable or complete an identified field/action, keep the semantic target unchanged; the generated per-site handler must implement and verify that page-specific scroll sequence. Never describe preparation as CAPTCHA or bot-detection bypass.",
    "Canonical key vocabulary (formweave-canonical-v1): first_name, middle_name, last_name, full_name, email, phone, date_of_birth, current_address, city, state, zip_code, household_size, has_children, num_children, monthly_income, annual_income, housing_status, services_requested, disability_status, veteran_status, immigration_status, primary_language, referral_source, ssn_last4. Use the supported canonical key when meaning is clear; otherwise use a stable snake_case key faithful to the raw question.",
    "Sensitivity is narrow: mark credentials, government identifiers, financial values, health/disability, immigration, or similarly protected content sensitive. Names, ordinary contact fields, service selections, housing status, and veteran-service metadata are not automatically sensitive merely because the form has a privacy notice.",
    "Use @example.invalid for email, example.invalid for URLs, 555 numbers for telephone controls, 99999 (or 99999-9999 when required) for US postal/ZIP codes, 9999 for currency/income/rent controls rendered as text inputs, and conspicuous FORMWEAVE TEST text where the control format permits text. Never put letters into a numeric, date, postal-code, currency, or other format-strict value.",
    "When an observed pattern cannot contain FORMWEAVE TEST wording, format validity remains primary: use a reserved sentinel made of 9 for numeric positions and Z or X for letter positions (or FW when the pattern requires exactly two letters), such as 9999999999 or FW9999, only when it satisfies the observed pattern.",
    "Numeric test values must also be semantically plausible for the label, not merely accepted by HTML: prefer household size 2, age 35, a short duration such as 3 months, whole-dollar monthly income 2500, and whole-dollar annual income 30000 unless observed constraints require another value. Avoid unrealistic boundary fillers such as 99 for ordinary household size.",
    "Mark credentials, login, payment, uploads, legal acceptance, CAPTCHA, and terminal submission as protected proposed-action kinds. Treat an ordinary required confirmation that the displayed synthetic information is accurate as legal_acceptance_interaction too; deterministic policy decides whether it has review-confirmation authority. A separate deterministic validator rejects protected actions except narrowly authorized synthetic crawl actions; never provide a file path, filename, or file content in an upload proposal.",
    "A Next/Continue/Review action may be typed advance only when the evidence makes it nonterminal.",
    "A final Submit/Finish/Send/Apply action must be terminal_submit.",
    "Journey progression is narrower than button execution. A local validate, check, calculate, preview, save-draft, advisory, or eligibility action is not an advance merely because it is clickable; select it as progression only when rendered evidence supports that it unlocks substantive controls or moves to another journey state.",
    "An advance must be expected to produce a new URL/route or a substantive visible-control delta. A click alone, focus movement, cosmetic styling, or an unchanged rendered state is not evidence that the journey advanced.",
    "A scrollRegions fact is never a form progression. Scrolling a terms/policy region is a prerequisite owned by the dependent field's generated actuator; bind state progression only to an observed action fact.",
    "A state with terminal_submit progression must use state.kind=terminal; every other state must use a nonterminal kind.",
    "Sort every string-array field canonically and remove duplicates.",
    "Treat runtimeValidationFeedback, when present, as a required correction to the prior draft; correct every listed issue and never repeat a selector reported as ambiguous, missing, or observed no-effect. For nonterminal_no_effect_replan, the prior fields already belong to existingContract: generate only a new additive state decision, bind progression to a different observed source fact and selector predicate, and never repeat the excluded action. For pending_disclosure, preserve unrelated currently actionable fields but replace the current progression with kind advance, one matching proposed advance action, and mechanics.progressionTarget bound to the exact pendingDisclosures factId and unique selectorCandidates supplied by the validator. Do not keep terminal_submit as the current progression in that repaired state. Omit every field whose source fact appears in that disclosure's blockedControlFactIds from fields, state.visibleControlKeys, mechanics.fieldTargets, proposed field_actuation actions, and section question membership; those controls will be generated after the disclosure opens and the page is re-sensed.",
    "When runtimeBranchScope is present, this is a first-level same-page branch variant. Generate fields only for the listed scopedSourceFactIds, while still declaring the observed state and progression. Do not repeat parent or sibling-variant fields visible elsewhere in the screenshot.",
    "",
    JSON.stringify(observation),
  ].join("\n");
}

export async function generateSemanticProposal(
  { observation, screenshot },
  {
    fetchImpl = fetch,
    log = async () => {},
    configuration = semanticConfiguration(),
    maxSchemaAttempts = 2,
    timeoutMs: requestedTimeoutMs = null,
  } = {},
) {
  if (!configuration.configured) {
    throw new Error("Semantic generation requires OPENAI_KEY or OPENAI_API_KEY.");
  }
  if (process.env.FORMWEAVE_DISABLE_OPENAI === "1") {
    throw new Error("Semantic generation is disabled for this process.");
  }
  const startedAt = Date.now();
  await log("semantic_generation_started", {
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort || "none",
    promptVersion: configuration.promptVersion,
    url: observation.url,
    screenshotSha256: observation.screenshot.sha256,
  });
  const controller = new AbortController();
  const configuredTimeoutMs = Math.max(
    1_000,
    Math.min(
      Number.parseInt(
        process.env.FORMWEAVE_SEMANTIC_TIMEOUT_MS || "360000",
        10,
      ),
      360_000,
    ),
  );
  const timeoutMs = Math.max(
    1_000,
    Math.min(
      Number.isFinite(Number(requestedTimeoutMs))
        ? Number(requestedTimeoutMs)
        : configuredTimeoutMs,
      configuredTimeoutMs,
    ),
  );
  const schemaAttemptLimit = Math.max(
    1,
    Math.min(Number.parseInt(String(maxSchemaAttempts), 10) || 2, 2),
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rejectedDrafts = [];
    let correction = "";
    for (
      let attempt = 1;
      attempt <= schemaAttemptLimit;
      attempt += 1
    ) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${configuration.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuration.model,
          ...reasoningRequestFor(
            "semantic",
            configuration.reasoningEffort || "none",
          ),
          store: false,
          input: [
            {
              role: "system",
              content:
                "You generate auditable form metadata and proposed actions. You never actuate sites, never use hidden test knowledge, and never override deterministic safety.",
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `${promptText(observation)}${correction}`,
                },
                {
                  type: "input_image",
                  image_url: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
                  detail: "high",
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "formweave_semantic_state_proposal",
              strict: true,
              schema: SEMANTIC_PROPOSAL_JSON_SCHEMA,
            },
          },
          max_output_tokens: 60_000,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload?.error?.message || `OpenAI returned HTTP ${response.status}.`,
        );
      }
      if (payload.status === "incomplete") {
        throw new Error(
          `OpenAI semantic generation was incomplete: ${payload.incomplete_details?.reason || "unknown reason"}.`,
        );
      }
      const rawProposal = JSON.parse(outputText(payload));
      const canonicalized = canonicalizeSemanticProposal(
        rawProposal,
        observation.existingContract,
        observation,
      );
      const proposal = canonicalized.proposal;
      if (canonicalized.normalizations.length > 0) {
        await log("semantic_proposal_canonicalized", {
          attempt,
          responseId: payload.id || null,
          normalizations: canonicalized.normalizations,
        });
      }
      try {
        validateSemanticProposal(proposal, observation.existingContract);
      } catch (error) {
        rejectedDrafts.push({
          attempt,
          responseId: payload.id || null,
          error: error instanceof Error ? error.message : String(error),
          proposal,
        });
        await log("semantic_proposal_schema_rejected", {
          attempt,
          responseId: payload.id || null,
          error: error instanceof Error ? error.message : String(error),
          proposal,
        });
        if (attempt === schemaAttemptLimit) throw error;
        correction = [
          "",
          "",
          "Your prior draft was rejected by deterministic schema validation.",
          `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          "Correct only the invalid path and any references that necessarily depend on it. Preserve every unrelated valid value from the prior proposal.",
          "Return the complete corrected proposal because the response schema requires a complete document. Do not change observed facts merely to satisfy validation.",
          "Prior canonical proposal:",
          JSON.stringify(proposal),
        ].join("\n");
        continue;
      }
      const provenance = {
        generatedAt: new Date().toISOString(),
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort || "none",
        promptVersion: configuration.promptVersion,
        responseId: payload.id || null,
        durationMs: Date.now() - startedAt,
        screenshotSha256: observation.screenshot.sha256,
        sourceUrl: observation.url,
        attempts: attempt,
        rejectedDrafts,
        normalizations: canonicalized.normalizations,
      };
      await log("semantic_generation_completed", {
        proposalId: proposal.proposalId,
        model: configuration.model,
        reasoningEffort: configuration.reasoningEffort || "none",
        promptVersion: configuration.promptVersion,
        durationMs: provenance.durationMs,
        attempts: attempt,
        fields: proposal.fields.length,
        actions: proposal.proposedActions.length,
      });
      return { proposal, provenance };
    }
    throw new Error("Semantic generation exhausted its repair budget.");
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error(String(error));
    failure.semanticGenerationFailure = true;
    await log("semantic_generation_failed", {
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort || "none",
      promptVersion: configuration.promptVersion,
      durationMs: Date.now() - startedAt,
      error: failure.message,
    });
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}
