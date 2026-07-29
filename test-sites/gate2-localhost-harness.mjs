import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(".");
const envPath = path.join(projectRoot, ".env");
const answerKeyRoot =
  process.env.LOCALHOST_TEST_SITES_ROOT || "C:\\pp2\\scraper\\test_sites";
const answerKeyProbe = path.join(
  answerKeyRoot,
  "site_a_shelter",
  "ground_truth.yaml",
);

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

loadEnv(envPath);
if (!process.env.OPENAI_KEY && !process.env.OPENAI_API_KEY) {
  throw new Error("Gate 2 localhost generation requires OPENAI_KEY in .env.");
}
if (!existsSync(answerKeyProbe)) {
  throw new Error(
    "The answer-key probe file was not found; isolation cannot be proven.",
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(projectRoot, "data", "gate2-localhost", stamp);
await mkdir(output, { recursive: true });
const worker = path.join(
  projectRoot,
  "local",
  "semantic",
  "localhost-generation-worker.mjs",
);
const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.join(
    process.env.LOCALAPPDATA || "C:\\Users\\Public",
    "ms-playwright",
  );
const allowRead = [
  path.join(projectRoot, "local"),
  path.join(projectRoot, "node_modules"),
  path.join(projectRoot, "package.json"),
  worker,
  browserCache,
  process.env.TEMP || process.env.TMP,
  output,
].filter(Boolean);
const temporaryDirectory = process.env.TEMP || process.env.TMP;
const allowWrite = [output, temporaryDirectory, browserCache].filter(Boolean);
const child = spawn(
  process.execPath,
  [
    "--permission",
    "--allow-child-process",
    ...allowRead.map((entry) => `--allow-fs-read=${entry}`),
    ...allowWrite.map((entry) => `--allow-fs-write=${entry}`),
    worker,
    "--origin",
    process.env.LOCALHOST_TEST_SITES_URL || "http://127.0.0.1:9001/",
    "--count",
    process.env.FORMWEAVE_GATE2_TARGET_COUNT || "3",
    "--output",
    output,
  ],
  {
    cwd: projectRoot,
    env: {
      OPENAI_KEY: process.env.OPENAI_KEY || "",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
      OPENAI_SEMANTIC_MODEL: process.env.OPENAI_SEMANTIC_MODEL || "",
      OPENAI_MODEL: process.env.OPENAI_MODEL || "",
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
    `Isolated Gate 2 worker failed with exit code ${exitCode}.\n${stdout.slice(-8_000)}`,
  );
}
const summaryLine = stdout
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .at(-1);
const summary = JSON.parse(summaryLine);
console.log(
  JSON.stringify(
    {
      output,
      answerKeyIsolation: summary.answerKeyIsolation,
      targetsCompleted: summary.targetsCompleted,
      targetsFailed: summary.targetsFailed,
      results: summary.results.map((result) => ({
        target: result.target,
        fields: result.fields,
        actionsAccepted: result.actionsAccepted,
        actionsRejected: result.actionsRejected,
        rejectionCodes: result.rejectionCodes,
        error: result.error,
      })),
      scored: false,
    },
    null,
    2,
  ),
);
