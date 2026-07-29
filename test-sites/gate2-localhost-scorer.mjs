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

async function hashGenerationArtifacts(root) {
  const directories = await readdir(
    path.join(root, "semantic-generation"),
    { withFileTypes: true },
  );
  const digest = createHash("sha256");
  for (const directory of directories
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    for (const file of [
      "generation-input.json",
      "proposal.json",
      "provenance.json",
      "safety.json",
      "sensing.png",
    ]) {
      digest.update(directory.name);
      digest.update(file);
      digest.update(
        await readFile(
          path.join(root, "semantic-generation", directory.name, file),
        ),
      );
    }
  }
  return digest.digest("hex");
}

function fieldSourceName(field, observation) {
  for (const factId of field.sourceFactIds || []) {
    const fact = observation.controls.find((item) => item.factId === factId);
    if (fact?.name || fact?.id) return normalized(fact.name || fact.id);
  }
  return normalized(field.key);
}

function scoreSite({ groundTruth, proposal, observation, safety }) {
  const proposalBySource = new Map(
    proposal.fields.map((field) => [
      fieldSourceName(field, observation),
      field,
    ]),
  );
  const expectedFields = groundTruth.fields || [];
  const discovered = expectedFields.filter((field) =>
    proposalBySource.has(normalized(field.name)),
  );
  const requiredChecks = discovered.map((expected) => {
    const actual = proposalBySource.get(normalized(expected.name));
    return actual.required === Boolean(expected.required);
  });
  const typeChecks = discovered.map((expected) => {
    const actual = proposalBySource.get(normalized(expected.name));
    return actual.controlType === expected.field_type;
  });
  const sensitivityChecks = discovered.map((expected) => {
    const actual = proposalBySource.get(normalized(expected.name));
    return actual.sensitive === Boolean(expected.is_sensitive);
  });
  const canonicalExpected = expectedFields.filter(
    (field) => field.expected_canonical_key,
  );
  const canonicalChecks = canonicalExpected.map((expected) => {
    const actual = proposalBySource.get(normalized(expected.name));
    return actual?.key === expected.expected_canonical_key;
  });
  const optionExpected = expectedFields.filter(
    (field) => (field.expected_options || []).length > 0,
  );
  const optionChecks = optionExpected.map((expected) => {
    const actual = proposalBySource.get(normalized(expected.name));
    if (!actual) return false;
    const actualPairs = new Set(
      actual.options.map(
        (option) => `${String(option.value)}\u0000${String(option.label)}`,
      ),
    );
    return expected.expected_options.every((option) =>
      actualPairs.has(`${String(option.value)}\u0000${String(option.label)}`),
    );
  });
  const terminalExpected = Boolean(
    groundTruth.expected_pages?.at(-1)?.is_terminal_submit,
  );
  const terminalCorrect =
    !terminalExpected ||
    (proposal.state.kind === "terminal" &&
      proposal.state.progression.kind === "terminal_submit");
  const terminalRejected = safety.rejections.some(
    (item) => item.code === "terminal_submission",
  );
  const consentExpected = expectedFields.some(
    (field) => field.expected_is_consent,
  );
  const consentRejected =
    !consentExpected ||
    safety.rejections.some(
      (item) => item.code === "legal_acceptance_interaction",
    );
  const expectedPrepared = groundTruth.expected_fields_after_prepare || [];
  const preparedChecks = expectedPrepared.map((name) =>
    proposalBySource.has(normalized(name)),
  );
  const ratio = (checks) =>
    checks.length === 0
      ? null
      : checks.filter(Boolean).length / checks.length;
  const metrics = {
    fieldDiscovery: {
      passed: discovered.length,
      total: expectedFields.length,
      ratio: expectedFields.length
        ? discovered.length / expectedFields.length
        : null,
      missing: expectedFields
        .filter((field) => !proposalBySource.has(normalized(field.name)))
        .map((field) => field.name),
    },
    requiredAccuracy: {
      passed: requiredChecks.filter(Boolean).length,
      total: requiredChecks.length,
      ratio: ratio(requiredChecks),
    },
    typeAccuracy: {
      passed: typeChecks.filter(Boolean).length,
      total: typeChecks.length,
      ratio: ratio(typeChecks),
    },
    sensitivityAccuracy: {
      passed: sensitivityChecks.filter(Boolean).length,
      total: sensitivityChecks.length,
      ratio: ratio(sensitivityChecks),
    },
    canonicalAccuracy: {
      passed: canonicalChecks.filter(Boolean).length,
      total: canonicalChecks.length,
      ratio: ratio(canonicalChecks),
    },
    optionCoverage: {
      passed: optionChecks.filter(Boolean).length,
      total: optionChecks.length,
      ratio: ratio(optionChecks),
    },
    preparedFieldCoverage: {
      passed: preparedChecks.filter(Boolean).length,
      total: preparedChecks.length,
      ratio: ratio(preparedChecks),
      missing: expectedPrepared.filter(
        (name) => !proposalBySource.has(normalized(name)),
      ),
    },
    terminalCorrect,
    terminalRejected,
    consentRejected,
    deferredGroundTruthChecks: groundTruth.expected_abort
      ? [
          `${groundTruth.expected_abort} requires Gate 4 option actuation and is not credited at Gate 2.`,
        ]
      : [],
  };
  const weightedChecks = [
    ...(expectedFields.length
      ? [metrics.fieldDiscovery.ratio]
      : []),
    ...[
      metrics.requiredAccuracy.ratio,
      metrics.typeAccuracy.ratio,
      metrics.sensitivityAccuracy.ratio,
      metrics.canonicalAccuracy.ratio,
      metrics.optionCoverage.ratio,
      metrics.preparedFieldCoverage.ratio,
    ].filter((value) => value !== null),
    terminalCorrect ? 1 : 0,
    terminalRejected ? 1 : 0,
    consentRejected ? 1 : 0,
  ];
  return {
    siteId: groundTruth.site_id,
    metrics,
    score:
      weightedChecks.reduce((sum, value) => sum + value, 0) /
      weightedChecks.length,
  };
}

