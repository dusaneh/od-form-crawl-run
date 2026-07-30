import assert from "node:assert/strict";
import test from "node:test";

import {
  generateApiToken,
  generatePassword,
  hashPassword,
  sha256,
  verifyPassword,
} from "../production/auth-crypto.mjs";

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
