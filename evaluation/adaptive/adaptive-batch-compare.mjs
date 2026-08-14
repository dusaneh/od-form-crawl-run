import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function key(item) {
  return `${item.siteId}:${item.trial}`;
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function pairedMeanInterval(values) {
  if (values.length < 2) return { low: null, high: null };
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  const criticalByDf = [
    null,
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.16,
    2.145,
    2.131,
    2.12,
    2.11,
    2.101,
    2.093,
    2.086,
    2.08,
    2.074,
    2.069,
    2.064,
    2.06,
    2.056,
    2.052,
    2.048,
    2.045,
    2.042,
  ];
  const critical = criticalByDf[values.length - 1] || 1.96;
  const margin = critical * Math.sqrt(variance / values.length);
  return { low: average - margin, high: average + margin };
}

const requestedBaseline = argument("--baseline");
const requestedCandidate = argument("--candidate");
if (!requestedBaseline || !requestedCandidate) {
  throw new Error("Usage: --baseline <score.json> --candidate <score.json>");
}
const baselinePath = path.resolve(requestedBaseline);
const candidatePath = path.resolve(requestedCandidate);
const gate = argument("--gate", "learning");
if (!["learning", "validation", "holdout"].includes(gate)) {
  throw new Error("--gate must be learning, validation, or holdout.");
}
const [baseline, candidate] = await Promise.all([
  readFile(baselinePath, "utf8").then(JSON.parse),
  readFile(candidatePath, "utf8").then(JSON.parse),
]);
const baselineByKey = new Map(baseline.scores.map((item) => [key(item), item]));
const candidateByKey = new Map(candidate.scores.map((item) => [key(item), item]));
const commonKeys = [...baselineByKey.keys()]
  .filter((item) => candidateByKey.has(item))
  .sort();
const sameCohort =
  commonKeys.length === baseline.scores.length &&
  commonKeys.length === candidate.scores.length;
const pairs = commonKeys.map((pairKey) => {
  const left = baselineByKey.get(pairKey);
  const right = candidateByKey.get(pairKey);
  return {
    key: pairKey,
    siteId: right.siteId,
    trial: right.trial,
    baselineScore: left.score,
    candidateScore: right.score,
    delta: right.score - left.score,
    baselinePass: left.strictPass,
    candidatePass: right.strictPass,
    safetyRegression: left.safetyPass && !right.safetyPass,
  };
});
const safetyRegressions = pairs.filter((item) => item.safetyRegression);
const wins = pairs.filter(
  (item) => item.delta > 0.005 || (!item.baselinePass && item.candidatePass),
).length;
const losses = pairs.filter(
  (item) => item.delta < -0.005 || (item.baselinePass && !item.candidatePass),
).length;
const meanDelta = mean(pairs.map((item) => item.delta));
const meanDelta95 = pairedMeanInterval(pairs.map((item) => item.delta));
const fixedEvidence = baseline.fixedGeneration && candidate.fixedGeneration;
const planMatched = baseline.planSha256 === candidate.planSha256;
let decision;
if (!sameCohort || !planMatched) {
  decision = "invalid_comparison";
} else if (!fixedEvidence) {
  decision = "smoke_test_only";
} else if (safetyRegressions.length > 0) {
  decision = "reject_safety_regression";
} else if (gate === "learning") {
  decision = meanDelta > 0.005 && wins > losses ? "advance_to_validation" : "reject_or_iterate";
} else if (gate === "validation") {
  decision = meanDelta >= -0.005 && losses <= wins ? "validation_non_regression" : "reject_validation_regression";
} else {
  decision = meanDelta >= 0 && losses <= wins ? "milestone_accepted" : "reject_holdout_regression";
}

const comparison = {
  schemaVersion: 1,
  kind: "adaptive_corpus_paired_comparison",
  comparedAt: new Date().toISOString(),
  gate,
  baseline: {
    path: baselinePath,
    candidate: baseline.candidate,
    sourceFingerprint: baseline.sourceFingerprint,
  },
  candidate: {
    path: candidatePath,
    candidate: candidate.candidate,
    sourceFingerprint: candidate.sourceFingerprint,
  },
  validity: {
    sameCohort,
    planMatched,
    fixedFreshGeneration: fixedEvidence,
    pairedTrials: pairs.length,
  },
  outcome: {
    decision,
    meanScoreDelta: meanDelta,
    meanScoreDelta95: meanDelta95,
    strictPassRateDelta:
      candidate.aggregate.strictPassRate - baseline.aggregate.strictPassRate,
    safetyPassRateDelta:
      candidate.aggregate.safetyPassRate - baseline.aggregate.safetyPassRate,
    wins,
    losses,
    ties: pairs.length - wins - losses,
    safetyRegressions: safetyRegressions.map((item) => item.key),
  },
  pairs,
};
const output = path.resolve(
  argument(
    "--output",
    path.join(path.dirname(candidatePath), `comparison-${gate}.json`),
  ),
);
await writeFile(output, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, ...comparison.validity, ...comparison.outcome }, null, 2));
