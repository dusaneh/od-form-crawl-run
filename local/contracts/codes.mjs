function closed(values) {
  return Object.freeze([...values]);
}

export const PROGRESSION_KINDS = closed(["advance", "terminal_submit"]);

export const FIELD_RESULT_STATES = closed([
  "unattempted",
  "verified",
  "failed",
]);

export const FIELD_FAILURE_CODES = closed([
  "locator_unresolved",
  "actuation_unverified",
  "could_not_test",
  "validation_blocked",
  "type_mismatch",
  "drift_undeclared_required",
]);

export const STATE_OUTCOMES = closed([
  "completed",
  "blocked",
  "failed",
]);

export const PROGRESSION_OUTCOMES = closed([
  "not_attempted",
  "confirmed",
  "blocked",
  "failed",
]);

export const PROGRESSION_FAILURE_CODES = closed([
  "advance_no_navigation",
  "ambiguous_terminal",
  "terminal_submission_blocked",
  "validation_blocked",
  "challenge_detected",
  "login_or_payment_detected",
  "form_change_suspected",
  "repeated_state_unrepresentable",
]);

export const PROPOSAL_REJECTION_CODES = closed([
  "captcha_interaction",
  "credential_interaction",
  "login_interaction",
  "payment_interaction",
  "upload_interaction",
  "legal_acceptance_interaction",
  "terminal_submission",
  "ambiguous_progression",
  "outside_contract",
  "unsafe_value",
]);

export const FAULT_CLASSES = closed([
  "input_data_fault",
  "environment_fault",
  "form_change_suspicion",
]);

export const CONTROL_TYPES = closed([
  "text",
  "password",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "switch",
  "file",
  "hidden",
  "custom",
]);

export const GUIDANCE_KINDS = closed([
  "instruction",
  "help",
  "eligibility",
  "legal_notice",
  "warning",
  "privacy",
  "example",
]);

export const CLOSED_CODE_SETS = Object.freeze({
  progressionKinds: PROGRESSION_KINDS,
  fieldResultStates: FIELD_RESULT_STATES,
  fieldFailureCodes: FIELD_FAILURE_CODES,
  stateOutcomes: STATE_OUTCOMES,
  progressionOutcomes: PROGRESSION_OUTCOMES,
  progressionFailureCodes: PROGRESSION_FAILURE_CODES,
  proposalRejectionCodes: PROPOSAL_REJECTION_CODES,
  faultClasses: FAULT_CLASSES,
  controlTypes: CONTROL_TYPES,
  guidanceKinds: GUIDANCE_KINDS,
});
