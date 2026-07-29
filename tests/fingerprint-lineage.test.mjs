import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  quarantineLineageVersion,
  updateArtifactLineage,
} from "../local/artifact-lineage.mjs";
import {
  FINGERPRINT_ALGORITHM_VERSION,
  fingerprintArtifact,
} from "../local/fingerprint.ts";

function report(id, algorithmVersion = FINGERPRINT_ALGORITHM_VERSION) {
  const page = {
    normalizedUrl: "https://example.test/form?session=volatile",
    finalUrl: "https://example.test/form?session=volatile",
    fields: [
      {
        name: "email",
        control: "email",
        required: true,
        optionValues: [],
      },
    ],
    stateEvidence: [],
  };
  return {
    id,
    generatedAt: new Date().toISOString(),
    targets: ["https://example.test/form?session=volatile"],
    pages: [
      {
        ...page,
        fingerprint: fingerprintArtifact(page).digest,
        fingerprintAlgorithmVersion: algorithmVersion,
        certificationStatus: "probe_completed",
      },
    ],
    traversalSettings: { version: 3 },
  };
}

test("an algorithm change requests rebaseline instead of creating site drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-lineage-"));
  const created = await updateArtifactLineage(report("run_one"), root);
  assert.equal(created.outcome, "created");

  const changedAlgorithm = report("run_two", "formweave-structural-v99");
  const outcome = await updateArtifactLineage(changedAlgorithm, root);
  assert.equal(outcome.outcome, "algorithm_rebaseline_required");
  assert.equal(outcome.version, 1);
  assert.equal(outcome.requiresReview, true);

  const lineage = JSON.parse(await readFile(outcome.filePath, "utf8"));
  assert.equal(lineage.currentVersion, 1);
  assert.equal(lineage.versions.length, 1);
  assert.equal(lineage.pendingAlgorithmRebaselines.length, 1);
});

test("quarantined lineage versions are explicitly ineligible for certification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-quarantine-"));
  await updateArtifactLineage(report("run_one"), root);
  const result = await quarantineLineageVersion(
    "https://example.test/form",
    1,
    root,
    "Generated control identity produced a false version."
  );
  const lineage = JSON.parse(await readFile(result.filePath, "utf8"));
  assert.equal(lineage.versions[0].certificationState, "revoked");
  assert.equal(lineage.versions[0].certificationEligible, false);
  assert.equal(lineage.quarantinedVersions[0].version, 1);
});
