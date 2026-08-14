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
  "devrun-20260811-threegate7-candidate-06-orthogonal-choice-contract";
const sourceFingerprint =
  "a4d6d9e3f57800f46b081d626f3154cd174835bb877c12616a947612c0ae0f90";

const additions = [
  {
    sequence: 23,
    batchId: "fix-checkpoint-candidate-06",
    role: "fix",
    experimentId: "exp_20260812_threegate7_c6_fix_rotating04",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate,
    sourceFingerprint,
    overallScore: 82.81295714285714,
    status: "blocked",
    strictPassRate: 0.14285714285714285,
    safetyPassRate: 0.8571428571428571,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.428571428571427,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260812_threegate7_c5_rotating04",
    pairedDelta: 3.346771428571427,
    explicitActivationWitnessCount: 0,
    retainedChoiceInteractionScenarios: 2,
    candidateDecision: "rejected_fix_checkpoint_safety_and_unrelated_loss",
    requirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-postcheckpoint.md",
  },
  {
    sequence: 24,
    batchId: "regression-candidate-06-skipped",
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
    sequence: 25,
    batchId: "rotating-05-candidate-06-skipped",
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

if (!(run.plannedBatches || []).some((row) => row.batchId === "candidate-06-staged-bundle")) {
  run.plannedBatches.push({
    batchId: "candidate-06-staged-bundle",
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
    rotatingSelectionArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/selection-rotating-05.json",
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-06-premeasurement.json",
    premeasurementRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-premeasurement.md",
    postcheckpointRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-postcheckpoint.md",
    singleCapability:
      "orthogonal_virtual_choice_semantics_mechanics_and_backing",
    decision: "rejected_fix_checkpoint_safety_and_unrelated_loss",
  });
}
const candidate06Bundle = (run.plannedBatches || []).find(
  (row) => row.batchId === "candidate-06-staged-bundle",
);
if (candidate06Bundle) {
  candidate06Bundle.rollback = {
    status: "verified",
    candidateChangesRetained: false,
    restoredSourceFingerprint:
      "2d99ed3a97482d347ca05845c26d550de3c46ee9fe26cc0c97c119e184036e4b",
    sourceFiles: 98,
  };
}

run.preservation.candidate06PreservationReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-06-premeasurement.json";
run.preservation.candidate06PremeasurementRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-premeasurement.md";
run.preservation.candidate06PostcheckpointRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-postcheckpoint.md";
run.preservation.candidate06FixComparison =
  "data/evaluation-experiments/runs/exp_20260812_threegate7_c6_fix_rotating04/comparison-exp_20260812_threegate7_c5_rotating04.json";
run.preservation.candidate06RollbackVerification =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-candidate-06-postcheckpoint.json";

await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
