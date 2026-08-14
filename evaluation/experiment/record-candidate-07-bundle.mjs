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
  "devrun-20260811-threegate7-candidate-07-grounded-probe-failure";
const sourceFingerprint =
  "9473c4893bd761cd4d583d56eb14655f264d57e817e5d87881e3b848bb52dd65";
const requirement =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-07-candidate-07-postcheckpoint.md";

const additions = [
  {
    sequence: 26,
    batchId: "fix-checkpoint-candidate-07-attempt-01",
    role: "fix",
    experimentId: "exp_20260812_threegate7_c7_fix_rotating04",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate,
    sourceFingerprint,
    status: "aborted_infrastructure",
    validTrials: 0,
    invalidTrials: 0,
    completedScenarioExecutions: 3,
    qualitativeStatus: "partial_not_scored",
    comparisonEligible: false,
    requirementsArtifact: requirement,
  },
  {
    sequence: 27,
    batchId: "fix-checkpoint-candidate-07-retry",
    role: "fix",
    experimentId: "exp_20260812_threegate7_c7_fix_rotating04_r2",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate,
    sourceFingerprint,
    overallScore: 82.76584285714284,
    status: "blocked",
    strictPassRate: 0.14285714285714285,
    safetyPassRate: 0.8571428571428571,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.428571428571427,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260812_threegate7_c5_rotating04",
    pairedDelta: 3.299657142857142,
    explicitActivationWitnessCount: 0,
    candidateDecision: "rejected_fix_checkpoint_activation_absent",
    requirementsArtifact: requirement,
  },
  {
    sequence: 28,
    batchId: "regression-candidate-07-skipped",
    role: "regression",
    experimentId: null,
    planId: "plan_931bd81e97ed6082",
    candidate,
    sourceFingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
  },
  {
    sequence: 29,
    batchId: "rotating-05-candidate-07-skipped",
    role: "rotating",
    experimentId: null,
    planId: "plan_0667a5e983762ce7",
    candidate,
    sourceFingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
  },
];
const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}

if (!(run.plannedBatches || []).some((row) => row.batchId === "candidate-07-staged-bundle")) {
  run.plannedBatches.push({
    batchId: "candidate-07-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "stopped_rejected_fix_checkpoint",
    candidateKind: "repair_on_rejected_provenance",
    sourceFingerprint,
    fixPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T16-29-55-752Z-plan_310f0070a86c7733/plan.json",
    regressionPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
    rotatingPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T19-02-46-388Z-plan_0667a5e983762ce7/plan.json",
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-07-premeasurement.json",
    premeasurementRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-07-candidate-07-premeasurement.md",
    postcheckpointRequirementsArtifact: requirement,
    singleCapability: "grounded_exhausted_choice_probe_failure_normalization",
    decision: "rejected_fix_checkpoint_activation_absent",
    rollback: {
      status: "verified",
      candidateChangesRetained: false,
      restoredSourceFingerprint:
        "2d99ed3a97482d347ca05845c26d550de3c46ee9fe26cc0c97c119e184036e4b",
      sourceFiles: 98,
    },
  });
}

run.preservation.candidate07PreservationReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-07-premeasurement.json";
run.preservation.candidate07PremeasurementRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-07-candidate-07-premeasurement.md";
run.preservation.candidate07PostcheckpointRequirements = requirement;
run.preservation.candidate07FixComparison =
  "data/evaluation-experiments/runs/exp_20260812_threegate7_c7_fix_rotating04_r2/comparison-exp_20260812_threegate7_c5_rotating04.json";
run.preservation.candidate07RollbackVerification =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-07-candidate-07-postcheckpoint.json";

await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
