import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../env.mjs";
import { assertActuatorBundle } from "../actuator/actuator-source.mjs";
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
  semanticCandidates: 0,
  actuatorBundles: 0,
  actuatorModules: 0,
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

  const semanticCandidates = await database.pool.query(
    `SELECT candidate_id, candidate_sha256, proposal
     FROM formweave_semantic_candidates
     ORDER BY candidate_id`,
  );
  for (const candidate of semanticCandidates.rows) {
    if (sha256(stableJson(candidate.proposal)) !== candidate.candidate_sha256) {
      throw new Error(
        `Semantic candidate hash mismatch for ${candidate.candidate_id}.`,
      );
    }
    verified.semanticCandidates += 1;
  }

  const actuatorBundles = await database.pool.query(
    `SELECT bundle.bundle_id, bundle.bundle_sha256, bundle.manifest,
            semantic.proposal
     FROM formweave_actuator_bundles bundle
     JOIN formweave_semantic_candidates semantic
       ON semantic.candidate_id = bundle.semantic_candidate_id
     ORDER BY bundle.bundle_id`,
  );
  for (const storedBundle of actuatorBundles.rows) {
    const modules = await database.pool.query(
      `SELECT module_path, source_sha256, source_text
       FROM formweave_actuator_modules
       WHERE bundle_id = $1
       ORDER BY module_path`,
      [storedBundle.bundle_id],
    );
    const sources = new Map(
      modules.rows.map((actuatorModule) => [
        actuatorModule.module_path,
        actuatorModule,
      ]),
    );
    const bundle = {
      ...storedBundle.manifest,
      modules: storedBundle.manifest.modules.map((actuatorModule) => ({
        ...actuatorModule,
        source: sources.get(actuatorModule.modulePath)?.source_text || "",
      })),
    };
    const checked = assertActuatorBundle({
      bundle,
      semanticProposal: storedBundle.proposal,
    });
    if (checked.bundleHash !== storedBundle.bundle_sha256) {
      throw new Error(
        `Actuator bundle hash mismatch for ${storedBundle.bundle_id}.`,
      );
    }
    verified.actuatorBundles += 1;
    verified.actuatorModules += modules.rowCount;
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
       WHERE script.artifact_id IS NULL) AS orphan_approval_scripts,
      (SELECT count(*)::bigint
       FROM formweave_actuator_bundles bundle
       LEFT JOIN formweave_semantic_candidates semantic
         ON semantic.candidate_id = bundle.semantic_candidate_id
       WHERE semantic.candidate_id IS NULL) AS orphan_actuator_semantics,
      (SELECT count(*)::bigint
       FROM formweave_actuator_modules actuator_module
       LEFT JOIN formweave_actuator_bundles bundle
         ON bundle.bundle_id = actuator_module.bundle_id
       WHERE bundle.bundle_id IS NULL) AS orphan_actuator_modules,
      (SELECT count(*)::bigint
       FROM formweave_artifact_releases release
       LEFT JOIN formweave_semantic_candidates semantic
         ON semantic.candidate_id = release.semantic_candidate_id
       LEFT JOIN formweave_actuator_bundles bundle
         ON bundle.bundle_id = release.actuator_bundle_id
       WHERE semantic.candidate_id IS NULL OR bundle.bundle_id IS NULL)
       AS orphan_actuator_releases
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
          orphanActuatorSemantics: 0,
          orphanActuatorModules: 0,
          orphanActuatorReleases: 0,
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
