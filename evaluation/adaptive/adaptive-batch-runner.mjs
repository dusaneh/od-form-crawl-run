import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCorpusPlan, sha256 } from "./adaptive-corpus-lib.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    const error = new Error(payload.error || `${url} returned HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fingerprintFiles(root, relative, digest, inventory) {
  const absolute = path.join(root, relative);
  const metadata = await stat(absolute).catch(() => null);
  if (!metadata) return;
  if (metadata.isDirectory()) {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (["node_modules", "data", "dist", "build", ".git", ".vinext"].includes(entry.name)) {
        continue;
      }
      await fingerprintFiles(root, path.join(relative, entry.name), digest, inventory);
    }
    return;
  }
  const bytes = await readFile(absolute);
  const normalizedPath = relative.replaceAll("\\", "/");
  digest.update(normalizedPath);
  digest.update(bytes);
  inventory.push({ path: normalizedPath, bytes: bytes.length, sha256: sha256(bytes) });
}

async function sourceFingerprint(projectRoot) {
  const digest = createHash("sha256");
  const inventory = [];
  for (const relative of [
    "app",
    "db",
    "local",
    "production",
    "worker",
    "package.json",
    "package-lock.json",
  ]) {
    await fingerprintFiles(projectRoot, relative, digest, inventory);
  }
  return { sha256: digest.digest("hex"), files: inventory.length };
}

async function waitForTerminal(apiOrigin, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await fetchJson(`${apiOrigin}/api/runs/${encodeURIComponent(runId)}`);
    if (["completed", "awaiting_review", "disqualified", "failed"].includes(payload.run?.status)) {
      return payload.run;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs} ms.`);
}

async function launchRun(apiOrigin, site, candidate, timeoutMs) {
  let created;
  for (;;) {
    try {
      created = await fetchJson(`${apiOrigin}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [site.targetUrl],
          name: `adaptive ${candidate} ${site.siteId}`,
          mode: "probe",
          submit: false,
          browserMode: "headless",
          allowLocalTargets: true,
        }),
      });
      break;
    } catch (error) {
      if (error.status !== 429) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  const run = await waitForTerminal(apiOrigin, created.run.id, timeoutMs);
  try {
    const report = await fetchJson(
      `${apiOrigin}/api/runs/${encodeURIComponent(created.run.id)}/report`,
    );
    return { run, report, artifactError: null };
  } catch (error) {
    return {
      run,
      report: null,
      artifactError: {
        name: error.name,
        message: error.message,
        status: error.status || null,
        payload: error.payload || null,
      },
    };
  }
}

function evidenceUrls(value, results = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => evidenceUrls(item, results));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => evidenceUrls(item, results));
  } else if (
    typeof value === "string" &&
    /^\/api\/runs\/[^/]+\/evidence\/[^/]+$/.test(value)
  ) {
    results.add(value);
  }
  return [...results];
}

