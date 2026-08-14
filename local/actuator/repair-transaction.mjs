import { hashJson } from "../contracts/artifact-store.mjs";
import {
  validateActuatorRepairDocument,
  validateRepairDiagnosis,
  validateSemanticRepairDocument,
} from "../contracts/semantic-actuator-schemas.mjs";
import { inspectActuatorModule } from "./actuator-source.mjs";

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function normalizedStateIdentity(state = {}) {
  return {
    key: String(state.key || "state"),
    normalizedRoute: String(state.normalizedRoute || ""),
    visibleControlKeys: uniqueSorted(state.visibleControlKeys || []),
    progression: {
      key: String(state.progression?.key || ""),
      kind: String(state.progression?.kind || ""),
    },
  };
}

function validateRepair(repair) {
  if (repair?.layer === "semantic") {
    return validateSemanticRepairDocument(repair);
  }
  if (repair?.layer === "actuator") {
    return validateActuatorRepairDocument(repair);
  }
  throw new TypeError("Repair lineage requires a semantic or actuator repair document.");
}

export function assignRepairLineage({
  repair,
  artifactId,
  stateIdentity,
  attemptOrdinal,
}) {
  validateRepair(repair);
  if (!Number.isInteger(attemptOrdinal) || attemptOrdinal < 1) {
    throw new TypeError("Repair attempt ordinal must be a positive integer.");
  }
  const requestedRepairId = repair.repairId;
  const canonicalContent = structuredClone(repair);
  delete canonicalContent.repairId;
  const contentHash = hashJson(canonicalContent);
  const lineage = {
    schemaVersion: 1,
    artifactId: String(artifactId),
    stateIdentity: normalizedStateIdentity(stateIdentity),
    layer: repair.layer,
    parentHash: repair.baseCandidateHash || repair.baseBundleHash,
    attemptOrdinal,
    contentHash,
  };
  const assignedRepairId = `repair_${repair.layer}_${hashJson(lineage).slice(0, 40)}`;
  const assigned = {
    ...structuredClone(repair),
    repairId: assignedRepairId,
  };
  validateRepair(assigned);
  return {
    repair: assigned,
    lineage,
    provenance: {
      requestedRepairId,
      assignedRepairId,
      repairLineage: lineage,
    },
  };
}

export function assignDiagnosisIdentity({ diagnosis, context = {} }) {
  const requestedDiagnosisId = diagnosis?.diagnosisId;
  const canonicalContent = {
    ...structuredClone(diagnosis),
    schemaVersion: 1,
  };
  delete canonicalContent.diagnosisId;
  const identity = {
    schemaVersion: 1,
    contentHash: hashJson(canonicalContent),
    contextHash: hashJson(context),
  };
  const assignedDiagnosisId = `diagnosis_${hashJson(identity).slice(0, 40)}`;
  const assigned = {
    ...canonicalContent,
    diagnosisId: assignedDiagnosisId,
  };
  validateRepairDiagnosis(assigned);
  return {
    diagnosis: assigned,
    provenance: {
      requestedDiagnosisId,
      assignedDiagnosisId,
      diagnosisIdentity: identity,
    },
  };
}

