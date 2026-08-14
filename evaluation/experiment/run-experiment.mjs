import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildEvaluationPlan,
  directoryInventory,
  evidenceUrls,
  fetchJson,
  fetchJsonResponse,
  inventoryHash,
  normalizeConfiguration,
  readJson,
  relativeArtifact,
  sha256,
  sourceFingerprint,
  stamp,
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

function flag(name, argv = process.argv) {
  return argv.includes(name);
}

function optionalNumber(name, argv = process.argv) {
  const value = argument(name, null, argv);
  return value === null ? undefined : Number(value);
}

export function validateFrozenPlanCatalog(plan, catalog) {
  if (plan.catalogRevision === catalog.catalog_revision) {
    return { revisionChanged: false, liveCatalogRevision: catalog.catalog_revision };
  }
  const liveScenarios = new Map(
    (catalog.scenarios || []).map((scenario) => [
      `${scenario.site_id}/${scenario.scenario_id}`,
      scenario,
    ]),
  );
  const differences = [];
  for (const [key, planned] of Object.entries(plan.scenarios || {})) {
    const live = liveScenarios.get(key);
    if (!live) {
      differences.push(`${key}: missing from live catalog`);
      continue;
    }
    if (live.enabled !== true) differences.push(`${key}: no longer enabled`);
    if (live.fixture_revision !== planned.fixtureRevision) {
      differences.push(`${key}: fixture revision changed`);
    }
    if (live.entry_url !== planned.entryUrl) differences.push(`${key}: entry URL changed`);
    if (live.ground_truth_url !== planned.groundTruthUrl) {
      differences.push(`${key}: ground-truth URL changed`);
    }
  }
  if (differences.length) {
    throw new Error(
      `Plan catalog revision ${plan.catalogRevision} does not match live ${catalog.catalog_revision}, and the frozen cohort changed: ${differences.join("; ")}.`,
    );
  }
  return {
    revisionChanged: true,
    liveCatalogRevision: catalog.catalog_revision,
  };
}

function resolveFrom(root, value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function errorRecord(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    status: error?.status || null,
    payload: error?.payload || null,
    stack: error?.stack || null,
  };
}

async function health(apiOrigin) {
  try {
    const response = await fetchJson(`${apiOrigin}/api/health`, { attempts: 1 });
    return response.payload;
  } catch {
    return null;
  }
}

async function waitForHealth(apiOrigin, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await health(apiOrigin);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`FormWeave API did not become healthy at ${apiOrigin}.`);
}