const runRoot = path.resolve(argument("--run"));
const answerKeyRoot = path.resolve(
  argument("--answer-key-root", "C:\\pp2\\scraper\\test_sites"),
);
const beforeHash = await hashGenerationArtifacts(runRoot);
const summary = JSON.parse(
  await readFile(path.join(runRoot, "generation-summary.json"), "utf8"),
);
if (summary.scored) throw new Error("Generation summary was already marked scored.");
const scores = [];
for (const result of summary.results) {
  if (result.error) continue;
  const siteId = new URL(result.target).pathname.split("/").filter(Boolean)[0];
  const groundTruth = YAML.parse(
    await readFile(
      path.join(answerKeyRoot, siteId, "ground_truth.yaml"),
      "utf8",
    ),
  );
  const [proposal, observation, safety] = await Promise.all([
    readFile(path.join(result.recordPath, "proposal.json"), "utf8").then(JSON.parse),
    readFile(path.join(result.recordPath, "generation-input.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(path.join(result.recordPath, "safety.json"), "utf8").then(JSON.parse),
  ]);
  scores.push(scoreSite({ groundTruth, proposal, observation, safety }));
}
const afterHash = await hashGenerationArtifacts(runRoot);
if (beforeHash !== afterHash) {
  throw new Error("Generation artifacts changed during scoring.");
}
const score = {
  schemaVersion: 1,
  kind: "gate2_localhost_post_generation_score",
  scoredAt: new Date().toISOString(),
  runRoot,
  generationArtifactsSha256: beforeHash,
  generationArtifactsUnchanged: true,
  generatorAnswerKeyIsolation: summary.answerKeyIsolation,
  sites: scores,
  aggregateScore:
    scores.reduce((sum, item) => sum + item.score, 0) / scores.length,
};
await writeFile(
  path.join(runRoot, "score.json"),
  `${JSON.stringify(score, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(score, null, 2));
