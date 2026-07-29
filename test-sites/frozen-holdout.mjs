import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { crawlTargetsWithPlaywright } from "../local/playwright-crawler.mjs";
import { holdoutFcrbHousingScript } from "../local/recon-scripts/holdout-fcrb-housing.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const fixtureModule = pathToFileURL(
  "C:\\pp2\\FCR_B\\server\\test\\fixtures\\serve.ts"
).href;
const { serveFixture } = await import(fixtureModule);
const frozenFiles = [
  "local/playwright-crawler.mjs",
  "local/form-traversal.mjs",
  "local/traversal-automation.mjs",
  "local/browser-evidence.mjs",
  "local/test-values.mjs",
  "local/traversal-settings.mjs",
  "local/fingerprint.ts",
];

async function frozenHashes() {
  const { readFile } = await import("node:fs/promises");
  return Object.fromEntries(
    await Promise.all(
      frozenFiles.map(async (relativePath) => [
        relativePath,
        createHash("sha256")
          .update(await readFile(path.join(projectRoot, relativePath)))
          .digest("hex"),
      ])
    )
  );
}

const beforeHashes = await frozenHashes();
const fixture = await serveFixture(0);
const targetUrl = new URL("/holdout-fcrb-housing", fixture.url).toString();
const events = [];
let output;

try {
  output = await crawlTargetsWithPlaywright(
    [targetUrl],
    `run_holdout_${Date.now().toString(36)}`,
    {
      browserMode: "headless",
      executionMode: "probe",
      allowLoopback: true,
      discoverLinks: false,
      reconScriptResolver: (url, options) =>
        holdoutFcrbHousingScript.matches(url, options)
          ? holdoutFcrbHousingScript
          : null,
      traversalSettings: {
        stableWindowMs: 200,
        maxStateWaitMs: 3_000,
        maxFormStates: 12,
        maxBranchOptionsPerControl: 3,
        enterTestValues: true,
        exerciseBranches: true,
        advanceFormSteps: true,
      },
      onBrowserEvent: (kind, message, metadata = {}) =>
        events.push({
          timestamp: new Date().toISOString(),
          kind,
          message,
          metadata,
        }),
    }
  );
} finally {
  await new Promise((resolve) => fixture.server.close(resolve));
}

const afterHashes = await frozenHashes();
const changedFrozenFiles = frozenFiles.filter(
  (file) => beforeHashes[file] !== afterHashes[file]
);
const page = output.pages[0];
const observedNames = new Set(
  output.contract.map((field) => field.name || field.id || field.key)
);
const expectedNames = ["first_name", "housing_type", "shelter_name", "income"];
const checks = {
  scriptMatched: page.reconScriptId === holdoutFcrbHousingScript.id,
  expectedFieldsCaptured: expectedNames.every((name) => observedNames.has(name)),
  noUnexpectedSessionField: ![...observedNames].some((name) =>
    /(?:csrf|xsrf|session|token)/i.test(name)
  ),
  cookieTraversed: (page.automationActions || []).some(
    (action) => action.category === "cookie_consent" && action.changed
  ),
  branchExercised: (page.branchStates || 0) >= 1,
  secondStateReached: (page.stateEvidence || []).some((state) =>
    state.values.some((value) => value.fieldKey === "income")
  ),
  entriesVerified: (page.fieldsEntered || 0) >= 3 && page.entryFailures === 0,
  terminalBlocked: page.finalSubmission === "blocked",
  noSubmissionAttempt: page.submissionsAttempted === 0,
  sharedPhysicsUnchanged: changedFrozenFiles.length === 0,
};
const passed = Object.values(checks).every(Boolean);
const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d{3}Z$/, "Z");
const outputRoot = path.join(projectRoot, "data", "holdout", stamp);
await mkdir(outputRoot, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  sourceCorpus: "C:\\pp2\\FCR_B\\server\\test\\fixtures\\form.html",
  previouslyUsedByFormWeave: false,
  targetUrl,
  passed,
  result: passed ? "passed_with_script_only" : "failed",
  script: {
    id: holdoutFcrbHousingScript.id,
    version: holdoutFcrbHousingScript.version,
    path: "local/recon-scripts/holdout-fcrb-housing.mjs",
  },
  frozenFiles,
  beforeHashes,
  afterHashes,
  changedFrozenFiles,
  checks,
  observations: {
    fields: [...observedNames],
    fieldsEntered: page.fieldsEntered || 0,
    entryFailures: page.entryFailures || 0,
    branchStates: page.branchStates || 0,
    statesCaptured: page.stateEvidence?.length || 0,
    finalSubmission: page.finalSubmission,
    certificationStatus: page.certificationStatus,
  },
  sharedCodeChangesRequired: [],
  siteSpecificExceptionsRequired: [],
};
await Promise.all([
  writeFile(
    path.join(outputRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  ),
  writeFile(
    path.join(outputRoot, "events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8"
  ),
]);
process.stdout.write(`${JSON.stringify({ ...summary, outputRoot }, null, 2)}\n`);
if (!passed) process.exitCode = 1;
