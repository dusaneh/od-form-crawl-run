import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../env.mjs";
import {
  createFormWeaveDatabase,
  planFromSource,
  sha256,
  stableJson,
} from "./database.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

const database = await createFormWeaveDatabase();
const verified = {
  reports: 0,
  scripts: 0,
  blobs: 0,
  blobBytes: 0,
};

try {
  const reports = await database.pool.query(
    "SELECT run_id, payload, sha256 FROM formweave_reports ORDER BY run_id",
  );
  for (const report of reports.rows) {
    if (sha256(stableJson(report.payload)) !== report.sha256) {
      throw new Error(`Report hash mismatch for ${report.run_id}.`);
    }
    verified.reports += 1;
  }

  const scripts = await database.pool.query(
    `SELECT artifact_id, version, source_sha256, plan_sha256, plan, source_text
     FROM formweave_script_versions
     ORDER BY artifact_id, version`,
  );
  for (const script of scripts.rows) {
    if (sha256(script.source_text) !== script.source_sha256) {
      throw new Error(
        `Script source hash mismatch for ${script.artifact_id}@${script.version}.`,
      );
    }
    if (sha256(stableJson(script.plan)) !== script.plan_sha256) {
      throw new Error(
        `Script plan hash mismatch for ${script.artifact_id}@${script.version}.`,
      );
    }
    if (
      stableJson(planFromSource(script.source_text)) !==
      stableJson(script.plan)
    ) {
      throw new Error(
        `Script plan/source mismatch for ${script.artifact_id}@${script.version}.`,
      );
    }
    verified.scripts += 1;
  }

  let lastHash = "";
  for (;;) {
    const blobs = await database.pool.query(
      `SELECT sha256, byte_length, bytes
       FROM formweave_blobs
       WHERE sha256 > $1
       ORDER BY sha256
       LIMIT 100`,
      [lastHash],
    );
    if (!blobs.rowCount) break;
    for (const blob of blobs.rows) {
      const byteLength = Number(blob.byte_length);
      if (
        blob.bytes.byteLength !== byteLength ||
        sha256(blob.bytes) !== blob.sha256
      ) {
        throw new Error(`Blob hash or length mismatch for ${blob.sha256}.`);
      }
      verified.blobs += 1;
      verified.blobBytes += byteLength;
      lastHash = blob.sha256;
    }
  }

  const integrity = await database.pool.query(`
    SELECT
      (SELECT count(*)::bigint
       FROM formweave_objects object
       LEFT JOIN formweave_blobs blob ON blob.sha256 = object.blob_sha256
       WHERE blob.sha256 IS NULL) AS orphan_objects,
      (SELECT count(*)::bigint
       FROM formweave_forms form_record
       LEFT JOIN formweave_script_versions script
         ON script.artifact_id = form_record.artifact_id
        AND script.version = form_record.script_version
        AND script.source_sha256 = form_record.source_sha256
       WHERE form_record.artifact_id IS NOT NULL
         AND script.artifact_id IS NULL) AS orphan_form_scripts,
      (SELECT count(*)::bigint
       FROM formweave_form_approvals approval
       LEFT JOIN formweave_script_versions script
         ON script.artifact_id = approval.artifact_id
        AND script.version = approval.script_version
        AND script.source_sha256 = approval.source_sha256
       WHERE script.artifact_id IS NULL) AS orphan_approval_scripts
  `);
  const failures = Object.entries(integrity.rows[0]).filter(
    ([, count]) => Number(count) !== 0,
  );
  if (failures.length) {
    throw new Error(
      `Relational integrity failure: ${failures
        .map(([name, count]) => `${name}=${count}`)
        .join(", ")}.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        connection: await database.ping(),
        verified,
        integrity: {
          orphanObjects: 0,
          orphanFormScripts: 0,
          orphanApprovalScripts: 0,
        },
        database: await database.counts(),
      },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
