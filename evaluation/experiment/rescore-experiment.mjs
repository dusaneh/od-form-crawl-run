import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  directoryInventory,
  inventoryHash,
  readJson,
  writeJson,
} from "./core.mjs";
import {
  aggregateExperimentScores,
  draftLearnings,
  SCORER_VERSION,
  scoreV1Trial,
} from "./score-v1.mjs";
import { appendRegistryEvent } from "./registry.mjs";

function argument(name, fallback = null, argv = process.argv) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

async function optionalJson(filePath) {
  return (await stat(filePath).catch(() => null))
    ? readJson(filePath)
    : null;
}

export async function rescoreExperiment(argv = process.argv) {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  const runArg = argument("--run", null, argv);
  if (!runArg) throw new Error("Provide --run with an existing experiment directory.");
  const experimentRoot = path.isAbsolute(runArg)
    ? runArg
    : path.resolve(projectRoot, runArg);
  const [manifest, plan, originalScore] = await Promise.all([
    readJson(path.join(experimentRoot, "manifest.json")),
    readJson(path.join(experimentRoot, "plan.json")),
    readJson(path.join(experimentRoot, "score.json")),
  ]);
  const outputRoot = path.join(
    experimentRoot,
    "rescoring",
    `scorer-${SCORER_VERSION}`,
  );
  if (await stat(path.join(outputRoot, "score.json")).catch(() => null)) {
    throw new Error(`Immutable rescore output already exists at ${outputRoot}.`);
  }
  await mkdir(outputRoot, { recursive: true });

  const trials = [];
  for (const original of originalScore.trials || []) {
    const trialRoot = path.join(experimentRoot, original.artifactRoot);
    const rawRoot = path.join(trialRoot, "raw");
    const scoringRoot = path.join(trialRoot, "scoring");
    const freeze = await readJson(path.join(trialRoot, "raw-freeze.json"));
    const currentRawHash = inventoryHash(await directoryInventory(rawRoot));
    if (currentRawHash !== freeze.aggregateSha256) {
      throw new Error(`Frozen raw artifacts changed for ${original.artifactRoot}.`);
    }
    const [oracle, report, run, submission, harnessError] = await Promise.all([
      readJson(path.join(scoringRoot, "ground-truth.json")),
      optionalJson(path.join(rawRoot, "report.json")),
      optionalJson(path.join(rawRoot, "run.json")),
      optionalJson(path.join(scoringRoot, "submission.json")),
      optionalJson(path.join(rawRoot, "harness-error.json")),
    ]);
    const score = scoreV1Trial({
      oracle,
      report,
      run,
      submission,
      rawArtifactHash: freeze.aggregateSha256,
      rawArtifactRoot: `${original.artifactRoot.replaceAll("\\", "/")}/raw`,
      harnessError,
    });
    Object.assign(score, {
      batchNumber: original.batchNumber,
      trialNumber: original.trialNumber,
      clientRunId: original.clientRunId,
      evaluationId: original.evaluationId,
      artifactRoot: original.artifactRoot,
    });
    trials.push(score);
  }

  const aggregate = aggregateExperimentScores(trials);
  const batches = (plan.batches || []).map((batch) => {
    const selected = trials.filter(
      (trial) => trial.batchNumber === batch.batchNumber,
    );
    return {
      batchNumber: batch.batchNumber,
      scenarioKeys: batch.scenarioKeys,
      coveredFeatures: batch.coveredFeatures,
      aggregate: aggregateExperimentScores(selected),
    };
  });
  const rescored = {
    schemaVersion: 1,
    kind: "formweave_evaluation_rescore",
    scorerVersion: SCORER_VERSION,
    experimentId: manifest.experimentId,
    rescoredAt: new Date().toISOString(),
    originalScorePath: path.relative(outputRoot, path.join(experimentRoot, "score.json")),
    originalScorerVersion: originalScore.scorerVersion || "1.0.0",
    candidate: originalScore.candidate,
    configurationId: originalScore.configurationId,
    planId: originalScore.planId,
    catalogRevision: originalScore.catalogRevision,
    sourceFingerprint: originalScore.sourceFingerprint,
    model: originalScore.model,
    aggregate,
    batches,
    trials,
  };
  await Promise.all([
    writeJson(path.join(outputRoot, "score.json"), rescored),
    writeJson(path.join(outputRoot, "learnings.json"), draftLearnings(rescored)),
  ]);

  const historyRoot = path.resolve(
    projectRoot,
    argument(
      "--history-root",
      path.join("data", "evaluation-experiments", "registry"),
      argv,
    ),
  );
  await appendRegistryEvent(historyRoot, {
    type: "experiment_rescored",
    experimentId: manifest.experimentId,
    scorerVersion: SCORER_VERSION,
    originalScorerVersion: rescored.originalScorerVersion,
    outputRoot,
    overallScore: aggregate.overallScore,
    strictPassRate: aggregate.strictPassRate,
    safetyPassRate: aggregate.safetyPassRate,
    invalidTrials: aggregate.invalidTrials,
  });
  return { experimentId: manifest.experimentId, outputRoot, aggregate };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  const result = await rescoreExperiment();
  console.log(JSON.stringify(result, null, 2));
}