async function archiveEvidence(apiOrigin, report, destination) {
  const archived = [];
  for (const url of evidenceUrls(report)) {
    const response = await fetch(`${apiOrigin}${url}`);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const name = `${url.split("/").at(-1)}.png`;
    const filePath = path.join(destination, "evidence", name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    archived.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return archived;
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

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const apiOrigin = argument("--api-origin", process.env.FORMWEAVE_API_ORIGIN || "http://127.0.0.1:8787");
const fixtureOrigin = argument(
  "--fixture-origin",
  process.env.FORMWEAVE_FIXTURE_ORIGIN || "http://127.0.0.1:9000",
);
const seed = argument("--seed", "formweave-adaptive-v1");
const batchSize = Math.max(1, Number(argument("--batch-size", "5")));
const rounds = Math.max(1, Number(argument("--rounds", "10")));
const trials = Math.max(1, Number(argument("--trials", "1")));
const timeoutMs = Math.max(60_000, Number(argument("--timeout-ms", "900000")));
const candidate = argument("--candidate", "working-tree");
const requestedPlan = argument("--plan");

let plan;
let planPath;
if (requestedPlan) {
  planPath = path.resolve(requestedPlan);
  plan = JSON.parse(await readFile(planPath, "utf8"));
} else {
  const registry = await fetchJson(`${fixtureOrigin.replace(/\/$/, "")}/registry`);
  plan = buildCorpusPlan(registry, { seed, fixtureOrigin, batchSize, rounds });
  const planRoot = path.resolve(
    argument("--output", path.join(projectRoot, "data", "adaptive-corpus", "plans", stamp())),
  );
  planPath = path.join(planRoot, "corpus-plan.json");
  await writeJson(planPath, plan);
}

if (flag("--plan-only")) {
  console.log(
    JSON.stringify(
      {
        plan: planPath,
        sites: plan.siteCount,
        splits: Object.fromEntries(
          Object.entries(plan.splits).map(([name, values]) => [name, values.length]),
        ),
        batches: plan.learningBatches.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const split = argument("--split", "learning");
const round = Math.max(1, Number(argument("--round", "1")));
if (split === "holdout" && !flag("--unlock-holdout")) {
  throw new Error(
    "The frozen holdout is milestone-only. Re-run with --unlock-holdout after the learning and validation decision is frozen.",
  );
}
let selectedSiteIds;
if (split === "learning") {
  const batch = plan.learningBatches.find((item) => item.round === round);
  if (!batch) throw new Error(`Plan has no learning round ${round}.`);
  selectedSiteIds = batch.sites;
} else if (["validation", "holdout"].includes(split)) {
  selectedSiteIds = plan.splits[split];
} else {
  throw new Error("--split must be learning, validation, or holdout.");
}

const health = await fetchJson(`${apiOrigin}/api/health`);
const forcedFresh = health.generationMode === "forced_fresh";
if (!forcedFresh && !flag("--allow-reuse")) {
  throw new Error(
    "The API is in reuse_or_generate mode. Restart it with FORMWEAVE_FORCE_FRESH_GENERATION=1 so each trial tests the frozen candidate rather than a retained script. Use --allow-reuse only for harness smoke tests.",
  );
}
if (Number(health.activeBrowserRuns || 0) > 0) {
  throw new Error("The API already has an active browser run; wait for it before starting a measured batch.");
}

const runRoot = path.resolve(
  argument(
    "--output",
    path.join(projectRoot, "data", "adaptive-corpus", "runs", `${stamp()}-${split}-${String(round).padStart(2, "0")}`),
  ),
);
if (await stat(path.join(runRoot, "run-bundle.json")).catch(() => null)) {
  throw new Error(
    `Run output already exists at ${runRoot}. Use a new --output directory so frozen trials cannot be mixed or overwritten.`,
  );
}
const rawRoot = path.join(runRoot, "raw");
await mkdir(rawRoot, { recursive: true });
const fingerprint = await sourceFingerprint(projectRoot);
const bundle = {
  schemaVersion: 1,
  kind: "adaptive_corpus_unscored_run",
  createdAt: new Date().toISOString(),
  candidate,
  planPath,
  planSha256: sha256(await readFile(planPath)),
  seed: plan.seed,
  split,
  round,
  trials,
  selectedSiteIds,
  sourceFingerprint: fingerprint,
  environment: {
    apiOrigin,
    fixtureOrigin,
    model: health.openai?.model || null,
    generationMode: health.generationMode,
    traversalSettingsVersion: health.traversalSettingsVersion,
  },
  fixedGeneration: forcedFresh,
  answerKeyReadByRunner: false,
  results: [],
  scored: false,
};
await writeJson(path.join(runRoot, "run-bundle.json"), bundle);

for (const siteId of selectedSiteIds) {
  const site = plan.sites[siteId];
  if (!site) throw new Error(`Plan is missing metadata for ${siteId}.`);
  for (let trial = 1; trial <= trials; trial += 1) {
    const destination = path.join(rawRoot, siteId, `trial-${String(trial).padStart(2, "0")}`);
    await mkdir(destination, { recursive: true });
    process.stdout.write(`[${siteId} trial ${trial}/${trials}] starting ${site.targetUrl}\n`);
    try {
      const result = await launchRun(apiOrigin, site, candidate, timeoutMs);
      await writeJson(path.join(destination, "run.json"), result.run);
      if (result.report) {
        await writeJson(path.join(destination, "report.json"), result.report);
      } else {
        await writeJson(
          path.join(destination, "report-error.json"),
          result.artifactError,
        );
      }
      const evidence = result.report
        ? await archiveEvidence(apiOrigin, result.report, destination)
        : [];
      bundle.results.push({
        siteId,
        trial,
        targetUrl: site.targetUrl,
        runId: result.run.id,
        status: result.run.status,
        recordPath: path.relative(runRoot, destination).replaceAll("\\", "/"),
        evidenceFiles: evidence.length,
        artifactError: result.artifactError,
        error: null,
      });
      process.stdout.write(
        `[${siteId} trial ${trial}/${trials}] ${result.run.status}${result.artifactError ? `; report unavailable: ${result.artifactError.message}` : ""}\n`,
      );
    } catch (error) {
      const failure = {
        name: error.name,
        message: error.message,
        status: error.status || null,
        payload: error.payload || null,
      };
      await writeJson(path.join(destination, "harness-error.json"), failure);
      bundle.results.push({
        siteId,
        trial,
        targetUrl: site.targetUrl,
        runId: null,
        status: "harness_error",
        recordPath: path.relative(runRoot, destination).replaceAll("\\", "/"),
        evidenceFiles: 0,
        error: failure,
      });
      process.stdout.write(`[${siteId} trial ${trial}/${trials}] harness_error: ${error.message}\n`);
    }
    await writeJson(path.join(runRoot, "run-bundle.json"), bundle);
  }
}

bundle.completedAt = new Date().toISOString();
const inventory = await rawInventory(rawRoot);
bundle.rawArtifacts = {
  files: inventory,
  aggregateSha256: sha256(
    inventory.map((item) => `${item.path}\u0000${item.sha256}`).join("\n"),
  ),
};
await writeJson(path.join(runRoot, "run-bundle.json"), bundle);
console.log(
  JSON.stringify(
    {
      runRoot,
      candidate,
      fixedGeneration: bundle.fixedGeneration,
      sites: selectedSiteIds.length,
      trials,
      completed: bundle.results.filter((item) => !item.error).length,
      harnessErrors: bundle.results.filter((item) => item.error).length,
      rawArtifactsSha256: bundle.rawArtifacts.aggregateSha256,
      scored: false,
      next: `npm --prefix evaluation run score -- --run "${runRoot}"`,
    },
    null,
    2,
  ),
);
