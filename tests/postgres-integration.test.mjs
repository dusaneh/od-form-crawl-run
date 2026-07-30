import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createFormWeaveDatabase,
  sha256,
} from "../local/postgres/database.mjs";

const connectionString = process.env.FORMWEAVE_TEST_POSTGRES_URI;

function generatedSource(plan) {
  const encoded = Buffer.from(JSON.stringify(plan), "utf8").toString(
    "base64url",
  );
  return [
    "export const FORMWEAVE_GENERATED_PLAN_VERSION = 3;",
    `export const plan = Object.freeze(JSON.parse(Buffer.from("${encoded}", "base64url").toString("utf8")));`,
    "",
  ].join("\n");
}

test(
  "PostgreSQL round-trips every durable state category",
  { skip: !connectionString },
  async () => {
    const database = await createFormWeaveDatabase(connectionString);
    const suffix = randomUUID().replaceAll("-", "");
    const runId = `run_${suffix}`;
    const artifactId = `form_${suffix.slice(0, 24)}`;
    const formId = `form_${suffix}`;
    const executionId = `exec_${suffix}`;
    const now = new Date().toISOString();
    const plan = {
      artifactId,
      scriptVersion: 1,
      initialUrl: "https://example.test/form",
      states: [],
      provenance: [],
    };
    const sourceText = generatedSource(plan);
    const sourceHash = sha256(sourceText);

    try {
      assert.equal((await database.ping()).connected, true);
      await database.putSettings({ version: 1, updatedAt: now }, `test-${suffix}`);
      await database.putRun({
        id: runId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      await database.putReport(runId, { id: runId, pages: [], generatedAt: now });
      await database.appendEvent("run", runId, {
        timestamp: now,
        kind: "integration_test",
        message: "PostgreSQL event round trip",
        metadata: { safe: true },
      });
      await database.putScriptVersion({
        artifactId,
        version: 1,
        sourceText,
        sourceHash,
        plan,
        manifest: {
          schemaVersion: 1,
          artifactId,
          scriptVersion: 1,
          sourceHash,
        },
      });
      await database.putForm({
        formId,
        sourceRunId: runId,
        status: "observed",
        createdAt: now,
        updatedAt: now,
        script: {
          artifactId,
          scriptVersion: 1,
          sourceHash,
        },
      });
      const approval = {
        approvalId: `approval_${suffix}`,
        decision: "approved",
        actor: "integration-test",
        notes: "",
        decidedAt: now,
        pinnedScript: {
          artifactId,
          scriptVersion: 1,
          sourceHash,
        },
      };
      await database.putForm({
        ...(await database.getForm(formId)),
        status: "approved",
        updatedAt: now,
        approval,
      });
      await database.putExecution({
        executionId,
        formId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      await database.putLineage(
        suffix.slice(0, 24),
        `https://example.test/form?test=${suffix}`,
        { normalizedUrl: `https://example.test/form?test=${suffix}` },
      );
      await database.appendAuditEvent(
        {
          occurredAt: now,
          category: "crawl",
          severity: "success",
          eventType: "crawl.integration_test",
          outcome: "completed",
          actorType: "api_token",
          actorId: `token_${suffix}`,
          scopeType: "run",
          scopeId: runId,
          message: "Integration crawl completed.",
          metadata: { fieldsFound: 3 },
        },
        `integration:${suffix}`,
      );

      const bytes = Buffer.from(`formweave-postgres-image-${suffix}`);
      const saved = await database.putObject({
        ownerType: "run",
        ownerId: runId,
        objectKey: "evidence/page_01.png",
        bytes,
        contentType: "image/png",
      });
      const loaded = await database.getObject(
        "run",
        runId,
        "evidence/page_01.png",
      );
      assert.equal(loaded.sha256, sha256(bytes));
      assert.deepEqual(loaded.bytes, bytes);
      assert.equal((await database.getRun(runId)).status, "completed");
      assert.equal((await database.getReport(runId)).id, runId);
      assert.equal((await database.listEvents("run", runId)).length, 1);
      assert.equal((await database.getForm(formId)).approval.approvalId, approval.approvalId);
      assert.equal((await database.getExecution(executionId)).status, "completed");
      const audit = await database.auditDashboard({ hours: 24 * 90 });
      assert.equal(
        audit.events.some(
          (event) =>
            event.scopeId === runId &&
            event.eventType === "crawl.integration_test",
        ),
        true,
      );

      await assert.rejects(
        database.pool.query(
          `UPDATE formweave_script_versions
           SET source_text = source_text || ' '
           WHERE artifact_id = $1 AND version = 1`,
          [artifactId],
        ),
        /append-only/,
      );
      await assert.rejects(
        database.pool.query(
          "DELETE FROM formweave_audit_events WHERE event_key = $1",
          [`integration:${suffix}`],
        ),
        /append-only/,
      );
      await assert.rejects(
        database.pool.query(
          "DELETE FROM formweave_blobs WHERE sha256 = $1",
          [saved.sha256],
        ),
        /append-only/,
      );
    } finally {
      await database.close();
    }
  },
);
