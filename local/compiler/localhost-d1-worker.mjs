import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { compileAndStoreD1 } from "./d1-compiler.mjs";
import { loadRestrictedD1 } from "./restricted-d1-loader.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function assertAnswerKeyUnreadable() {
  const probe = process.env.FORMWEAVE_ANSWER_KEY_PROBE;
  if (!probe) throw new Error("The answer-key isolation probe was not configured.");
  try {
    await readFile(probe, "utf8");
  } catch (error) {
    if (error?.code === "ERR_ACCESS_DENIED") {
      return { passed: true, code: error.code };
    }
    throw new Error(
      `Answer-key probe did not prove permission isolation (${error?.code || "unknown"}).`,
    );
  }
  throw new Error("Answer-key isolation failed: the D1 worker read the probe.");
}

const gate2Root = path.resolve(argument("--gate2-run"));
const output = path.resolve(argument("--output"));
const isolation = await assertAnswerKeyUnreadable();
const generationSummary = JSON.parse(
  await readFile(path.join(gate2Root, "generation-summary.json"), "utf8"),
);
if (!generationSummary.answerKeyIsolation?.passed) {
  throw new Error("The source semantic-generation run did not prove isolation.");
}
const selectedByRun = new Map(
  generationSummary.results.map((result) => [result.runId, result.selectedUrl]),
);
const semanticRoot = path.join(gate2Root, "semantic-generation");
const records = (await readdir(semanticRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const record of records) {
    const recordRoot = path.join(semanticRoot, record.name);
    const [observation, proposal, provenance] = await Promise.all([
      readFile(path.join(recordRoot, "generation-input.json"), "utf8").then(
        JSON.parse,
      ),
      readFile(path.join(recordRoot, "proposal.json"), "utf8").then(JSON.parse),
      readFile(path.join(recordRoot, "provenance.json"), "utf8").then(JSON.parse),
    ]);
    try {
      const compiled = await compileAndStoreD1({
        dataRoot: output,
        proposal,
        observation,
        provenance,
      });
      const loaded = await loadRestrictedD1({
        dataRoot: output,
        artifactId: compiled.artifactId,
        artifactVersion: 1,
        scriptVersion: 1,
      });
      const page = await browser.newPage({
        locale: observation.locale || "en-US",
        viewport: { width: 1440, height: 1100 },
      });
      const evidenceRoot = path.join(
        output,
        "execution-evidence",
        compiled.artifactId,
      );
      await mkdir(evidenceRoot, { recursive: true });
      let evidenceIndex = 0;
      try {
        await page.goto(selectedByRun.get(record.name) || observation.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        const runtime = loaded.createRuntime({
          page,
          contract: loaded.contract,
          evidenceSink: async ({ kind, metadata }) => {
            evidenceIndex += 1;
            const file = `${String(evidenceIndex).padStart(3, "0")}-${kind}.png`;
            await page.screenshot({
              path: path.join(evidenceRoot, file),
              fullPage: true,
              type: "png",
            });
            await writeFile(
              path.join(evidenceRoot, `${file}.json`),
              `${JSON.stringify(metadata, null, 2)}\n`,
              "utf8",
            );
            return `execution-evidence/${compiled.artifactId}/${file}`;
          },
        });
        const inputs = runtime.defaultInputs(loaded.contract.entryStateKey);
        const envelope = await runtime.execute({
          scriptVersion: 1,
          contractVersion: 1,
          stateKey: loaded.contract.entryStateKey,
          inputs,
          directive: { progressionPermission: "allowed" },
          mode: "validation_replay",
        });
        results.push({
          sourceRecord: record.name,
          selectedUrl: selectedByRun.get(record.name) || observation.url,
          artifactId: compiled.artifactId,
          artifactVersion: 1,
          contractVersion: 1,
          scriptVersion: 1,
          sourceHash: compiled.sourceHash,
          contractHash: compiled.manifest.contractHash,
          fingerprint: {
            algorithmVersion: compiled.fingerprint.algorithmVersion,
            digest: compiled.fingerprint.digest,
          },
          protectedFieldKeys: compiled.descriptor.protectedFieldKeys,
          defaultInputKeys: Object.keys(inputs).sort(),
          envelope,
          evidenceCount: evidenceIndex,
        });
      } finally {
        await page.close();
      }
    } catch (error) {
      results.push({
        sourceRecord: record.name,
        selectedUrl: selectedByRun.get(record.name) || observation.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
} finally {
  await browser.close();
}

const summary = {
  schemaVersion: 1,
  kind: "gate3_localhost_generated_d1_unscored",
  generatedAt: new Date().toISOString(),
  sourceGate2Run: gate2Root,
  answerKeyIsolation: isolation,
  targetsCompleted: results.filter((result) => !result.error).length,
  targetsFailed: results.filter((result) => result.error).length,
  results,
  scored: false,
};
await writeFile(
  path.join(output, "gate3-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary));
if (summary.targetsFailed > 0) process.exitCode = 1;
