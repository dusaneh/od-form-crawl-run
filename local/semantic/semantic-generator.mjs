import {
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_PROPOSAL_JSON_SCHEMA,
  validateSemanticProposal,
} from "./proposal-schema.mjs";

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

export function canonicalizeSemanticProposal(
  input,
  existingContract = null,
  observation = null,
) {
  const proposal = structuredClone(input);
  const normalizations = [];
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

  const observedFacts = new Map(
    (observation?.controls || []).map((fact) => [fact.factId, fact]),
  );
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

  const usedActionIds = new Set();
  for (const [index, action] of (proposal.proposedActions || []).entries()) {
    const original = String(action.proposalId || "");
    let candidate = original;
    let suffix = index + 1;
    while (usedActionIds.has(candidate)) {
      candidate = `${original}__${suffix}`;
      suffix += 1;
    }
    if (candidate !== original) {
      action.proposalId = candidate;
      normalizations.push({
        path: `$.proposedActions[${index}].proposalId`,
        kind: "deduplicate_opaque_id",
        before: original,
        after: candidate,
      });
    }
    usedActionIds.add(candidate);
  }

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
    promptVersion: SEMANTIC_PROMPT_VERSION,
  };
}

function promptText(observation) {
  return [
    "Generate one conservative FormWeave semantic-state proposal from the supplied live observations.",
    "This is metadata generation only. Do not claim that any proposed action has happened.",
    "Use only the DOM facts, accessibility snapshot, screenshot, prior states, and existing expand-only contract supplied here.",
    "Never assume hidden fixture metadata, answer keys, expected test behavior, or facts not visible in the supplied observation.",
    "Return only additions. Never repeat, rename, modify, or delete an existing contract key.",
    "Every state, progression, section, guidance, and field key must be globally unique across prior states and the existing contract.",
    "Preserve exact displayed option labels and raw option values.",
    "Keep grouped option meaning separate from the group legend.",
    "Represent guidance once at form, section, or question scope with source fact IDs.",
    "Resolution hints must be selectors copied exactly from selectorCandidates in the raw facts.",
    "Prefer the full structural :nth-of-type selector candidate for progression and any otherwise-ambiguous control. If runtimeValidationFeedback reports an ambiguous locator, replace it with a supplied selector candidate that identifies exactly that intended element.",
    "Every visible applicant control should have a canonical field and a format-valid, obviously synthetic test value. Satisfying the observed field format and constraints is mandatory; add conspicuous test wording only where that format permits it.",
    "Discovery must expose conditional behavior rather than avoid it. For visible select, radio, checkbox, switch, and button-like applicant controls, choose the format-valid option or boolean state most likely to reveal dependent questions. Never justify a value because it avoids revealing controls.",
    "For every unprotected visible radio group, checkbox, switch, or non-exempt select, propose explicit choice_probe actions covering every non-placeholder observed option. Do not propose choice_probe actions for selects whose meaningful option values or labels are all numeric, or for calendar-month selects recognized by a month-like identity or mostly month-name options. Those shared special traversal rules treat bounded date-like selectors as scalar input, not dependency branches. For a checkbox or switch, propose both false and true. Each choice_probe value must be an observed raw option value or boolean state; shared code will reject incomplete coverage and will not invent missing probes.",
    "A visible terminal-looking action does not prove the current contract is complete while an unprobed choice control could reveal more applicant controls. The runtime will re-sense visibility after proposed field actions.",
    "Propose exactly one primary typed action for every visible applicant control: field_actuation for ordinary controls and the matching protected action kind for uploads, legal acceptance, credentials, login, payment, or CAPTCHA. Choice_probe actions are additional explicit discovery instructions.",
    "Propose exactly one action for the declared progression target. mechanics.progressionTarget.sourceFactId must identify the one observed visible action fact chosen by the model. Selectors must come from that same fact; deterministic compilation will bind the chosen fact to its unique structural locator without changing the chosen action.",
    "This crawl serves OneDegree's resource-access mission. Select exactly one public form journey that most directly helps a person obtain an essential service or coordinate a referral: housing, food, healthcare, financial assistance, employment, education, legal aid, childcare, transportation, or another basic support service.",
    "Form-entry priority is: intake/application/enrollment/service-request/referral/eligibility form; then public registration that directly grants access to the resource; only when none is available, a contact or request-information form that can accelerate access. Prefer the form for the person seeking service over provider, partner, administrator, donation, volunteer, newsletter, survey, marketing, or general-feedback forms.",
    "A landing or introduction surface with no applicant controls may be a nonterminal form state only when the model selects one exact observed action that advances toward that single resource-access form. Once a form journey is selected, do not explore alternate forms, unrelated information pages, or other same-site links. Current-page links are observation facts, not permission for heuristic page discovery.",
    "At the onset of each new page, before this model receives its observation, shared deterministic Playwright code performs approximately one second of varied-easing mouse movement, opens each recognized collapsed details, accordion, expando, disclosure, or aria-expanded control once across accessible frames, and scrolls the main document, child frames, and nested scroll containers. Do not generate actions for that onset process. If a visible collapsed disclosure remains in the observation because it appeared later or uses an unrecognized mechanism, select its exact observed fact as an advance before unrelated progression or terminal submission; never repeat an already-expanded disclosure.",
    "A link whose href already points to a confirmation, success, submitted, or thank-you route is terminal-looking, not a disclosure; never use such a link to bypass still-hidden applicant controls or a disabled real submit control.",
    "Cookie and consent-management banners are session traversal infrastructure, not applicant questions. When one blocks or obscures the form, select the exact observed reject-non-essential or necessary-only action when available; otherwise select the minimum acceptance action required to expose the public form. Do not add cookie choices to fields, sections, the applicant contract, or API inputs.",
    "Treat deterministic page-onset preparation only as browser physics that exposes rendered page state before sensing. Do not invent mouse, scroll, or disclosure-preparation controls as model-authored form actions, and never describe this preparation as CAPTCHA or bot-detection bypass.",
    "Canonical key vocabulary: first_name, middle_name, last_name, full_name, email, phone, date_of_birth, address_line_1, address_line_2, city, state, postal_code, household_size, monthly_income, annual_income, housing_status, services_requested, disability_status, veteran_status, immigration_status, ssn_last4. Use the supported canonical key when meaning is clear; otherwise use a stable snake_case key faithful to the raw question.",
    "Sensitivity is narrow: mark credentials, government identifiers, financial values, health/disability, immigration, or similarly protected content sensitive. Names, ordinary contact fields, service selections, housing status, and veteran-service metadata are not automatically sensitive merely because the form has a privacy notice.",
    "Use @example.invalid for email, example.invalid for URLs, 555 numbers for telephone controls, 99999 (or 99999-9999 when required) for US postal/ZIP codes, 9999 for currency/income/rent controls rendered as text inputs, and conspicuous FORMWEAVE TEST text where the control format permits text. Never put letters into a numeric, date, postal-code, currency, or other format-strict value.",
    "When an observed pattern cannot contain FORMWEAVE TEST wording, format validity remains primary: use a reserved sentinel made of 9 for numeric positions and Z or X for letter positions (or FW when the pattern requires exactly two letters), such as 9999999999 or FW9999, only when it satisfies the observed pattern.",
    "Numeric test values must also be semantically plausible for the label, not merely accepted by HTML: prefer household size 2, age 35, a short duration such as 3 months, whole-dollar monthly income 2500, and whole-dollar annual income 30000 unless observed constraints require another value. Avoid unrealistic boundary fillers such as 99 for ordinary household size.",
    "Mark credentials, login, payment, uploads, legal acceptance, CAPTCHA, and terminal submission as protected proposed-action kinds. A separate deterministic validator rejects them except narrowly authorized loopback fixture actions; never provide a file path, filename, or file content in an upload proposal.",
    "A Next/Continue/Review action may be typed advance only when the evidence makes it nonterminal.",
    "A final Submit/Finish/Send/Apply action must be terminal_submit.",
    "A state with terminal_submit progression must use state.kind=terminal; every other state must use a nonterminal kind.",
    "Sort every string-array field canonically and remove duplicates.",
    "Treat runtimeValidationFeedback, when present, as a required correction to the prior draft; never repeat a selector reported as ambiguous or missing.",
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
    promptVersion: configuration.promptVersion,
    url: observation.url,
    screenshotSha256: observation.screenshot.sha256,
  });
  const controller = new AbortController();
  const timeoutMs = Math.max(
    1_000,
    Math.min(
      Number.parseInt(
        process.env.FORMWEAVE_SEMANTIC_TIMEOUT_MS || "360000",
        10,
      ),
      360_000,
    ),
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rejectedDrafts = [];
    let correction = "";
    const maxSchemaAttempts = 4;
    for (
      let attempt = 1;
      attempt <= maxSchemaAttempts;
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
        if (attempt === maxSchemaAttempts) throw error;
        correction = [
          "",
          "",
          "Your prior draft was rejected by deterministic schema validation.",
          `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          "Return a corrected complete proposal. Do not change observed facts merely to satisfy validation.",
        ].join("\n");
        continue;
      }
      const provenance = {
        generatedAt: new Date().toISOString(),
        model: configuration.model,
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
    await log("semantic_generation_failed", {
      model: configuration.model,
      promptVersion: configuration.promptVersion,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
