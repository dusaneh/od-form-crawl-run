import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../env.mjs";
import { createFormWeaveDatabase } from "./database.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dataRoot = path.resolve(
  projectRoot,
  argument("--data") || process.env.FORMWEAVE_DATA_DIR || "data",
);
const includeObjects = !process.argv.includes("--metadata-only");

async function readJsonIfAvailable(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function directories(root, pattern) {
  return (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function importEvents(database, scopeType, scopeId, filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  const entries = [];
  const relativeSource = path.relative(dataRoot, filePath).replaceAll("\\", "/");
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      event = {
        timestamp: new Date().toISOString(),
        kind: "legacy_log_line",
        message: line,
        metadata: { source: relativeSource, line: index + 1 },
      };
    }
    entries.push({
      event,
      eventKey: `filesystem:${relativeSource}:${index + 1}`,
    });
  }
  await database.appendEvents(scopeType, scopeId, entries);
  return entries.length;
}

const database = await createFormWeaveDatabase();
const totals = {
  settings: 0,
  runs: 0,
  reports: 0,
  runEvents: 0,
  runObjects: 0,
  scripts: 0,
  lineages: 0,
  forms: 0,
  approvals: 0,
  executions: 0,
  executionEvents: 0,
  systemObjects: 0,
};

try {
  console.log(`Importing FormWeave application state from ${dataRoot}`);
  const settings = await readJsonIfAvailable(path.join(dataRoot, "settings.json"));
  if (settings) {
    await database.putSettings(settings);
    totals.settings += 1;
  }

  const runIds = await directories(path.join(dataRoot, "runs"), /^run_/i);
  for (const [index, runId] of runIds.entries()) {
    const root = path.join(dataRoot, "runs", runId);
    const run = await readJsonIfAvailable(path.join(root, "run.json"));
    if (!run) continue;
    await database.putRun(run);
    totals.runs += 1;
    const report = await readJsonIfAvailable(path.join(root, "report.json"));
    if (report) {
      await database.putReport(runId, report);
      totals.reports += 1;
    }
    totals.runEvents += await importEvents(
      database,
      "run",
      runId,
      path.join(root, "events.jsonl"),
    );
    if (includeObjects) {
      totals.runObjects += await database.importDirectory({
        ownerType: "run",
        ownerId: runId,
        directory: root,
        exclude: new Set(["run.json", "report.json", "events.jsonl"]),
      });
    }
    if ((index + 1) % 25 === 0 || index + 1 === runIds.length) {
      console.log(`Runs: ${index + 1}/${runIds.length}`);
    }
  }

  totals.scripts = await database.importScriptRegistry(
    path.join(dataRoot, "generated-scripts"),
  );

  const lineageRoot = path.join(dataRoot, "lineages");
  const lineageFiles = (await readdir(lineageRoot, { withFileTypes: true }).catch(
    () => [],
  )).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  for (const entry of lineageFiles) {
    const payload = await readJsonIfAvailable(path.join(lineageRoot, entry.name));
    if (!payload?.normalizedUrl) continue;
    await database.putLineage(
      path.basename(entry.name, ".json"),
      payload.normalizedUrl,
      payload,
    );
    totals.lineages += 1;
  }

  const formIds = await directories(path.join(dataRoot, "forms"), /^form_/i);
  for (const formId of formIds) {
    const formRoot = path.join(dataRoot, "forms", formId);
    const payload = await readJsonIfAvailable(path.join(formRoot, "form.json"));
    if (!payload) continue;
    await database.putForm(payload);
    totals.forms += 1;
    const approvals = (
      await readdir(formRoot, { withFileTypes: true }).catch(() => [])
    ).filter(
      (entry) =>
        entry.isFile() && /^approval_[a-z0-9]+\.json$/i.test(entry.name),
    );
    for (const entry of approvals) {
      const approval = await readJsonIfAvailable(path.join(formRoot, entry.name));
      if (!approval) continue;
      await database.putApproval(formId, approval);
      totals.approvals += 1;
    }
  }

  const executionIds = await directories(
    path.join(dataRoot, "executions"),
    /^exec_/i,
  );
  for (const executionId of executionIds) {
    const root = path.join(dataRoot, "executions", executionId);
    const payload = await readJsonIfAvailable(path.join(root, "execution.json"));
    if (!payload) continue;
    await database.putExecution(payload);
    totals.executions += 1;
    totals.executionEvents += await importEvents(
      database,
      "execution",
      executionId,
      path.join(root, "events.jsonl"),
    );
  }

  if (includeObjects) {
    for (const directoryName of ["logs", "service-logs"]) {
      totals.systemObjects += await database.importDirectory({
        ownerType: "system",
        ownerId: "local-filesystem-import",
        directory: path.join(dataRoot, directoryName),
        keyPrefix: `${directoryName}/`,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        source: dataRoot,
        mode: includeObjects ? "complete" : "metadata-only",
        imported: totals,
        database: await database.counts(),
      },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
