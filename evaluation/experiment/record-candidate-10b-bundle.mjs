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

const fixPlan = "plan_310f0070a86c7733";
const regressionPlan = "plan_931bd81e97ed6082";
const rotatingPlan = "plan_0667a5e983762ce7";
const fixComplexity = 23.428571428571427;
const regressionComplexity = 17.285714285714285;
const rotatingComplexity = 22.857142857142858;

async function measurement({
  sequence,
  batchId,
  role,
  experimentId,
  candidate,
  complexityMean,
  baselineExperimentId,
  pairedDelta,
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
    comparisonEligible: true,
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

const req09b =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-09-candidate-09b-postcheckpoint.md";
const req10 =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-10-prerequisite-repair-preimplementation.md";
const req10a =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-10-candidate-10a-premeasurement.md";
const req10b =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-10-candidate-10b-postbundle.md";

const c09b =
  "devrun-20260811-threegate7-candidate-09b-comparator-preservation";
const c10 =
  "devrun-20260811-threegate7-candidate-10-grounded-prerequisite-repair";
const c10a =
  "devrun-20260811-threegate7-candidate-10a-control-provenance";
const c10b =
  "devrun-20260811-threegate7-candidate-10b-system-owned-diagnosis-identity";
const fp09b =
  "7196296abf771e6bf5a4ee8b17efa7d98d0dbbf02bccb62cd134c90546e4d406";
const fp10 =
  "d555a726c82e1c1a4c7eae798d6e3941e4e0948958b228ad983dcdba53870875";
const fp10a =
  "55fdf2f14b8db691036e94b2a2e3ea8922c13ff69c085ab2f94dacad4814368a";

const additions = [
  await measurement({
    sequence: 36,
    batchId: "fix-checkpoint-candidate-09b",
    role: "fix",
    experimentId: "exp_20260813205015_c62a6e64",
    candidate: c09b,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813202113_0f79ad6b",
    pairedDelta: -1.5875857142857082,
    candidateDecision: "rejected_fix_checkpoint_material_gated_loss",
    requirementsArtifact: req09b,
  }),
  skipped({
    sequence: 37,
    batchId: "regression-candidate-09b-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c09b,
    sourceFingerprint: fp09b,
    requirementsArtifact: req09b,
  }),
  skipped({
    sequence: 38,
    batchId: "rotating-05-candidate-09b-skipped",
    role: "rotating",
    planId: rotatingPlan,
    candidate: c09b,
    sourceFingerprint: fp09b,
    requirementsArtifact: req09b,
  }),
  await measurement({
    sequence: 39,
    batchId: "fix-checkpoint-candidate-10",
    role: "fix",
    experimentId: "exp_20260813211839_84ac25b7",
    candidate: c10,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813205015_c62a6e64",
    pairedDelta: -3.966828571428578,
    candidateDecision: "rejected_fix_checkpoint_safety_regression",
    requirementsArtifact: req10,
  }),
  skipped({
    sequence: 40,
    batchId: "regression-candidate-10-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c10,
    sourceFingerprint: fp10,
    requirementsArtifact: req10,
  }),
  skipped({
    sequence: 41,
    batchId: "rotating-05-candidate-10-skipped",
    role: "rotating",
    planId: rotatingPlan,
    candidate: c10,
    sourceFingerprint: fp10,
    requirementsArtifact: req10,
  }),
  await measurement({
    sequence: 42,
    batchId: "fix-checkpoint-candidate-10a",
    role: "fix",
    experimentId: "exp_20260813214050_2fba22e4",
    candidate: c10a,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813211839_84ac25b7",
    pairedDelta: 2.7527857142857064,
    candidateDecision: "rejected_fix_checkpoint_diagnosis_identity_abort",
    requirementsArtifact: req10a,
  }),
  skipped({
    sequence: 43,
    batchId: "regression-candidate-10a-skipped",
    role: "regression",
    planId: regressionPlan,
    candidate: c10a,
    sourceFingerprint: fp10a,
    requirementsArtifact: req10a,
  }),
  skipped({
    sequence: 44,
    batchId: "rotating-05-candidate-10a-skipped",
    role: "rotating",
    planId: rotatingPlan,
    candidate: c10a,
    sourceFingerprint: fp10a,
    requirementsArtifact: req10a,
  }),
  await measurement({
    sequence: 45,
    batchId: "fix-checkpoint-candidate-10b",
    role: "fix",
    experimentId: "exp_20260813220013_62a66fd0",
    candidate: c10b,
    complexityMean: fixComplexity,
    baselineExperimentId: "exp_20260813214050_2fba22e4",
    pairedDelta: 5.658785714285714,
    candidateDecision: "passed_fix_checkpoint",
    requirementsArtifact: req10b,
  }),
  await measurement({
    sequence: 46,
    batchId: "regression-candidate-10b",
    role: "regression",
    experimentId: "exp_20260813222206_02e4fd0e",
    candidate: c10b,
    complexityMean: regressionComplexity,
    baselineExperimentId: "exp_20260811_threegate7_c2b_regression01_r2",
    pairedDelta: 0,
    candidateDecision: "passed_regression_gate",
    requirementsArtifact: req10b,
  }),
  await measurement({
    sequence: 47,
    batchId: "rotating-05-candidate-10b",
    role: "rotating",
    experimentId: "exp_20260813223257_52d7e3f0",
    candidate: c10b,
    complexityMean: rotatingComplexity,
    baselineExperimentId: "exp_20260813054711_5e6b2cea",
    pairedDelta: 0.9305571428571459,
    candidateDecision: "promoted_three_gate_candidate",
    requirementsArtifact: req10b,
  }),
];

const existing = new Set((run.executions || []).map((row) => row.sequence));
for (const addition of additions) {
  if (!existing.has(addition.sequence)) run.executions.push(addition);
}

const bundleDefinitions = [
  {
    batchId: "candidate-09b-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp09b,
    singleCapability: "choice_failure_comparator_preservation",
    decision: "rejected_fix_checkpoint_material_gated_loss",
    postcheckpointRequirementsArtifact: req09b,
  },
  {
    batchId: "candidate-10-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp10,
    singleCapability: "evidence_grounded_prerequisite_repair",
    decision: "rejected_fix_checkpoint_safety_regression",
    postcheckpointRequirementsArtifact: req10,
  },
  {
    batchId: "candidate-10a-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "stopped_rejected_fix_checkpoint",
    sourceFingerprint: fp10a,
    singleCapability: "typed_failure_control_provenance",
    decision: "rejected_fix_checkpoint_diagnosis_identity_abort",
    postcheckpointRequirementsArtifact: req10a,
  },
  {
    batchId: "candidate-10b-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "completed_promoted",
    sourceFingerprint:
      "14374150318cc34adeb4fc65559e7e67dbc354318723a29f7ab731eb924e4a29",
    singleCapability: "system_owned_content_addressed_diagnosis_identity",
    decision: "promoted_three_gate_candidate",
    postbundleRequirementsArtifact: req10b,
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-10b-postbundle.json",
    operationalArtifacts: [
      "data/evaluation-experiments/runs/exp_20260813220013_62a66fd0",
      "data/evaluation-experiments/runs/exp_20260813222206_02e4fd0e",
      "data/evaluation-experiments/runs/exp_20260813223257_52d7e3f0"
    ],
  },
];
for (const definition of bundleDefinitions) {
  if (!(run.plannedBatches || []).some((row) => row.batchId === definition.batchId)) {
    run.plannedBatches.push({
      ...definition,
      fixPlanArtifact:
        "data/evaluation-experiments/plans/2026-08-12T16-29-55-752Z-plan_310f0070a86c7733/plan.json",
      regressionPlanArtifact:
        "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
      rotatingPlanArtifact:
        "data/evaluation-experiments/plans/2026-08-12T19-02-46-388Z-plan_0667a5e983762ce7/plan.json",
    });
  }
}

run.currentPromotedCandidate = {
  candidate: c10b,
  sourceFingerprint:
    "14374150318cc34adeb4fc65559e7e67dbc354318723a29f7ab731eb924e4a29",
  promotedBy: [
    "exp_20260813220013_62a66fd0",
    "exp_20260813222206_02e4fd0e",
    "exp_20260813223257_52d7e3f0",
  ],
  nextCapability: "bounded_nonterminal_action_outcome_semantics",
};
run.preservation.candidate10bPostbundleReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-10b-postbundle.json";
run.preservation.candidate10bPostbundleRequirements = req10b;
run.preservation.candidate10bFixComparison =
  "data/evaluation-experiments/runs/exp_20260813220013_62a66fd0/comparison-exp_20260813214050_2fba22e4.json";
run.preservation.candidate10bRegressionComparison =
  "data/evaluation-experiments/runs/exp_20260813222206_02e4fd0e/comparison-exp_20260811_threegate7_c2b_regression01_r2.json";
run.preservation.candidate10bRotatingComparison =
  "data/evaluation-experiments/runs/exp_20260813223257_52d7e3f0/comparison-exp_20260813054711_5e6b2cea.json";

await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
console.log(runPath);
