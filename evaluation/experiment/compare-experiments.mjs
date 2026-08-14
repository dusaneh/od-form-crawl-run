import path from "node:path";

import { readJson, writeJson } from "./core.mjs";
import { appendRegistryEvent } from "./registry.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function pairedInterval(values) {
  if (values.length < 2) return { low: null, high: null };
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const critical = values.length < 30 ? 2.262 : 1.96;
  const margin = critical * Math.sqrt(variance / values.length);
  return { low: mean - margin, high: mean + margin };
}

function trialKey(trial) {
  return `${trial.batchNumber}:${trial.scenarioKey}:${trial.trialNumber}`;
}

const baselineRoot = argument("--baseline");
const candidateRoot = argument("--candidate");
if (!baselineRoot || !candidateRoot) {
  throw new Error("Usage: --baseline <experiment-directory> --candidate <experiment-directory> [--baseline-score <score.json>] [--candidate-score <score.json>]");
}
const baselinePath = path.resolve(baselineRoot);
const candidatePath = path.resolve(candidateRoot);
const baselineScorePath = path.resolve(
  argument("--baseline-score", path.join(baselinePath, "score.json")),
);
const candidateScorePath = path.resolve(
  argument("--candidate-score", path.join(candidatePath, "score.json")),
);
const [baseline, candidate] = await Promise.all([
  readJson(baselineScorePath),
  readJson(candidateScorePath),
]);
const baselineByKey = new Map(baseline.trials.map((trial) => [trialKey(trial), trial]));
const candidateByKey = new Map(candidate.trials.map((trial) => [trialKey(trial), trial]));
const common = [...baselineByKey.keys()].filter((key) => candidateByKey.has(key)).sort();
const samePlan = baseline.planId === candidate.planId;
const sameConfiguration = baseline.configurationId === candidate.configurationId;
const sameCohort = common.length === baseline.trials.length && common.length === candidate.trials.length;
const sameScorer = baseline.scorerVersion === candidate.scorerVersion;
const pairs = common.map((key) => {
  const left = baselineByKey.get(key);
  const right = candidateByKey.get(key);
  return {
    key,
    baselineScore: left.overallScore,
    candidateScore: right.overallScore,
    delta: right.overallScore - left.overallScore,
    baselineStatus: left.status,
    candidateStatus: right.status,
    safetyRegression: left.safetyPass === true && right.safetyPass === false,
  };
});
const deltas = pairs.map((pair) => pair.delta);
const safetyRegressions = pairs.filter((pair) => pair.safetyRegression);
const meanDelta = average(deltas);
const valid = samePlan && sameConfiguration && sameCohort && sameScorer;
const decision = !valid
  ? "invalid_comparison"
  : safetyRegressions.length
    ? "reject_safety_regression"
    : meanDelta > 0.5
      ? "improved"
      : meanDelta < -0.5
        ? "regressed"
        : "no_material_change";
const comparison = {
  schemaVersion: 1,
  kind: "formweave_evaluation_comparison",
  comparedAt: new Date().toISOString(),
  baselineExperimentId: baseline.experimentId,
  candidateExperimentId: candidate.experimentId,
  validity: {
    samePlan,
    sameConfiguration,
    sameCohort,
    sameScorer,
    baselineScorerVersion: baseline.scorerVersion || null,
    candidateScorerVersion: candidate.scorerVersion || null,
    pairedTrials: pairs.length,
  },
  outcome: {
    decision,
    meanScoreDelta: meanDelta,
    meanScoreDelta95: pairedInterval(deltas),
    strictPassRateDelta: candidate.aggregate.strictPassRate - baseline.aggregate.strictPassRate,
    safetyPassRateDelta: candidate.aggregate.safetyPassRate - baseline.aggregate.safetyPassRate,
    wins: pairs.filter((pair) => pair.delta > 0.5).length,
    losses: pairs.filter((pair) => pair.delta < -0.5).length,
    ties: pairs.filter((pair) => Math.abs(pair.delta) <= 0.5).length,
    safetyRegressions: safetyRegressions.map((pair) => pair.key),
  },
  pairs,
};
const output = path.resolve(
  argument("--output", path.join(candidatePath, `comparison-${baseline.experimentId}.json`)),
);
await writeJson(output, comparison);
const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const historyRoot = path.resolve(
  argument("--history-root", path.join(projectRoot, "data", "evaluation-experiments", "registry")),
);
await appendRegistryEvent(historyRoot, {
  type: "comparison_recorded",
  experimentId: candidate.experimentId,
  baselineExperimentId: baseline.experimentId,
  scoreDelta: meanDelta,
  decision,
  comparisonPath: output,
});
console.log(JSON.stringify({ output, ...comparison.validity, ...comparison.outcome }, null, 2));
