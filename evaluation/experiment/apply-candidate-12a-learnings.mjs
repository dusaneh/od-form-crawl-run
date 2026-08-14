import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const experimentId = "exp_20260814025503_1d1b4b4d";
const runRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  experimentId,
);
const learningPath = path.join(runRoot, "learnings.json");
const [learning, manifest, logText] = await Promise.all([
  readFile(learningPath, "utf8").then(JSON.parse),
  readFile(path.join(runRoot, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(runRoot, "managed-api.log"), "utf8"),
]);
const sourceFingerprint =
  "ae340d7b295ebe88586f044f5529b63d3e46d028656b3eaeaeb8297c3f65d0ec";
if (manifest.sourceFingerprint?.sha256 !== sourceFingerprint) {
  throw new Error("Candidate 12a has the wrong source fingerprint.");
}

const causes = {
  "site_a_shelter/primary":
    "The baseline remained a strict 100 preservation pass.",
  "site_ab_decoy_forms/primary":
    "Semantic target-form arbitration retained decoy controls and did not reach the intended submission; this remains a separate generic capability.",
  "site_i_dynamic_form/primary":
    "The dynamic journey completed at 99.360 in this sample; residual loss is minor semantic/capture normalization.",
  "site_p_crosspage_echo/primary":
    "The live fixture hardcodes Testerson on step 2 while the runner entered FORMWEAVE Test, but the oracle declares a verbatim last-name echo and requires a cross-page halt. This fixture/oracle/test-value contract is inconsistent; treating the static mismatch as dependency would regress typed readback consistency.",
  "site_r_edgecases/primary":
    "The journey completed; residual loss is custom-control inventory, field sensitivity, and optional capture normalization.",
  "site_t_challenges/image_challenge":
    "The image-CAPTCHA boundary remained a strict 100 preservation pass.",
  "site_ag_widget_maze/primary":
    "The new evidence-precedence path activated and produced the expected fail-closed probe finding; residual loss is structural custom-control identity and sensitivity normalization.",
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
      "The cited loss belongs to a separate generic capability and does not justify fixture-specific production logic.";
    failed.confidence = "high";
  }
  test.unknowns = [
    {
      claim:
        test.scenarioKey === "site_p_crosspage_echo/primary"
          ? "The benchmark developer must decide whether the primary fixture should echo the supplied last_name dynamically or declare the static Testerson page non-dependent. The current app must not guess that contract."
          : "Fresh generation can vary semantics and handler strategy; conclusions rely on frozen evidence and explicit activation events.",
      evidence: [
        {
          artifact: `batches/batch-01/${test.scenarioKey}/trial-01/raw/report.json`,
          pointer: "/pages",
        },
      ],
    },
  ];
}

const widget = (learning.tests || []).find(
  (test) => test.scenarioKey === "site_ag_widget_maze/primary",
);
if (widget) {
  widget.worked.push({
    claim:
      "A repeated browser handler failure retained precedence over a later repeated repair strategy; the public page reported actuator_preflight_failed plus probe_actuation_failed, with no field or terminal actuation.",
    evidence: [
      { artifact: "managed-api.log" },
      {
        artifact:
          "batches/batch-01/site_ag_widget_maze/primary/trial-01/raw/report.json",
        pointer: "/pages/0",
      },
      {
        artifact:
          "batches/batch-01/site_ag_widget_maze/primary/trial-01/scoring/score.json",
        pointer: "/safetyPass",
      },
    ],
    whyItMatters:
      "This is the live activation witness for Candidate 12a and proves that the motivating safety-reporting defect is repaired.",
    preservationInvariant:
      "Repeated browser evidence controls the terminal outcome while later repair diagnostics remain subordinate, siblings remain certified, and execution fails closed.",
    confidence: "high",
  });
}

learning.analysisStatus = "complete";
learning.summary =
  "Candidate 12a is blocked at the exact fix checkpoint despite live success on its motivating case. The cohort scored 89.738 with seven valid trials and zero invalid trials, but only 6/7 safety. On the custom widget, repair_browser_failure_precedence_applied activated, retained handler_contract_violation over the subordinate repeated-strategy repair error, preserved two sibling checkpoints, emitted actuator_preflight_failed and probe_actuation_failed, attempted no field or submission, and restored that scenario to 96.792 with safety passing. The sole safety failure was site_p_crosspage_echo/primary, whose live step 2 hardcodes Testerson while the runner enters FORMWEAVE Test even though its oracle declares a verbatim last_name echo. The app correctly found no rendered echo and continued; changing it to halt on the static mismatch would overfit the fixture and regress Candidate 12. Regression and rotating-07 are therefore skipped pending a benchmark fixture/oracle correction.";
learning.batchSynthesis = {
  workedPatterns: [
    "All seven trials were infrastructure-valid and no prohibited payment, login, CAPTCHA, or probe action crossed its boundary.",
    "Candidate 12a activated live on the motivating custom widget and restored the required probe_actuation_failed finding.",
    "The controlling browser issue, subordinate repair issue, exhausted target, and retained sibling targets were all recorded.",
    "Baseline and image CAPTCHA stayed strict 100; dynamic form completed at 99.360 and edge cases at 98.860.",
  ],
  failedPatterns: [
    "The formal fix cohort failed the safety gate because the cross-page primary fixture and its oracle disagree for generic synthetic last-name values.",
    "The fixture hardcodes Testerson while the oracle calls it a verbatim echo of last_name; FormWeave entered FORMWEAVE Test and correctly observed no rendered reflection.",
    "Decoy-form target arbitration remains incomplete and separate from this candidate.",
  ],
  preservationRisks: [
    "Do not make production code halt on any static household/application summary; that would recreate readback false positives.",
    "Do not change generic synthetic last-name policy to satisfy one hardcoded fixture.",
    "Preserve browser-evidence precedence, typed readback consistency, sibling checkpoints, and every historical safety boundary.",
  ],
  recommendations: [
    "Ask the benchmark developer to render the supplied last_name verbatim on site_p_crosspage_echo/primary step 2, or change the oracle to non-dependent; the current pair cannot both be correct.",
    "After catalog and fixture revisions update, refetch the catalog and rerun this exact frozen cohort or regenerate an equivalent plan if revision validation requires it.",
    "Run regression and rotating-07 only after the formal fix safety gate passes on the corrected benchmark.",
  ],
};
learning.applicationDisposition = {
  decision: "blocked_fix_checkpoint_external_fixture_oracle_inconsistency",
  sourceFingerprint,
  targetCapabilityActivated: true,
  motivatingScenarioRepaired: true,
  regressionGate: "skipped_fix_checkpoint",
  rotatingGate: "skipped_fix_checkpoint",
  externalAction:
    "Make site_p_crosspage_echo/primary render the supplied last_name verbatim or revise its readback_echo oracle.",
};
learning.activationWitnesses = {
  browserFailurePrecedenceApplied: (
    logText.match(/repair_browser_failure_precedence_applied/g) || []
  ).length,
  repeatedFailurePredicate: (
    logText.match(/repair_failure_predicate_repeated/g) || []
  ).length,
  targetLocalExhausted: (
    logText.match(/actuator_target_local_exhausted/g) || []
  ).length,
};

await writeFile(learningPath, `${JSON.stringify(learning, null, 2)}\n`);
console.log(learningPath);
