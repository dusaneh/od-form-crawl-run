import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function fetchJsonResponse(url, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  const request = { ...options };
  delete request.attempts;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, request);
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          const error = new Error(
            `${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`,
          );
          error.status = response.status;
          error.body = text;
          throw error;
        }
      }
      const result = {
        ok: response.ok,
        status: response.status,
        payload,
        headers: Object.fromEntries(response.headers.entries()),
      };
      if (response.ok || response.status === 404) return result;
      const error = new Error(
        payload?.detail || payload?.error || `${url} returned HTTP ${response.status}`,
      );
      error.status = response.status;
      error.payload = payload;
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

export async function fetchJson(url, options = {}) {
  const response = await fetchJsonResponse(url, options);
  if (!response.ok) {
    const error = new Error(
      response.payload?.detail ||
        response.payload?.error ||
        `${url} returned HTTP ${response.status}`,
    );
    error.status = response.status;
    error.payload = response.payload;
    throw error;
  }
  return response;
}

function seededRandom(seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const random = seededRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function scenarioKey(scenario) {
  return `${scenario.site_id}/${scenario.scenario_id}`;
}

function chooseFeatureBalancedBatches(scenarios, { seed, batchSize, batchCount }) {
  const usage = new Map(scenarios.map((scenario) => [scenarioKey(scenario), 0]));
  const batches = [];
  for (let number = 1; number <= batchCount; number += 1) {
    const selected = [];
    const covered = new Set();
    const rank = new Map(
      shuffled(
        scenarios.map(scenarioKey),
        `${seed}:batch:${number}`,
      ).map((key, index) => [key, index]),
    );
    while (selected.length < Math.min(batchSize, scenarios.length)) {
      const remaining = scenarios.filter(
        (scenario) => !selected.some((item) => scenarioKey(item) === scenarioKey(scenario)),
      );
      remaining.sort((left, right) => {
        const leftKey = scenarioKey(left);
        const rightKey = scenarioKey(right);
        const usageDelta = usage.get(leftKey) - usage.get(rightKey);
        if (usageDelta) return usageDelta;
        const leftNovelty = (left.feature_tags || []).filter(
          (feature) => !covered.has(feature),
        ).length;
        const rightNovelty = (right.feature_tags || []).filter(
          (feature) => !covered.has(feature),
        ).length;
        return rightNovelty - leftNovelty || rank.get(leftKey) - rank.get(rightKey);
      });
      const winner = remaining[0];
      selected.push(winner);
      usage.set(scenarioKey(winner), usage.get(scenarioKey(winner)) + 1);
      (winner.feature_tags || []).forEach((feature) => covered.add(feature));
    }
    batches.push({
      batchNumber: number,
      scenarioKeys: selected.map(scenarioKey),
      coveredFeatures: [...covered].sort(),
    });
  }
  return batches;
}

function scenarioComplexity(scenario) {
  const value = Number(scenario.complexity);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function stratifiedSubset(scenarios, capacity) {
  if (scenarios.length <= capacity) return scenarios;
  const selected = [];
  const used = new Set();
  for (let index = 0; index < capacity; index += 1) {
    let position = Math.floor(((index + 0.5) * scenarios.length) / capacity);
    position = Math.min(Math.max(position, 0), scenarios.length - 1);
    while (used.has(position) && position + 1 < scenarios.length) position += 1;
    while (used.has(position) && position > 0) position -= 1;
    used.add(position);
    selected.push(scenarios[position]);
  }
  return selected.sort(
    (left, right) =>
      scenarioComplexity(left) - scenarioComplexity(right) ||
      scenarioKey(left).localeCompare(scenarioKey(right)),
  );
}

function chooseComplexityStratifiedBatches(
  scenarios,
  { seed, batchSize, batchCount },
) {
  const rank = new Map(
    shuffled(
      scenarios.map(scenarioKey),
      `${seed}:complexity-ties`,
    ).map((key, index) => [key, index]),
  );
  const ordered = [...scenarios].sort(
    (left, right) =>
      scenarioComplexity(left) - scenarioComplexity(right) ||
      rank.get(scenarioKey(left)) - rank.get(scenarioKey(right)),
  );
  const capacity = Math.min(ordered.length, batchSize * batchCount);
  const selected = stratifiedSubset(ordered, capacity);
  const actualBatchCount = Math.min(
    batchCount,
    Math.max(1, Math.ceil(selected.length / batchSize)),
  );
  const batches = Array.from({ length: actualBatchCount }, (_, index) => ({
    batchNumber: index + 1,
    scenarios: [],
  }));

  // Consecutive score blocks contain one candidate per batch. Alternating the
  // assignment direction keeps every batch spread across the full difficulty
  // range while preserving seeded randomness for equal scores.
  for (let offset = 0; offset < selected.length; offset += actualBatchCount) {
    const block = selected.slice(offset, offset + actualBatchCount);
    const blockNumber = Math.floor(offset / actualBatchCount);
    if (block.length < actualBatchCount) {
      const targets = batches
        .map((batch, index) => ({
          index,
          mean: mean(batch.scenarios.map(scenarioComplexity)),
          size: batch.scenarios.length,
        }))
        .sort(
          (left, right) =>
            left.mean - right.mean ||
            left.size - right.size ||
            left.index - right.index,
        );
      const descending = [...block].sort(
        (left, right) => scenarioComplexity(right) - scenarioComplexity(left),
      );
      for (const [index, scenario] of descending.entries()) {
        batches[targets[index].index].scenarios.push(scenario);
      }
      continue;
    }
    const direction = blockNumber % 2 === 0 ? 1 : -1;
    for (const [index, scenario] of block.entries()) {
      const batchIndex =
        direction === 1 ? index : actualBatchCount - 1 - index;
      batches[batchIndex].scenarios.push(scenario);
    }
  }

  return batches
    .filter((batch) => batch.scenarios.length > 0)
    .map((batch) => {
      const scores = batch.scenarios.map(scenarioComplexity);
      const covered = new Set(
        batch.scenarios.flatMap((scenario) => scenario.feature_tags || []),
      );
      return {
        batchNumber: batch.batchNumber,
        scenarioKeys: batch.scenarios.map(scenarioKey),
        coveredFeatures: [...covered].sort(),
        complexity: {
          scores,
          minimum: Math.min(...scores),
          maximum: Math.max(...scores),
          mean: mean(scores),
        },
      };
    });
}

function chooseBatches(scenarios, configuration) {
  if (configuration.selectionAlgorithm === "complexity-stratified-v1") {
    return chooseComplexityStratifiedBatches(scenarios, configuration);
  }
  return chooseFeatureBalancedBatches(scenarios, configuration);
}

export function normalizeConfiguration(input = {}) {
  const config = {
    schemaVersion: 1,
    name: String(input.name || "formweave-five-by-three-v1"),
    seed: String(input.seed || "formweave-evaluation-v1"),
    batchSize: Math.max(1, Number(input.batchSize || 5)),
    batchCount: Math.max(1, Number(input.batchCount || 3)),
    trials: Math.max(1, Number(input.trials || 1)),
    selectionAlgorithm:
      input.selectionAlgorithm === "complexity-stratified-v1"
        ? "complexity-stratified-v1"
        : "feature-balanced-v1",
    protocolBase: String(
      input.protocolBase || "https://testforms.dbolab.io/api/v1",
    ).replace(/\/$/, ""),
    appApiOrigin: String(
      input.appApiOrigin || "http://127.0.0.1:8787",
    ).replace(/\/$/, ""),
    executionGoal: input.executionGoal || "submit",
    appExecutionMode: input.appExecutionMode || "fixture_submit",
    browserMode: input.browserMode === "headful" ? "headful" : "headless",
    timeoutMs: Math.max(60_000, Number(input.timeoutMs || 900_000)),
    freshGenerationRequired: input.freshGenerationRequired !== false,
    scenarioKeys: Array.isArray(input.scenarioKeys)
      ? [...new Set(input.scenarioKeys.map(String).filter(Boolean))].sort()
      : [],
  };
  if (!new Set(["submit", "crawl_only", "halt_check"]).has(config.executionGoal)) {
    throw new Error("executionGoal must be submit, crawl_only, or halt_check.");
  }
  if (!new Set(["probe", "fixture_submit"]).has(config.appExecutionMode)) {
    throw new Error("appExecutionMode must be probe or fixture_submit.");
  }
  if (config.executionGoal === "crawl_only" && config.appExecutionMode === "fixture_submit") {
    throw new Error("crawl_only cannot be paired with fixture_submit.");
  }
  return config;
}

export function buildEvaluationPlan(catalog, inputConfiguration = {}) {
  const configuration = normalizeConfiguration(inputConfiguration);
  const requestedKeys = new Set(configuration.scenarioKeys);
  const enabled = (catalog.scenarios || [])
    .filter((scenario) => scenario.enabled === true)
    .filter(
      (scenario) =>
        requestedKeys.size === 0 || requestedKeys.has(scenarioKey(scenario)),
    )
    .map((scenario) => ({
      siteId: scenario.site_id,
      scenarioId: scenario.scenario_id,
      key: scenarioKey(scenario),
      entryUrl: scenario.entry_url,
      groundTruthUrl: scenario.ground_truth_url,
      fixtureRevision: scenario.fixture_revision,
      featureTags: [...new Set(scenario.feature_tags || [])].sort(),
      complexity: scenarioComplexity(scenario),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  if (enabled.length === 0) throw new Error("The catalog has no enabled scenarios.");
  if (requestedKeys.size > 0 && enabled.length !== requestedKeys.size) {
    const found = new Set(enabled.map((scenario) => scenario.key));
    const missing = [...requestedKeys].filter((key) => !found.has(key));
    throw new Error(`Requested scenarios are absent or disabled: ${missing.join(", ")}.`);
  }
  const configurationComparable = {
    ...configuration,
    protocolBase: new URL(configuration.protocolBase).origin,
    appApiOrigin: new URL(configuration.appApiOrigin).origin,
  };
  const configurationId = `cfg_${sha256(stableJson(configurationComparable)).slice(0, 16)}`;
  const selectedBatches = chooseBatches(
    enabled.map((scenario) => ({
      site_id: scenario.siteId,
      scenario_id: scenario.scenarioId,
      feature_tags: scenario.featureTags,
      complexity: scenario.complexity,
    })),
    configuration,
  );
  const planCore = {
    schemaVersion: 1,
    kind: "formweave_evaluation_plan",
    configurationId,
    configuration,
    catalogRevision: catalog.catalog_revision,
    catalogScenarioCount: catalog.scenario_count,
    enabledScenarioCount: enabled.length,
    scenarios: Object.fromEntries(enabled.map((scenario) => [scenario.key, scenario])),
    batches: selectedBatches,
    oracleIsolation: {
      catalogOnlyBeforeExecution: true,
      groundTruthFetchedAfterRawFreeze: true,
      correlatedSubmissionFetchedAfterRawFreeze: true,
    },
  };
  return {
    ...planCore,
    planId: `plan_${sha256(stableJson(planCore)).slice(0, 16)}`,
    createdAt: new Date().toISOString(),
  };
}

async function fingerprintPath(root, relative, digest, inventory) {
  const absolute = path.join(root, relative);
  const metadata = await stat(absolute).catch(() => null);
  if (!metadata) return;
  if (metadata.isDirectory()) {
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (["node_modules", "data", "dist", "build", ".git", ".vinext"].includes(entry.name)) {
        continue;
      }
      await fingerprintPath(root, path.join(relative, entry.name), digest, inventory);
    }
    return;
  }
  const bytes = await readFile(absolute);
  const normalizedPath = relative.replaceAll("\\", "/");
  digest.update(normalizedPath);
  digest.update(bytes);
  inventory.push({
    path: normalizedPath,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

export async function sourceFingerprint(projectRoot) {
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
    await fingerprintPath(projectRoot, relative, digest, inventory);
  }
  let git = { commit: null, branch: null, dirty: null, dirtyHash: null };
  try {
    const [{ stdout: commit }, { stdout: branch }, { stdout: dirty }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot }),
      execFileAsync("git", ["branch", "--show-current"], { cwd: projectRoot }),
      execFileAsync("git", ["status", "--porcelain"], { cwd: projectRoot }),
    ]);
    git = {
      commit: commit.trim(),
      branch: branch.trim(),
      dirty: Boolean(dirty.trim()),
      dirtyHash: dirty.trim() ? sha256(dirty) : null,
    };
  } catch {
    // File-content hashing is the authoritative fallback.
  }
  return {
    sha256: digest.digest("hex"),
    files: inventory.length,
    git,
  };
}

export async function directoryInventory(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else {
        const bytes = await readFile(absolute);
        files.push({
          path: path.relative(root, absolute).replaceAll("\\", "/"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  }
  await visit(root);
  return files;
}

export function inventoryHash(inventory) {
  return sha256(
    inventory.map((item) => `${item.path}\u0000${item.sha256}`).join("\n"),
  );
}

export function evidenceUrls(value, results = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => evidenceUrls(item, results));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => evidenceUrls(item, results));
  } else if (
    typeof value === "string" &&
    /^\/api\/runs\/[^/]+\/evidence\/[^/]+$/.test(value)
  ) {
    results.add(value);
  }
  return [...results];
}

export function relativeArtifact(root, absolute) {
  return path.relative(root, absolute).replaceAll("\\", "/");
}
