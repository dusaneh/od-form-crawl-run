import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProgressionActionOutcome,
  excludedProgressionFactIssues,
  noEffectReplanEligibility,
  noEffectReplanFeedback,
  progressionActionExclusion,
  shouldSkipNoEffectProgressionReplay,
} from "../local/semantic/action-outcome.mjs";

function proposal({
  factId = "action_check",
  selector = "#check-eligibility",
  key = "check_eligibility",
  kind = "advance",
} = {}) {
  return {
    proposalId: "proposal_1",
    state: { progression: { key, kind } },
    mechanics: {
      progressionTarget: {
        sourceFactId: factId,
        selectors: [selector],
      },
    },
  };
}

test("typed action outcomes do not treat an executed click as progression", () => {
  const outcome = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
    },
    afterObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
    },
    dynamicsOutcome: "uncertain",
  });

  assert.equal(outcome.outcome, "no_effect");
  assert.equal(outcome.urlChanged, false);
  assert.equal(outcome.revealedControlCount, 0);
  assert.equal(outcome.changedControlCount, 0);
});

test("an LLM validation label cannot replace a newly observed validation marker", () => {
  const before = {
    url: "https://example.invalid/intake",
    normalizedRoute: "/intake",
    title: "Intake",
    heading: "Application",
    actions: [],
    sections: [],
    guidance: [],
  };
  const unsupported = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: before,
    afterObservation: before,
    dynamicsOutcome: "validation_only",
    validationMessagesBefore: [],
    validationMessagesAfter: [],
  });
  assert.equal(unsupported.outcome, "no_effect");

  const evidenced = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: before,
    afterObservation: before,
    dynamicsOutcome: "validation_only",
    validationMessagesBefore: [],
    validationMessagesAfter: ["Eligibility information is ready."],
  });
  assert.equal(evidenced.outcome, "validation_feedback");
  assert.deepEqual(evidenced.newValidationMessages, [
    "eligibility information is ready.",
  ]);
});

test("a changed non-control semantic surface is a cosmetic effect", () => {
  const outcome = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
      heading: "Application",
      actions: [],
      sections: [],
      guidance: [],
    },
    afterObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
      heading: "Application reviewed",
      actions: [],
      sections: [],
      guidance: [],
    },
    dynamicsOutcome: "cosmetic",
  });
  assert.equal(outcome.outcome, "cosmetic_change");
  assert.equal(outcome.semanticSurfaceChanged, true);
});

test("URL movement and substantive same-page reveals remain typed effects", () => {
  const navigation = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: {
      url: "https://example.invalid/step-1",
      normalizedRoute: "/step-1",
    },
    afterObservation: {
      url: "https://example.invalid/step-2",
      normalizedRoute: "/step-2",
    },
  });
  assert.equal(navigation.outcome, "page_advance");

  const disclosure = classifyProgressionActionOutcome({
    progressionKind: "advance",
    beforeObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
    },
    afterObservation: {
      url: "https://example.invalid/intake",
      normalizedRoute: "/intake",
    },
    revealedControls: [{ factId: "field_revealed" }],
    dynamicsOutcome: "same_page_disclosure",
  });
  assert.equal(disclosure.outcome, "control_delta");
});

test("a no-effect replan is bounded and requires verified fields", () => {
  const outcome = { outcome: "no_effect" };
  const plan = {
    progression: { kind: "advance", modelProposed: true },
  };
  const verified = [
    {
      field: { required: true },
      outcome: { verified: true, skipped: false },
    },
  ];

  assert.equal(
    noEffectReplanEligibility({
      outcome,
      plan,
      fieldResults: verified,
      attemptsUsed: 0,
      maxAttempts: 1,
    }).eligible,
    true,
  );
  assert.equal(
    noEffectReplanEligibility({
      outcome,
      plan,
      fieldResults: verified,
      attemptsUsed: 1,
      maxAttempts: 1,
    }).reason,
    "replan_budget_exhausted",
  );
  assert.equal(
    noEffectReplanEligibility({
      outcome,
      plan,
      fieldResults: [
        {
          field: { required: true },
          outcome: { verified: false },
        },
      ],
      attemptsUsed: 0,
      maxAttempts: 1,
    }).reason,
    "required_field_not_verified",
  );
});

test("the unchanged action fact and selector predicate cannot be regenerated", () => {
  const prior = proposal();
  const exclusion = progressionActionExclusion(prior);

  assert.equal(
    excludedProgressionFactIssues(proposal(), exclusion).length,
    1,
  );
  assert.equal(
    excludedProgressionFactIssues(
      proposal({
        factId: "action_submit",
        selector: "button[type=submit]",
        key: "submit_application",
        kind: "terminal_submit",
      }),
      exclusion,
    ).length,
    0,
  );

  const feedback = noEffectReplanFeedback({
    priorProposal: prior,
    outcome: { outcome: "no_effect" },
    exclusion,
    attemptsUsed: 1,
    maxAttempts: 1,
  });
  assert.equal(feedback.kind, "nonterminal_no_effect_replan");
  assert.equal(feedback.excludedProgression.sourceFactId, "action_check");
});

test("deterministic replay skips only a fully typed discarded progression", () => {
  assert.equal(
    shouldSkipNoEffectProgressionReplay({
      progression: {
        dynamicContinuation: true,
        noEffectContinuation: true,
        replayDisposition: "skip_observed_no_effect",
      },
    }),
    true,
  );
  assert.equal(
    shouldSkipNoEffectProgressionReplay({
      progression: {
        dynamicContinuation: true,
        samePageRevealAction: true,
      },
    }),
    false,
  );
});
