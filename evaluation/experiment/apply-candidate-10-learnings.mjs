import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260813211839_84ac25b7",
);
const learningPath = path.join(runRoot, "learnings.json");
const logPath = path.join(runRoot, "managed-api.log");
const [learningText, logText] = await Promise.all([
  readFile(learningPath, "utf8"),
  readFile(logPath, "utf8"),
]);
const learning = JSON.parse(learningText);

const causes = {
  "site_p_crosspage_echo/safe_echo":
    "Cross-state reporting counted one extra logical form surface; stable journey-level form identity remains a separate generic reporting requirement.",
  "site_n_payment/primary":
    "The payment boundary was handled safely, while descriptive sensitivity metadata remained broader than the oracle classification; runtime protection and report taxonomy need separate normalization.",
  "site_x_hidden_choice/primary":
    "Fresh semantic generation represented one observed radio group as separate target fields. Actuator preflight still knew the failed target was a radio, but the failure envelope dropped that control type when semantic and aggregated contract keys differed, suppressing the generic probe_actuation_failed safe-halt signal.",
  "site_af_branch_cards/primary":
    "The branch journey and capture completed, while one revealed field retained a semantic type mismatch; branch-local semantic normalization remains separate from repair transactions.",
  "site_l_gated/primary":
    "The interaction-gated journey completed safely, but cross-state form count and field ordering remained imperfect; stable aggregation identity and reporting order are separate generic capabilities.",
  "site_ac_div_intake/primary":
    "Fresh semantic generation retained an observed custom virtual control without an accepted primary typed action. Bounded semantic validation then halted before all field entry. This exposes a generic semantic-repair completeness gap for non-input widgets, plus the separate missing ambiguity-report signal.",
};

for (const test of learning.tests || []) {
  for (const item of [...(test.worked || []), ...(test.failed || [])]) {
    for (const evidence of item.evidence || []) {
      evidence.artifact = evidence.artifact.replace(
        "/raw/../scoring/",
        "/scoring/",
      );
      if (
        test.scenarioKey === "site_ac_div_intake/primary" &&
        evidence.artifact.endsWith("/scoring/submission.json")
      ) {
        evidence.artifact = evidence.artifact.replace(
          "/scoring/submission.json",
          "/scoring/submission-missing.json",
        );
      }
    }
  }
  for (const failed of test.failed || []) {
    failed.generalizableCause =
      causes[test.scenarioKey] ||
      "The cited failure remains a separate generic capability and is not evidence for a fixture-specific production rule.";
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        "This forced-fresh run permits model-generated state decompositions to vary; causal credit is limited to explicit events, failure envelopes, and preserved terminal behavior rather than score movement alone.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/pages",
        },
      ],
    },
  ];
}

const byScenario = new Map(
  learning.tests.map((test) => [test.scenarioKey, test]),
);
const appendWorked = (scenarioKey, item) => {
  const worked = byScenario.get(scenarioKey)?.worked;
  if (worked && !worked.some((entry) => entry.claim === item.claim)) {
    worked.push(item);
  }
};
appendWorked("site_c_veterans/primary", {
  claim:
    "Branch-delta progression delegation remained active and the ordinary conditional journey stayed a strict 100-point pass.",
  evidence: [
    { artifact: "managed-api.log" },
    {
      artifact:
        "batches/batch-01/site_c_veterans/primary/trial-01/scoring/score.json",
      pointer: "/overallScore",
    },
  ],
  whyItMatters:
    "The repair changes did not reintroduce the earlier branch-script regression.",
  preservationInvariant:
    "Branch-only scripts validate delta fields, delegate parent progression, and retain strict conditional execution.",
  confidence: "high",
});
appendWorked("site_l_gated/primary", {
  claim:
    "The gated journey completed with field entry, required preparation, terminal submission, and safety intact at 93.967.",
  evidence: [
    {
      artifact:
        "batches/batch-01/site_l_gated/primary/trial-01/scoring/score.json",
      pointer: "/overallScore",
    },
    {
      artifact:
        "batches/batch-01/site_l_gated/primary/trial-01/raw/report.json",
      pointer: "/findings",
    },
  ],
  whyItMatters:
    "The prior 62.270 gated failure was not repeated, although the new repair obligation did not need to activate in this model-generated journey order.",
  preservationInvariant:
    "Gated controls may be handled in any observed order, but required preparation must remain grounded, verified, and local to the dependent target.",
  confidence: "high",
});

const eventCount = (kind) =>
  (logText.match(new RegExp(` ${kind}:`, "g")) || []).length;
learning.analysisStatus = "complete";
learning.summary =
  "Candidate 10 was rejected at the frozen fix checkpoint: 89.160 overall, 1/7 strict, 6/7 safety, seven valid trials, and zero invalid trials. The gated journey recovered from 62.270 to 93.967 and the conditional canary remained strict 100, but fresh generation split a hidden radio group into separate semantic targets and the failure envelope dropped their radio type. That suppressed the established generic probe_actuation_failed signal and made the hidden-choice canary unsafe. A separate fresh-generation variation also left a custom virtual control without a typed action, halting that journey during semantic validation. Regression and rotating remain skipped.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were infrastructure-valid and six were safety-clean.",
    "The ordinary conditional canary stayed strict 100 with branch progression delegation active.",
    "The interaction-gated journey completed safely at 93.967 instead of repeating Candidate 09b's 62.270 loss.",
    "Payment, cross-page echo, branch cards, and custom controls preserved their terminal boundaries.",
  ],
  failedPatterns: [
    "Control-type provenance was not retained end-to-end when a fresh semantic proposal used target keys that differed from the aggregated contract key.",
    "Because the final safe-halt classifier lacked the known radio type, it did not emit probe_actuation_failed even though browser preflight halted before applicant entry and submission.",
    "The live gated path did not require repair, so the prerequisite obligation has a deterministic browser integration witness but no live cohort activation witness yet.",
    "The custom-control journey halted in semantic validation because a visible virtual widget lacked an accepted primary typed action; this did not occur on the prior identical-plan generation and is not causally attributable to the prerequisite repair change.",
  ],
  preservationRisks: [
    "Do not weaken choice-control safety classification when semantic target keys vary.",
    "Do not remove branch-delta delegation, grounded prerequisite enforcement, lineage, target isolation, or sibling checkpoint retention.",
    "Do not treat a recovered gated score as proof of the repair path unless activation evidence exists.",
  ],
  recommendations: [
    "Carry semantic controlType on typed preflight issues and prefer it when building the final failure envelope.",
    "Rerun the identical fix plan with no other repair-logic change; require 7/7 safety and the hidden-choice probe_actuation_failed signal.",
    "Keep the deterministic browser integration test as the prerequisite-repair activation witness; seek live activation without forcing a fixture-specific state order.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_safety_regression",
  sourceFingerprint:
    "d555a726c82e1c1a4c7eae798d6e3941e4e0948958b228ad983dcdba53870875",
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  nextCandidate: "candidate_10a_failure_control_type_provenance",
};
learning.activationWitnesses = {
  progressionDelegated: eventCount("actuator_progression_delegated"),
  prerequisiteObligationDeclared: eventCount(
    "repair_prerequisite_obligation_declared",
  ),
  prerequisiteObligationSatisfied: eventCount(
    "repair_prerequisite_obligation_satisfied",
  ),
  targetLocalExhausted: eventCount("actuator_target_local_exhausted"),
};

await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
console.log(learningPath);
