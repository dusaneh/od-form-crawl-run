import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FINGERPRINT_ALGORITHM_VERSION,
  fingerprintArtifact,
} from "../local/fingerprint.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const manifestPath = path.join(
  projectRoot,
  "test-sites",
  "fingerprint-golden.json"
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = [];
let checked = 0;

for (const retained of manifest.reports) {
  const reportPath = path.resolve(projectRoot, retained.path);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const actual = report.pages.map((page) => fingerprintArtifact(page).digest);
  checked += actual.length;
  if (JSON.stringify(actual) !== JSON.stringify(retained.pageDigests)) {
    failures.push({
      path: retained.path,
      expected: retained.pageDigests,
      actual,
    });
  }
}

const result = {
  passed:
    failures.length === 0 &&
    manifest.algorithmVersion === FINGERPRINT_ALGORITHM_VERSION,
  algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
  retainedAlgorithmVersion: manifest.algorithmVersion,
  reports: manifest.reports.length,
  pages: checked,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
