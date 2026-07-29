import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const projectRoot = path.resolve(".");
const gate3Run = path.resolve(argument("--gate3-run"));
const answerKeyRoot =
  process.env.LOCALHOST_TEST_SITES_ROOT || "C:\\pp2\\scraper\\test_sites";
const answerKeyProbe = path.join(
  answerKeyRoot,
  "site_a_shelter",
  "ground_truth.yaml",
);
if (!existsSync(answerKeyProbe)) throw new Error("Answer-key probe unavailable.");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(projectRoot, "data", "gate4-localhost", stamp);
await mkdir(output, { recursive: true });
const worker = path.join(
  projectRoot,
  "local",
  "dynamics",
  "localhost-gate4-worker.mjs",
);
const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.join(process.env.LOCALAPPDATA || "C:\\Users\\Public", "ms-playwright");
const temporaryDirectory = process.env.TEMP || process.env.TMP;
const reads = [
  path.join(projectRoot, "local"),
  path.join(projectRoot, "node_modules"),
  path.join(projectRoot, "package.json"),
  gate3Run,
  output,
  browserCache,
  temporaryDirectory,
].filter(Boolean);
const writes = [output, browserCache, temporaryDirectory].filter(Boolean);
const child = spawn(
  process.execPath,
  [
    "--permission",
    "--allow-child-process",
    ...reads.map((value) => `--allow-fs-read=${value}`),
    ...writes.map((value) => `--allow-fs-write=${value}`),
    worker,
    "--gate3-run",
    gate3Run,
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
const code = await new Promise((resolve) => child.once("exit", resolve));
if (code !== 0) {
  throw new Error(`Gate 4 worker failed (${code}).\n${stdout.slice(-12000)}`);
}
const summary = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
console.log(
  JSON.stringify(
    {
      output,
      answerKeyIsolation: summary.answerKeyIsolation,
      results: summary.results.map((result) => ({
        selectedUrl: result.selectedUrl,
        probesCompleted: result.probesCompleted,
        probesFailed: result.probesFailed,
        addedVisibleControls: result.addedVisibleControls,
        repairItems: result.repairItems,
      })),
      scored: false,
    },
    null,
    2,
  ),
);
