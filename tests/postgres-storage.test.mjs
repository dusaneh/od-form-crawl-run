import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  planFromSource,
  sha256,
  stableJson,
} from "../local/postgres/database.mjs";

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
