import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { loadRestrictedD1 } from "../compiler/restricted-d1-loader.mjs";
import { aggregateChangeMap } from "./change-map.mjs";
import { buildRepairQueue } from "./repair-queue.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function assertAnswerKeyUnreadable() {
  try {
    await readFile(process.env.FORMWEAVE_ANSWER_KEY_PROBE, "utf8");
  } catch (error) {
    if (error?.code === "ERR_ACCESS_DENIED") {
      return { passed: true, code: error.code };
    }
    throw error;
  }
  throw new Error("Gate 4 worker could read the answer key.");
}

const gate3Root = path.resolve(argument("--gate3-run"));
const output = path.resolve(argument("--output"));
const isolation = await assertAnswerKeyUnreadable();
const gate3 = JSON.parse(
  await readFile(path.join(gate3Root, "gate3-summary.json"), "utf8"),
);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const target of gate3.results) {
    const loaded = await loadRestrictedD1({
      dataRoot: gate3Root,
      artifactId: target.artifactId,
      artifactVersion: target.artifactVersion,
      scriptVersion: target.scriptVersion,
    });
    const generationInput = JSON.parse(
      await readFile(
        path.join(loaded.root, "generation-input.json"),
        "utf8",
      ),
    );
    const observations = [];
    const failures = [];
    for (const field of loaded.contract.fields) {
      if (
        !["select", "radio", "checkbox"].includes(field.controlType) ||
        loaded.descriptor.protectedFieldKeys.includes(field.key)
      ) {
        continue;
      }
      const values =
        field.controlType === "checkbox"
          ? [true, false]
          : field.options.map((option) => option.value).filter(Boolean);
      for (const value of values) {
        const page = await browser.newPage({
          locale: loaded.contract.locale,
          viewport: { width: 1440, height: 1100 },
        });
        try {
          await page.goto(target.selectedUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          const runtime = loaded.createRuntime({
            page,
            contract: loaded.contract,
          });
          observations.push(
            await runtime.probeChoice({
              stateKey: loaded.contract.entryStateKey,
              fieldKey: field.key,
              value,
            }),
          );
        } catch (error) {
          failures.push({
            fieldKey: field.key,
            value,
            code: error?.formweaveCode || "could_not_test",
            detail: error instanceof Error ? error.message : String(error),
          });
        } finally {
          await page.close();
        }
      }
    }
    const changeMap = aggregateChangeMap(observations);
    const repairQueue = buildRepairQueue({
      proposal: generationInput.proposal,
      safety: generationInput.safety,
      changeMap,
    });
    const targetRoot = path.join(output, target.artifactId);
    await mkdir(targetRoot, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(targetRoot, "d6-observations.json"),
        `${JSON.stringify(observations, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(targetRoot, "change-map.json"),
        `${JSON.stringify(changeMap, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(targetRoot, "repair-queue.json"),
        `${JSON.stringify(repairQueue, null, 2)}\n`,
        "utf8",
      ),
    ]);
    results.push({
      artifactId: target.artifactId,
      selectedUrl: target.selectedUrl,
      probesCompleted: observations.length,
      probesFailed: failures.length,
      failures,
      addedVisibleControls: changeMap.probes.flatMap((probe) =>
        probe.added
          .filter((fact) => fact.visible)
          .map((fact) => ({
            trigger: {
              fieldKey: probe.fieldKey,
              value: probe.value,
            },
            name: fact.name,
            id: fact.id,
            rawType: fact.rawType,
            required: fact.required,
          })),
      ),
      repairItems: repairQueue.items,
    });
  }
} finally {
  await browser.close();
}
const summary = {
  schemaVersion: 1,
  kind: "gate4_localhost_discovery_unscored",
  generatedAt: new Date().toISOString(),
  sourceGate3Run: gate3Root,
  answerKeyIsolation: isolation,
  results,
  scored: false,
};
await writeFile(
  path.join(output, "gate4-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(summary));
