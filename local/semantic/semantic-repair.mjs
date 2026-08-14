import { hashJson } from "../contracts/artifact-store.mjs";
import { validateSemanticRepairDocument } from "../contracts/semantic-actuator-schemas.mjs";
import { validateSemanticProposal } from "./proposal-schema.mjs";

export class SemanticRepairError extends TypeError {
  constructor(message, code = "SEMANTIC_REPAIR_INVALID") {
    super(message);
    this.name = "SemanticRepairError";
    this.code = code;
  }
}

function indexBy(items, predicate, description) {
  const index = items.findIndex(predicate);
  if (index < 0) {
    throw new SemanticRepairError(`Semantic repair target was not found: ${description}.`);
  }
  return index;
}

function renameCandidateKey(proposal, from, to) {
  if (from === to) return;
  const field = proposal.fields.find((item) => item.key === from);
  const actionIsProgression = proposal.state.progression.key === from;
  if (!field && !actionIsProgression) {
    throw new SemanticRepairError(`Cannot rename unknown semantic key "${from}".`);
  }
  if (
    proposal.fields.some((item) => item.key === to) ||
    proposal.state.progression.key === to
  ) {
    throw new SemanticRepairError(`Cannot rename semantic key to existing key "${to}".`);
  }

  if (field) {
    field.key = to;
    proposal.state.visibleControlKeys = proposal.state.visibleControlKeys.map(
      (key) => (key === from ? to : key),
    );
    for (const section of proposal.sections) {
      section.fieldKeys = section.fieldKeys.map((key) => (key === from ? to : key));
    }
    for (const target of proposal.mechanics.fieldTargets) {
      if (target.fieldKey === from) target.fieldKey = to;
    }
    for (const guidance of proposal.guidance) {
      if (guidance.scopeKind === "question" && guidance.scopeKey === from) {
        guidance.scopeKey = to;
      }
    }
  } else {
    proposal.state.progression.key = to;
    proposal.mechanics.progressionTarget.key = to;
  }
  for (const action of proposal.proposedActions) {
    if (action.targetKey === from) action.targetKey = to;
  }
  for (const rationale of proposal.rationale) {
    if (rationale.subjectKey === from) rationale.subjectKey = to;
  }
}

function removeField(proposal, key) {
  const index = indexBy(proposal.fields, (item) => item.key === key, key);
  proposal.fields.splice(index, 1);
  proposal.state.visibleControlKeys = proposal.state.visibleControlKeys.filter(
    (item) => item !== key,
  );
  proposal.mechanics.fieldTargets = proposal.mechanics.fieldTargets.filter(
    (item) => item.fieldKey !== key,
  );
  proposal.proposedActions = proposal.proposedActions.filter(
    (item) => item.targetKey !== key,
  );
  proposal.rationale = proposal.rationale.filter(
    (item) => item.subjectKey !== key,
  );
  for (const section of proposal.sections) {
    section.fieldKeys = section.fieldKeys.filter((item) => item !== key);
  }
  proposal.guidance = proposal.guidance.filter(
    (item) => !(item.scopeKind === "question" && item.scopeKey === key),
  );
}

function replaceAction(proposal, targetKey, replacement) {
  const index = indexBy(
    proposal.proposedActions,
    (item) => item.proposalId === targetKey || item.targetKey === targetKey,
    targetKey,
  );
  proposal.proposedActions[index] = structuredClone(replacement);
}

function removeAction(proposal, targetKey) {
  const index = indexBy(
    proposal.proposedActions,
    (item) => item.proposalId === targetKey || item.targetKey === targetKey,
    targetKey,
  );
  proposal.proposedActions.splice(index, 1);
}

function applyOperation(proposal, operation) {
  const { op, targetKey, value } = operation;
  if (op === "replace_source_fact_ids") {
    const field = proposal.fields.find((item) => item.key === targetKey);
    if (!field) throw new SemanticRepairError(`Unknown field "${targetKey}".`);
    field.sourceFactIds = [...value];
  } else if (op === "replace_field_mechanics") {
    const index = indexBy(
      proposal.mechanics.fieldTargets,
      (item) => item.fieldKey === targetKey,
      targetKey,
    );
    proposal.mechanics.fieldTargets[index] = structuredClone(value);
  } else if (op === "rename_candidate_key") {
    renameCandidateKey(proposal, targetKey, value);
  } else if (op === "replace_field") {
    const index = indexBy(proposal.fields, (item) => item.key === targetKey, targetKey);
    proposal.fields[index] = structuredClone(value);
  } else if (op === "add_field") {
    if (proposal.fields.some((item) => item.key === value.key)) {
      throw new SemanticRepairError(`Field "${value.key}" already exists.`);
    }
    proposal.fields.push(structuredClone(value));
  } else if (op === "remove_field") {
    removeField(proposal, targetKey);
  } else if (op === "replace_progression") {
    if (!value.stateProgression || !value.mechanicsTarget) {
      throw new SemanticRepairError(
        "replace_progression requires stateProgression and mechanicsTarget.",
      );
    }
    proposal.state.progression = structuredClone(value.stateProgression);
    proposal.mechanics.progressionTarget = structuredClone(value.mechanicsTarget);
  } else if (op === "replace_action") {
    replaceAction(proposal, targetKey, value);
  } else if (op === "add_action") {
    proposal.proposedActions.push(structuredClone(value));
  } else if (op === "remove_action") {
    removeAction(proposal, targetKey);
  } else if (op === "replace_sections") {
    proposal.sections = structuredClone(value);
  } else if (op === "replace_guidance") {
    proposal.guidance = structuredClone(value);
  } else {
    throw new SemanticRepairError(`Unsupported semantic repair operation: ${op}.`);
  }
}

