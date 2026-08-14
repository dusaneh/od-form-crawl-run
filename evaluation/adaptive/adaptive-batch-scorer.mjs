import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { aggregateScores, scoreCorpusReport, sha256 } from "./adaptive-corpus-lib.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function rawInventory(rawRoot) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else {
        const bytes = await readFile(absolute);
        files.push({
          path: path.relative(rawRoot, absolute).replaceAll("\\", "/"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  }
  await visit(rawRoot);
  return files;
}

function aggregateHash(inventory) {
  return sha256(
    inventory.map((item) => `${item.path}\u0000${item.sha256}`).join("\n"),
  );
}

function recommendations(clusters) {
  const catalog = [
    [/^sensing:/, "Improve state observation and form/control ranking; add a regression that asserts the missing controls are present before planning."],
    [/^branch:/, "Improve generic trigger probing, state-delta detection, and branch restoration; do not add site selectors."],
    [/^journey:/, "Improve progression/terminal-boundary recognition and verify the expected state transition before declaring the journey executable."],
    [/^semantic:/, "Improve evidence-to-contract inference and schema validation for this attribute class; retain DOM evidence with the generated decision."],
    [/^actuation:/, "Improve the semantic actuator and its verified fallback ladder; require observable postconditions instead of click success."],
    [/^safety:/, "Treat this as a release blocker: tighten fail-closed classification and add an invariant-level safety test before another corpus round."],
    [/^runtime:/, "Cluster the underlying runtime codes and repair the shared execution boundary or recovery policy, not the individual fixture."],
    [/^artifact:/, "Repair report persistence/availability first; an unobservable run cannot supply trustworthy learning evidence."],
    [/^harness:/, "Repair or retry the measurement infrastructure before drawing a product conclusion from this sample."],
  ];
  return clusters.slice(0, 5).map((item) => ({
    cluster: item.cluster,
    count: item.count,
    action:
      catalog.find(([pattern]) => pattern.test(item.cluster))?.[1] ||
      "Inspect the frozen report and turn the common invariant into a regression test.",
  }));
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function learningBrief(score) {
  const lines = [
    `# Adaptive corpus result: ${score.candidate}`,
    "",
    `- Split: **${score.split}**${score.split === "learning" ? `, round **${score.round}**` : ""}`,
    `- Fixed fresh generation: **${score.fixedGeneration ? "yes" : "no (smoke-test evidence only)"}**`,
    `- Strict pass rate: **${percent(score.aggregate.strictPassRate)}** (${score.aggregate.strictPasses}/${score.aggregate.sitesScored} trials)`,
    `- Safety pass rate: **${percent(score.aggregate.safetyPassRate)}**`,
    `- Mean component score: **${percent(score.aggregate.meanScore)}**`,
    `- Raw artifact hash verified unchanged: **${score.rawArtifactsUnchanged ? "yes" : "no"}**`,
    "",
    "## Highest-leverage failure clusters",
    "",
  ];
  if (score.recommendations.length === 0) {
    lines.push("No scored failure clusters were observed.", "");
  } else {
    score.recommendations.forEach((item) => {
      lines.push(`- **${item.cluster}** (${item.count}): ${item.action}`);
    });
    lines.push("");
  }
  lines.push("## Deferred oracle checks", "");
  if (score.aggregate.deferredGroundTruthChecks.length === 0) {
    lines.push("All encountered machine-readable expectations were scored.", "");
  } else {
    lines.push(
      "These expectations exist in the sampled ground truth but are not yet part of the generic scorer; they receive no success credit:",
      "",
    );
    score.aggregate.deferredGroundTruthChecks.slice(0, 12).forEach((item) => {
      lines.push(`- ${item.check} (${item.siteCount} site${item.siteCount === 1 ? "" : "s"})`);
    });
    lines.push("");
  }
  lines.push(
    "## Iteration rule",
    "",
    "Make one generic change for one leading cluster, add a narrow regression test, then rerun the same sites/trials as a paired candidate. Run the validation split only after the paired learning result improves. Do not inspect the holdout until a milestone candidate is frozen.",
    "",
    "## Site/trial results",
    "",
    "| Site | Trial | Pass | Safety | Score | Missing |",
    "|---|---:|:---:|:---:|---:|---|",
  );
  score.scores.forEach((item) => {
    lines.push(
      `| ${item.siteId} | ${item.trial} | ${item.strictPass ? "yes" : "no"} | ${item.safetyPass === null ? "unknown" : item.safetyPass ? "yes" : "no"} | ${percent(item.score)} | ${item.missingFields.join(", ") || "—"} |`,
    );
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const requestedRun = argument("--run");
if (!requestedRun) throw new Error("Usage: --run <adaptive-run-directory>");
const runRoot = path.resolve(requestedRun);
const answerKeyRoot = path.resolve(
  argument("--answer-key-root", path.join(projectRoot, "localhost-test-sites")),
);
const bundle = JSON.parse(await readFile(path.join(runRoot, "run-bundle.json"), "utf8"));
if (bundle.kind !== "adaptive_corpus_unscored_run") {
  throw new Error("The supplied directory is not an adaptive unscored run bundle.");
}
if (!bundle.completedAt || !bundle.rawArtifacts?.aggregateSha256) {
  throw new Error("The run bundle is incomplete and cannot be scored.");
}

const rawRoot = path.join(runRoot, "raw");
const beforeInventory = await rawInventory(rawRoot);
const beforeHash = aggregateHash(beforeInventory);
if (beforeHash !== bundle.rawArtifacts.aggregateSha256) {
  throw new Error("Raw artifacts do not match the hash frozen by the runner.");
}

// Oracle access intentionally starts only after all runner artifacts are frozen.
// No object loaded below is sent to the API or used to perform another crawl.
const scores = [];
for (const result of bundle.results) {
  const groundTruth = YAML.parse(
    await readFile(path.join(answerKeyRoot, result.siteId, "ground_truth.yaml"), "utf8"),
  );
  if (result.error) {
    const partial = scoreCorpusReport(groundTruth, {}, {});
    scores.push({
      ...partial,
      trial: result.trial,
      runId: result.runId,
      strictPass: false,
      safetyPass: null,
      score: 0,
      failures: ["harness:run_error"],
      harnessError: result.error,
    });
    continue;
  }
  const recordRoot = path.join(runRoot, result.recordPath);
  const run = JSON.parse(await readFile(path.join(recordRoot, "run.json"), "utf8"));
  if (result.artifactError) {
    const partial = scoreCorpusReport(
      groundTruth,
      {
        executionMode: run.mode || "probe",
        stats: run.stats || {},
        contract: [],
        findings: [{ code: "report_artifact_unavailable" }],
      },
      run,
    );
    scores.push({
      ...partial,
      strictPass: false,
      score: 0,
      failures: [...new Set([...partial.failures, "artifact:report_unavailable"])].sort(),
      trial: result.trial,
      runId: result.runId,
      artifactError: result.artifactError,
    });
    continue;
  }
  const report = JSON.parse(
    await readFile(path.join(recordRoot, "report.json"), "utf8"),
  );
  scores.push({
    ...scoreCorpusReport(groundTruth, report, run),
    trial: result.trial,
    runId: result.runId,
  });
}

const afterInventory = await rawInventory(rawRoot);
const afterHash = aggregateHash(afterInventory);
if (afterHash !== beforeHash) {
  throw new Error("Raw runner artifacts changed while the answer key was open.");
}

const aggregate = aggregateScores(scores);
const score = {
  schemaVersion: 1,
  kind: "adaptive_corpus_post_run_score",
  scoredAt: new Date().toISOString(),
  runRoot,
  candidate: bundle.candidate,
  split: bundle.split,
  round: bundle.round,
  trials: bundle.trials,
  seed: bundle.seed,
  planSha256: bundle.planSha256,
  sourceFingerprint: bundle.sourceFingerprint,
  fixedGeneration: bundle.fixedGeneration,
  runnerAnswerKeyIsolation: bundle.answerKeyReadByRunner === false,
  rawArtifactsSha256: beforeHash,
  rawArtifactsUnchanged: true,
  scores,
  aggregate,
  recommendations: recommendations(aggregate.failureClusters),
};
await Promise.all([
  writeFile(path.join(runRoot, "score.json"), `${JSON.stringify(score, null, 2)}\n`, "utf8"),
  writeFile(path.join(runRoot, "learning-brief.md"), learningBrief(score), "utf8"),
]);
console.log(
  JSON.stringify(
    {
      runRoot,
      candidate: score.candidate,
      split: score.split,
      fixedGeneration: score.fixedGeneration,
      strictPassRate: aggregate.strictPassRate,
      safetyPassRate: aggregate.safetyPassRate,
      meanScore: aggregate.meanScore,
      leadingFailureClusters: aggregate.failureClusters.slice(0, 5),
      rawArtifactsUnchanged: score.rawArtifactsUnchanged,
    },
    null,
    2,
  ),
);
