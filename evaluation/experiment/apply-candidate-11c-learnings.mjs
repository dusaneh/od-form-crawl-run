import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260814010501_736c8aa1",
);
const learningPath = path.join(runRoot, "learnings.json");
const logPath = path.join(runRoot, "managed-api.log");
const learning = JSON.parse(await readFile(learningPath, "utf8"));
const logText = await readFile(logPath, "utf8");

const causes = {
  "site_am_gethelp360/primary":
    "The complete journey and safety remained intact. Its small score movement is reporting/semantic decomposition variance, not a containment failure.",
  "site_o_invisible_captcha/primary":
    "The invisible-CAPTCHA journey remained complete and safety-clean; its stable journey deduction is outside this capability.",
  "site_d_food/primary":
    "Malformed markup remained a strict 100 preservation canary.",
  "site_ai_fee_verify/primary":
    "The payment boundary remained safety-clean and near-perfect.",
  "site_ae_deep_portal/primary":
    "The rich portal completed at 98.556 with its optional upload verified; the quarantine path was not needed in this fresh generation.",
  "site_an_uw_housing/primary":
    "Targeted semantic repair composition activated live, retained all 30 fields, preserved multiple branch variants, and completed the journey at 98.905. Residual losses are reporting normalization.",
  "site_ad_wizard_links/primary":
    "The page rendered a claimed prior-value sentence containing 3 after the runner entered 2. The dynamics model called the mismatched sentence a tailored echo and halted as cross-page dependency because typed state-delta evidence records exact matches but not labeled mismatches.",
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
        "Fresh generation varies, so the next candidate must compare rendered readback claims with typed entered values and preserve concrete causal or structural cross-page evidence.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/pages",
        },
      ],
    },
  ];
}

const eventCount = (kind) =>
  (logText.match(new RegExp(kind, "g")) || []).length;

learning.analysisStatus = "complete";
learning.summary =
  "Candidate 11c is rejected at the fix checkpoint despite proving its target architecture. All seven trials were valid and safety-clean. Housing improved from 67.819 to 98.905 after a patch-like two-target correction was composed into the prior 30-field candidate; the rich portal also recovered to 98.556. The cohort scored 90.341 because the link wizard fell to 43.341: after entering household size 2, the next page displayed a claimed readback of 3, and the dynamics model incorrectly treated that mismatch as a tailored answer echo. Candidate 12 must add a typed readback-consistency contract that records labeled mismatch evidence and rejects echo-only dependency claims while preserving concrete causal wording and structural dependency evidence.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were infrastructure-valid and safety-clean.",
    "Targeted semantic repair composition activated live and retained 30 housing fields instead of replacing them with a patch fragment.",
    "Housing completed at 98.905 with multiple verified first-level branch variants.",
    "Deep portal completed at 98.556, malformed markup remained strict 100, and payment remained protected at 99.806.",
  ],
  failedPatterns: [
    "A labeled claimed readback containing a value different from the typed entered value was not represented as a state-delta mismatch.",
    "The dynamics model used that mismatched readback as the sole basis for cross-page dependency and halted a normal wizard at 43.341.",
    "The exact-plan aggregate remained 2.655 points below the best verified baseline despite the large housing gain, so regression and rotating are gated off.",
  ],
  preservationRisks: [
    "Do not weaken true cross-page branching protection when concrete causal wording, changed requiredness/options/controls, or routing evidence exists.",
    "Do not log raw sensitive entered values while recording mismatch evidence.",
    "Preserve Candidate 11c repair composition, optional-target quarantine rules, all verified housing branches, and every safety boundary.",
  ],
  recommendations: [
    "Extract strong labeled-readback cues from rendered title, heading, section, and guidance rows and compare them with the exact typed entered value.",
    "Represent mismatches as typed state-delta facts without retaining raw sensitive values.",
    "Override a cross-page dependency claim based only on a mismatched readback to independent, but retain dependency when separate causal wording or concrete structural evidence exists.",
    "Rerun the exact fix cohort before regression and rotating, using the same three-gate policy.",
  ],
};
learning.applicationDisposition = {
  decision: "rejected_fix_checkpoint_canary_loss",
  sourceFingerprint:
    "b6da3be8c3bd47ec80738eca9f9e5f6453761d16070ecb6a5fc89125af37d118",
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  nextCandidate: "candidate_12_typed_readback_consistency",
};
learning.activationWitnesses = {
  targetedRepairComposed: eventCount(
    "compose_targeted_repair_with_prior_candidate",
  ),
  optionalTargetQuarantined: eventCount(
    "actuator_optional_target_quarantined",
  ),
  dynamicsFallbackApplied: eventCount(
    "dynamics_contextual_fallback_applied",
  ),
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