export function failurePredicates(issues = []) {
  const byFingerprint = new Map();
  for (const issue of issues) {
    const targetKey = String(issue?.targetKey || "state");
    const code = String(
      issue?.code || issue?.failureCode || issue?.type || "unknown_failure",
    );
    const fingerprint = `${targetKey}|${code}`;
    if (!byFingerprint.has(fingerprint)) {
      byFingerprint.set(fingerprint, { targetKey, code, fingerprint });
    }
  }
  return [...byFingerprint.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}

export function repeatedFailurePredicates(failureHistory = [], issues = []) {
  const prior = new Set(
    failureHistory.flatMap((entry) =>
      failurePredicates(entry.issues || []).map((item) => item.fingerprint),
    ),
  );
  return failurePredicates(issues).filter((item) => prior.has(item.fingerprint));
}

export function actuatorRepairScope({ bundle, repair, issues = [] }) {
  validateActuatorRepairDocument(repair);
  const issueTargetKeys = uniqueSorted(
    failurePredicates(issues).map((item) => item.targetKey),
  );
  const issueTargets = new Set(issueTargetKeys);
  const handlers = new Map(
    (bundle.handlers || []).map((handler) => [handler.handlerId, handler]),
  );
  const affectedHandlers = [];
  for (const replacement of repair.replacements) {
    for (const handlerId of replacement.handlerIds) {
      const handler = handlers.get(handlerId);
      if (!handler) {
        throw new TypeError(
          `Actuator repair names unknown handler "${handlerId}".`,
        );
      }
      affectedHandlers.push(handler);
    }
  }
  const affectedHandlerIds = uniqueSorted(
    affectedHandlers.map((handler) => handler.handlerId),
  );
  const affectedTargetKeys = uniqueSorted(
    affectedHandlers.map((handler) => handler.targetKey),
  );
  const unexpectedTargetKeys = affectedTargetKeys.filter(
    (targetKey) => !issueTargets.has(targetKey),
  );
  if (affectedHandlerIds.length === 0 || unexpectedTargetKeys.length > 0) {
    const error = new TypeError(
      unexpectedTargetKeys.length > 0
        ? `Actuator repair changes targets outside the failure scope: ${unexpectedTargetKeys.join(", ")}.`
        : "Actuator repair does not identify an affected handler.",
    );
    error.code = "ACTUATOR_REPAIR_TARGET_SCOPE_INVALID";
    error.details = {
      issueTargetKeys,
      affectedHandlerIds,
      affectedTargetKeys,
      unexpectedTargetKeys,
    };
    throw error;
  }
  const affected = new Set(affectedHandlerIds);
  return {
    issueTargetKeys,
    affectedHandlerIds,
    affectedTargetKeys,
    retainedSiblingHandlerIds: uniqueSorted(
      (bundle.handlers || [])
        .filter((handler) => !affected.has(handler.handlerId))
        .map((handler) => handler.handlerId),
    ),
    retainedSiblingTargetKeys: uniqueSorted(
      (bundle.handlers || [])
        .filter(
          (handler) =>
            handler.targetKind === "field" && !affected.has(handler.handlerId),
        )
        .map((handler) => handler.targetKey),
    ),
  };
}

export function actuatorRepairStrategy({ bundle, repair, scope }) {
  validateActuatorRepairDocument(repair);
  const availableModules = new Set([
    ...(bundle.modules || []).map((item) => item.modulePath),
    ...repair.replacements.map((item) => item.modulePath),
  ]);
  const handlers = new Map(
    (bundle.handlers || []).map((handler) => [handler.handlerId, handler]),
  );
  const strategy = repair.replacements
    .map((replacement) => {
      const inspection = inspectActuatorModule({
        modulePath: replacement.modulePath,
        source: replacement.source,
        availableModules,
      });
      return {
        handlers: replacement.handlerIds
          .map((handlerId) => handlers.get(handlerId))
          .filter(Boolean)
          .map((handler) => ({
            targetKind: handler.targetKind,
            targetKey: handler.targetKey,
            operations: uniqueSorted(handler.operations || []),
            sourceFactIds: uniqueSorted(handler.sourceFactIds || []),
          }))
          .sort((left, right) =>
            `${left.targetKind}:${left.targetKey}`.localeCompare(
              `${right.targetKind}:${right.targetKey}`,
            ),
          ),
        usedMethods: inspection.usedMethods,
        strategySignals: inspection.strategySignals,
        capabilities: uniqueSorted(replacement.capabilities || []),
      };
    })
    .sort((left, right) =>
      JSON.stringify(left.handlers).localeCompare(JSON.stringify(right.handlers)),
    );
  return {
    strategyHash: hashJson({
      affectedTargetKeys: scope.affectedTargetKeys,
      strategy,
    }),
    contentHash: hashJson(
      repair.replacements.map((replacement) => ({
        modulePath: replacement.modulePath,
        sourceHash: replacement.sourceHash,
      })),
    ),
    strategy,
  };
}

export function compareRepairStrategy({
  priorStrategies = [],
  predicates = [],
  scope,
  strategy,
}) {
  const predicateFingerprints = uniqueSorted(
    predicates.map((item) => item.fingerprint),
  );
  const affectedTargetKeys = uniqueSorted(scope.affectedTargetKeys || []);
  const prior = [...priorStrategies]
    .reverse()
    .find(
      (entry) =>
        entry.predicateFingerprints.some((fingerprint) =>
          predicateFingerprints.includes(fingerprint),
        ) &&
        entry.affectedTargetKeys.some((targetKey) =>
          affectedTargetKeys.includes(targetKey),
        ),
    );
  return {
    compared: Boolean(prior),
    priorRepairId: prior?.repairId || null,
    priorStrategyHash: prior?.strategyHash || null,
    priorContentHash: prior?.contentHash || null,
    strategyChanged: prior ? prior.strategyHash !== strategy.strategyHash : null,
    contentChanged: prior ? prior.contentHash !== strategy.contentHash : null,
    semanticallyRepeated: prior
      ? prior.strategyHash === strategy.strategyHash
      : false,
  };
}

function issueRequestsPrerequisite(issue = {}) {
  const code = String(issue.code || issue.failureCode || "");
  const detail = String(issue.detail || "").toLowerCase();
  if (!["validation_blocked", "actuation_unverified"].includes(code)) {
    return false;
  }
  return /disabled|not enabled|not visible|unavailable|gated|prerequisite|read.?only/.test(
    detail,
  );
}

function selectorCandidates(value = {}) {
  return uniqueSorted([
    ...(value.selectorCandidates || []),
    ...(value.frameSelectorCandidates || []),
  ]);
}

function observedTargetFacts({ bundle, issues, observation }) {
  const issueTargets = new Set(
    failurePredicates(issues).map((item) => item.targetKey),
  );
  const sourceFactIds = new Set(
    (bundle.handlers || [])
      .filter((handler) => issueTargets.has(String(handler.targetKey || "")))
      .flatMap((handler) => handler.sourceFactIds || [])
      .map(String),
  );
  return (observation?.controls || []).filter((control) =>
    sourceFactIds.has(String(control.factId || "")),
  );
}

export function actuatorPrerequisiteObligation({
  bundle,
  issues = [],
  observation = null,
}) {
  const gatedIssues = issues.filter(issueRequestsPrerequisite);
  if (gatedIssues.length === 0) return null;
  const targetFacts = observedTargetFacts({ bundle, issues: gatedIssues, observation });
  if (
    targetFacts.length > 0 &&
    !targetFacts.some(
      (fact) =>
        fact.disabled === true ||
        fact.readOnly === true ||
        fact.visible === false,
    )
  ) {
    return null;
  }

  const candidates = [];
  for (const region of observation?.scrollRegions || []) {
    const selectors = selectorCandidates(region);
    if (selectors.length === 0) continue;
    candidates.push({
      factId: String(region.factId || ""),
      kind: "scroll_to_end",
      selectors,
      frameSelectors: uniqueSorted(region.frameSelectorCandidates || []),
      innerSelectors: uniqueSorted(region.selectorCandidates || []),
    });
  }
  for (const action of observation?.actions || []) {
    if (
      action.visible !== true ||
      action.disabled === true ||
      action.disclosureControl !== true ||
      action.disclosureExpanded === true
    ) {
      continue;
    }
    const selectors = selectorCandidates(action);
    if (selectors.length === 0) continue;
    candidates.push({
      factId: String(action.factId || ""),
      kind: "activate_disclosure",
      selectors,
      frameSelectors: [],
      innerSelectors: selectors,
    });
  }
  if (candidates.length === 0) return null;
  return {
    schemaVersion: 1,
    kind: "rendered_target_prerequisite",
    targetKeys: uniqueSorted(gatedIssues.map((issue) => issue.targetKey)),
    failurePredicates: failurePredicates(gatedIssues).map(
      (item) => item.fingerprint,
    ),
    targetFacts: targetFacts.map((fact) => ({
      factId: String(fact.factId || ""),
      disabled: fact.disabled === true,
      readOnly: fact.readOnly === true,
      visible: fact.visible !== false,
      selectors: uniqueSorted(fact.selectorCandidates || []),
    })),
    candidates,
    requiredPostconditionMethods: ["isEnabled", "isVisible"],
  };
}

function parsedApiSignal(signal) {
  const match = /^api:([^:]+):(.*)$/.exec(String(signal || ""));
  if (!match) return null;
  try {
    return { method: match[1], literals: JSON.parse(match[2]) };
  } catch {
    return null;
  }
}

export function assertActuatorPrerequisiteObligation({
  obligation,
  strategy,
}) {
  if (!obligation) return { satisfied: true, matchedCandidates: [] };
  const signals = (strategy?.strategy || [])
    .flatMap((item) => item.strategySignals || [])
    .map(parsedApiSignal)
    .filter(Boolean);
  const methods = new Set(signals.map((item) => item.method));
  const matchedCandidates = [];
  for (const candidate of obligation.candidates || []) {
    const allowedMethods =
      candidate.kind === "scroll_to_end"
        ? new Set(["scrollToEnd"])
        : new Set(["click", "dispatch"]);
    const selectorSet = new Set(candidate.selectors || []);
    const matched = signals.some(
      (signal) =>
        allowedMethods.has(signal.method) &&
        (signal.literals || []).some((literal) =>
          selectorSet.has(String(literal)),
        ),
    );
    if (matched) matchedCandidates.push(candidate.factId || candidate.kind);
  }
  const postconditionSatisfied = (
    obligation.requiredPostconditionMethods || []
  ).some((method) => methods.has(method));
  if (matchedCandidates.length === 0 || !postconditionSatisfied) {
    const error = new TypeError(
      "Actuator repair did not implement a grounded prerequisite and verify the dependent target afterward.",
    );
    error.code = "ACTUATOR_REPAIR_PREREQUISITE_UNSATISFIED";
    error.details = {
      targetKeys: obligation.targetKeys,
      candidateFactIds: (obligation.candidates || []).map(
        (candidate) => candidate.factId,
      ),
      matchedCandidates,
      postconditionSatisfied,
    };
    throw error;
  }
  return { satisfied: true, matchedCandidates };
}
