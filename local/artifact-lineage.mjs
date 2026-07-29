import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FINGERPRINT_ALGORITHM_VERSION,
  fingerprintArtifact,
  normalizeArtifactUrl,
} from "./fingerprint.ts";

export { normalizeArtifactUrl };

function lineageKey(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

async function readExisting(filePath, database = null, key = "") {
  if (database) return database.getLineage(key);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeLineage({
  database,
  key,
  normalizedUrl,
  filePath,
  payload,
}) {
  if (database) {
    await database.putLineage(key, normalizedUrl, payload);
  } else {
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

export async function updateArtifactLineage(
  report,
  dataRoot,
  { database = null } = {},
) {
  const normalizedUrl = normalizeArtifactUrl(report.targets[0]);
  const root = path.join(dataRoot, "lineages");
  const key = lineageKey(normalizedUrl);
  const filePath = database
    ? `postgres://lineage/${key}`
    : path.join(root, `${key}.json`);
  if (!database) await mkdir(root, { recursive: true });
  const existing = await readExisting(filePath, database, key);
  const generatedStateCount = Math.max(
    1,
    ...report.pages.map((page) =>
      Number(page.generatedArtifact?.states || 0)
    ),
  );
  const scopedReconArtifact = fingerprintArtifact({
    normalizedUrl,
    fields: report.contract,
    stateEvidence: Array.from(
      { length: generatedStateCount },
      (_, index) => ({ observedState: index + 1 }),
    ),
  });
  const baseFingerprints = [scopedReconArtifact.digest];
  // Runtime state identities prove traversal; they are not recon fingerprints
  // and therefore never participate in artifact versioning.
  const variantFingerprints = [];
  const observedAt = report.generatedAt;
  const scriptVersions = report.pages
    .filter((page) => page.reconScriptId)
    .map((page) => ({
      id: page.reconScriptId,
      version: page.reconScriptVersion || 0,
    }));
  const artifactRecord = {
    runId: report.id,
    observedAt,
    baseFingerprints,
    fingerprintAlgorithmVersions: sortedUnique(
      report.pages.map(
        (page) =>
          page.fingerprintAlgorithmVersion || FINGERPRINT_ALGORITHM_VERSION
      )
    ),
    variantFingerprints,
    scriptVersions,
    policyVersion: report.traversalSettings?.version || 0,
    evidence: report.pages.flatMap((page) => [
      page.screenshotArtifact,
      ...(page.stateEvidence || []).map((state) => state.screenshotArtifact),
    ]).filter(Boolean),
    certificationState: report.pages.every(
      (page) => page.certificationStatus === "probe_completed"
    )
      ? "probe_completed"
      : "uncertified",
  };

  if (!existing) {
    const lineage = {
      normalizedUrl,
      currentVersion: 1,
      createdAt: observedAt,
      lastObservedAt: observedAt,
      versions: [{ version: 1, predecessor: null, ...artifactRecord }],
      expansions: [],
    };
    await writeLineage({
      database,
      key,
      normalizedUrl,
      filePath,
      payload: lineage,
    });
    return {
      outcome: "created",
      version: 1,
      normalizedUrl,
      filePath,
      requiresReview: false,
    };
  }

  const current = existing.versions.find(
    (version) => version.version === existing.currentVersion
  );
  const currentAlgorithms = sortedUnique(
    current?.fingerprintAlgorithmVersions || ["legacy-unversioned"]
  );
  if (
    !sameValues(
      currentAlgorithms,
      artifactRecord.fingerprintAlgorithmVersions
    )
  ) {
    const request = {
      runId: report.id,
      observedAt,
      fromAlgorithmVersions: currentAlgorithms,
      toAlgorithmVersions: artifactRecord.fingerprintAlgorithmVersions,
      proposedBaseFingerprints: baseFingerprints,
    };
    existing.lastObservedAt = observedAt;
    existing.pendingAlgorithmRebaselines = [
      ...(existing.pendingAlgorithmRebaselines || []).filter(
        (entry) => entry.runId !== report.id
      ),
      request,
    ];
    await writeLineage({
      database,
      key,
      normalizedUrl,
      filePath,
      payload: existing,
    });
    return {
      outcome: "algorithm_rebaseline_required",
      version: existing.currentVersion,
      normalizedUrl,
      filePath,
      requiresReview: true,
      rebaselineRequired: true,
      ...request,
    };
  }
  if (sameValues(current?.baseFingerprints || [], baseFingerprints)) {
    const hasNewVariant = variantFingerprints.some(
      (fingerprint) => !(current?.variantFingerprints || []).includes(fingerprint)
    );
    existing.lastObservedAt = observedAt;
    if (hasNewVariant) {
      existing.expansions.push({
        version: existing.currentVersion,
        ...artifactRecord,
      });
      current.variantFingerprints = sortedUnique([
        ...(current.variantFingerprints || []),
        ...variantFingerprints,
      ]);
      await writeLineage({
        database,
        key,
        normalizedUrl,
        filePath,
        payload: existing,
      });
      return {
        outcome: "expanded",
        version: existing.currentVersion,
        normalizedUrl,
        filePath,
        requiresReview: false,
      };
    }
    current.lastObservedRunId = report.id;
    current.lastObservedAt = observedAt;
    await writeLineage({
      database,
      key,
      normalizedUrl,
      filePath,
      payload: existing,
    });
    return {
      outcome: "unchanged",
      version: existing.currentVersion,
      normalizedUrl,
      filePath,
      requiresReview: false,
    };
  }

  const nextVersion = existing.currentVersion + 1;
  existing.currentVersion = nextVersion;
  existing.lastObservedAt = observedAt;
  existing.versions.push({
    version: nextVersion,
    predecessor: existing.currentVersion - 1,
    ...artifactRecord,
  });
  await writeLineage({
    database,
    key,
    normalizedUrl,
    filePath,
    payload: existing,
  });
  return {
    outcome: "structural_change",
    version: nextVersion,
    normalizedUrl,
    filePath,
    requiresReview: true,
  };
}

export async function quarantineLineageVersion(
  normalizedTargetUrl,
  version,
  dataRoot,
  reason
) {
  const normalizedUrl = normalizeArtifactUrl(normalizedTargetUrl);
  const filePath = path.join(
    dataRoot,
    "lineages",
    `${lineageKey(normalizedUrl)}.json`
  );
  const lineage = await readExisting(filePath);
  if (!lineage) throw new Error(`No lineage exists for ${normalizedUrl}.`);
  const record = lineage.versions.find((item) => item.version === version);
  if (!record) {
    throw new Error(`Lineage version ${version} does not exist for ${normalizedUrl}.`);
  }
  const quarantinedAt = new Date().toISOString();
  record.certificationState = "revoked";
  record.certificationEligible = false;
  record.quarantinedAt = quarantinedAt;
  record.quarantineReason = reason;
  lineage.quarantinedVersions = [
    ...(lineage.quarantinedVersions || []).filter(
      (item) => item.version !== version
    ),
    { version, quarantinedAt, reason },
  ];
  await writeFile(filePath, `${JSON.stringify(lineage, null, 2)}\n`, "utf8");
  return { normalizedUrl, version, filePath, quarantinedAt, reason };
}
