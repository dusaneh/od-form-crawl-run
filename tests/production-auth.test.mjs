import assert from "node:assert/strict";
import test from "node:test";

import {
  generateApiToken,
  generatePassword,
  hashPassword,
  sha256,
  verifyPassword,
} from "../production/auth-crypto.mjs";
import { AuthStore } from "../production/auth-store.mjs";

test("password hashes verify without retaining plaintext", async () => {
  const password = generatePassword();
  const credential = await hashPassword(password);
  assert.equal(await verifyPassword(password, credential), true);
  assert.equal(await verifyPassword(`${password}x`, credential), false);
  assert.notEqual(credential.hash, password);
  assert.equal(credential.parameters.algorithm, "scrypt");
});

test("API tokens are high entropy and represented by a stable digest", () => {
  const token = generateApiToken();
  assert.match(token, /^fw_dev_[A-Za-z0-9_-]{40,}$/);
  assert.match(sha256(token), /^[0-9a-f]{64}$/);
  assert.notEqual(sha256(token), token);
});

test("successful site login is attributed in the unified audit stream", async () => {
  const password = "Correct horse battery staple!";
  const credential = await hashPassword(password);
  const auditEvents = [];
  const database = {
    pool: {
      async query(sql) {
        if (/SELECT locked_until/i.test(sql)) return { rows: [] };
        if (/FROM formweave_users/i.test(sql)) {
          return {
            rows: [
              {
                email: "operator@example.test",
                display_name: "Test Operator",
                password_salt: credential.salt,
                password_hash: credential.hash,
                password_parameters: credential.parameters,
                active: true,
                role: "admin",
              },
            ],
          };
        }
        return { rows: [] };
      },
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
    },
  };
  const auth = new AuthStore(database);
  const result = await auth.authenticateBasic(
    "operator@example.test",
    password,
    "192.0.2.10",
  );
  assert.equal(result.ok, true);
  assert.equal(result.role, "admin");
  assert.deepEqual(result.scopes, ["ui", "api", "admin"]);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].category, "authentication");
  assert.equal(auditEvents[0].outcome, "succeeded");
  assert.equal(auditEvents[0].actorType, "user");
  assert.equal(auditEvents[0].actorId, "operator@example.test");
  assert.equal(
    JSON.stringify(auditEvents[0]).includes(password),
    false,
  );
  assert.equal(
    JSON.stringify(auditEvents[0]).includes("192.0.2.10"),
    false,
  );

  const failed = await auth.authenticateBasic(
    "operator@example.test",
    "incorrect password",
    "192.0.2.10",
  );
  assert.equal(failed.ok, false);
  assert.equal(auditEvents[1].outcome, "failed");
  assert.equal(auditEvents[1].actorType, "user");
  assert.equal(auditEvents[1].actorId, "operator@example.test");
});
