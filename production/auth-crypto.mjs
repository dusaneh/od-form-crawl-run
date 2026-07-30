import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);

export const PASSWORD_PARAMETERS = Object.freeze({
  algorithm: "scrypt",
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
});

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export async function hashPassword(password, salt = randomBytes(24)) {
  if (typeof password !== "string" || password.length < 14) {
    throw new Error("Passwords must contain at least 14 characters.");
  }
  const normalizedSalt = Buffer.isBuffer(salt)
    ? salt
    : Buffer.from(String(salt), "base64url");
  const hash = await derivePassword(password, normalizedSalt, PASSWORD_PARAMETERS);
  return {
    salt: normalizedSalt.toString("base64url"),
    hash: hash.toString("base64url"),
    parameters: PASSWORD_PARAMETERS,
  };
}

export async function verifyPassword(password, credential) {
  try {
    const expected = Buffer.from(credential.hash, "base64url");
    const actual = await derivePassword(
      String(password),
      Buffer.from(credential.salt, "base64url"),
      credential.parameters,
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function generatePassword() {
  return `FW-${randomBytes(18).toString("base64url")}`;
}

export function generateApiToken() {
  return `fw_dev_${randomBytes(32).toString("base64url")}`;
}

async function derivePassword(password, salt, parameters) {
  if (parameters?.algorithm !== "scrypt") {
    throw new Error("Unsupported password hashing algorithm.");
  }
  return scrypt(password, salt, Number(parameters.keyLength), {
    N: Number(parameters.cost),
    r: Number(parameters.blockSize),
    p: Number(parameters.parallelization),
    maxmem: 64 * 1024 * 1024,
  });
}
