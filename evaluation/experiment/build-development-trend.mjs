import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function scoredExecution(execution) {
  const score = Number(
    execution.correctedOverallScore ?? execution.overallScore,
  );
  const validTrials = Number(execution.validTrials || 0);
  const observedInvalidTrials = Number(execution.invalidTrials || 0);
  const effectiveInvalidTrials = Number(
    execution.replacementAdjustedInvalidTrials ?? observedInvalidTrials,
  );
  if (!Number.isFinite(score) || validTrials <= 0) return null;
  return {
    sequence: execution.sequence,
    batchId: execution.batchId,
    role: execution.role,
    experimentId: execution.experimentId,
    candidate: execution.candidate,
    sourceFingerprint: execution.sourceFingerprint,
    planId: execution.planId || null,
    configurationId: execution.configurationId || null,
    score,
    status: execution.status,
    validTrials,
    invalidTrials: effectiveInvalidTrials,
    observedInvalidTrials,
    strictPasses: Number(
      (
        Number(
          execution.correctedStrictPassRate ?? execution.strictPassRate ?? 0,
        ) * validTrials
      ).toFixed(8),
    ),
    safetyPasses: Number(
      (Number(execution.safetyPassRate || 0) * validTrials).toFixed(8),
    ),
  };
}

function aggregate(rows) {
  const validTrials = rows.reduce((sum, row) => sum + row.validTrials, 0);
  const invalidTrials = rows.reduce((sum, row) => sum + row.invalidTrials, 0);
  const score = validTrials
    ? rows.reduce((sum, row) => sum + row.score * row.validTrials, 0) /
      validTrials
    : null;
  const strictPasses = rows.reduce((sum, row) => sum + row.strictPasses, 0);
  const safetyPasses = rows.reduce((sum, row) => sum + row.safetyPasses, 0);
  return {
    score: round(score),
    validTrials,
    invalidTrials,
    strictPasses: round(strictPasses),
    strictPassRate: validTrials ? round(strictPasses / validTrials) : null,
    safetyPasses: round(safetyPasses),
    safetyPassRate: validTrials ? round(safetyPasses / validTrials) : null,
  };
}

function candidateKey(row) {
  return `${row.candidate || "unknown"}|${row.sourceFingerprint || "unknown"}`;
}

