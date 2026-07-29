import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function latestGate2Run(projectRoot) {
  const root = path.join(projectRoot, "data", "gate2-localhost");
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((entry) => existsSync(path.join(entry, "generation-summary.json")))
    .sort();
  const selected = candidates.at(-1);
  if (!selected) throw new Error("No completed Gate 2 generation run exists.");
  return selected;
}

const projectRoot = path.resolve(".");
loadEnv(path.join(projectRoot, ".env"));
const gate2Run = path.resolve(
  argument("--gate2-run", await latestGate2Run(projectRoot)),
);
const answerKeyRoot =
  process.env.LOCALHOST_TEST_SITES_ROOT || "C:\\pp2\\scraper\\test_sites";
const answerKeyProbe = path.join(
  answerKeyRoot,
  "site_a_shelter",
  "ground_truth.yaml",
);
if (!existsSync(answerKeyProbe)) {
  throw new Error("The answer-key probe file is unavailable.");
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(projectRoot, "data", "gate3-localhost", stamp);
await mkdir(output, { recursive: true });
const worker = path.join(
  projectRoot,
  "local",
  "compiler",
  "localhost-d1-worker.mjs",
);
const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.join(process.env.LOCALAPPDATA || "C:\\Users\\Public", "ms-playwright");
const temporaryDirectory = process.env.TEMP || process.env.TMP;
const allowRead = [
  path.join(projectRoot, "local"),
  path.join(projectRoot, "node_modules"),
  path.join(projectRoot, "package.json"),
  browserCache,
  temporaryDirectory,
  gate2Run,
  output,
].filter(Boolean);
const allowWrite = [output, temporaryDirectory, browserCache].filter(Boolean);
const child = spawn(
  process.execPath,
  [
    "--permission",
    "--allow-child-process",
    ...allowRead.map((entry) => `--allow-fs-read=${entry}`),
    ...allowWrite.map((entry) => `--allow-fs-write=${entry}`),
    worker,
    "--gate2-run",
    gate2Run,
    "--output",
    output,
  ],
  {
    cwd: projectRoot,
    env: {
      FORMWEAVE_ANSWER_KEY_PROBE: answerKeyProbe,
      LOCALAPPDATA: process.env.LOCALAPPDATA || "",
      PATH: process.env.PATH || "",
      SYSTEMROOT: process.env.SYSTEMROOT || "",
      TEMP: process.env.TEMP || "",
      TMP: process.env.TMP || "",
    },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  },
);
let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
if (exitCode !== 0) {
  throw new Error(
    `Isolated Gate 3 worker failed with exit code ${exitCode}.\n${stdout.slice(-12_000)}`,
  );
}
const summary = JSON.parse(
  stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1),
);
console.log(
  JSON.stringify(
    {
      output,
      sourceGate2Run: gate2Run,
      answerKeyIsolation: summary.answerKeyIsolation,
      targetsCompleted: summary.targetsCompleted,
      targetsFailed: summary.targetsFailed,
      results: summary.results.map((result) => ({
        selectedUrl: result.selectedUrl,
        artifactId: result.artifactId,
        defaultInputKeys: result.defaultInputKeys,
        protectedFieldKeys: result.protectedFieldKeys,
        stateOutcome: result.envelope?.stateOutcome,
        progression: result.envelope?.progression,
        error: result.error,
      })),
      scored: false,
    },
    null,
    2,
  ),
);
