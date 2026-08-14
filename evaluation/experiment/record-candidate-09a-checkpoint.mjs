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
const runPath = path.join(developmentRoot, "run.json");
const run = JSON.parse(await readFile(runPath, "utf8"));
const candidate =
  "devrun-20260811-threegate7-candidate-09a-target-local-repair-transaction";
const sourceFingerprint =
  "dd35295c947c267a63fa0c38b16731fe359831aad327723d8562f3e8abe1b5f7";
const requirementsArtifact =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-09-candidate-09a-postcheckpoint.md";
const additions = [
  {
    sequence: 33,
    batchId: "fix-checkpoint-candidate-09a",
    role: "fix",
    experimentId: "exp_20260813202113_0f79ad6b",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate,
    sourceFingerprint,
    overallScore: 94.71482857142857,
    status: "blocked",
    strictPassRate: 1 / 7,
    safetyPassRate: 6 / 7,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.428571428571427,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260813051908_00adc0df",
    pairedDelta: -3.2738142857142867,
    explicitActivationWitnessCount: 7,
    candidateDecision: "rejected_fix_checkpoint_safety_regression",
    requirementsArtifact,
  },
  {
    sequence: 34,
    batchId: "regression-candidate-09a-skipped",
    role: "regression",
    experimentId: null,
    planId: "plan_931bd81e97ed6082",
    candidate,
    sourceFingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
    requirementsArtifact,
  },
  {
    sequence: 35,
    batchId: "rotating-05-candidate-09a-skipped",
    role: "rotating",
    experimentId: null,
    planId: "plan_0667a5e983762ce7",
    candidate,
    sourceFingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
    requirementsArtifact,
  },
];
const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}
if (
  !(run.plannedBatches || []).some(
    (row) => row.batchId === "candidate-09a-staged-bundle",
  )
) {
  run.plannedBatches.push({
    batchId: "candidate-09a-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "stopped_rejected_fix_checkpoint",
    candidateKind: "repair_on_restored_best_verified_baseline",
    sourceFingerprint,
    fixPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T16-29-55-752Z-plan_310f0070a86c7733/plan.json",
    regressionPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
    rotatingPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T19-02-46-388Z-plan_0667a5e983762ce7/plan.json",
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-09-premeasurement.json",
    premeasurementRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-09-candidate-09-premeasurement.md",
    postcheckpointRequirementsArtifact: requirementsArtifact,
    singleCapability: "target_local_diagnosis_sensitive_repair_transaction",
    decision: "rejected_fix_checkpoint_safety_regression",
    nextCandidate: "candidate-09b-comparator-preservation-repair",
  });
}
run.preservation.candidate09PremeasurementRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-09-candidate-09-premeasurement.md";
run.preservation.candidate09aPostcheckpointRequirements = requirementsArtifact;
run.preservation.candidate09aFixComparison =
  "data/evaluation-experiments/runs/exp_20260813202113_0f79ad6b/comparison-exp_20260813051908_00adc0df.json";
await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
console.log(runPath);
