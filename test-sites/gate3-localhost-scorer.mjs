import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalized(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function filesRecursively(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesRecursively(root, child)));
    } else if (entry.name !== "score.json") {
      files.push(child);
    }
  }
  return files;
}

async function hashFrozenArtifacts(root) {
  const digest = createHash("sha256");
  for (const relative of await filesRecursively(root)) {
    digest.update(relative.replaceAll("\\", "/"));
    digest.update(await readFile(path.join(root, relative)));
  }
  return digest.digest("hex");
}

function sourceNameByContractKey(generationInput) {
  const controls = new Map(
    generationInput.observation.controls.map((fact) => [fact.factId, fact]),
  );
  return new Map(
    generationInput.proposal.fields.map((field) => {
      const source = field.sourceFactIds
        .map((factId) => controls.get(factId))
        .find(Boolean);
      return [field.key, normalized(source?.name || source?.id || field.key)];
    }),
  );
}

function ratio(passed, total) {
  return { passed, total, ratio: total === 0 ? null : passed / total };
}

function scoreTarget({ groundTruth, result, generationInput }) {
  const sourceNames = sourceNameByContractKey(generationInput);
  const contractKeyBySource = new Map(
    [...sourceNames].map(([key, source]) => [source, key]),
  );
  const expected = groundTruth.fields || [];
  const discovered = expected.filter((field) =>
    contractKeyBySource.has(normalized(field.name)),
  );
  const eligibleForSyntheticReplay = expected.filter(
    (field) =>
      !field.conditional &&
      !field.expected_is_consent &&
      field.field_type !== "file",
  );
  const defaultKeys = new Set(result.defaultInputKeys);
  const defaultCovered = eligibleForSyntheticReplay.filter((field) => {
    const contractKey = contractKeyBySource.get(normalized(field.name));
    return contractKey && defaultKeys.has(contractKey);
  });
  const resultsByKey = new Map(
    result.envelope.fieldResults.map((field) => [field.key, field]),
  );
  const verifiedDefaults = result.defaultInputKeys.filter(
    (key) => resultsByKey.get(key)?.status === "verified",
  );
  const expectedProtected = expected.filter(
    (field) => field.expected_is_consent || field.field_type === "file",
  );
  const protectedKeys = new Set(result.protectedFieldKeys);
  const protectedCovered = expectedProtected.filter((field) => {
    const contractKey = contractKeyBySource.get(normalized(field.name));
    return contractKey && protectedKeys.has(contractKey);
  });
  const terminalBlocked =
    result.envelope.progression.kind === "terminal_submit" &&
    result.envelope.progression.failureCode === "terminal_submission_blocked" &&
    result.envelope.progression.attempted === false;
  const metrics = {
    fieldDiscovery: ratio(discovered.length, expected.length),
    defaultSyntheticCoverage: ratio(
      defaultCovered.length,
      eligibleForSyntheticReplay.length,
    ),
    defaultActuationVerified: ratio(
      verifiedDefaults.length,
      result.defaultInputKeys.length,
    ),
    protectedFieldEnforcement: ratio(
      protectedCovered.length,
      expectedProtected.length,
    ),
    terminalBlocked,
    deferredGroundTruthChecks: expected
      .filter((field) => field.conditional)
      .map(
        (field) =>
          `${field.name}: conditional discovery requires Gate 4 option actuation.`,
      ),
  };
  const scoredRatios = [
    metrics.fieldDiscovery.ratio,
    metrics.defaultSyntheticCoverage.ratio,
    metrics.defaultActuationVerified.ratio,
    metrics.protectedFieldEnforcement.ratio,
    terminalBlocked ? 1 : 0,
  ].filter((value) => value !== null);
  return {
    metrics,
    score:
      scoredRatios.reduce((sum, value) => sum + value, 0) /
      scoredRatios.length,
  };
}

const runRoot = path.resolve(argument("--run"));
const answerKeyRoot = path.resolve(
  argument("--answer-key-root", "C:\\pp2\\scraper\\test_sites"),
);
const beforeHash = await hashFrozenArtifacts(runRoot);
const summary = JSON.parse(
  await readFile(path.join(runRoot, "gate3-summary.json"), "utf8"),
);
if (!summary.answerKeyIsolation?.passed) {
  throw new Error("Gate 3 generation/execution did not prove answer-key isolation.");
}
if (summary.targetsFailed !== 0) {
  throw new Error("Gate 3 has failed targets and cannot be scored as complete.");
}

const sites = [];
for (const result of summary.results) {
  const segments = new URL(result.selectedUrl).pathname
    .split("/")
    .filter(Boolean);
  const siteId = segments[0];
  const groundTruth = YAML.parse(
    await readFile(path.join(answerKeyRoot, siteId, "ground_truth.yaml"), "utf8"),
  );
  const generationInput = JSON.parse(
    await readFile(
      path.join(
        runRoot,
        "artifacts",
        result.artifactId,
        "versions",
        String(result.artifactVersion),
        "scripts",
        String(result.scriptVersion),
        "generation-input.json",
      ),
      "utf8",
    ),
  );
  sites.push({
    siteId,
    ...scoreTarget({ groundTruth, result, generationInput }),
  });
}
const afterHash = await hashFrozenArtifacts(runRoot);
if (beforeHash !== afterHash) {
  throw new Error("Gate 3 artifacts changed while scorer read ground truth.");
}
const score = {
  schemaVersion: 1,
  kind: "gate3_localhost_post_execution_score",
  scoredAt: new Date().toISOString(),
  runRoot,
  sourceGate2Run: summary.sourceGate2Run,
  frozenArtifactsSha256: beforeHash,
  frozenArtifactsUnchanged: true,
  generatorAndExecutorAnswerKeyIsolation: summary.answerKeyIsolation,
  sites,
  aggregateScore:
    sites.reduce((sum, site) => sum + site.score, 0) / sites.length,
};
await writeFile(
  path.join(runRoot, "score.json"),
  `${JSON.stringify(score, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" },
);
console.log(JSON.stringify(score, null, 2));
