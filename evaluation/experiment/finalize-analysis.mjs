import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { readJson, writeJson } from "./core.mjs";
import { appendRegistryEvent } from "./registry.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function validateEvidence(experimentRoot, evidence, errors, context) {
  for (const [index, item] of (evidence || []).entries()) {
    if (!item?.artifact || typeof item.artifact !== "string") {
      errors.push(`${context} evidence ${index + 1} has no artifact path.`);
      continue;
    }
    const resolved = path.resolve(experimentRoot, item.artifact);
    const relative = path.relative(experimentRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`${context} evidence escapes the experiment root: ${item.artifact}`);
      continue;
    }
    if (!(awaitableStatCache.get(resolved) ?? false)) {
      errors.push(`${context} evidence does not exist: ${item.artifact}`);
    }
  }
}

const awaitableStatCache = new Map();

async function validateLearnings(experimentRoot, learnings, score, acceptDraft) {
  const errors = [];
  if (learnings.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (learnings.kind !== "formweave_qualitative_learning") {
    errors.push("kind must be formweave_qualitative_learning.");
  }
  if (learnings.experimentId !== score.experimentId) {
    errors.push("experimentId does not match score.json.");
  }
  if (!acceptDraft && learnings.analysisStatus !== "complete") {
    errors.push("analysisStatus must be complete after Codex semantic review.");
  }
  if (!String(learnings.summary || "").trim()) errors.push("summary is required.");
  const expectedScenarios = new Set(score.trials.map((trial) => trial.scenarioKey));
  const observedScenarios = new Set((learnings.tests || []).map((test) => test.scenarioKey));
  for (const scenarioKey of expectedScenarios) {
    if (!observedScenarios.has(scenarioKey)) errors.push(`Missing learnings for ${scenarioKey}.`);
  }
  const evidenceItems = [];
  for (const test of learnings.tests || []) {
    if (!Array.isArray(test.worked) || !Array.isArray(test.failed)) {
      errors.push(`${test.scenarioKey || "unknown"} must contain worked[] and failed[].`);
      continue;
    }
    for (const [index, item] of test.worked.entries()) {
      if (!String(item.claim || "").trim()) errors.push(`${test.scenarioKey} worked ${index + 1} has no claim.`);
      if (!String(item.preservationInvariant || "").trim()) {
        errors.push(`${test.scenarioKey} worked ${index + 1} has no preservationInvariant.`);
      }
      evidenceItems.push({ evidence: item.evidence, context: `${test.scenarioKey} worked ${index + 1}` });
    }
    for (const [index, item] of test.failed.entries()) {
      if (!String(item.claim || "").trim()) errors.push(`${test.scenarioKey} failed ${index + 1} has no claim.`);
      if (!String(item.generalizableCause || "").trim()) {
        errors.push(`${test.scenarioKey} failed ${index + 1} has no generalizableCause.`);
      }
      if (!acceptDraft && /requires semantic review/i.test(item.generalizableCause || "")) {
        errors.push(`${test.scenarioKey} failed ${index + 1} still contains the draft cause.`);
      }
      evidenceItems.push({ evidence: item.evidence, context: `${test.scenarioKey} failed ${index + 1}` });
    }
  }
  const paths = new Set(
    evidenceItems.flatMap((item) => (item.evidence || []).map((evidence) => evidence.artifact)).filter(Boolean),
  );
  await Promise.all(
    [...paths].map(async (artifact) => {
      const resolved = path.resolve(experimentRoot, artifact);
      awaitableStatCache.set(resolved, Boolean(await stat(resolved).catch(() => null)));
    }),
  );
  for (const item of evidenceItems) validateEvidence(experimentRoot, item.evidence, errors, item.context);
  if (!learnings.batchSynthesis || typeof learnings.batchSynthesis !== "object") {
    errors.push("batchSynthesis is required.");
  } else {
    for (const key of ["workedPatterns", "failedPatterns", "preservationRisks", "recommendations"]) {
      if (!Array.isArray(learnings.batchSynthesis[key])) errors.push(`batchSynthesis.${key} must be an array.`);
    }
  }
  return errors;
}

function markdown(learnings) {
  const lines = [
    `# FormWeave evaluation learnings: ${learnings.experimentId}`,
    "",
    learnings.summary,
    "",
  ];
  for (const test of learnings.tests) {
    lines.push(`## ${test.scenarioKey}`, "", `Status: **${test.status}**; score: **${Number(test.overallScore).toFixed(1)}**`, "", "### Worked", "");
    if (!test.worked.length) lines.push("- Nothing reached a fully passing scored state.");
    for (const item of test.worked) {
      lines.push(`- ${item.claim} Preserve: ${item.preservationInvariant}`);
    }
    lines.push("", "### Failed", "");
    if (!test.failed.length) lines.push("- No scored failures.");
    for (const item of test.failed) {
      lines.push(`- ${item.claim} Cause: ${item.generalizableCause}`);
    }
    if ((test.unknowns || []).length) {
      lines.push(
        "",
        "### Unknown",
        "",
        ...test.unknowns.map((item) =>
          `- ${typeof item === "string" ? item : item?.claim || JSON.stringify(item)}`
        ),
      );
    }
    lines.push("");
  }
  lines.push("## Cross-test synthesis", "");
  for (const [label, key] of [
    ["Worked patterns", "workedPatterns"],
    ["Failed patterns", "failedPatterns"],
    ["Preservation risks", "preservationRisks"],
    ["Recommendations", "recommendations"],
  ]) {
    lines.push(`### ${label}`, "");
    const values = learnings.batchSynthesis[key] || [];
    lines.push(...(values.length ? values.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`) : ["- None."]));
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const requestedRun = argument("--run");
if (!requestedRun) throw new Error("Usage: --run <experiment-directory> [--input <learnings.json>]");
const experimentRoot = path.resolve(requestedRun);
const inputPath = path.resolve(argument("--input", path.join(experimentRoot, "learnings.json")));
const [learnings, score, manifest] = await Promise.all([
  readJson(inputPath),
  readJson(path.join(experimentRoot, "score.json")),
  readJson(path.join(experimentRoot, "manifest.json")),
]);
const errors = await validateLearnings(experimentRoot, learnings, score, flag("--accept-draft"));
if (errors.length) {
  throw new Error(`Qualitative analysis validation failed:\n- ${errors.join("\n- ")}`);
}
learnings.analysisStatus = flag("--accept-draft") ? "complete_deterministic" : "complete";
learnings.finalizedAt = new Date().toISOString();
await Promise.all([
  writeJson(path.join(experimentRoot, "learnings.json"), learnings),
  writeFile(path.join(experimentRoot, "learnings.md"), markdown(learnings), "utf8"),
]);
manifest.qualitativeStatus = "complete";
manifest.qualitativeCompletedAt = learnings.finalizedAt;
await writeJson(path.join(experimentRoot, "manifest.json"), manifest);

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const historyRoot = path.resolve(
  argument(
    "--history-root",
    path.join(projectRoot, "data", "evaluation-experiments", "registry"),
  ),
);
await appendRegistryEvent(historyRoot, {
  type: "analysis_completed",
  experimentId: score.experimentId,
  analysisPath: path.join(experimentRoot, "learnings.json"),
  summary: learnings.summary,
});
console.log(
  JSON.stringify(
    {
      experimentId: score.experimentId,
      experimentRoot,
      analysisStatus: learnings.analysisStatus,
      tests: learnings.tests.length,
      historyRoot,
    },
    null,
    2,
  ),
);
