import { validateRepairDiagnosis } from "../contracts/semantic-actuator-schemas.mjs";

const SEMANTIC_CODES = new Set([
  "semantic_binding_missing",
  "semantic_binding_ownership_conflict",
  "semantic_binding_selector_mismatch",
  "semantic_progression_binding_missing",
  "semantic_progression_selector_mismatch",
  "semantic_binding_mismatch",
  "semantic_meaning_mismatch",
  "proposal_fact_binding",
  "source_fact_ownership",
  "radio_group_ownership",
  "progression_action_contract",
  "wrong_field_id",
]);

const ACTUATOR_CODES = new Set([
  "locator_unresolved",
  "actuation_unverified",
  "readback_unverified",
  "handler_timeout",
  "handler_contract_violation",
  "capability_denied",
  "state_change_unverified",
  "validation_blocked",
  "actuator_generation_failed",
  "actuator_validation_blocked",
  "actuator_preflight_failed",
]);

const ENVIRONMENT_CODES = new Set([
  "environment_error",
  "network_error",
  "request_timeout",
  "browser_unavailable",
  "browser_capacity_reached",
]);

const DRIFT_CODES = new Set([
  "drift_suspected",
  "form_change_suspected",
  "drift_undeclared_required",
  "unrecognized_state",
]);

function issueCode(issue) {
  return String(issue?.code || issue?.failureCode || issue?.type || "");
}

function issueId(issue, index) {
  return String(issue?.issueId || issue?.id || `issue_${index + 1}`);
}

function deterministicClassification(stage, issues) {
  if (String(stage || "").startsWith("semantic_")) return "semantic";
  if (stage === "actuator_generation_failed" || stage === "actuator_validation_blocked") {
    return "actuator";
  }
  if (stage === "environment_failed") return "environment";
  if (stage === "drift_suspected") return "drift_suspicion";

  const classes = new Set();
  for (const issue of issues) {
    const code = issueCode(issue);
    if (SEMANTIC_CODES.has(code) || code.startsWith("semantic_")) {
      classes.add("semantic");
    } else if (ACTUATOR_CODES.has(code) || code.startsWith("actuator_")) {
      classes.add("actuator");
    } else if (ENVIRONMENT_CODES.has(code)) {
      classes.add("environment");
    } else if (DRIFT_CODES.has(code) || code.startsWith("drift_")) {
      classes.add("drift_suspicion");
    }
  }
  if (classes.has("drift_suspicion")) return "drift_suspicion";
  if (classes.has("environment") && classes.size === 1) return "environment";
  if (classes.has("semantic") && classes.has("actuator")) return "both";
  if (classes.size === 1) return [...classes][0];
  return null;
}

function routeFor(classification) {
  if (classification === "semantic") {
    return {
      nextState: "semantic_repair",
      repairLayers: ["semantic"],
      invalidateActuatorHandlers: true,
      retryInfrastructure: false,
      recrawl: false,
    };
  }
  if (classification === "actuator") {
    return {
      nextState: "actuator_repair",
      repairLayers: ["actuator"],
      invalidateActuatorHandlers: false,
      retryInfrastructure: false,
      recrawl: false,
    };
  }
  if (classification === "both") {
    return {
      nextState: "semantic_repair",
      repairLayers: ["semantic", "actuator"],
      invalidateActuatorHandlers: true,
      retryInfrastructure: false,
      recrawl: false,
    };
  }
  if (classification === "environment") {
    return {
      nextState: "environment_retry",
      repairLayers: [],
      invalidateActuatorHandlers: false,
      retryInfrastructure: true,
      recrawl: false,
    };
  }
  return {
    nextState: "drift_recrawl",
    repairLayers: [],
    invalidateActuatorHandlers: true,
    retryInfrastructure: false,
    recrawl: true,
  };
}

export function routeRepair({
  stage = "",
  issues = [],
  diagnosis = null,
  preferDiagnosis = false,
}) {
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new TypeError("Repair routing requires at least one structured issue.");
  }
  const deterministic = deterministicClassification(stage, issues);
  let classification = preferDiagnosis && diagnosis
    ? null
    : deterministic;
  let diagnosisId = null;
  if (!classification) {
    if (!diagnosis) {
      return {
        classification: "ambiguous",
        nextState: "diagnosis_required",
        repairLayers: [],
        invalidateActuatorHandlers: false,
        retryInfrastructure: false,
        recrawl: false,
        issueIds: issues.map(issueId),
        diagnosisId: null,
      };
    }
    validateRepairDiagnosis(diagnosis);
    classification = diagnosis.classification;
    diagnosisId = diagnosis.diagnosisId;
  }
  const route = routeFor(classification);
  return {
    classification,
    ...route,
    issueIds: issues.map(issueId),
    diagnosisId,
  };
}
