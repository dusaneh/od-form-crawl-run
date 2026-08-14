export const PROGRESSION_ACTION_OUTCOME_SCHEMA_VERSION = 1;

export const PROGRESSION_ACTION_OUTCOMES = Object.freeze([
  "page_advance",
  "control_delta",
  "validation_feedback",
  "cosmetic_change",
  "terminal_result",
  "no_effect",
]);

function normalizedSelectors(selectors = []) {
  return [...new Set(selectors.map((value) => String(value || "").trim()))]
    .filter(Boolean)
    .sort();
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedMessages(messages = []) {
  return [...new Set(messages.map(normalizedText))].filter(Boolean).sort();
}

function semanticSurface(observation = {}) {
  const text = (rows = []) =>
    rows
      .flatMap((row) =>
        typeof row === "string"
          ? [row]
          : [
              row?.rawText,
              row?.label,
              row?.title,
              row?.description,
              row?.text,
            ],
      )
      .map(normalizedText)
      .filter(Boolean)
      .sort();
  return JSON.stringify({
    title: normalizedText(observation.title),
    heading: normalizedText(observation.heading),
    sections: text(observation.sections),
    guidance: text(observation.guidance),
    actions: (observation.actions || [])
      .filter((action) => action?.visible === true)
      .map((action) => ({
        factId: String(action.factId || ""),
        rawText: normalizedText(action.rawText),
        rawType: normalizedText(action.rawType),
      }))
      .sort((left, right) =>
        `${left.factId}:${left.rawText}`.localeCompare(
          `${right.factId}:${right.rawText}`,
        ),
      ),
  });
}

export function progressionActionExclusion(proposal) {
  const target = proposal?.mechanics?.progressionTarget || {};
  return {
    sourceFactId: String(target.sourceFactId || ""),
    selectors: normalizedSelectors(target.selectors),
    progressionKind: String(proposal?.state?.progression?.kind || ""),
  };
}

export function classifyProgressionActionOutcome({
  progressionKind,
  beforeObservation = {},
  afterObservation = {},
  revealedControls = [],
  changedControls = [],
  dynamicsOutcome = null,
  terminalAssessment = null,
  validationMessagesBefore = [],
  validationMessagesAfter = [],
}) {
  const beforeUrl = String(beforeObservation?.url || "");
  const afterUrl = String(afterObservation?.url || "");
  const urlChanged = Boolean(beforeUrl && afterUrl && beforeUrl !== afterUrl);
  const routeChanged =
    String(beforeObservation?.normalizedRoute || "") !==
    String(afterObservation?.normalizedRoute || "");
  const revealedControlCount = revealedControls.length;
  const changedControlCount = changedControls.length;
  const terminalEvidence = Boolean(terminalAssessment);
  const beforeValidationMessages = normalizedMessages(
    validationMessagesBefore,
  );
  const afterValidationMessages = normalizedMessages(
    validationMessagesAfter,
  );
  const priorValidation = new Set(beforeValidationMessages);
  const newValidationMessages = afterValidationMessages.filter(
    (message) => !priorValidation.has(message),
  );
  const semanticSurfaceChanged =
    semanticSurface(beforeObservation) !== semanticSurface(afterObservation);

  let outcome = "no_effect";
  if (terminalEvidence) {
    outcome = "terminal_result";
  } else if (urlChanged || routeChanged) {
    outcome = "page_advance";
  } else if (revealedControlCount + changedControlCount > 0) {
    outcome = "control_delta";
  } else if (newValidationMessages.length > 0) {
    outcome = "validation_feedback";
  } else if (semanticSurfaceChanged) {
    outcome = "cosmetic_change";
  }

  return {
    schemaVersion: PROGRESSION_ACTION_OUTCOME_SCHEMA_VERSION,
    outcome,
    progressionKind: String(progressionKind || ""),
    beforeUrl,
    afterUrl,
    urlChanged,
    routeChanged,
    revealedControlCount,
    changedControlCount,
    dynamicsOutcome: dynamicsOutcome || null,
    terminalEvidence,
    beforeValidationMessages,
    afterValidationMessages,
    newValidationMessages,
    semanticSurfaceChanged,
  };
}

export function excludedProgressionFactIssues(proposal, exclusion) {
  if (!exclusion) return [];
  const candidate = progressionActionExclusion(proposal);
  const sameFact =
    Boolean(exclusion.sourceFactId) &&
    candidate.sourceFactId === exclusion.sourceFactId;
  const excludedSelectors = new Set(normalizedSelectors(exclusion.selectors));
  const samePredicate =
    excludedSelectors.size > 0 &&
    candidate.selectors.some((selector) => excludedSelectors.has(selector));
  if (!sameFact && !samePredicate) return [];

  return [
    {
      type: "excluded_no_effect_progression",
      code: "excluded_no_effect_progression",
      targetKey: proposal?.state?.progression?.key || "progression",
      detail:
        "This observed action was already executed in the unchanged state and produced no URL, control, validation, or terminal delta.",
      instruction:
        "Choose a different grounded visible action fact for the next journey progression. Do not repeat the excluded source fact or selector predicate. If no different valid progression exists, validation must exhaust and halt without another click.",
      excludedSourceFactId: exclusion.sourceFactId || "",
      selectorCandidates: normalizedSelectors(exclusion.selectors),
    },
  ];
}

export function noEffectReplanEligibility({
  outcome,
  plan,
  fieldResults = [],
  attemptsUsed = 0,
  maxAttempts = 1,
}) {
  if (outcome?.outcome !== "no_effect") {
    return { eligible: false, reason: "action_had_typed_effect" };
  }
  if (
    plan?.progression?.kind !== "advance" ||
    plan?.progression?.modelProposed !== true
  ) {
    return { eligible: false, reason: "not_model_proposed_advance" };
  }
  if (
    fieldResults.some(
      ({ field, outcome: fieldOutcome }) =>
        field?.required &&
        (fieldOutcome?.verified !== true || fieldOutcome?.skipped === true),
    )
  ) {
    return { eligible: false, reason: "required_field_not_verified" };
  }
  if (attemptsUsed >= maxAttempts) {
    return { eligible: false, reason: "replan_budget_exhausted" };
  }
  return { eligible: true, reason: "bounded_replan_available" };
}

export function noEffectReplanFeedback({
  priorProposal,
  outcome,
  exclusion,
  attemptsUsed,
  maxAttempts,
}) {
  return {
    kind: "nonterminal_no_effect_replan",
    priorProposalId: String(priorProposal?.proposalId || ""),
    observedActionOutcome: outcome,
    excludedProgression: exclusion,
    attemptsUsed,
    maxAttempts,
    issues: excludedProgressionFactIssues(priorProposal, exclusion),
    instruction:
      "The prior state's fields are already part of existingContract and were verified. Generate only a new additive state decision from the freshly rendered evidence. Select a different grounded action fact for journey progression; never repeat the excluded no-effect fact or selector predicate. Preserve the active form journey and do not add unrelated page forms.",
  };
}

export function shouldSkipNoEffectProgressionReplay(plan) {
  return (
    plan?.progression?.dynamicContinuation === true &&
    plan?.progression?.noEffectContinuation === true &&
    plan?.progression?.replayDisposition === "skip_observed_no_effect"
  );
}
