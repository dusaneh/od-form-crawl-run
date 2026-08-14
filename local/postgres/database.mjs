import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { summarizeLlmTelemetry } from "../audit/llm-telemetry.mjs";
import { assertActuatorBundle } from "../actuator/actuator-source.mjs";
import {
  validateActuatorRepairDocument,
  validateArtifactRelease,
  validateSemanticRepairDocument,
} from "../contracts/semantic-actuator-schemas.mjs";
import { validateSemanticProposal } from "../semantic/proposal-schema.mjs";

const { Pool } = pg;
const localDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(localDirectory, "..", "..");
const migrationsRoot = path.join(projectRoot, "db", "migrations");
const SAFE_SCRIPT_ID = /^form_[a-z0-9]+$/i;
const SAFE_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function jsonbParameter(value) {
  return JSON.stringify(value);
}

function timestamp(value, fallback = new Date().toISOString()) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function auditRow(row) {
  return {
    id: String(row.id),
    occurredAt: row.occurred_at?.toISOString?.() || row.occurred_at,
    category: row.category,
    severity: row.severity,
    eventType: row.event_type,
    outcome: row.outcome,
    actorType: row.actor_type,
    actorId: row.actor_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    parentScopeType: row.parent_scope_type,
    parentScopeId: row.parent_scope_id,
    message: row.message,
    metadata: row.metadata,
  };
}

function sslConfiguration(connectionString) {
  const configured = String(process.env.POSTGRES_SSL || "").toLowerCase();
  if (configured === "disable") return false;
  const hostname = new URL(connectionString).hostname
    .toLowerCase()
    .replace(/\.$/, "");
  const local =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.");
  if (local && configured !== "require" && configured !== "verify-full") {
    return false;
  }
  return {
    rejectUnauthorized:
      configured !== "require" &&
      process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "0",
  };
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json";
    case ".jsonl":
      return "application/x-ndjson";
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".sha256":
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function objectKindFor(contentType) {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("javascript")) return "script";
  if (contentType.startsWith("text/")) return "text";
  return "binary";
}