function markdown(result) {
  const lines = [
    `# Cumulative trend: ${result.developmentRunId}`,
    "",
    `Assessment: **${result.assessment.kind}** — ${result.assessment.detail}`,
    "",
    "This is a descriptive run-wide view. Only rows explicitly marked `paired` are formal same-plan comparisons.",
    "",
    "## Candidate bundles",
    "",
    "| Candidate | Cohorts | Score | Strict | Safety | Invalid | Δ first | Δ previous |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const candidate of result.candidates) {
    lines.push(
      `| ${candidate.candidate} | ${candidate.cohorts} | ${candidate.aggregate.score?.toFixed(2) ?? "—"} | ${(100 * (candidate.aggregate.strictPassRate || 0)).toFixed(1)}% | ${(100 * (candidate.aggregate.safetyPassRate || 0)).toFixed(1)}% | ${candidate.aggregate.invalidTrials} | ${candidate.deltaFromFirstCandidate == null ? "—" : candidate.deltaFromFirstCandidate.toFixed(2)} | ${candidate.deltaFromPreviousCandidate == null ? "—" : candidate.deltaFromPreviousCandidate.toFixed(2)} |`,
    );
  }
  lines.push(
    "",
    "## Every measured cohort",
    "",
    "| # | Role | Candidate | Score | Strict | Safety | Running score | Comparison |",
    "|---:|---|---|---:|---:|---:|---:|---|",
  );
  for (const row of result.measurements) {
    lines.push(
      `| ${row.sequence} | ${row.role} | ${row.candidate} | ${row.score.toFixed(2)} | ${(100 * row.strictPassRate).toFixed(1)}% | ${(100 * row.safetyPassRate).toFixed(1)}% | ${row.running.score.toFixed(2)} | ${row.comparisonKind} |`,
    );
  }
  if (result.unscored.length) {
    lines.push("", "## Unscored or aborted attempts", "");
    for (const row of result.unscored) {
      lines.push(`- #${row.sequence} ${row.candidate}: ${row.status}.`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const requestedDevelopmentRun = argument("--development-run", "");
if (!requestedDevelopmentRun) {
  throw new Error("Pass --development-run <run.json>. ");
}
const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const developmentRunPath = path.isAbsolute(requestedDevelopmentRun)
  ? requestedDevelopmentRun
  : path.resolve(projectRoot, requestedDevelopmentRun);
const run = JSON.parse(await readFile(developmentRunPath, "utf8"));
const scored = [];
const measurements = [];
for (const execution of run.executions || []) {
  const row = scoredExecution(execution);
  if (!row) continue;
  const previous = scored.at(-1) || null;
  scored.push(row);
  const running = aggregate(scored);
  measurements.push({
    ...row,
    strictPassRate: round(row.strictPasses / row.validTrials),
    safetyPassRate: round(row.safetyPasses / row.validTrials),
    deltaFromRunBaseline: round(row.score - scored[0].score),
    deltaFromPreviousMeasurement: previous
      ? round(row.score - previous.score)
      : null,
    comparisonKind:
      previous && previous.planId === row.planId
        ? "paired_same_plan"
        : "descriptive",
    running,
  });
}

const grouped = new Map();
for (const row of scored) {
  const key = candidateKey(row);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}
const candidateRows = [...grouped.values()];
const candidates = candidateRows.map((rows, index) => {
  const value = aggregate(rows);
  const first = aggregate(candidateRows[0]);
  const previous = index > 0 ? aggregate(candidateRows[index - 1]) : null;
  return {
    candidate: rows[0].candidate,
    sourceFingerprint: rows[0].sourceFingerprint,
    cohorts: rows.length,
    roles: rows.map((row) => row.role),
    experimentIds: rows.map((row) => row.experimentId),
    aggregate: value,
    deltaFromFirstCandidate: round(value.score - first.score),
    deltaFromPreviousCandidate: previous
      ? round(value.score - previous.score)
      : null,
    comparisonKind: "descriptive_candidate_bundle",
  };
});

const latest = candidates.at(-1) || null;
const prior = candidates.at(-2) || null;
let assessment = {
  kind: "insufficient_evidence",
  detail: "No scored candidate bundles are available.",
};
if (latest && prior) {
  const delta = latest.aggregate.score - prior.aggregate.score;
  const safetyHeld =
    latest.aggregate.safetyPassRate >= prior.aggregate.safetyPassRate &&
    latest.aggregate.invalidTrials <= prior.aggregate.invalidTrials;
  assessment = !safetyHeld
    ? {
        kind: "regression",
        detail:
          "The latest candidate lost safety or added invalid trials, regardless of its mean score.",
      }
    : delta >= 0.5
      ? {
          kind: "improving",
          detail: `The latest descriptive candidate-bundle mean improved by ${round(delta, 2)} points with safety preserved.`,
        }
      : delta <= -0.5
        ? {
            kind: "regressing",
            detail: `The latest descriptive candidate-bundle mean fell by ${round(Math.abs(delta), 2)} points.`,
          }
        : {
            kind: "flat",
            detail: `The latest descriptive candidate-bundle mean changed by only ${round(delta, 2)} points.`,
          };
}

const result = {
  schemaVersion: 1,
  kind: "formweave_development_run_cumulative_trend",
  generatedAt: new Date().toISOString(),
  developmentRunId: run.developmentRunId,
  comparabilityNote:
    "Run-wide and candidate-bundle aggregates are descriptive because cohort roles, plans, and catalog revisions can differ. Formal deltas require the same frozen plan. Infrastructure-invalid observations may be excluded only when an explicitly linked unchanged-source replacement execution is recorded.",
  assessment,
  cumulative: aggregate(scored),
  measurements,
  candidates,
  unscored: (run.executions || [])
    .filter((execution) => !scoredExecution(execution))
    .map((execution) => ({
      sequence: execution.sequence,
      candidate: execution.candidate,
      experimentId: execution.experimentId,
      status: execution.status,
    })),
};
const root = path.dirname(developmentRunPath);
await writeFile(
  path.join(root, "cumulative-trend.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
await writeFile(path.join(root, "cumulative-trend.md"), markdown(result), "utf8");
console.log(
  JSON.stringify(
    {
      developmentRunId: result.developmentRunId,
      candidates: result.candidates.length,
      measurements: result.measurements.length,
      cumulative: result.cumulative,
      assessment: result.assessment,
    },
    null,
    2,
  ),
);
