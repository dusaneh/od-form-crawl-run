import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crawlTargetsWithPlaywright } from "../local/playwright-crawler.mjs";
import { fingerprintArtifact } from "../local/fingerprint.ts";
import {
  createCorpusReconScript,
  discoverCorpusOrigin,
  loadGroundTruthCorpus,
} from "./localhost-corpus.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const origin =
  process.env.LOCALHOST_TEST_SITES_URL || (await discoverCorpusOrigin());
const groundTruth = (await loadGroundTruthCorpus(undefined, origin)).find(
  (entry) => entry.site_id === "site_s_variants"
);
if (!groundTruth) throw new Error("site_s_variants ground truth was not found.");

const variantEndpoint = new URL("/site_s_variants/variant", origin);
const targetUrl = new URL("/site_s_variants/intake", origin).toString();
const script = createCorpusReconScript(groundTruth);
const variants = [];

try {
  for (const n of [1, 1, 2, 3, 4]) {
    variantEndpoint.search = n === 1 ? "?n=1" : `?n=${n}`;
    const selected = await fetch(variantEndpoint).then((response) =>
      response.json()
    );
    const output = await crawlTargetsWithPlaywright(
      [targetUrl],
      `run_drift_v${n}_${Date.now().toString(36)}`,
      {
        browserMode: "headless",
        executionMode: "probe",
        allowLoopback: true,
        discoverLinks: false,
        reconScriptResolver: (url, options) =>
          script.matches(url, options) ? script : null,
        traversalSettings: {
          stableWindowMs: 150,
          maxStateWaitMs: 2_000,
          maxFormStates: 12,
          maxBranchOptionsPerControl: 2,
          exerciseBranches: true,
          enterTestValues: true,
          advanceFormSteps: true,
        },
      }
    );
    const artifactFingerprint = fingerprintArtifact({
      normalizedUrl: targetUrl,
      fields: output.contract,
      stateEvidence: output.pages[0]?.stateEvidence || [],
    });
    const facts = artifactFingerprint.facts.fields;
    variants.push({
      n,
      selected,
      facts,
      fingerprint: artifactFingerprint.digest,
      fingerprintAlgorithmVersion: artifactFingerprint.algorithmVersion,
      finalSubmission: output.pages[0]?.finalSubmission,
      fieldsEntered: output.pages[0]?.fieldsEntered || 0,
    });
  }
} finally {
  variantEndpoint.search = "?reset=true";
  await fetch(variantEndpoint).catch(() => {});
}

const [baseline, identical, optionalAdd, requiredAdd, cosmetic] = variants;
const baselineNames = new Set(baseline.facts.map((field) => field.nameOrId));
const requiredAdditions = requiredAdd.facts.filter(
  (field) => field.required && !baselineNames.has(field.nameOrId)
);
const checks = {
  identicalRecrawlStable: identical.fingerprint === baseline.fingerprint,
  optionalAdditionDetected: optionalAdd.fingerprint !== baseline.fingerprint,
  optionalAdditionNoncritical:
    optionalAdd.facts
      .filter((field) => !baselineNames.has(field.nameOrId))
      .every((field) => !field.required),
  requiredAdditionDetected: requiredAdd.fingerprint !== baseline.fingerprint,
  requiredAdditionCritical: requiredAdditions.length > 0,
  cosmeticReorderStable: cosmetic.fingerprint === baseline.fingerprint,
  probeTerminalSubmissionBlocked: variants.every(
    (variant) => variant.finalSubmission === "blocked"
  ),
};
const passed = Object.values(checks).every(Boolean);
const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d{3}Z$/, "Z");
const outputRoot = path.join(projectRoot, "data", "localhost-corpus", stamp);
await mkdir(outputRoot, { recursive: true });
const reportPath = path.join(outputRoot, "drift-summary.json");
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      origin,
      targetUrl,
      passed,
      checks,
      variants,
    },
    null,
    2
  )}\n`,
  "utf8"
);

process.stdout.write(
  `Drift matrix: ${passed ? "PASS" : "FAIL"}\nSummary: ${reportPath}\n`
);
if (!passed) process.exitCode = 1;
