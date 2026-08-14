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
const runsRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
);
const run = JSON.parse(await readFile(runPath, "utf8"));

const fixPlan = "plan_0667a5e983762ce7";
const regressionPlan = "plan_931bd81e97ed6082";
const rotating06Plan = "plan_f0a98581d1a97e3b";
const fixComplexity = 22.857142857142858;
const regressionComplexity = 17.285714285714285;
const rotating06Complexity = 23;

async function measurement({
  sequence,
  batchId,
  role,
  experimentId,
  candidate,
  complexityMean,
  baselineExperimentId = null,
  pairedDelta = null,
  comparisonEligible = true,
  candidateDecision,
  requirementsArtifact,
}) {
  const root = path.join(runsRoot, experimentId);
  const [manifest, learnings] = await Promise.all([
    readFile(path.join(root, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "learnings.json"), "utf8").then(JSON.parse),
  ]);
  const witnesses = Object.values(learnings.activationWitnesses || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  return {
    sequence,
    batchId,
    role,
    experimentId,
    planId: manifest.planId,
    configurationId: manifest.configurationId,
    candidate,
    sourceFingerprint: manifest.sourceFingerprint.sha256,
    overallScore: manifest.aggregate.overallScore,
    status: manifest.status,
    strictPassRate: manifest.aggregate.strictPassRate,
    safetyPassRate: manifest.aggregate.safetyPassRate,
    validTrials: manifest.aggregate.validTrials,
    invalidTrials: manifest.aggregate.invalidTrials,
    complexityMean,
    qualitativeStatus: manifest.qualitativeStatus,
    comparisonEligible,
    pairedBaselineExperimentId: baselineExperimentId,
    pairedDelta,
    explicitActivationWitnessCount: witnesses,
    candidateDecision,
    requirementsArtifact,
  };
}

function skipped({
  sequence,
  batchId,
  role,
  planId,
  candidate,
  sourceFingerprint,
  requirementsArtifact,
}) {
  return {
    sequence,
    batchId,
    role,
    experimentId: null,
    planId,
    candidate,
    sourceFingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
    requirementsArtifact,
  };
}

const requirementsRoot =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements";
const req11 = `${requirementsRoot}/round-11-candidate-11-premeasurement.md`;
const req11b = `${requirementsRoot}/round-11-candidate-11b-premeasurement.md`;
const req11c = `${requirementsRoot}/round-11-candidate-11c-premeasurement.md`;
const req12 = `${requirementsRoot}/round-12-candidate-12-postbundle.md`;

const c11 = "devrun-20260811-threegate7-candidate-11-bounded-action-outcomes";
const c11b =
  "devrun-20260811-threegate7-candidate-11b-typed-validation-evidence";
const c11c =
  "devrun-20260811-threegate7-candidate-11c-typed-item-fault-containment";
const c12 =
  "devrun-20260811-threegate7-candidate-12-typed-readback-consistency";

const fp11 =
  "9d5660831f6bfbd97c3f5615e939c6e3a4a171ac44b24dff24f208d887d50b57";
const fp11b =
  "fc9f8035eb497c4bce06ecc48bfad0b89745dd3972cae0c045d98dea3a3cadeb";
const fp11c =
  "b6da3be8c3bd47ec80738eca9f9e5f6453761d16070ecb6a5fc89125af37d118";
const fp12 =
  "08aa5134e107e9403157130da51fbe1c2e708f530b867eba52903acb13b22ac3";

const additions = [
  await measurement({
    sequence: 48,
    batchId: "fix-checkpoint-candidate-11",
    role: "fix",
    experimentId: "exp_20260814000448_6bc1e624",
    candidate: c11,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813223257_52d7e3f0",
    pairedDelta: 0.10438571428571897,
    candidateDecision: "rejected_fix_checkpoint_activation_absent",
    requirementsArtifact: req11,
  }),
  skipped({
    sequence: 49,
    batchId: "regression-candidate-11-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c11,
    sourceFingerprint: fp11,
    requirementsArtifact: req11,
  }),
  skipped({
    sequence: 50,
    batchId: "rotating-06-candidate-11-skipped",
    role: "rotating",
    planId: rotating06Plan,
    candidate: c11,
    sourceFingerprint: fp11,
    requirementsArtifact: req11,
  }),
  await measurement({
    sequence: 51,
    batchId: "fix-checkpoint-candidate-11b",
    role: "fix",
    experimentId: "exp_20260814003305_9cb4942e",
    candidate: c11b,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813223257_52d7e3f0",
    pairedDelta: -8.83705238095238,
    comparisonEligible: false,
    candidateDecision: "rejected_fix_checkpoint_invalid_trial",
    requirementsArtifact: req11b,
  }),
  skipped({
    sequence: 52,
    batchId: "regression-candidate-11b-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c11b,
    sourceFingerprint: fp11b,
    requirementsArtifact: req11b,
  }),
  skipped({
    sequence: 53,
    batchId: "rotating-06-candidate-11b-skipped",
    role: "rotating",
    planId: rotating06Plan,
    candidate: c11b,
    sourceFingerprint: fp11b,
    requirementsArtifact: req11b,
  }),
  await measurement({
    sequence: 54,
    batchId: "fix-checkpoint-candidate-11c",
    role: "fix",
    experimentId: "exp_20260814010501_736c8aa1",
    candidate: c11c,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813223257_52d7e3f0",
    pairedDelta: -2.6551714285714103,
    candidateDecision: "rejected_fix_checkpoint_canary_loss",
    requirementsArtifact: req11c,
  }),
  skipped({
    sequence: 55,
    batchId: "regression-candidate-11c-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c11c,
    sourceFingerprint: fp11c,
    requirementsArtifact: req11c,
  }),
  skipped({
    sequence: 56,
    batchId: "rotating-06-candidate-11c-skipped",
    role: "rotating",
    planId: rotating06Plan,
    candidate: c11c,
    sourceFingerprint: fp11c,
    requirementsArtifact: req11c,
  }),
  await measurement({
    sequence: 57,
    batchId: "fix-checkpoint-candidate-12",
    role: "fix",
    experimentId: "exp_20260814013831_07a7eb80",
    candidate: c12,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813223257_52d7e3f0",
    pairedDelta: 4.331185714285711,
    candidateDecision: "passed_fix_checkpoint",
    requirementsArtifact: req12,
  }),
  await measurement({
    sequence: 58,
    batchId: "regression-candidate-12",
    role: "regression",
    experimentId: "exp_20260814020149_83bd5104",
    candidate: c12,
    complexityMean: regressionComplexity,
    baselineExperimentId: "exp_20260813222206_02e4fd0e",
    pairedDelta: 0,
    candidateDecision: "passed_regression_gate",
    requirementsArtifact: req12,
  }),
  await measurement({
    sequence: 59,
    batchId: "rotating-06-candidate-12-sample-01",
    role: "rotating",
    experimentId: "exp_20260814021147_0f9842bc",
    candidate: c12,
    complexityMean: rotating06Complexity,
    comparisonEligible: false,
    candidateDecision: "breadth_sample_requires_replicate",
    requirementsArtifact: req12,
  }),
  await measurement({
    sequence: 60,
    batchId: "rotating-06-candidate-12-replicate-02",
    role: "rotating_replicate",
    experimentId: "exp_20260814022447_f44982e0",
    candidate: c12,
    complexityMean: rotating06Complexity,
    baselineExperimentId: "exp_20260814021147_0f9842bc",
    pairedDelta: 2.266157142857143,
    candidateDecision: "rejected_three_gate_rotating_safety_failure",
    requirementsArtifact: req12,
  }),
];

const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}

