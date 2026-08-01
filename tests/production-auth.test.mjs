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
import {
  ACCESS_SCOPES,
  hasPrivilegedUserScope,
  isStandardTestTarget,
  mayExecuteHostedTarget,
  requiresExternalTargetAccess,
  userScopes,
} from "../production/access-policy.mjs";

test("the designated administrator receives narrowly scoped privileges", () => {
  const scopes = userScopes("DBOSMAIL@gmail.com", "admin");
  assert.deepEqual(scopes, [
    "ui",
    "api",
    "admin",
    "control-plane",
    "external-targets",
  ]);
  assert.equal(
    hasPrivilegedUserScope(
      {
        mechanism: "session",
        principal: "dbosmail@gmail.com",
        role: "admin",
        scopes,
      },
      ACCESS_SCOPES.controlPlane,
    ),
    true,
  );
});

test("admin role and API tokens do not grant designated-user privileges", () => {
  assert.deepEqual(userScopes("another-admin@example.test", "admin"), [
    "ui",
    "api",
    "admin",
  ]);
  assert.equal(
    hasPrivilegedUserScope(
      {
        mechanism: "bearer",
        principal: "dbosmail@gmail.com",
        role: "admin",
        scopes: ["admin", "control-plane", "external-targets"],
      },
      ACCESS_SCOPES.externalTargets,
    ),
    false,
  );
});

test("hosted target execution combines origin and designated-user checks", () => {
  const operator = {
    mechanism: "session",
    principal: "operator@example.test",
    role: "operator",
    scopes: ["ui", "api"],
  };
  const designatedAdmin = {
    mechanism: "session",
    principal: "dbosmail@gmail.com",
    role: "admin",
    scopes: userScopes("dbosmail@gmail.com", "admin"),
  };
  assert.equal(
    mayExecuteHostedTarget(
      operator,
      "https://testforms.dbolab.io/site_a/intake",
    ),
    true,
  );
  assert.equal(
    mayExecuteHostedTarget(operator, "https://example.org/application"),
    false,
  );
  assert.equal(
    mayExecuteHostedTarget(
      designatedAdmin,
      "https://example.org/application",
    ),
    true,
  );
});

test("only the exact HTTPS testforms origin is a standard target", () => {
  assert.equal(isStandardTestTarget("https://testforms.dbolab.io/site_a"), true);
  assert.equal(isStandardTestTarget("https://testforms.dbolab.io:443/site_a"), true);
  assert.equal(requiresExternalTargetAccess("http://testforms.dbolab.io/site_a"), true);
  assert.equal(requiresExternalTargetAccess("https://sub.testforms.dbolab.io/site_a"), true);
  assert.equal(requiresExternalTargetAccess("https://example.org/form"), true);
});

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