function planFromSource(source) {
  const encoded = source.match(
    /Buffer\.from\((["'])([A-Za-z0-9_-]+)\1,\s*(["'])base64url\3\)/,
  )?.[2];
  if (!encoded) {
    throw new Error("Generated script does not contain an encoded plan.");
  }
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

async function filesBeneath(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return output;
}

export class FormWeaveDatabase {
  constructor(connectionString, options = {}) {
    if (!connectionString) throw new Error("POSTGRES_URI is required.");
    const connectionTimeoutMillis =
      options.connectionTimeoutMillis ||
      Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS) ||
      45_000;
    const idleTimeoutMillis =
      options.idleTimeoutMillis ||
      Number(process.env.POSTGRES_IDLE_TIMEOUT_MS) ||
      60_000;
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis,
      idleTimeoutMillis,
      keepAlive: options.keepAlive ?? true,
      max: options.maxConnections || 8,
      application_name: "formweave",
      ssl: options.ssl ?? sslConfiguration(connectionString),
    });
  }

  async close() {
    await this.pool.end();
  }

  async ping() {
    const result = await this.pool.query(
      `SELECT current_database() AS database,
              current_user AS role,
              version() AS version,
              now() AS server_time`,
    );
    const row = result.rows[0];
    return {
      connected: true,
      database: row.database,
      role: row.role,
      engine: row.version.split(" on ")[0],
      serverTime: row.server_time,
    };
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('formweave_schema_migrations'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS formweave_schema_migrations (
          version text PRIMARY KEY,
          sha256 character(64),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(
        `ALTER TABLE formweave_schema_migrations
         ADD COLUMN IF NOT EXISTS sha256 character(64)`,
      );
      const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^\d+.*\.sql$/i.test(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
      const applied = [];
      for (const entry of entries) {
        const source = await readFile(path.join(migrationsRoot, entry.name), "utf8");
        const migrationHash = sha256(source);
        await client.query("BEGIN");
        try {
          const exists = await client.query(
            `SELECT sha256
             FROM formweave_schema_migrations
             WHERE version = $1`,
            [entry.name],
          );
          if (exists.rowCount) {
            if (
              exists.rows[0].sha256 &&
              exists.rows[0].sha256 !== migrationHash
            ) {
              throw new Error(
                `Applied migration checksum mismatch: ${entry.name}.`,
              );
            }
            if (!exists.rows[0].sha256) {
              await client.query(
                `UPDATE formweave_schema_migrations
                 SET sha256 = $2
                 WHERE version = $1 AND sha256 IS NULL`,
                [entry.name, migrationHash],
              );
            }
          } else {
            await client.query(source);
            await client.query(
              `INSERT INTO formweave_schema_migrations(version, sha256)
               VALUES ($1, $2)`,
              [entry.name, migrationHash],
            );
            applied.push(entry.name);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      await client.query(
        `ALTER TABLE formweave_schema_migrations
         ALTER COLUMN sha256 SET NOT NULL`,
      );
      return applied;
    } finally {
      await client
        .query(
          "SELECT pg_advisory_unlock(hashtext('formweave_schema_migrations'))",
        )
        .catch(() => {});
      client.release();
    }
  }

  async getSettings(key = "traversal") {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_settings WHERE key = $1",
      [key],
    );
    return result.rows[0]?.payload || null;
  }

  async putSettings(payload, key = "traversal") {
    await this.pool.query(
      `INSERT INTO formweave_settings(key, payload, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = now()
       WHERE formweave_settings.payload IS DISTINCT FROM EXCLUDED.payload`,
      [key, payload],
    );
    return payload;
  }

  async putRun(payload) {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO formweave_runs(id, status, created_at, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload
       WHERE formweave_runs.status IS DISTINCT FROM EXCLUDED.status
          OR formweave_runs.updated_at IS DISTINCT FROM EXCLUDED.updated_at
          OR formweave_runs.payload IS DISTINCT FROM EXCLUDED.payload`,
      [
        payload.id,
        payload.status,
        timestamp(payload.createdAt, now),
        timestamp(payload.updatedAt, now),
        payload,
      ],
    );
    return payload;
  }

  async getRun(runId) {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_runs WHERE id = $1",
      [runId],
    );
    return result.rows[0]?.payload || null;
  }

  async listRuns() {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_runs ORDER BY created_at DESC",
    );
    return result.rows.map((row) => row.payload);
  }

  async putReport(runId, payload) {
    const canonical = stableJson(payload);
    await this.pool.query(
      `INSERT INTO formweave_reports(run_id, payload, sha256)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           sha256 = EXCLUDED.sha256,
           updated_at = now()
       WHERE formweave_reports.sha256 IS DISTINCT FROM EXCLUDED.sha256
          OR formweave_reports.payload IS DISTINCT FROM EXCLUDED.payload`,
      [runId, payload, sha256(canonical)],
    );
    return payload;
  }

  async getReport(runId) {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_reports WHERE run_id = $1",
      [runId],
    );
    return result.rows[0]?.payload || null;
  }

  async appendEvent(scopeType, scopeId, event, eventKey = randomUUID()) {
    await this.appendEvents(scopeType, scopeId, [{ event, eventKey }]);
  }

  async appendEvents(scopeType, scopeId, entries) {
    for (let offset = 0; offset < entries.length; offset += 250) {
      const batch = entries.slice(offset, offset + 250);
      const values = [];
      const placeholders = batch.map(({ event, eventKey }, index) => {
        const base = index * 8;
        values.push(
          scopeType,
          scopeId,
          eventKey,
          timestamp(event.timestamp),
          String(event.kind || ""),
          String(event.message || ""),
          event.metadata && typeof event.metadata === "object"
            ? event.metadata
            : {},
          event,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      });
      if (!placeholders.length) continue;
      await this.pool.query(
        `INSERT INTO formweave_events(
           scope_type, scope_id, event_key, occurred_at, kind, message, metadata, payload
         ) VALUES ${placeholders.join(", ")}
         ON CONFLICT (scope_type, scope_id, event_key) DO NOTHING`,
        values,
      );
    }
  }

  async listEvents(scopeType, scopeId) {
    const result = await this.pool.query(
      `SELECT payload FROM formweave_events
       WHERE scope_type = $1 AND scope_id = $2
       ORDER BY id`,
      [scopeType, scopeId],
    );
    return result.rows.map((row) => row.payload);
  }

  async appendAuditEvent(event, eventKey = randomUUID()) {
    const occurredAt = timestamp(event.occurredAt || event.timestamp);
    const result = await this.pool.query(
      `INSERT INTO formweave_audit_events(
         event_key, occurred_at, category, severity, event_type, outcome,
         actor_type, actor_id, scope_type, scope_id,
         parent_scope_type, parent_scope_id, message, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [
        String(eventKey),
        occurredAt,
        String(event.category || "api"),
        String(event.severity || "info"),
        String(event.eventType || "unspecified"),
        String(event.outcome || "observed"),
        String(event.actorType || "unknown"),
        event.actorId ? String(event.actorId).slice(0, 320) : null,
        event.scopeType ? String(event.scopeType) : null,
        event.scopeId ? String(event.scopeId).slice(0, 320) : null,
        event.parentScopeType ? String(event.parentScopeType) : null,
        event.parentScopeId
          ? String(event.parentScopeId).slice(0, 320)
          : null,
        String(event.message || "").slice(0, 4_000),
        event.metadata && typeof event.metadata === "object"
          ? event.metadata
          : {},
      ],
    );
    return result.rows[0]?.id || null;
  }

  async auditDashboard({
    hours = 24,
    limit = 200,
    category = "",
    severity = "",
    actorId = "",
    loginHours = 24 * 90,
    loginLimit = 100,
  } = {}) {
    const boundedHours = Math.min(24 * 365 * 5, Math.max(1, Number(hours) || 24));
    const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    const boundedLoginHours = Math.min(
      24 * 365 * 5,
      Math.max(1, Number(loginHours) || 24 * 90),
    );
    const boundedLoginLimit = Math.min(
      500,
      Math.max(1, Number(loginLimit) || 100),
    );
    const allowedCategory = [
      "authentication",
      "api",
      "crawl",
      "approval",
      "execution",
      "llm",
    ].includes(category)
      ? category
      : "";
    const allowedSeverity = [
      "info",
      "success",
      "warning",
      "error",
    ].includes(severity)
      ? severity
      : "";
    const allowedActorId = String(actorId || "").trim().slice(0, 320);
    const values = [
      boundedHours,
      allowedCategory || null,
      allowedSeverity || null,
      allowedActorId || null,
    ];
    const where = `occurred_at >= now() - ($1 * interval '1 hour')
      AND ($2::text IS NULL OR category = $2)
      AND ($3::text IS NULL OR severity = $3)
      AND ($4::text IS NULL OR actor_id = $4)`;
    const [
      summaryResult,
      categoryResult,
      actorResult,
      eventsResult,
      llmResult,
      usersResult,
      loginResult,
    ] =
      await Promise.all([
        this.pool.query(
          `SELECT
             count(*)::integer AS total,
             count(*) FILTER (WHERE severity = 'success')::integer AS successes,
             count(*) FILTER (WHERE severity = 'warning')::integer AS warnings,
             count(*) FILTER (WHERE severity = 'error')::integer AS failures,
             count(*) FILTER (
               WHERE category = 'authentication' AND outcome = 'succeeded'
             )::integer AS login_successes,
             count(*) FILTER (
               WHERE category = 'authentication'
                 AND outcome IN ('failed', 'locked')
             )::integer AS login_failures,
             count(*) FILTER (
               WHERE category = 'crawl' AND outcome = 'completed'
             )::integer AS crawls_completed,
             count(*) FILTER (
               WHERE category = 'crawl' AND severity = 'error'
             )::integer AS crawls_failed,
             count(*) FILTER (
               WHERE category = 'execution' AND outcome = 'completed'
             )::integer AS executions_completed,
             count(*) FILTER (
               WHERE category = 'execution' AND severity = 'error'
             )::integer AS executions_failed
           FROM formweave_audit_events
           WHERE ${where}`,
          values,
        ),
        this.pool.query(
          `SELECT category, count(*)::integer AS count
           FROM formweave_audit_events
           WHERE ${where}
           GROUP BY category
           ORDER BY count DESC, category`,
          values,
        ),
        this.pool.query(
          `SELECT actor_type, actor_id, count(*)::integer AS count,
                  max(occurred_at) AS last_seen_at
           FROM formweave_audit_events
           WHERE ${where} AND actor_id IS NOT NULL
           GROUP BY actor_type, actor_id
           ORDER BY count DESC, last_seen_at DESC
           LIMIT 12`,
          values,
        ),
        this.pool.query(
          `SELECT id, occurred_at, category, severity, event_type, outcome,
                  actor_type, actor_id, scope_type, scope_id,
                  parent_scope_type, parent_scope_id, message, metadata
           FROM formweave_audit_events
           WHERE ${where}
           ORDER BY occurred_at DESC, id DESC
           LIMIT $5`,
          [...values, boundedLimit],
        ),
        this.pool.query(
          `SELECT occurred_at, outcome, scope_id, metadata
           FROM formweave_audit_events
           WHERE occurred_at >= now() - ($1 * interval '1 hour')
             AND category = 'llm'
             AND ($2::text IS NULL OR actor_id = $2)
           ORDER BY occurred_at DESC, id DESC
           LIMIT 5000`,
          [boundedHours, allowedActorId || null],
        ),
        this.pool.query(
          `SELECT email, display_name
           FROM formweave_users
           WHERE active = true
           ORDER BY display_name, email`,
        ),
        this.pool.query(
          `SELECT id, occurred_at, category, severity, event_type, outcome,
                  actor_type, actor_id, scope_type, scope_id,
                  parent_scope_type, parent_scope_id, message, metadata
           FROM formweave_audit_events
           WHERE occurred_at >= now() - ($1 * interval '1 hour')
             AND category = 'authentication'
             AND ($2::text IS NULL OR actor_id = $2)
           ORDER BY occurred_at DESC, id DESC
           LIMIT $3`,
          [boundedLoginHours, allowedActorId || null, boundedLoginLimit],
        ),
      ]);
    const summary = summaryResult.rows[0] || {};
    return {
      generatedAt: new Date().toISOString(),
      windowHours: boundedHours,
      filters: {
        category: allowedCategory || null,
        severity: allowedSeverity || null,
        actorId: allowedActorId || null,
        limit: boundedLimit,
        loginHours: boundedLoginHours,
        loginLimit: boundedLoginLimit,
      },
      summary: {
        total: Number(summary.total || 0),
        successes: Number(summary.successes || 0),
        warnings: Number(summary.warnings || 0),
        failures: Number(summary.failures || 0),
        loginSuccesses: Number(summary.login_successes || 0),
        loginFailures: Number(summary.login_failures || 0),
        crawlsCompleted: Number(summary.crawls_completed || 0),
        crawlsFailed: Number(summary.crawls_failed || 0),
        executionsCompleted: Number(summary.executions_completed || 0),
        executionsFailed: Number(summary.executions_failed || 0),
      },
      byCategory: categoryResult.rows.map((row) => ({
        category: row.category,
        count: Number(row.count),
      })),
      topActors: actorResult.rows.map((row) => ({
        actorType: row.actor_type,
        actorId: row.actor_id,
        count: Number(row.count),
        lastSeenAt:
          row.last_seen_at?.toISOString?.() || row.last_seen_at,
      })),
      availableUsers: usersResult.rows.map((row) => ({
        actorId: row.email,
        displayName: row.display_name,
      })),
      loginSummary: {
        successes: loginResult.rows.filter(
          (row) => row.outcome === "succeeded",
        ).length,
        failures: loginResult.rows.filter((row) =>
          ["failed", "locked"].includes(row.outcome),
        ).length,
      },
      loginHistory: loginResult.rows.map(auditRow),
      llmTelemetry: summarizeLlmTelemetry(
        llmResult.rows.map((row) => ({
          occurredAt:
            row.occurred_at?.toISOString?.() || row.occurred_at,
          outcome: row.outcome,
          scopeId: row.scope_id,
          metadata: row.metadata,
        })),
      ),
      events: eventsResult.rows.map(auditRow),
    };
  }

  async putForm(payload) {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO formweave_forms(
         id, source_run_id, artifact_id, script_version, source_sha256,
         status, created_at, updated_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
       SET source_run_id = EXCLUDED.source_run_id,
           artifact_id = EXCLUDED.artifact_id,
           script_version = EXCLUDED.script_version,
           source_sha256 = EXCLUDED.source_sha256,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload
       WHERE formweave_forms.source_run_id IS DISTINCT FROM EXCLUDED.source_run_id
          OR formweave_forms.artifact_id IS DISTINCT FROM EXCLUDED.artifact_id
          OR formweave_forms.script_version IS DISTINCT FROM EXCLUDED.script_version
          OR formweave_forms.source_sha256 IS DISTINCT FROM EXCLUDED.source_sha256
          OR formweave_forms.status IS DISTINCT FROM EXCLUDED.status
          OR formweave_forms.updated_at IS DISTINCT FROM EXCLUDED.updated_at
          OR formweave_forms.payload IS DISTINCT FROM EXCLUDED.payload`,
      [
        payload.formId,
        payload.sourceRunId || null,
        payload.script?.artifactId || null,
        payload.script?.scriptVersion || null,
        payload.script?.sourceHash || null,
        payload.status,
        timestamp(payload.createdAt, now),
        timestamp(payload.updatedAt, now),
        payload,
      ],
    );
    if (payload.approval) await this.putApproval(payload.formId, payload.approval);
    return payload;
  }

  async getForm(formId) {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_forms WHERE id = $1",
      [formId],
    );
    return result.rows[0]?.payload || null;
  }

  async listForms() {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_forms ORDER BY created_at DESC",
    );
    return result.rows.map((row) => row.payload);
  }

  async putApproval(formId, approval) {
    await this.pool.query(
      `INSERT INTO formweave_form_approvals(
         approval_id, form_id, decision, artifact_id, script_version,
         source_sha256, decided_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (approval_id) DO NOTHING`,
      [
        approval.approvalId,
        formId,
        approval.decision,
        approval.pinnedScript.artifactId,
        approval.pinnedScript.scriptVersion,
        approval.pinnedScript.sourceHash,
        timestamp(approval.decidedAt),
        approval,
      ],
    );
  }

  async putExecution(payload) {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO formweave_executions(
         id, form_id, status, created_at, updated_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
       SET form_id = EXCLUDED.form_id,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload
       WHERE formweave_executions.form_id IS DISTINCT FROM EXCLUDED.form_id
          OR formweave_executions.status IS DISTINCT FROM EXCLUDED.status
          OR formweave_executions.updated_at IS DISTINCT FROM EXCLUDED.updated_at
          OR formweave_executions.payload IS DISTINCT FROM EXCLUDED.payload`,
      [
        payload.executionId,
        payload.formId || null,
        payload.status,
        timestamp(payload.createdAt, now),
        timestamp(payload.updatedAt, now),
        payload,
      ],
    );
    return payload;
  }

  async getExecution(executionId) {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_executions WHERE id = $1",
      [executionId],
    );
    return result.rows[0]?.payload || null;
  }

  async getLineage(lineageKey) {
    const result = await this.pool.query(
      "SELECT payload FROM formweave_lineages WHERE lineage_key = $1",
      [lineageKey],
    );
    return result.rows[0]?.payload || null;
  }

  async putLineage(lineageKey, normalizedUrl, payload) {
    await this.pool.query(
      `INSERT INTO formweave_lineages(
         lineage_key, normalized_url, payload, updated_at
       ) VALUES ($1, $2, $3, now())
       ON CONFLICT (lineage_key) DO UPDATE
       SET normalized_url = EXCLUDED.normalized_url,
           payload = EXCLUDED.payload,
           updated_at = now()
       WHERE formweave_lineages.normalized_url IS DISTINCT FROM EXCLUDED.normalized_url
          OR formweave_lineages.payload IS DISTINCT FROM EXCLUDED.payload`,
      [lineageKey, normalizedUrl, payload],
    );
    return payload;
  }

  async putObject({
    ownerType,
    ownerId,
    objectKey,
    bytes,
    contentType = "application/octet-stream",
    objectKind = objectKindFor(contentType),
    metadata = {},
  }) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const digest = sha256(buffer);
    await this.pool.query(
      `WITH stored_blob AS (
         INSERT INTO formweave_blobs(sha256, media_type, byte_length, bytes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sha256) DO NOTHING
       )
       INSERT INTO formweave_objects(
         owner_type, owner_id, object_key, object_kind, media_type,
         blob_sha256, metadata
       ) VALUES ($5, $6, $7, $8, $2, $1, $9)
       ON CONFLICT (owner_type, owner_id, object_key) DO UPDATE
       SET object_kind = EXCLUDED.object_kind,
           media_type = EXCLUDED.media_type,
           blob_sha256 = EXCLUDED.blob_sha256,
           metadata = EXCLUDED.metadata,
           updated_at = now()
       WHERE formweave_objects.object_kind IS DISTINCT FROM EXCLUDED.object_kind
          OR formweave_objects.media_type IS DISTINCT FROM EXCLUDED.media_type
          OR formweave_objects.blob_sha256 IS DISTINCT FROM EXCLUDED.blob_sha256
          OR formweave_objects.metadata IS DISTINCT FROM EXCLUDED.metadata`,
      [
        digest,
        contentType,
        buffer.byteLength,
        buffer,
        ownerType,
        ownerId,
        objectKey,
        objectKind,
        metadata,
      ],
    );
    return {
      sha256: digest,
      byteLength: buffer.byteLength,
      contentType,
      uri: `postgres://${ownerType}/${encodeURIComponent(ownerId)}/${objectKey}`,
    };
  }

  async getObject(ownerType, ownerId, objectKey) {
    const result = await this.pool.query(
      `SELECT b.bytes, o.media_type, b.byte_length, b.sha256, o.metadata
       FROM formweave_objects o
       JOIN formweave_blobs b ON b.sha256 = o.blob_sha256
       WHERE o.owner_type = $1 AND o.owner_id = $2 AND o.object_key = $3`,
      [ownerType, ownerId, objectKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      bytes: row.bytes,
      contentType: row.media_type,
      byteLength: Number(row.byte_length),
      sha256: row.sha256,
      metadata: row.metadata,
    };
  }

  async findObject(ownerType, ownerId, objectKeyPrefix) {
    const result = await this.pool.query(
      `SELECT o.object_key, b.bytes, o.media_type, b.byte_length, b.sha256, o.metadata
       FROM formweave_objects o
       JOIN formweave_blobs b ON b.sha256 = o.blob_sha256
       WHERE o.owner_type = $1
         AND o.owner_id = $2
         AND left(o.object_key, length($3)) = $3
       ORDER BY o.object_key
       LIMIT 1`,
      [ownerType, ownerId, objectKeyPrefix],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      objectKey: row.object_key,
      bytes: row.bytes,
      contentType: row.media_type,
      byteLength: Number(row.byte_length),
      sha256: row.sha256,
      metadata: row.metadata,
    };
  }

  async importDirectory({
    ownerType,
    ownerId,
    directory,
    keyPrefix = "",
    exclude = new Set(),
    concurrency = 8,
  }) {
    const files = (await filesBeneath(directory)).filter(
      (filePath) => !exclude.has(path.relative(directory, filePath).replaceAll("\\", "/")),
    );
    let next = 0;
    let stored = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(files.length, 1)) },
      async () => {
        while (next < files.length) {
          const index = next++;
          const filePath = files[index];
          const relative = path.relative(directory, filePath).replaceAll("\\", "/");
          const contentType = contentTypeFor(filePath);
          await this.putObject({
            ownerType,
            ownerId,
            objectKey: `${keyPrefix}${relative}`,
            bytes: await readFile(filePath),
            contentType,
            metadata: {
              sourceRelativePath: relative,
            },
          });
          stored += 1;
        }
      },
    );
    await Promise.all(workers);
    return stored;
  }

  async materializeObjects({
    ownerType,
    ownerId,
    destination,
    keyPrefix = "",
  }) {
    const result = await this.pool.query(
      `SELECT o.object_key, b.bytes, b.sha256
       FROM formweave_objects o
       JOIN formweave_blobs b ON b.sha256 = o.blob_sha256
       WHERE o.owner_type = $1
         AND o.owner_id = $2
         AND left(o.object_key, length($3)) = $3
       ORDER BY o.object_key`,
      [ownerType, ownerId, keyPrefix],
    );
    for (const row of result.rows) {
      const relative = row.object_key.slice(keyPrefix.length);
      const filePath = path.resolve(destination, relative);
      const resolvedDestination = path.resolve(destination);
      if (
        filePath !== resolvedDestination &&
        !filePath.startsWith(`${resolvedDestination}${path.sep}`)
      ) {
        throw new Error(`Unsafe object key: ${row.object_key}`);
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      let currentHash = "";
      try {
        currentHash = sha256(await readFile(filePath));
      } catch {}
      if (currentHash !== row.sha256) await writeFile(filePath, row.bytes);
    }
    return result.rowCount;
  }

  async putScriptVersion({
    artifactId,
    version,
    sourceText,
    sourceHash,
    plan,
    manifest,
  }) {
    if (!SAFE_SCRIPT_ID.test(String(artifactId || ""))) {
      throw new Error("Generated script artifact id is invalid.");
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("Generated script version is invalid.");
    }
    const computedSourceHash = sha256(sourceText);
    if (computedSourceHash !== sourceHash) {
      throw new Error(
        `Generated script ${artifactId}@${version} failed its source hash check.`,
      );
    }
    const decodedPlan = planFromSource(sourceText);
    if (
      JSON.stringify(decodedPlan) !== JSON.stringify(plan) ||
      plan.artifactId !== artifactId ||
      Number(plan.scriptVersion) !== version
    ) {
      throw new Error(
        `Generated script ${artifactId}@${version} does not match its decoded plan.`,
      );
    }
    if (
      manifest.sourceHash &&
      manifest.sourceHash !== sourceHash
    ) {
      throw new Error(
        `Generated script ${artifactId}@${version} manifest hash mismatch.`,
      );
    }
    const planHash = sha256(stableJson(plan));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO formweave_script_artifacts(
           artifact_id, initial_url, latest_version
         ) VALUES ($1, $2, $3)
         ON CONFLICT (artifact_id) DO UPDATE
         SET initial_url = COALESCE(
               formweave_script_artifacts.initial_url,
               EXCLUDED.initial_url
             ),
              latest_version = GREATEST(
                formweave_script_artifacts.latest_version,
                EXCLUDED.latest_version
              ),
              updated_at = now()
          WHERE formweave_script_artifacts.initial_url IS NULL
             OR EXCLUDED.latest_version >
                formweave_script_artifacts.latest_version`,
        [artifactId, plan.initialUrl || null, version],
      );
      await client.query(
        `INSERT INTO formweave_script_versions(
           artifact_id, version, source_sha256, plan_sha256,
           plan, manifest, source_text
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (artifact_id, version) DO NOTHING`,
        [
          artifactId,
          version,
          sourceHash,
          planHash,
          plan,
          manifest,
          sourceText,
        ],
      );
      const stored = await client.query(
        `SELECT source_sha256, plan_sha256
         FROM formweave_script_versions
         WHERE artifact_id = $1 AND version = $2`,
        [artifactId, version],
      );
      if (
        stored.rows[0]?.source_sha256 !== sourceHash ||
        stored.rows[0]?.plan_sha256 !== planHash
      ) {
        throw new Error(
          `Immutable generated script conflict for ${artifactId}@${version}.`,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async importScriptDirectory(directory, identity = {}) {
    const [sourceText, expectedHash, manifest] = await Promise.all([
      readFile(path.join(directory, "generated.mjs"), "utf8"),
      readFile(path.join(directory, "source.sha256"), "utf8").then((value) =>
        value.trim(),
      ),
      readFile(path.join(directory, "manifest.json"), "utf8").then(JSON.parse),
    ]);
    const plan = planFromSource(sourceText);
    const artifactId =
      identity.artifactId || manifest.artifactId || plan.artifactId;
    const version = Number(
      identity.version || manifest.scriptVersion || plan.scriptVersion,
    );
    if (!artifactId || !Number.isInteger(version) || version < 1) {
      throw new Error(`Generated script identity is invalid: ${directory}`);
    }
    await this.putScriptVersion({
      artifactId,
      version,
      sourceText,
      sourceHash: expectedHash,
      plan,
      manifest,
    });
    return { artifactId, version, sourceHash: expectedHash };
  }

  async importScriptRegistry(registryRoot) {
    const artifacts = await readdir(registryRoot, { withFileTypes: true }).catch(
      () => [],
    );
    let imported = 0;
    for (const artifact of artifacts.filter((entry) => entry.isDirectory())) {
      const artifactRoot = path.join(registryRoot, artifact.name);
      const versions = await readdir(artifactRoot, { withFileTypes: true });
      for (const versionEntry of versions.filter(
        (entry) => entry.isDirectory() && /^v\d+$/i.test(entry.name),
      )) {
        await this.importScriptDirectory(
          path.join(artifactRoot, versionEntry.name),
          {
            artifactId: artifact.name,
            version: Number(versionEntry.name.slice(1)),
          },
        );
        imported += 1;
      }
    }
    return imported;
  }

  async materializeScriptRegistry(registryRoot, { reset = true } = {}) {
    if (reset) {
      await rm(registryRoot, { recursive: true, force: true });
      await mkdir(registryRoot, { recursive: true });
    }
    const result = await this.pool.query(
      `SELECT v.artifact_id, v.version, v.source_sha256, v.source_text,
              v.manifest, a.latest_version
       FROM formweave_script_versions v
       JOIN formweave_script_artifacts a ON a.artifact_id = v.artifact_id
       ORDER BY v.artifact_id, v.version`,
    );
    for (const row of result.rows) {
      if (
        !SAFE_SCRIPT_ID.test(row.artifact_id) ||
        !Number.isInteger(row.version) ||
        row.version < 1
      ) {
        throw new Error("Stored generated script identity is unsafe.");
      }
      const versionRoot = path.join(
        registryRoot,
        row.artifact_id,
        `v${row.version}`,
      );
      await mkdir(versionRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(versionRoot, "generated.mjs"), row.source_text, "utf8"),
        writeFile(
          path.join(versionRoot, "source.sha256"),
          `${row.source_sha256}\n`,
          "utf8",
        ),
        writeFile(
          path.join(versionRoot, "manifest.json"),
          stableJson(row.manifest),
          "utf8",
        ),
      ]);
    }
    const latestByArtifact = new Map();
    for (const row of result.rows) {
      latestByArtifact.set(row.artifact_id, {
        schemaVersion: 1,
        artifactId: row.artifact_id,
        scriptVersion: row.latest_version,
        sourceHash: result.rows.find(
          (candidate) =>
            candidate.artifact_id === row.artifact_id &&
            candidate.version === row.latest_version,
        )?.source_sha256,
        updatedAt: new Date().toISOString(),
      });
    }
    for (const [artifactId, latest] of latestByArtifact) {
      await writeFile(
        path.join(registryRoot, artifactId, "latest.json"),
        stableJson(latest),
        "utf8",
      );
    }
    return result.rowCount;
  }

  async nextSemanticCandidateVersion(artifactId) {
    if (!SAFE_SCRIPT_ID.test(String(artifactId || ""))) {
      throw new Error("Semantic candidate artifact id is invalid.");
    }
    const result = await this.pool.query(
      `SELECT COALESCE(MAX(candidate_version), 0)::integer + 1 AS version
       FROM formweave_semantic_candidates
       WHERE artifact_id = $1`,
      [artifactId],
    );
    return Number(result.rows[0].version);
  }

  async nextActuatorBundleVersion(artifactId) {
    if (!SAFE_SCRIPT_ID.test(String(artifactId || ""))) {
      throw new Error("Actuator bundle artifact id is invalid.");
    }
    const result = await this.pool.query(
      `SELECT COALESCE(MAX(bundle_version), 0)::integer + 1 AS version
       FROM formweave_actuator_bundles
       WHERE artifact_id = $1`,
      [artifactId],
    );
    return Number(result.rows[0].version);
  }

  async nextArtifactReleaseVersion(artifactId) {
    if (!SAFE_SCRIPT_ID.test(String(artifactId || ""))) {
      throw new Error("Artifact release id is invalid.");
    }
    const result = await this.pool.query(
      `SELECT COALESCE(MAX(release_version), 0)::integer + 1 AS version
       FROM formweave_artifact_releases
       WHERE artifact_id = $1`,
      [artifactId],
    );
    return Number(result.rows[0].version);
  }

  async putSemanticCandidate({
    candidateId,
    artifactId,
    candidateVersion,
    proposal,
    existingContract = null,
    observationHash,
    parentCandidateId = null,
    status = "draft",
    provenance = {},
  }) {
    if (!SAFE_RECORD_ID.test(String(candidateId || ""))) {
      throw new Error("Semantic candidate id is invalid.");
    }
    if (!SAFE_SCRIPT_ID.test(String(artifactId || ""))) {
      throw new Error("Semantic candidate artifact id is invalid.");
    }
    if (!Number.isInteger(candidateVersion) || candidateVersion < 1) {
      throw new Error("Semantic candidate version is invalid.");
    }
    if (!/^[a-f0-9]{64}$/.test(String(observationHash || ""))) {
      throw new Error("Semantic candidate observation hash is invalid.");
    }
    if (!["draft", "rejected", "validated", "superseded"].includes(status)) {
      throw new Error("Semantic candidate status is invalid.");
    }
    if (parentCandidateId && !SAFE_RECORD_ID.test(parentCandidateId)) {
      throw new Error("Semantic candidate parent id is invalid.");
    }
    validateSemanticProposal(proposal, existingContract);
    const candidateHash = sha256(stableJson(proposal));
    await this.pool.query(
      `INSERT INTO formweave_semantic_candidates(
         candidate_id, artifact_id, candidate_version, candidate_sha256,
         observation_sha256, parent_candidate_id, status, proposal, provenance
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (candidate_id) DO NOTHING`,
      [
        candidateId,
        artifactId,
        candidateVersion,
        candidateHash,
        observationHash,
        parentCandidateId,
        status,
        jsonbParameter(proposal),
        jsonbParameter(provenance),
      ],
    );
    const stored = await this.pool.query(
      `SELECT artifact_id, candidate_version, candidate_sha256,
              observation_sha256, status
       FROM formweave_semantic_candidates
       WHERE candidate_id = $1`,
      [candidateId],
    );
    const row = stored.rows[0];
    if (
      row?.artifact_id !== artifactId ||
      row?.candidate_version !== candidateVersion ||
      row?.candidate_sha256 !== candidateHash ||
      row?.observation_sha256 !== observationHash ||
      row?.status !== status
    ) {
      throw new Error(`Immutable semantic candidate conflict for ${candidateId}.`);
    }
    return {
      candidateId,
      artifactId,
      candidateVersion,
      candidateHash,
      observationHash,
      status,
    };
  }

  async getSemanticCandidate(candidateId) {
    const result = await this.pool.query(
      `SELECT candidate_id, artifact_id, candidate_version,
              candidate_sha256, observation_sha256, parent_candidate_id,
              status, proposal, provenance, created_at
       FROM formweave_semantic_candidates
       WHERE candidate_id = $1`,
      [candidateId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      candidateId: row.candidate_id,
      artifactId: row.artifact_id,
      candidateVersion: row.candidate_version,
      candidateHash: row.candidate_sha256,
      observationHash: row.observation_sha256,
      parentCandidateId: row.parent_candidate_id,
      status: row.status,
      proposal: row.proposal,
      provenance: row.provenance,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
    };
  }

  async putActuatorBundle({
    bundle,
    semanticProposal,
    semanticCandidateId,
    status = "draft",
    provenance = {},
  }) {
    if (!SAFE_RECORD_ID.test(String(semanticCandidateId || ""))) {
      throw new Error("Actuator semantic candidate id is invalid.");
    }
    if (!["draft", "rejected", "validated", "superseded"].includes(status)) {
      throw new Error("Actuator bundle status is invalid.");
    }
    const checked = assertActuatorBundle({ bundle, semanticProposal });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const semantic = await client.query(
        `SELECT artifact_id, candidate_sha256, observation_sha256
         FROM formweave_semantic_candidates
         WHERE candidate_id = $1`,
        [semanticCandidateId],
      );
      if (
        semantic.rows[0]?.artifact_id !== bundle.artifactId ||
        semantic.rows[0]?.candidate_sha256 !== bundle.semanticCandidateHash ||
        semantic.rows[0]?.observation_sha256 !== bundle.observationHash
      ) {
        throw new Error("Actuator bundle does not match its semantic candidate.");
      }
      const manifest = {
        ...bundle,
        modules: bundle.modules.map(({ modulePath, sourceHash }) => ({
          modulePath,
          sourceHash,
        })),
      };
      await client.query(
        `INSERT INTO formweave_actuator_bundles(
           bundle_id, artifact_id, bundle_version, semantic_candidate_id,
           semantic_candidate_sha256, observation_sha256, bundle_sha256,
           status, manifest, provenance
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (bundle_id) DO NOTHING`,
        [
          bundle.bundleId,
          bundle.artifactId,
          bundle.bundleVersion,
          semanticCandidateId,
          bundle.semanticCandidateHash,
          bundle.observationHash,
          checked.bundleHash,
          status,
          jsonbParameter(manifest),
          jsonbParameter(provenance),
        ],
      );
      for (const actuatorModule of bundle.modules) {
        const capabilities = [
          ...new Set(
            bundle.handlers
              .filter(
                (handler) =>
                  handler.modulePath === actuatorModule.modulePath,
              )
              .flatMap((handler) => handler.capabilities),
          ),
        ].sort();
        await client.query(
          `INSERT INTO formweave_actuator_modules(
             bundle_id, module_path, source_sha256, source_text, capabilities
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (bundle_id, module_path) DO NOTHING`,
          [
            bundle.bundleId,
            actuatorModule.modulePath,
            actuatorModule.sourceHash,
            actuatorModule.source,
            jsonbParameter(capabilities),
          ],
        );
      }
      const stored = await client.query(
        `SELECT bundle_sha256, semantic_candidate_sha256, status
         FROM formweave_actuator_bundles
         WHERE bundle_id = $1`,
        [bundle.bundleId],
      );
      const storedModules = await client.query(
        `SELECT module_path, source_sha256
         FROM formweave_actuator_modules
         WHERE bundle_id = $1`,
        [bundle.bundleId],
      );
      const moduleHashes = new Map(
        storedModules.rows.map((row) => [row.module_path, row.source_sha256]),
      );
      if (
        stored.rows[0]?.bundle_sha256 !== checked.bundleHash ||
        stored.rows[0]?.semantic_candidate_sha256 !==
          bundle.semanticCandidateHash ||
        stored.rows[0]?.status !== status ||
        moduleHashes.size !== bundle.modules.length ||
        bundle.modules.some(
          (module) => moduleHashes.get(module.modulePath) !== module.sourceHash,
        )
      ) {
        throw new Error(`Immutable actuator bundle conflict for ${bundle.bundleId}.`);
      }
      await client.query("COMMIT");
      return {
        bundleId: bundle.bundleId,
        artifactId: bundle.artifactId,
        bundleVersion: bundle.bundleVersion,
        bundleHash: checked.bundleHash,
        status,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getActuatorBundle(bundleId) {
    const [bundleResult, modulesResult] = await Promise.all([
      this.pool.query(
        `SELECT bundle_id, artifact_id, bundle_version,
                semantic_candidate_id, semantic_candidate_sha256,
                observation_sha256, bundle_sha256, status, manifest,
                provenance, created_at
         FROM formweave_actuator_bundles
         WHERE bundle_id = $1`,
        [bundleId],
      ),
      this.pool.query(
        `SELECT module_path, source_sha256, source_text, capabilities
         FROM formweave_actuator_modules
         WHERE bundle_id = $1
         ORDER BY module_path`,
        [bundleId],
      ),
    ]);
    if (!bundleResult.rowCount) return null;
    const row = bundleResult.rows[0];
    const sources = new Map(
      modulesResult.rows.map((module) => [module.module_path, module]),
    );
    const bundle = {
      ...row.manifest,
      modules: row.manifest.modules.map((module) => ({
        ...module,
        source: sources.get(module.modulePath)?.source_text || "",
      })),
    };
    return {
      bundle,
      bundleHash: row.bundle_sha256,
      semanticCandidateId: row.semantic_candidate_id,
      status: row.status,
      provenance: row.provenance,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
    };
  }

  async putRepairAttempt({ artifactId, repair, status = "proposed", provenance = {} }) {
    if (repair?.layer === "semantic") validateSemanticRepairDocument(repair);
    else if (repair?.layer === "actuator") validateActuatorRepairDocument(repair);
    else throw new Error("Repair attempt layer is invalid.");
    if (!["proposed", "rejected", "applied", "superseded"].includes(status)) {
      throw new Error("Repair attempt status is invalid.");
    }
    await this.pool.query(
      `INSERT INTO formweave_repair_attempts(
         repair_id, artifact_id, layer, base_semantic_sha256,
         base_actuator_sha256, issue_ids, repair_document, status,
         model_provenance
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (repair_id) DO NOTHING`,
      [
        repair.repairId,
        artifactId,
        repair.layer,
        repair.baseCandidateHash || null,
        repair.baseBundleHash || null,
        jsonbParameter(repair.issueIds),
        jsonbParameter(repair),
        status,
        jsonbParameter(provenance),
      ],
    );
    const stored = await this.pool.query(
      `SELECT artifact_id, layer, repair_document, status
       FROM formweave_repair_attempts
       WHERE repair_id = $1`,
      [repair.repairId],
    );
    if (
      stored.rows[0]?.artifact_id !== artifactId ||
      stored.rows[0]?.layer !== repair.layer ||
      stableJson(stored.rows[0]?.repair_document) !== stableJson(repair) ||
      stored.rows[0]?.status !== status
    ) {
      throw new Error(`Immutable repair attempt conflict for ${repair.repairId}.`);
    }
    return { repairId: repair.repairId, artifactId, layer: repair.layer, status };
  }

  async putValidationRun({
    artifactId,
    semanticCandidateId = null,
    actuatorBundleId = null,
    validation,
    validatorVersions = {},
  }) {
    if (!SAFE_RECORD_ID.test(String(validation?.validationId || ""))) {
      throw new Error("Validation id is invalid.");
    }
    if (!['semantic', 'actuator_static', 'preflight', 'publication'].includes(validation.phase)) {
      throw new Error("Validation phase is invalid.");
    }
    if (!['passed', 'failed', 'blocked'].includes(validation.outcome)) {
      throw new Error("Validation outcome is invalid.");
    }
    await this.pool.query(
      `INSERT INTO formweave_validation_runs(
         validation_id, artifact_id, semantic_candidate_id,
         actuator_bundle_id, phase, outcome, validator_versions,
         issues, evidence_refs, timings
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (validation_id) DO NOTHING`,
      [
        validation.validationId,
        artifactId,
        semanticCandidateId,
        actuatorBundleId,
        validation.phase,
        validation.outcome,
        jsonbParameter(validatorVersions),
        jsonbParameter(validation.issues || []),
        jsonbParameter(validation.evidenceRefs || []),
        jsonbParameter(validation.timings || {}),
      ],
    );
    const stored = await this.pool.query(
      `SELECT artifact_id, phase, outcome
       FROM formweave_validation_runs
       WHERE validation_id = $1`,
      [validation.validationId],
    );
    if (
      stored.rows[0]?.artifact_id !== artifactId ||
      stored.rows[0]?.phase !== validation.phase ||
      stored.rows[0]?.outcome !== validation.outcome
    ) {
      throw new Error(`Immutable validation conflict for ${validation.validationId}.`);
    }
    return {
      validationId: validation.validationId,
      artifactId,
      phase: validation.phase,
      outcome: validation.outcome,
    };
  }

  async publishArtifactRelease(release) {
    validateArtifactRelease(release);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const [semantic, actuator, validations] = await Promise.all([
        client.query(
          `SELECT artifact_id, candidate_version, candidate_sha256, status
           FROM formweave_semantic_candidates
           WHERE candidate_id = $1`,
          [release.semanticCandidateId],
        ),
        client.query(
          `SELECT artifact_id, bundle_version, bundle_sha256,
                  semantic_candidate_id, status
           FROM formweave_actuator_bundles
           WHERE bundle_id = $1`,
          [release.actuatorBundleId],
        ),
        client.query(
          `SELECT validation_id, artifact_id, outcome
           FROM formweave_validation_runs
           WHERE validation_id = ANY($1::text[])`,
          [release.validationIds],
        ),
      ]);
      const semanticRow = semantic.rows[0];
      const actuatorRow = actuator.rows[0];
      if (
        semanticRow?.artifact_id !== release.artifactId ||
        semanticRow?.candidate_version !== release.semanticVersion ||
        semanticRow?.candidate_sha256 !== release.semanticHash ||
        semanticRow?.status !== "validated"
      ) {
        throw new Error("Release semantic candidate is not a validated exact match.");
      }
      if (
        actuatorRow?.artifact_id !== release.artifactId ||
        actuatorRow?.bundle_version !== release.actuatorVersion ||
        actuatorRow?.bundle_sha256 !== release.actuatorHash ||
        actuatorRow?.semantic_candidate_id !== release.semanticCandidateId ||
        actuatorRow?.status !== "validated"
      ) {
        throw new Error("Release actuator bundle is not a validated exact match.");
      }
      if (
        validations.rowCount !== release.validationIds.length ||
        validations.rows.some(
          (row) =>
            row.artifact_id !== release.artifactId || row.outcome !== "passed",
        )
      ) {
        throw new Error("Release validation set is incomplete or contains a failure.");
      }
      await client.query(
        `INSERT INTO formweave_artifact_releases(
           release_id, artifact_id, release_version, semantic_candidate_id,
           semantic_version, semantic_sha256, actuator_bundle_id,
           actuator_version, actuator_sha256, validation_ids,
           supersedes_release_id, certification_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (release_id) DO NOTHING`,
        [
          release.releaseId,
          release.artifactId,
          release.releaseVersion,
          release.semanticCandidateId,
          release.semanticVersion,
          release.semanticHash,
          release.actuatorBundleId,
          release.actuatorVersion,
          release.actuatorHash,
          jsonbParameter(release.validationIds),
          release.supersedesReleaseId,
          release.certificationStatus,
        ],
      );
      const stored = await client.query(
        `SELECT semantic_sha256, actuator_sha256, release_version
         FROM formweave_artifact_releases
         WHERE release_id = $1`,
        [release.releaseId],
      );
      if (
        stored.rows[0]?.semantic_sha256 !== release.semanticHash ||
        stored.rows[0]?.actuator_sha256 !== release.actuatorHash ||
        stored.rows[0]?.release_version !== release.releaseVersion
      ) {
        throw new Error(`Immutable artifact release conflict for ${release.releaseId}.`);
      }
      await client.query(
        `INSERT INTO formweave_artifact_release_heads(
           artifact_id, release_id, release_version
         ) VALUES ($1, $2, $3)
         ON CONFLICT (artifact_id) DO UPDATE
         SET release_id = EXCLUDED.release_id,
             release_version = EXCLUDED.release_version,
             updated_at = now()
         WHERE EXCLUDED.release_version >
               formweave_artifact_release_heads.release_version`,
        [release.artifactId, release.releaseId, release.releaseVersion],
      );
      await client.query("COMMIT");
      return release;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestArtifactRelease(artifactId) {
    const result = await this.pool.query(
      `SELECT r.*
       FROM formweave_artifact_release_heads h
       JOIN formweave_artifact_releases r ON r.release_id = h.release_id
       WHERE h.artifact_id = $1`,
      [artifactId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      schemaVersion: 1,
      releaseId: row.release_id,
      artifactId: row.artifact_id,
      releaseVersion: row.release_version,
      semanticCandidateId: row.semantic_candidate_id,
      semanticVersion: row.semantic_version,
      semanticHash: row.semantic_sha256,
      actuatorBundleId: row.actuator_bundle_id,
      actuatorVersion: row.actuator_version,
      actuatorHash: row.actuator_sha256,
      validationIds: row.validation_ids,
      supersedesReleaseId: row.supersedes_release_id,
      certificationStatus: row.certification_status,
    };
  }

  async counts() {
    const names = [
      "formweave_runs",
      "formweave_reports",
      "formweave_events",
      "formweave_audit_events",
      "formweave_forms",
      "formweave_form_approvals",
      "formweave_executions",
      "formweave_lineages",
      "formweave_script_versions",
      "formweave_semantic_candidates",
      "formweave_actuator_bundles",
      "formweave_actuator_modules",
      "formweave_repair_attempts",
      "formweave_validation_runs",
      "formweave_artifact_releases",
      "formweave_objects",
      "formweave_blobs",
    ];
    const output = {};
    for (const name of names) {
      const result = await this.pool.query(`SELECT count(*)::bigint AS count FROM ${name}`);
      output[name] = Number(result.rows[0].count);
    }
    const size = await this.pool.query(
      `SELECT pg_database_size(current_database())::bigint AS bytes`,
    );
    output.databaseBytes = Number(size.rows[0].bytes);
    return output;
  }
}

export async function createFormWeaveDatabase(
  connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI,
  options = {},
) {
  const database = new FormWeaveDatabase(connectionString, options);
  try {
    if (options.migrate !== false) await database.migrate();
    return database;
  } catch (error) {
    await database.close().catch(() => {});
    throw error;
  }
}

export { contentTypeFor, objectKindFor, planFromSource, sha256 };
