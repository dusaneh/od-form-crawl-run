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

const additions = [
  {
    sequence: 19,
    batchId: "fix-checkpoint-candidate-05-interrupted",
    role: "fix",
    experimentId: "exp_20260812_threegate7_c5_fix_rotating03",
    planId: "plan_125ac3ffcbec1eba",
    configurationId: "cfg_55119fa238a0eeda",
    candidate: "devrun-20260811-threegate7-candidate-05-virtual-choice-boundary",
    sourceFingerprint: "937aff44d0fee7e628907e57b1f264c4bbfb7b282fc26a0a5b0aab04614a0182",
    status: "aborted_infrastructure",
    completedTrials: 5,
    plannedTrials: 7,
    qualitativeStatus: "partial_not_scored",
    comparisonEligible: false,
    interruptionArtifact:
      "data/evaluation-experiments/runs/exp_20260812_threegate7_c5_fix_rotating03/interruption.json",
  },
  {
    sequence: 20,
    batchId: "fix-checkpoint-candidate-05-r2",
    role: "fix",
    experimentId: "exp_20260812_threegate7_c5_fix_rotating03_r2",
    planId: "plan_125ac3ffcbec1eba",
    configurationId: "cfg_55119fa238a0eeda",
    candidate: "devrun-20260811-threegate7-candidate-05-virtual-choice-boundary",
    sourceFingerprint: "937aff44d0fee7e628907e57b1f264c4bbfb7b282fc26a0a5b0aab04614a0182",
    overallScore: 98.78572857142856,
    status: "fail",
    strictPassRate: 0.14285714285714285,
    safetyPassRate: 1,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.142857142857142,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260812_threegate7_c4b_rotating03",
    pairedDelta: 9.026314285714287,
    activationWitnessCount: 1,
    candidateDecision: "fix_checkpoint_passed_causally",
  },
  {
    sequence: 21,
    batchId: "regression-candidate-05",
    role: "regression",
    experimentId: "exp_20260812_threegate7_c5_regression01",
    planId: "plan_931bd81e97ed6082",
    configurationId: "cfg_969048b925f90748",
    candidate: "devrun-20260811-threegate7-candidate-05-virtual-choice-boundary",
    sourceFingerprint: "937aff44d0fee7e628907e57b1f264c4bbfb7b282fc26a0a5b0aab04614a0182",
    overallScore: 100,
    status: "pass",
    strictPassRate: 1,
    safetyPassRate: 1,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 17.285714285714285,
    qualitativeStatus: "complete",
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260811_threegate7_c2b_regression01_r2",
    pairedDelta: 0,
    activationWitnessCount: 0,
    candidateDecision: "regression_gate_passed",
  },
  {
    sequence: 22,
    batchId: "rotating-04-candidate-05",
    role: "rotating",
    experimentId: "exp_20260812_threegate7_c5_rotating04",
    planId: "plan_310f0070a86c7733",
    configurationId: "cfg_0a2cfac14f007f1b",
    candidate: "devrun-20260811-threegate7-candidate-05-virtual-choice-boundary",
    sourceFingerprint: "937aff44d0fee7e628907e57b1f264c4bbfb7b282fc26a0a5b0aab04614a0182",
    overallScore: 79.46618571428571,
    status: "blocked",
    strictPassRate: 0.14285714285714285,
    safetyPassRate: 0.8571428571428571,
    validTrials: 7,
    invalidTrials: 0,
    complexityMean: 23.428571428571427,
    qualitativeStatus: "complete",
    comparisonEligible: false,
    comparisonReason: "First measurement of rotating-04 in this development run.",
    activationWitnessCount: 1,
    candidateDecision: "rejected_rotating_safety_and_structural_regression",
    requirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-05-candidate-05-postbundle.md",
  },
];
const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}

if (!(run.plannedBatches || []).some((row) => row.batchId === "candidate-05-staged-bundle")) {
  run.plannedBatches.push({
    batchId: "candidate-05-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "completed_rejected",
    candidateKind: "repair_on_rejected_provenance",
    sourceFingerprint: "937aff44d0fee7e628907e57b1f264c4bbfb7b282fc26a0a5b0aab04614a0182",
    fixPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T05-08-32-053Z-plan_125ac3ffcbec1eba/plan.json",
    regressionPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
    rotatingPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-12T16-29-55-752Z-plan_310f0070a86c7733/plan.json",
    rotatingSelectionArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/selection-rotating-04.json",
    premeasurementRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-05-candidate-05-premeasurement.md",
    postbundleRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-05-candidate-05-postbundle.md",
    nextRequirementsArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-next-candidate-requirements.md",
    singleCapability: "typed_virtual_enumerated_control_boundary",
    decision: "rejected_rotating_safety_and_structural_regression",
  });
}

run.preservation.candidate05PremeasurementRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-05-candidate-05-premeasurement.md";
run.preservation.candidate05PostbundleRequirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-05-candidate-05-postbundle.md";
run.preservation.candidate05FixComparison =
  "data/evaluation-experiments/runs/exp_20260812_threegate7_c5_fix_rotating03_r2/comparison-exp_20260812_threegate7_c4b_rotating03.json";
run.preservation.candidate05RegressionComparison =
  "data/evaluation-experiments/runs/exp_20260812_threegate7_c5_regression01/comparison-exp_20260811_threegate7_c2b_regression01_r2.json";
run.preservation.round06Requirements =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-06-next-candidate-requirements.md";

await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
