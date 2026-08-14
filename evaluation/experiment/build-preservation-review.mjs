import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { readJson, writeJson } from "./core.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function unique(values) {
  return [...new Set(values.filter((value) => String(value || "").trim()))].sort();
}

const repoRoot = path.resolve(import.meta.dirname, "../..");

function repoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function parseFeatureDefinitions(markdown) {
  const definitions = new Map();
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const start = line.match(/^- `([A-Z]\d+(?:\.\d+)*)`\s+(.*)$/);
    if (start) {
      current = start[1];
      definitions.set(current, start[2].trim());
      continue;
    }
    if (current && /^\s{2,}\S/.test(line)) {
      definitions.set(current, `${definitions.get(current)} ${line.trim()}`);
      continue;
    }
    if (line.trim()) current = null;
  }
  return definitions;
}

async function completedLearnings(runsRoot) {
  const directories = await readdir(runsRoot, { withFileTypes: true });
  const values = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const learningsPath = path.join(runsRoot, directory.name, "learnings.json");
    const learnings = await readJson(learningsPath).catch(() => null);
    if (learnings?.analysisStatus !== "complete") continue;
    values.push({ learningsPath, learnings });
  }
  return values.sort((left, right) =>
    String(left.learnings.generatedAt || "").localeCompare(
      String(right.learnings.generatedAt || ""),
    ),
  );
}

const developmentRunPath = repoPath(
  argument(
    "--development-run",
    "data/evaluation-experiments/development-runs/devrun_20260810_complexity7_v1/run.json",
  ),
);
const sourceRunPath = repoPath(argument("--source-run"));
const featuresPath = repoPath(argument("--features", "FEATURES.md"));
const outputPath = repoPath(
  argument(
    "--output",
    path.join(path.dirname(developmentRunPath), "preservation-review.json"),
  ),
);
const featureIds = unique(String(argument("--feature-ids", ""))
  .split(",")
  .map((value) => value.trim()));

if (!sourceRunPath) {
  throw new Error(
    "Usage: --source-run <experiment-directory> [--development-run <run.json>] [--feature-ids F1,F2]",
  );
}

const [developmentRun, sourceLearnings, featureMarkdown] = await Promise.all([
  readJson(developmentRunPath),
  readJson(path.join(sourceRunPath, "learnings.json")),
  readFile(featuresPath, "utf8"),
]);
const history = await completedLearnings(
  path.resolve(repoRoot, "data/evaluation-experiments/runs"),
);
const featureDefinitions = parseFeatureDefinitions(featureMarkdown);
const missingFeatures = featureIds.filter((id) => !featureDefinitions.has(id));
if (missingFeatures.length > 0) {
  throw new Error(`Unknown feature IDs: ${missingFeatures.join(", ")}`);
}

const preservationInvariants = unique(
  history.flatMap(({ learnings }) =>
    (learnings.tests || []).flatMap((test) =>
      (test.worked || []).map((item) => item.preservationInvariant),
    ),
  ),
);
const workedPatterns = unique(
  history.flatMap(({ learnings }) => learnings.batchSynthesis?.workedPatterns || []),
);
const preservationRisks = unique(
  history.flatMap(({ learnings }) => learnings.batchSynthesis?.preservationRisks || []),
);

await writeJson(outputPath, {
  schemaVersion: 1,
  kind: "formweave_preservation_review",
  generatedAt: new Date().toISOString(),
  developmentRunId: developmentRun.developmentRunId,
  sourceExperimentId: sourceLearnings.experimentId,
  history: {
    completedExperimentIds: history.map(({ learnings }) => learnings.experimentId),
    completedExperimentCount: history.length,
    preservationInvariants,
    workedPatterns,
    preservationRisks,
  },
  applicableFeatures: featureIds.map((id) => ({
    id,
    requirement: featureDefinitions.get(id),
  })),
  sourceRecommendations: sourceLearnings.batchSynthesis?.recommendations || [],
  changeGate: {
    requiredBeforeImplementation: [
      "Every proposed change maps to at least one application feature requirement.",
      "Every previously successful safety boundary remains represented by a regression test.",
      "Deterministic code may classify mechanics and enforce safety, but page meaning remains a semantic-layer decision.",
      "Same-cohort rescoring and the next frozen batch use one unchanged source fingerprint.",
    ],
    requiredRegressionFamilies: [
      "interactive CAPTCHA halt",
      "payment-family zero entry",
      "login/credential zero entry",
      "unsupported semantic cross-page dependency halt",
      "ordinary multi-page progression",
      "conditional branch discovery",
      "native ordinary-control compilation",
      "custom-control generated-script fallback",
      "drift and structural ordering",
      "sensitive evidence masking",
      "upload filename/readback fidelity",
    ],
  },
});

console.log(outputPath);
