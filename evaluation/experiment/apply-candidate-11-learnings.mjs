import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260814000448_6bc1e624",
);
const learningPath = path.join(runRoot, "learnings.json");
const logPath = path.join(runRoot, "managed-api.log");
const [learningText, logText] = await Promise.all([
  readFile(learningPath, "utf8"),
  readFile(logPath, "utf8"),
]);
const learning = JSON.parse(learningText);

const causes = {
  "site_am_gethelp360/primary":
    "The journey, capture, and safety were complete; residual loss is canonical/reporting normalization and is unrelated to Candidate 11's execution capability.",
  "site_o_invisible_captcha/primary":
    "The invisible-CAPTCHA journey submitted safely; residual loss is structure/reporting normalization, not action-outcome execution.",
  "site_d_food/primary":
    "No failure remained: malformed markup stayed strict 100 and is a preservation canary.",
  "site_ai_fee_verify/primary":
    "The payment boundary halted safely; the small residual is descriptive reporting and must not weaken payment protection.",
  "site_ae_deep_portal/primary":
    "The nested upload/consent journey completed; residual structure normalization is outside Candidate 11.",
  "site_an_uw_housing/primary":
    "The controller observed zero URL delta, zero newly visible controls, zero changed controls, and no reflection after the selected local action. The dynamics LLM nevertheless labeled it validation_only, and Candidate 11 trusted that label as validation_feedback without requiring a typed validation marker. The action therefore halted instead of activating the bounded no-effect replan.",
  "site_ad_wizard_links/primary":
    "The link-navigated journey and capture remained complete; residual form/repeater reporting is outside Candidate 11.",
};

for (const test of learning.tests || []) {
  for (const item of [...(test.worked || []), ...(test.failed || [])]) {
    for (const evidence of item.evidence || []) {
      evidence.artifact = evidence.artifact.replace(
        "/raw/../scoring/",
        "/scoring/",
      );
      if (evidence.artifact.endsWith("/scoring/submission.json")) {
        const exists = await access(path.join(runRoot, evidence.artifact))
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          evidence.artifact = evidence.artifact.replace(
            "/scoring/submission.json",
            "/scoring/submission-missing.json",
          );
        }
      }
    }
  }
  for (const failed of test.failed || []) {
    failed.generalizableCause =
      causes[test.scenarioKey] ||
      "The cited loss belongs to a separate generic capability and does not justify fixture-specific code.";
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        "Forced-fresh model generation can change semantic decomposition; acceptance depends on typed activation evidence and paired plan results, not score movement alone.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/pages",
        },
      ],
    },
  ];
}

const housing = learning.tests.find(
  (test) => test.scenarioKey === "site_an_uw_housing/primary",
);
housing?.worked?.push({
  claim:
    "The complex state still verified 35 field entries and three conditional branches with no entry failure and full safety.",
  evidence: [
    {
      artifact:
        "batches/batch-01/site_an_uw_housing/primary/trial-01/raw/report.json",
      pointer: "/pages/0",
    },
    {
      artifact:
        "batches/batch-01/site_an_uw_housing/primary/trial-01/scoring/score.json",
      pointer: "/safetyPass",
    },
  ],
  whyItMatters:
    "The next correction must preserve the field, branch, upload, and safety machinery that already works on the motivating state.",
  preservationInvariant:
    "Keep all 35 verified field entries, three branch states, zero entry failures, and every safety check while repairing only post-action outcome classification.",
  confidence: "high",
});

const eventCount = (kind) =>
  (logText.match(new RegExp(` ${kind}:`, "g")) || []).length;
learning.analysisStatus = "complete";
learning.summary =
  "Candidate 11 was valid and safety-clean on all seven trials, scoring 93.100, but it failed the fix gate and is rejected. The motivating housing case improved only 0.255 points and stopped after 35 verified fields and three branches because zero typed state delta was promoted to validation_feedback solely from an LLM validation_only label. The predeclared no-effect replan witnesses were absent. Candidate 11b must require a newly observed validation marker for validation_feedback; otherwise zero URL/control/terminal/semantic-surface delta is no_effect and receives the one bounded replan. Regression and rotating are skipped for Candidate 11.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were infrastructure-valid and safety-clean.",
    "Malformed markup remained strict 100; payment protection remained near-perfect and fail-closed.",
    "Nested portal and link-wizard journeys stayed complete and near-perfect.",
    "The motivating housing state preserved 35 verified fields, three conditional branches, and zero entry failures.",
  ],
  failedPatterns: [
    "The typed outcome layer accepted an unsupported LLM validation_only label despite zero newly observed validation marker.",
    "Because validation_feedback was selected instead of no_effect, neither bounded replan activation witness appeared.",
    "Housing remained incomplete at 67.819 and the paired cohort improved only 0.104 overall, which is not material.",
  ],
  preservationRisks: [
    "Do not reinterpret genuine new validation alerts as no-effect.",
    "Do not disturb the verified field/branch/upload mechanics on the large state.",
    "Do not weaken payment, CAPTCHA, login, or unresolved cross-page safety boundaries.",
    "Do not run regression or rotating until the exact fix cohort has a live replan witness and material improvement.",
  ],
  recommendations: [
    "Capture validation messages immediately before and after the action and require a newly appeared marker before emitting validation_feedback.",
    "Derive cosmetic_change only from a changed non-control semantic surface; a dynamics label alone cannot prove an effect.",
    "Treat zero URL, control, terminal, validation, and semantic-surface delta as no_effect regardless of the LLM label.",
    "During replacement-state preflight, restore active branch-variant values as part of the preserved checkpoint before validating the replacement progression.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_activation_absent",
  sourceFingerprint:
    "9d5660831f6bfbd97c3f5615e939c6e3a4a171ac44b24dff24f208d887d50b57",
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  nextCandidate:
    "candidate_11b_typed_validation_evidence_and_checkpoint_restore",
};
learning.activationWitnesses = {
  actionOutcomeClassified: eventCount(
    "progression_action_outcome_classified",
  ),
  noEffectReplanRequested: eventCount(
    "nonterminal_no_effect_replan_requested",
  ),
  noEffectReplanSucceeded: eventCount(
    "nonterminal_no_effect_replan_succeeded",
  ),
};

await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
console.log(learningPath);