const planArtifacts = {
  fixPlanArtifact:
    "data/evaluation-experiments/plans/2026-08-12T19-02-46-388Z-plan_0667a5e983762ce7/plan.json",
  regressionPlanArtifact:
    "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
  rotatingPlanArtifact:
    "data/evaluation-experiments/plans/2026-08-13T23-33-01-856Z-plan_f0a98581d1a97e3b/plan.json",
};
const bundleDefinitions = [
  {
    batchId: "candidate-11-staged-bundle",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp11,
    singleCapability: "bounded_nonterminal_action_outcome_semantics",
    decision: "rejected_fix_checkpoint_activation_absent",
    requirementsArtifact: req11,
  },
  {
    batchId: "candidate-11b-staged-bundle",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp11b,
    singleCapability: "typed_validation_evidence",
    decision: "rejected_fix_checkpoint_invalid_trial",
    requirementsArtifact: req11b,
  },
  {
    batchId: "candidate-11c-staged-bundle",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp11c,
    singleCapability: "typed_item_level_fault_containment",
    decision: "rejected_fix_checkpoint_canary_loss",
    requirementsArtifact: req11c,
  },
  {
    batchId: "candidate-12-staged-bundle",
    status: "completed_rejected_rotating_safety_gate",
    sourceFingerprint: fp12,
    singleCapability: "typed_cross_page_readback_consistency",
    decision: "rejected_three_gate_rotating_safety_failure",
    requirementsArtifact: req12,
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-12-postbundle.json",
    operationalArtifacts: [
      "data/evaluation-experiments/runs/exp_20260814013831_07a7eb80",
      "data/evaluation-experiments/runs/exp_20260814020149_83bd5104",
      "data/evaluation-experiments/runs/exp_20260814021147_0f9842bc",
      "data/evaluation-experiments/runs/exp_20260814022447_f44982e0",
    ],
  },
];
for (const definition of bundleDefinitions) {
  if (!(run.plannedBatches || []).some((row) => row.batchId === definition.batchId)) {
    run.plannedBatches.push({
      ...definition,
      role: "staged_fix_regression_rotating",
      ...planArtifacts,
    });
  }
}

run.currentPromotedCandidate = {
  ...run.currentPromotedCandidate,
  nextCapability: "browser_failure_evidence_precedence_across_failed_repairs",
};
run.currentDevelopmentCandidate = {
  candidate: "candidate-12a-browser-failure-evidence-precedence",
  parentSourceFingerprint: fp12,
  provenance: "repair_on_rejected_candidate_12_worktree",
  status: "requirements_complete_implementation_not_started",
  requirementsArtifact: `${requirementsRoot}/round-13-candidate-12a-preimplementation.md`,
};
run.preservation.candidate12PostbundleReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-12-postbundle.json";
run.preservation.candidate12PostbundleRequirements = req12;
run.preservation.candidate12FixComparison =
  "data/evaluation-experiments/runs/exp_20260814013831_07a7eb80/comparison-exp_20260813223257_52d7e3f0.json";
run.preservation.candidate12RegressionComparison =
  "data/evaluation-experiments/runs/exp_20260814020149_83bd5104/comparison-exp_20260813222206_02e4fd0e.json";
run.preservation.candidate12RotatingReplicateComparison =
  "data/evaluation-experiments/runs/exp_20260814022447_f44982e0/comparison-exp_20260814021147_0f9842bc.json";

await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
console.log(runPath);
