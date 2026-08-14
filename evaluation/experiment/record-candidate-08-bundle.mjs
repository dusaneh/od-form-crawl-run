import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const developmentRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "development-runs",
  "devrun_20260811_threegate7_v1",
);
const file = path.join(developmentRoot, "run.json");
const run = JSON.parse(await readFile(file, "utf8"));
const candidate =
  "devrun-20260811-threegate7-candidate-08-content-addressed-repair-lineage";
const sourceFingerprint =
  "d1d5c6eda9b3444f87257b8cc001cd5155c3f27f2de9c389443f2486e422e3bb";
const requirement =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-08-candidate-08-postbundle.md";

const interruptedRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  "exp_20260813_threegate7_c8_rotating05",
);
const interruptedManifestFile = path.join(interruptedRoot, "manifest.json");
const interruptedManifest = JSON.parse(
  await readFile(interruptedManifestFile, "utf8"),
);
if (interruptedManifest.status === "running") {
  const interruptedAt = new Date().toISOString();
  const interruption = {
    schemaVersion: 1,
    kind: "formweave_experiment_interruption",
    experimentId: interruptedManifest.experimentId,
    status: "aborted_infrastructure",
    interruptedAt,
    reason:
      "The external command wrapper yielded while the experiment continued as an orphaned process; it was stopped after the exact frozen replacement completed. Partial duplicate captures are not comparison evidence.",
    applicationFailure: false,
    completedTrials: interruptedManifest.results?.length || 0,
    plannedTrials: 7,
    comparisonEligible: false,
    sourceFingerprint,
    planId: interruptedManifest.planId,
    disposition:
      "Exclude this partial duplicate attempt. Use exp_20260813054711_5e6b2cea as the valid rotating-05 measurement.",
  };
  interruptedManifest.status = "aborted_infrastructure";
  interruptedManifest.qualitativeStatus = "partial_not_scored";
  interruptedManifest.completedAt = interruptedAt;
  interruptedManifest.interruptionArtifact = "interruption.json";
  await Promise.all([
    writeFile(
      path.join(interruptedRoot, "interruption.json"),
      `${JSON.stringify(interruption, null, 2)}\n`,
    ),
    writeFile(
      interruptedManifestFile,
      `${JSON.stringify(interruptedManifest, null, 2)}\n`,
    ),
  ]);
}

const additions = [
  {
    sequence: 30,
    batchId: "fix-checkpoint-candidate-08",
    role: "fix",
    experimentId: "exp_20260813051908_00adc0df",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate,
    sourceFingerprint,
    overallScore: 97.98864285714285,
    status: "fail",
    strictPassRate: 1 / 7,
    safetyPassRate: 1,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.428571428571427,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260812_threegate7_c5_rotating04",
    pairedDelta: 18.52245714285714,
    explicitActivationWitnessCount: 2,
    candidateDecision: "causal_fix_checkpoint_passed",
    requirementsArtifact: requirement,
  },
  {
    sequence: 31,
    batchId: "regression-candidate-08",
    role: "regression",
    experimentId: "exp_20260813053643_5135085c",
    planId: "plan_931bd81e97ed6082",
    configurationId: "cfg_969048b925f90748",
    candidate,
    sourceFingerprint,
    overallScore: 93.96462857142856,
    status: "fail",
    strictPassRate: 6 / 7,
    safetyPassRate: 1,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 17.285714285714285,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260811_threegate7_c2b_regression01_r2",
    pairedDelta: -6.035371428571429,
    explicitActivationWitnessCount: 2,
    candidateDecision: "preservation_gate_failed_strict_pass_to_fail",
    requirementsArtifact: requirement,
  },
  {
    sequence: 32,
    batchId: "rotating-05-candidate-08",
    role: "rotating",
    experimentId: "exp_20260813054711_5e6b2cea",
    planId: "plan_0667a5e983762ce7",
    configurationId: "cfg_dfb1608428a0b659",
    candidate,
    sourceFingerprint,
    overallScore: 92.06522857142856,
    status: "fail",
    strictPassRate: 1 / 7,
    safetyPassRate: 1,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 22.857142857142858,
    qualitativeStatus: "complete",
    comparisonEligible: false,
    comparisonReason: "First rotating-05 measurement in this development run.",
    explicitActivationWitnessCount: 3,
    candidateDecision: "transfer_insufficient_first_cohort_baseline",
    requirementsArtifact: requirement,
  },
];

const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}

if (!(run.plannedBatches || []).some((row) => row.batchId === "candidate-08-staged-bundle")) {
  run.plannedBatches.push({
    batchId: "candidate-08-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "completed_rejected_regression",
    candidateKind: "repair_on_rejected_provenance",
    sourceFingerprint,
    fixPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T16-29-55-752Z-plan_310f0070a86c7733/plan.json",
    regressionPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
    rotatingPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T19-02-46-388Z-plan_0667a5e983762ce7/plan.json",
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-08-premeasurement.json",
    premeasurementRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-08-candidate-08-premeasurement.md",
    postbundleRequirementsArtifact: requirement,
    singleCapability: "content_addressed_system_owned_repair_lineage",
    decision: "rejected_regression_strict_pass_to_fail_and_transfer_insufficient",
    operationalArtifacts: [
      "data/evaluation-experiments/runs/exp_20260813_threegate7_c8_rotating05",
    ],
    rollback: {
      status: "verified",
      candidateChangesRetained: false,
      restoredSourceFingerprint:
        "2d99ed3a97482d347ca05845c26d550de3c46ee9fe26cc0c97c119e184036e4b",
      sourceFiles: 98,
    },
  });
}

run.preservation.candidate08PreservationReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-08-premeasurement.json";
run.preservation.candidate08PremeasurementRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-08-candidate-08-premeasurement.md";
run.preservation.candidate08PostbundleRequirements = requirement;
run.preservation.candidate08PostbundleReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-08-postbundle.json";
run.preservation.candidate08FixComparison =
  "data/evaluation-experiments/runs/exp_20260813_threegate7_c8_fix_rotating04/comparison-exp_20260812_threegate7_c5_rotating04.json";
run.preservation.candidate08RegressionComparison =
  "data/evaluation-experiments/runs/exp_20260813_threegate7_c8_regression01/comparison-exp_20260811_threegate7_c2b_regression01_r2.json";
run.preservation.candidate08RollbackVerification =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-08-candidate-08-postbundle.json";

await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
