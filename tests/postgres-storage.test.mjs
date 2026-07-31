import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FormWeaveDatabase,
  planFromSource,
  sha256,
  stableJson,
} from "../local/postgres/database.mjs";
import {
  isRetryableDatabaseStartupError,
  retryDatabaseStartup,
} from "../local/postgres/startup.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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

test("PostgreSQL script records preserve readable plans and exact source hashes", () => {
  const plan = {
    artifactId: "form_0123456789abcdef01234567",
    scriptVersion: 4,
    initialUrl: "https://example.test/form",
    states: [{ key: "start", fields: [] }],
  };
  const source = generatedSource(plan);
  assert.deepEqual(planFromSource(source), plan);
  assert.match(sha256(source), /^[0-9a-f]{64}$/);
  assert.match(sha256(stableJson(plan)), /^[0-9a-f]{64}$/);
});

test("PostgreSQL migration covers JSON, immutable scripts, and binary objects", async () => {
  const migration = await readFile(
    path.join(projectRoot, "db", "migrations", "001_initial.sql"),
    "utf8",
  );
  assert.match(migration, /payload jsonb/i);
  assert.match(migration, /plan jsonb/i);
  assert.match(migration, /source_sha256 character\(64\)/i);
  assert.match(migration, /bytes bytea/i);
  assert.match(migration, /formweave_script_versions_immutable/i);
  assert.match(migration, /formweave_events_immutable/i);
  assert.match(migration, /formweave_blobs_immutable/i);
});

test("operational audit migration is append-only and actor-aware", async () => {
  const migration = await readFile(
    path.join(
      projectRoot,
      "db",
      "migrations",
      "005_operational_audit.sql",
    ),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS formweave_audit_events/i);
  assert.match(migration, /actor_type text NOT NULL/i);
  assert.match(migration, /actor_id text/i);
  assert.match(migration, /category IN \('authentication', 'api', 'crawl', 'approval', 'execution'\)/i);
  assert.match(migration, /formweave_audit_events_immutable/i);
  assert.match(migration, /formweave_reject_immutable_change/i);
});

test("user-role migration assigns the requested sole administrator", async () => {
  const migration = await readFile(
    path.join(projectRoot, "db", "migrations", "006_user_roles.sql"),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS role text/i);
  assert.match(migration, /role IN \('operator', 'admin'\)/i);
  assert.match(migration, /email = 'dbosmail@gmail\.com'/i);
  assert.match(migration, /ELSE 'operator'/i);
});

test("PostgreSQL pools tolerate slow managed-database connection startup", async () => {
  const database = new FormWeaveDatabase(
    "postgres://formweave:test@localhost/formweave",
  );
  try {
    assert.equal(database.pool.options.connectionTimeoutMillis, 45_000);
    assert.equal(database.pool.options.idleTimeoutMillis, 60_000);
    assert.equal(database.pool.options.keepAlive, true);
  } finally {
    await database.close();
  }
});

test("release migration retries transient connection startup failures only", async () => {
  let attempts = 0;
  const result = await retryDatabaseStartup(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("Connection terminated due to connection timeout", {
          cause: Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          }),
        });
      }
      return "connected";
    },
    {
      attempts: 4,
      delaysMs: [0, 0, 0],
    },
  );
  assert.equal(result, "connected");
  assert.equal(attempts, 3);
  assert.equal(
    isRetryableDatabaseStartupError(
      Object.assign(new Error("syntax error"), { code: "42601" }),
    ),
    false,
  );
  await assert.rejects(
    retryDatabaseStartup(
      async () => {
        throw Object.assign(new Error("syntax error"), { code: "42601" });
      },
      { attempts: 4, delaysMs: [0, 0, 0] },
    ),
    /syntax error/,
  );
});