export function semanticRepairBindingIssues(proposal, observation) {
  const controls = new Map(
    (observation?.controls || []).map((fact) => [fact.factId, fact]),
  );
  const actions = new Map(
    (observation?.actions || []).map((fact) => [fact.factId, fact]),
  );
  const issues = [];
  const ownerByFact = new Map();

  for (const field of proposal.fields) {
    for (const factId of field.sourceFactIds) {
      if (!controls.has(factId)) {
        issues.push({
          code: "semantic_binding_missing",
          targetKey: field.key,
          detail: `Source fact "${factId}" is not an observed control fact.`,
        });
        continue;
      }
      const owner = ownerByFact.get(factId);
      if (owner && owner !== field.key) {
        issues.push({
          code: "semantic_binding_ownership_conflict",
          targetKey: field.key,
          detail: `Source fact "${factId}" is already owned by "${owner}".`,
        });
      } else {
        ownerByFact.set(factId, field.key);
      }
    }
    const allowedSelectors = new Set(
      field.sourceFactIds.flatMap(
        (factId) => controls.get(factId)?.selectorCandidates || [],
      ),
    );
    const mechanics = proposal.mechanics.fieldTargets.find(
      (target) => target.fieldKey === field.key,
    );
    if (
      !mechanics ||
      mechanics.selectors.length === 0 ||
      mechanics.selectors.some((selector) => !allowedSelectors.has(selector))
    ) {
      issues.push({
        code: "semantic_binding_selector_mismatch",
        targetKey: field.key,
        detail:
          "The field mechanics are not fully derived from its current source-fact bindings.",
      });
    }
  }

  const progression = proposal.mechanics.progressionTarget;
  const actionFact = actions.get(progression.sourceFactId);
  if (!actionFact) {
    issues.push({
      code: "semantic_progression_binding_missing",
      targetKey: progression.key,
      detail: `Progression source fact "${progression.sourceFactId}" is not observed.`,
    });
  } else if (
    progression.selectors.some(
      (selector) => !(actionFact.selectorCandidates || []).includes(selector),
    )
  ) {
    issues.push({
      code: "semantic_progression_selector_mismatch",
      targetKey: progression.key,
      detail:
        "The progression mechanics are not fully derived from its current source-fact binding.",
    });
  }
  return issues;
}

export function applySemanticRepair({ proposal, repair, observation = null }) {
  validateSemanticProposal(proposal, observation?.existingContract);
  validateSemanticRepairDocument(repair);
  const baseHash = hashJson(proposal);
  if (repair.baseCandidateHash !== baseHash) {
    throw new SemanticRepairError(
      "Semantic repair base hash does not match the supplied candidate.",
      "SEMANTIC_REPAIR_BASE_MISMATCH",
    );
  }
  const candidate = structuredClone(proposal);
  const invalidatedTargetKeys = new Set();
  for (const operation of repair.operations) {
    applyOperation(candidate, operation);
    invalidatedTargetKeys.add(operation.targetKey);
    if (operation.op === "rename_candidate_key") {
      invalidatedTargetKeys.add(operation.value);
    }
  }
  validateSemanticProposal(candidate, observation?.existingContract);
  const bindingIssues = observation
    ? semanticRepairBindingIssues(candidate, observation)
    : [];
  if (bindingIssues.length > 0) {
    const error = new SemanticRepairError(
      `Repaired semantic candidate has ${bindingIssues.length} binding issue(s).`,
      "SEMANTIC_REPAIR_BINDING_INVALID",
    );
    error.issues = bindingIssues;
    throw error;
  }
  return {
    proposal: candidate,
    candidateHash: hashJson(candidate),
    parentCandidateHash: baseHash,
    invalidatedTargetKeys: [...invalidatedTargetKeys].sort(),
    repairId: repair.repairId,
  };
}
