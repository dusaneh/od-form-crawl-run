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
const experimentId = "exp_20260814025503_1d1b4b4d";
const experimentRoot = path.join(
  projectRoot,
  "data",
  "evaluation-experiments",
  "runs",
  experimentId,
);
const [manifest, learnings] = await Promise.all([
  readFile(path.join(experimentRoot, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(experimentRoot, "learnings.json"), "utf8").then(JSON.parse),
]);
const candidate =
  "devrun-20260811-threegate7-candidate-12a-browser-failure-evidence-precedence";
const fingerprint =
  "ae340d7b295ebe88586f044f5529b63d3e46d028656b3eaeaeb8297c3f65d0ec";
const requirementsArtifact =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/requirements/round-13-candidate-12a-postcheckpoint.md";
if (manifest.sourceFingerprint?.sha256 !== fingerprint) {
  throw new Error("Candidate 12a has the wrong source fingerprint.");
}

const additions = [
  {
    sequence: 61,
    batchId: "fix-checkpoint-candidate-12a",
    role: "fix",
    experimentId,
    planId: manifest.planId,
    configurationId: manifest.configurationId,
    candidate,
    sourceFingerprint: fingerprint,
    overallScore: manifest.aggregate.overallScore,
    status: manifest.status,
    strictPassRate: manifest.aggregate.strictPassRate,
    safetyPassRate: manifest.aggregate.safetyPassRate,
    validTrials: manifest.aggregate.validTrials,
    invalidTrials: manifest.aggregate.invalidTrials,
    complexityMean: 23,
    qualitativeStatus: manifest.qualitativeStatus,
    comparisonEligible: true,
    pairedBaselineExperimentId: "exp_20260814022447_f44982e0",
    pairedDelta: 0.4313714285714312,
    explicitActivationWitnessCount: Number(
      learnings.activationWitnesses?.browserFailurePrecedenceApplied || 0,
    ),
    candidateDecision:
      "blocked_fix_checkpoint_external_fixture_oracle_inconsistency",
    requirementsArtifact,
  },
  {
    sequence: 62,
    batchId: "regression-candidate-12a-skipped",
    role: "regression",
    experimentId: null,
    planId: "plan_931bd81e97ed6082",
    candidate,
    sourceFingerprint: fingerprint,
    status: "skipped_fix_checkpoint",
    plannedTrials: 7,
    qualitativeStatus: "not_run",
    comparisonEligible: false,
    requirementsArtifact,
  },
  {
    sequence: 63,
    batchId: "rotating-07-candidate-12a-skipped",
    role: "rotating",
    experimentId: null,
    planId: "plan_0f4305442316bef1",
    candidate,
    sourceFingerprint: fingerprint,
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

if (!(run.plannedBatches || []).some((row) => row.batchId === "candidate-12a-staged-bundle")) {
  run.plannedBatches.push({
    batchId: "candidate-12a-staged-bundle",
    role: "staged_fix_regression_rotating",
    status: "blocked_external_fixture_oracle_inconsistency",
    sourceFingerprint: fingerprint,
    singleCapability:
      "browser_failure_evidence_precedence_across_failed_repairs",
    decision: "blocked_fix_checkpoint_external_fixture_oracle_inconsistency",
    requirementsArtifact,
    fixPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-13T23-33-01-856Z-plan_f0a98581d1a97e3b/plan.json",
    regressionPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-11-threegate7-c2b-regression01-r2/plan.json",
    rotatingPlanArtifact:
      "data/evaluation-experiments/plans/2026-08-14T02-54-38-093Z-plan_0f4305442316bef1/plan.json",
    preservationReviewArtifact:
      "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-12a-postcheckpoint.json",
    operationalArtifacts: [
      "data/evaluation-experiments/runs/exp_20260814025503_1d1b4b4d",
    ],
  });
}

run.currentDevelopmentCandidate = {
  candidate,
  sourceFingerprint: fingerprint,
  parentSourceFingerprint:
    "08aa5134e107e9403157130da51fbe1c2e708f530b867eba52903acb13b22ac3",
  provenance: "repair_on_rejected_candidate_12_worktree",
  status: "blocked_external_fixture_oracle_inconsistency",
  targetCapabilityActivated: true,
  motivatingScenarioRepaired: true,
  requirementsArtifact,
  resumeAfter:
    "site_p_crosspage_echo/primary fixture and oracle agree for arbitrary supplied last_name values",
};
run.preservation.candidate12aPostcheckpointReview =
  "data/evaluation-experiments/development-runs/devrun_20260811_threegate7_v1/preservation-review-candidate-12a-postcheckpoint.json";
run.preservation.candidate12aPostcheckpointRequirements = requirementsArtifact;
run.preservation.candidate12aFixComparison =
  "data/evaluation-experiments/runs/exp_20260814025503_1d1b4b4d/comparison-exp_20260814022447_f44982e0.json";

await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
console.log(runPath);