async function startManagedApi(projectRoot, outputRoot, apiOrigin) {
  const existing = await health(apiOrigin);
  if (existing) return { child: null, health: existing, reused: true };
  await mkdir(outputRoot, { recursive: true });
  const logPath = path.join(outputRoot, "managed-api.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const apiUrl = new URL(apiOrigin);
  const apiPort = apiUrl.port || (apiUrl.protocol === "https:" ? "443" : "80");
  const child = spawn(
    process.execPath,
    [path.join(projectRoot, "evaluation", "adaptive", "start-audit-api.mjs")],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        FORMWEAVE_FORCE_FRESH_GENERATION: "1",
        FORMWEAVE_API_PORT: apiPort,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once("exit", () => log.end());
  try {
    return { child, health: await waitForHealth(apiOrigin), reused: false, logPath };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopManagedApi(managed) {
  if (!managed?.child || managed.child.exitCode !== null) return;
  managed.child.kill();
  await Promise.race([
    new Promise((resolve) => managed.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function waitForTerminal(apiOrigin, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = (await fetchJson(`${apiOrigin}/api/runs/${encodeURIComponent(runId)}`)).payload;
    if (["completed", "awaiting_review", "disqualified", "failed"].includes(payload.run?.status)) {
      return payload.run;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`FormWeave run ${runId} did not finish within ${timeoutMs} ms.`);
}

export async function launchFormweaveRun({ apiOrigin, entryUrl, label, configuration }) {
  let created;
  let capacityAttempts = 0;
  const capacityDeadline = Date.now() + configuration.timeoutMs;
  for (;;) {
    let response;
    try {
      response = await fetchJsonResponse(`${apiOrigin}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [entryUrl],
          name: label,
          mode: configuration.appExecutionMode,
          submit: configuration.appExecutionMode === "fixture_submit",
          browserMode: configuration.browserMode,
          allowLocalTargets: false,
        }),
        attempts: 1,
      });
    } catch (error) {
      const capacityReached =
        error?.status === 429 &&
        error?.payload?.code === "crawl_capacity_reached";
      if (!capacityReached || Date.now() >= capacityDeadline) throw error;
      capacityAttempts += 1;
      const delayMs = Math.min(2_000, 250 * 2 ** Math.min(capacityAttempts - 1, 3));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (response.ok) {
      created = response.payload;
      break;
    }
    if (
      response.status !== 429 ||
      response.payload?.code !== "crawl_capacity_reached" ||
      Date.now() >= capacityDeadline
    ) {
      const error = new Error(
        response.payload?.error || `FormWeave run creation failed with HTTP ${response.status}.`,
      );
      error.status = response.status;
      error.payload = response.payload;
      throw error;
    }
    capacityAttempts += 1;
    const delayMs = Math.min(2_000, 250 * 2 ** Math.min(capacityAttempts - 1, 3));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const run = await waitForTerminal(
    apiOrigin,
    created.run.id,
    configuration.timeoutMs,
  );
  const reportResponse = await fetchJsonResponse(
    `${apiOrigin}/api/runs/${encodeURIComponent(created.run.id)}/report`,
  );
  return {
    run,
    report: reportResponse.ok ? reportResponse.payload : null,
    reportError: reportResponse.ok
      ? null
      : {
          status: reportResponse.status,
          payload: reportResponse.payload,
        },
  };
}

async function archiveEvidence(apiOrigin, report, destination) {
  const archived = [];
  for (const url of evidenceUrls(report)) {
    const response = await fetch(`${apiOrigin}${url}`);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "image/png";
    const extension = contentType.includes("jpeg")
      ? ".jpg"
      : contentType.includes("webp")
        ? ".webp"
        : ".png";
    const name = `${url.split("/").at(-1)}${extension}`;
    const filePath = path.join(destination, "evidence", name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    archived.push({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return archived;
}

async function fetchSubmission(protocolBase, evaluationId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchJsonResponse(
      `${protocolBase}/evaluations/${encodeURIComponent(evaluationId)}/submission`,
      { attempts: 1 },
    );
    if (response.ok) return response;
    if (response.status !== 404) return response;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return fetchJsonResponse(
    `${protocolBase}/evaluations/${encodeURIComponent(evaluationId)}/submission`,
    { attempts: 1 },
  );
}

async function protocolSnapshots(protocolBase) {
  const names = [
    "catalog-v1",
    "evaluation-v1",
    "submission-v1",
    "scenario-ground-truth-v1",
  ];
  const [catalog, ...schemas] = await Promise.all([
    fetchJson(`${protocolBase}/catalog`),
    ...names.map((name) => fetchJson(`${protocolBase}/schemas/${name}`)),
  ]);
  return {
    catalog,
    schemas: Object.fromEntries(names.map((name, index) => [name, schemas[index]])),
  };
}

async function writeSnapshots(outputRoot, snapshots) {
  await writeJson(path.join(outputRoot, "catalog.json"), snapshots.catalog.payload);
  await writeJson(path.join(outputRoot, "catalog-response.json"), {
    status: snapshots.catalog.status,
    etag: snapshots.catalog.headers.etag || null,
    catalogRevision: snapshots.catalog.payload.catalog_revision,
  });
  await Promise.all(
    Object.entries(snapshots.schemas).map(([name, response]) =>
      writeJson(path.join(outputRoot, "schemas", `${name}.json`), response.payload),
    ),
  );
}

function learningsMarkdown(learnings) {
  const lines = [
    `# FormWeave evaluation learnings: ${learnings.experimentId}`,
    "",
    `Status: **${learnings.analysisStatus}**`,
    "",
    learnings.summary,
    "",
  ];
  for (const test of learnings.tests) {
    lines.push(`## ${test.scenarioKey}`, "", `Score: **${test.overallScore.toFixed(1)}**; status: **${test.status}**`, "", "### Worked", "");
    if (test.worked.length === 0) lines.push("- No fully passing scored components.");
    else test.worked.forEach((item) => lines.push(`- ${item.claim} Preserve: ${item.preservationInvariant}`));
    lines.push("", "### Failed", "");
    if (test.failed.length === 0) lines.push("- No scored failures.");
    else test.failed.forEach((item) => lines.push(`- ${item.claim} (${item.severity}).`));
    lines.push("");
  }
  lines.push(
    "## Codex analysis requirement",
    "",
    "Review the cited frozen artifacts, replace generic causes with evidence-backed causes, synthesize cross-test patterns, and run the finalize command. Do not change application code during a measurement-only run.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function allocateEvaluation(protocolBase, scenario, clientRunId, executionGoal) {
  const response = await fetchJson(`${protocolBase}/evaluations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema_version: "1.0",
      site_id: scenario.siteId,
      scenario_id: scenario.scenarioId,
      client_run_id: clientRunId,
      execution_goal: executionGoal,
      ttl_seconds: 3600,
    }),
  });
  return response.payload;
}

async function runTrial({
  experimentId,
  batchNumber,
  trialNumber,
  scenario,
  configuration,
  experimentRoot,
}) {
  const trialRoot = path.join(
    experimentRoot,
    "batches",
    `batch-${String(batchNumber).padStart(2, "0")}`,
    scenario.siteId,
    scenario.scenarioId,
    `trial-${String(trialNumber).padStart(2, "0")}`,
  );
  const rawRoot = path.join(trialRoot, "raw");
  const scoringRoot = path.join(trialRoot, "scoring");
  await Promise.all([
    mkdir(rawRoot, { recursive: true }),
    mkdir(scoringRoot, { recursive: true }),
  ]);
  const clientRunId = `${experimentId}-b${batchNumber}-t${trialNumber}-${scenario.siteId}-${scenario.scenarioId}`;
  let allocation = null;
  let run = null;
  let report = null;
  let harnessError = null;
  let rawHash = null;
  let oracle = null;
  let submission = null;
  try {
    allocation = await allocateEvaluation(
      configuration.protocolBase,
      scenario,
      clientRunId,
      configuration.executionGoal,
    );
    await writeJson(path.join(rawRoot, "allocation.json"), allocation);
    const launched = await launchFormweaveRun({
      apiOrigin: configuration.appApiOrigin,
      entryUrl: allocation.entry_url,
      label: `evaluation ${experimentId} batch ${batchNumber} ${scenario.key} trial ${trialNumber}`,
      configuration,
    });
    run = launched.run;
    report = launched.report;
    await writeJson(path.join(rawRoot, "run.json"), run);
    if (report) {
      await writeJson(path.join(rawRoot, "report.json"), report);
      await archiveEvidence(configuration.appApiOrigin, report, rawRoot);
    } else {
      await writeJson(path.join(rawRoot, "report-error.json"), launched.reportError);
      harnessError = launched.reportError;
    }
  } catch (error) {
    harnessError = errorRecord(error);
    await writeJson(path.join(rawRoot, "harness-error.json"), harnessError);
  }

  const inventory = await directoryInventory(rawRoot);
  rawHash = inventoryHash(inventory);
  await writeJson(path.join(trialRoot, "raw-freeze.json"), {
    frozenAt: new Date().toISOString(),
    aggregateSha256: rawHash,
    files: inventory,
    oracleReadBeforeFreeze: false,
  });

  try {
    const groundTruthResponse = await fetchJson(scenario.groundTruthUrl);
    oracle = groundTruthResponse.payload;
    await writeJson(path.join(scoringRoot, "ground-truth.json"), oracle);
    if (oracle.fixture_revision !== scenario.fixtureRevision) {
      harnessError ||= {
        name: "FixtureRevisionMismatch",
        message: `Catalog fixture revision ${scenario.fixtureRevision} does not match oracle ${oracle.fixture_revision}.`,
      };
    }
    if (allocation?.evaluation_id) {
      const submissionResponse = await fetchSubmission(
        configuration.protocolBase,
        allocation.evaluation_id,
      );
      if (submissionResponse.ok) {
        submission = submissionResponse.payload;
        await writeJson(path.join(scoringRoot, "submission.json"), submission);
      } else {
        await writeJson(path.join(scoringRoot, "submission-missing.json"), {
          status: submissionResponse.status,
          payload: submissionResponse.payload,
        });
      }
    }
  } catch (error) {
    harnessError ||= errorRecord(error);
    await writeJson(path.join(scoringRoot, "scoring-error.json"), errorRecord(error));
  }

  const afterInventory = await directoryInventory(rawRoot);
  const afterHash = inventoryHash(afterInventory);
  if (afterHash !== rawHash) {
    harnessError ||= {
      name: "RawArtifactMutation",
      message: "Raw artifacts changed after the oracle became available.",
    };
  }
  const relativeRawRoot = relativeArtifact(experimentRoot, rawRoot);
  const trialScore = scoreV1Trial({
    oracle,
    report,
    run,
    submission,
    rawArtifactHash: rawHash,
    rawArtifactRoot: relativeRawRoot,
    harnessError,
  });
  trialScore.batchNumber = batchNumber;
  trialScore.trialNumber = trialNumber;
  trialScore.clientRunId = clientRunId;
  trialScore.evaluationId = allocation?.evaluation_id || null;
  trialScore.artifactRoot = relativeArtifact(experimentRoot, trialRoot);
  await writeJson(path.join(scoringRoot, "score.json"), trialScore);

  if (allocation?.evaluation_id) {
    const cleanup = await fetchJsonResponse(
      `${configuration.protocolBase}/evaluations/${encodeURIComponent(allocation.evaluation_id)}`,
      { method: "DELETE" },
    ).catch((error) => ({ ok: false, status: error.status || null, payload: errorRecord(error) }));
    await writeJson(path.join(trialRoot, "cleanup.json"), cleanup);
  }
  return trialScore;
}

function applyOverrides(base, argv) {
  const requestedScenarios = argument("--scenarios", null, argv);
  return {
    ...base,
    ...(argument("--name", null, argv) ? { name: argument("--name", null, argv) } : {}),
    ...(argument("--seed", null, argv) ? { seed: argument("--seed", null, argv) } : {}),
    ...(optionalNumber("--batch-size", argv) ? { batchSize: optionalNumber("--batch-size", argv) } : {}),
    ...(optionalNumber("--batches", argv) ? { batchCount: optionalNumber("--batches", argv) } : {}),
    ...(optionalNumber("--trials", argv) ? { trials: optionalNumber("--trials", argv) } : {}),
    ...(argument("--protocol-base", null, argv) ? { protocolBase: argument("--protocol-base", null, argv) } : {}),
    ...(argument("--api-origin", null, argv) ? { appApiOrigin: argument("--api-origin", null, argv) } : {}),
    ...(argument("--execution-goal", null, argv) ? { executionGoal: argument("--execution-goal", null, argv) } : {}),
    ...(argument("--app-mode", null, argv) ? { appExecutionMode: argument("--app-mode", null, argv) } : {}),
    ...(argument("--browser-mode", null, argv) ? { browserMode: argument("--browser-mode", null, argv) } : {}),
    ...(optionalNumber("--timeout-ms", argv) ? { timeoutMs: optionalNumber("--timeout-ms", argv) } : {}),
    ...(flag("--allow-reuse", argv) ? { freshGenerationRequired: false } : {}),
    ...(requestedScenarios
      ? { scenarioKeys: requestedScenarios.split(",").map((value) => value.trim()).filter(Boolean) }
      : {}),
  };
}

export async function runExperiment(argv = process.argv) {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  const requestedConfig = argument("--config", null, argv);
  const requestedPlan = argument("--plan", null, argv);
  const loadedPlan = requestedPlan
    ? await readJson(resolveFrom(projectRoot, requestedPlan))
    : null;
  const baseConfiguration = requestedConfig
    ? await readJson(resolveFrom(projectRoot, requestedConfig))
    : loadedPlan?.configuration || {};
  const configuration = normalizeConfiguration(applyOverrides(baseConfiguration, argv));
  const snapshots = await protocolSnapshots(configuration.protocolBase);
  const plan = loadedPlan
    ? loadedPlan
    : buildEvaluationPlan(snapshots.catalog.payload, configuration);
  const catalogValidation = validateFrozenPlanCatalog(plan, snapshots.catalog.payload);
  if (loadedPlan) {
    const comparableKeys = [
      "seed",
      "batchSize",
      "batchCount",
      "trials",
      "selectionAlgorithm",
      "executionGoal",
      "appExecutionMode",
      "browserMode",
      "scenarioKeys",
    ];
    const changed = comparableKeys.filter(
      (key) => JSON.stringify(configuration[key]) !== JSON.stringify(loadedPlan.configuration[key]),
    );
    if (changed.length) {
      throw new Error(
        `A frozen plan cannot change comparable configuration fields: ${changed.join(", ")}.`,
      );
    }
  }
  const planRoot = resolveFrom(
    projectRoot,
    argument(
      "--output",
      path.join(projectRoot, "data", "evaluation-experiments", "plans", `${stamp()}-${plan.planId}`),
      argv,
    ),
  );
  if (flag("--plan-only", argv)) {
    if (await stat(path.join(planRoot, "plan.json")).catch(() => null)) {
      throw new Error(`Plan output already exists at ${planRoot}; frozen plans are immutable.`);
    }
    await mkdir(planRoot, { recursive: true });
    await writeSnapshots(planRoot, snapshots);
    await writeJson(path.join(planRoot, "plan.json"), plan);
    return { mode: "plan_only", planRoot, plan };
  }

  const experimentId = argument(
    "--experiment-id",
    `exp_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${sha256(`${plan.planId}:${Date.now()}`).slice(0, 8)}`,
    argv,
  );
  const experimentRoot = resolveFrom(
    projectRoot,
    argument(
      "--output",
      path.join(projectRoot, "data", "evaluation-experiments", "runs", experimentId),
      argv,
    ),
  );
  if (await stat(path.join(experimentRoot, "manifest.json")).catch(() => null)) {
    throw new Error(`Experiment output already exists at ${experimentRoot}.`);
  }
  await mkdir(experimentRoot, { recursive: true });
  await writeSnapshots(experimentRoot, snapshots);
  await writeJson(path.join(experimentRoot, "plan.json"), plan);
  await writeJson(path.join(experimentRoot, "configuration.json"), configuration);
  const fingerprint = await sourceFingerprint(projectRoot);
  const candidate = argument(
    "--candidate",
    fingerprint.git.commit
      ? `${fingerprint.git.commit.slice(0, 12)}${fingerprint.git.dirty ? "-dirty" : ""}`
      : fingerprint.sha256.slice(0, 12),
    argv,
  );
  const manifest = {
    schemaVersion: 1,
    kind: "formweave_evaluation_experiment",
    experimentId,
    createdAt: new Date().toISOString(),
    candidate,
    configurationId: plan.configurationId,
    planId: plan.planId,
    catalogRevision: plan.catalogRevision,
    liveCatalogRevision: catalogValidation.liveCatalogRevision,
    catalogMetadataChanged: catalogValidation.revisionChanged,
    sourceFingerprint: fingerprint,
    batchesRequested: plan.batches.length,
    trialsPerScenario: plan.configuration.trials,
    results: [],
    status: "running",
    qualitativeStatus: "pending",
  };
  await writeJson(path.join(experimentRoot, "manifest.json"), manifest);

  let managed;
  try {
    managed = flag("--manage-api", argv)
      ? await startManagedApi(projectRoot, experimentRoot, configuration.appApiOrigin)
      : { child: null, health: await waitForHealth(configuration.appApiOrigin), reused: true };
    const generationMode = managed.health.generationMode;
    if (configuration.freshGenerationRequired && generationMode !== "forced_fresh") {
      throw new Error(
        `Measured runs require forced_fresh generation; API reports ${generationMode || "unknown"}. Stop the normal server or use --allow-reuse only for smoke testing.`,
      );
    }
    manifest.environment = {
      appApiOrigin: configuration.appApiOrigin,
      protocolBase: configuration.protocolBase,
      model: managed.health.openai?.model || null,
      generationMode,
      traversalSettingsVersion: managed.health.traversalSettingsVersion || null,
      managedApi: Boolean(managed.child),
    };
    await writeJson(path.join(experimentRoot, "manifest.json"), manifest);
    for (const batch of plan.batches) {
      for (const key of batch.scenarioKeys) {
        const scenario = plan.scenarios[key];
        if (!scenario) throw new Error(`Plan is missing scenario metadata for ${key}.`);
        for (let trialNumber = 1; trialNumber <= plan.configuration.trials; trialNumber += 1) {
          process.stdout.write(
            `[${experimentId}] batch ${batch.batchNumber}/${plan.batches.length} ${key} trial ${trialNumber}/${plan.configuration.trials}\n`,
          );
          const result = await runTrial({
            experimentId,
            batchNumber: batch.batchNumber,
            trialNumber,
            scenario,
            configuration,
            experimentRoot,
          });
          manifest.results.push({
            batchNumber: batch.batchNumber,
            scenarioKey: key,
            trialNumber,
            status: result.status,
            overallScore: result.overallScore,
            artifactRoot: result.artifactRoot,
          });
          await writeJson(path.join(experimentRoot, "manifest.json"), manifest);
        }
      }
    }
  } finally {
    await stopManagedApi(managed);
  }

  const trialScores = [];
  for (const result of manifest.results) {
    trialScores.push(
      await readJson(path.join(experimentRoot, result.artifactRoot, "scoring", "score.json")),
    );
  }
  const aggregate = aggregateExperimentScores(trialScores);
  const batches = plan.batches.map((batch) => {
    const selected = trialScores.filter((trial) => trial.batchNumber === batch.batchNumber);
    return {
      batchNumber: batch.batchNumber,
      scenarioKeys: batch.scenarioKeys,
      coveredFeatures: batch.coveredFeatures,
      aggregate: aggregateExperimentScores(selected),
    };
  });
  const scoreDocument = {
    schemaVersion: 1,
    scorerVersion: SCORER_VERSION,
    kind: "formweave_evaluation_score",
    experimentId,
    scoredAt: new Date().toISOString(),
    candidate,
    configurationId: plan.configurationId,
    planId: plan.planId,
    catalogRevision: plan.catalogRevision,
    sourceFingerprint: fingerprint,
    model: manifest.environment?.model || null,
    aggregate,
    batches,
    trials: trialScores,
  };
  await writeJson(path.join(experimentRoot, "score.json"), scoreDocument);
  const learnings = draftLearnings(scoreDocument);
  await Promise.all([
    writeJson(path.join(experimentRoot, "learnings.json"), learnings),
    writeFile(path.join(experimentRoot, "learnings.md"), learningsMarkdown(learnings), "utf8"),
  ]);
  manifest.status = aggregate.status;
  manifest.completedAt = new Date().toISOString();
  manifest.qualitativeStatus = "draft";
  manifest.aggregate = aggregate;
  await writeJson(path.join(experimentRoot, "manifest.json"), manifest);

  const historyRoot = resolveFrom(
    projectRoot,
    argument(
      "--history-root",
      path.join(projectRoot, "data", "evaluation-experiments", "registry"),
      argv,
    ),
  );
  await appendRegistryEvent(historyRoot, {
    type: "experiment_completed",
    experimentId,
    candidate,
    configurationId: plan.configurationId,
    planId: plan.planId,
    catalogRevision: plan.catalogRevision,
    sourceFingerprint: fingerprint,
    model: manifest.environment?.model || null,
    outputRoot: experimentRoot,
    batches: batches.length,
    trials: trialScores.length,
    overallScore: aggregate.overallScore,
    status: aggregate.status,
    strictPassRate: aggregate.strictPassRate,
    safetyPassRate: aggregate.safetyPassRate,
    invalidTrials: aggregate.invalidTrials,
    categoryScores: aggregate.categoryScores,
  });
  return {
    mode: "experiment",
    experimentId,
    experimentRoot,
    historyRoot,
    aggregate,
    plan,
  };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  const result = await runExperiment();
  console.log(
    JSON.stringify(
      result.mode === "plan_only"
        ? {
            mode: result.mode,
            planRoot: result.planRoot,
            planId: result.plan.planId,
            configurationId: result.plan.configurationId,
            enabledScenarios: result.plan.enabledScenarioCount,
            batches: result.plan.batches.length,
          }
        : {
            mode: result.mode,
            experimentId: result.experimentId,
            experimentRoot: result.experimentRoot,
            historyRoot: result.historyRoot,
            overallScore: result.aggregate.overallScore,
            status: result.aggregate.status,
            strictPassRate: result.aggregate.strictPassRate,
            safetyPassRate: result.aggregate.safetyPassRate,
            next: `Review learnings.json and run npm --prefix evaluation run experiment:finalize -- --run "${result.experimentRoot}"`,
          },
      null,
      2,
    ),
  );
}
