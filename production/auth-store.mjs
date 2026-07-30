import { timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";

import { sha256, verifyPassword } from "./auth-crypto.mjs";

const DUMMY_CREDENTIAL = Object.freeze({
  salt: "g0zLz0vVT9HbOuq9YV0HVxc7kPk2aYdx",
  hash: "ZxbPaHxr6w-8fZL0FjK6jR3WFGowjp1bw6kh7APn3FI",
  parameters: {
    algorithm: "scrypt",
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
  },
});

export class AuthStore {
  constructor(database, options = {}) {
    this.database = database;
    this.maxFailures = positiveInteger(
      options.maxFailures ?? process.env.FORMWEAVE_AUTH_MAX_FAILURES,
      5,
    );
    this.lockoutSeconds = positiveInteger(
      options.lockoutSeconds ?? process.env.FORMWEAVE_AUTH_LOCKOUT_SECONDS,
      15 * 60,
    );
    this.sessionSeconds = positiveInteger(
      options.sessionSeconds ?? process.env.FORMWEAVE_SESSION_SECONDS,
      8 * 60 * 60,
    );
  }

  async authenticateBasic(email, password, clientAddress = "") {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const principalKey = sha256(`basic:${normalizedEmail}`);
    const clientKey = sha256(`client:${clientAddress || "unknown"}`);
    const lock = await this.#activeLock(principalKey);
    if (lock) {
      await this.#event("principal_locked", principalKey, clientKey, {
        mechanism: "basic",
      });
      return { ok: false, lockedUntil: lock };
    }

    const result = await this.database.pool.query(
      `SELECT email, display_name, password_salt, password_hash,
              password_parameters, active
       FROM formweave_users
       WHERE email = $1`,
      [normalizedEmail],
    );
    const user = result.rows[0];
    const validPassword = await verifyPassword(password, user
      ? {
          salt: user.password_salt,
          hash: user.password_hash,
          parameters: user.password_parameters,
        }
      : DUMMY_CREDENTIAL);
    if (!user || !user.active || !validPassword) {
      const lockedUntil = await this.#recordFailure(principalKey);
      await this.#event(
        lockedUntil ? "principal_locked" : "basic_failure",
        principalKey,
        clientKey,
        { mechanism: "basic" },
      );
      return { ok: false, lockedUntil };
    }

    await this.#clearFailure(principalKey);
    await this.#event("basic_success", principalKey, clientKey, {
      mechanism: "basic",
      actorId: user.email,
      displayName: user.display_name,
    });
    return {
      ok: true,
      mechanism: "basic",
      principal: user.email,
      displayName: user.display_name,
      scopes: ["ui", "api"],
    };
  }

  async authenticateBearer(token, clientAddress = "") {
    const normalizedToken = String(token || "");
    const tokenHash = sha256(normalizedToken);
    const principalKey = sha256(`bearer:${tokenHash}`);
    const clientKey = sha256(`client:${clientAddress || "unknown"}`);
    const lock = await this.#activeLock(principalKey);
    if (lock) {
      await this.#event("principal_locked", principalKey, clientKey, {
        mechanism: "bearer",
      });
      return { ok: false, lockedUntil: lock };
    }

    const prefix = normalizedToken.slice(0, 16);
    const result = await this.database.pool.query(
      `SELECT token_id, token_hash, label, scopes
       FROM formweave_api_tokens
       WHERE token_prefix = $1
         AND active = true
         AND (expires_at IS NULL OR expires_at > now())`,
      [prefix],
    );
    const tokenRecord = result.rows.find((candidate) =>
      safeHexEqual(candidate.token_hash, tokenHash),
    );
    if (!tokenRecord) {
      const lockedUntil = await this.#recordFailure(principalKey);
      await this.#event(
        lockedUntil ? "principal_locked" : "bearer_failure",
        principalKey,
        clientKey,
        { mechanism: "bearer", tokenPrefix: prefix },
      );
      return { ok: false, lockedUntil };
    }

    await Promise.all([
      this.#clearFailure(principalKey),
      this.database.pool.query(
        `UPDATE formweave_api_tokens
         SET last_used_at = now()
         WHERE token_id = $1`,
        [tokenRecord.token_id],
      ),
      this.#event("bearer_success", principalKey, clientKey, {
        mechanism: "bearer",
        tokenId: tokenRecord.token_id,
      }),
    ]);
    return {
      ok: true,
      mechanism: "bearer",
      principal: tokenRecord.token_id,
      displayName: tokenRecord.label,
      scopes: tokenRecord.scopes,
    };
  }

  async createSession(user) {
    const token = randomBytes(32).toString("base64url");
    const sessionHash = sha256(token);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM formweave_auth_sessions
         WHERE expires_at <= now()`,
      );
      await client.query(
        `INSERT INTO formweave_auth_sessions(
           session_hash, user_email, expires_at
         )
         VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
        [sessionHash, user.principal, this.sessionSeconds],
      );
      await client.query(
        `DELETE FROM formweave_auth_sessions
         WHERE session_hash IN (
           SELECT session_hash
           FROM formweave_auth_sessions
           WHERE user_email = $1
           ORDER BY created_at DESC
           OFFSET 10
         )`,
        [user.principal],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return {
      token,
      maxAge: this.sessionSeconds,
    };
  }

  async authenticateSession(token) {
    const sessionHash = sha256(String(token || ""));
    const result = await this.database.pool.query(
      `UPDATE formweave_auth_sessions AS session
       SET last_used_at = now()
       FROM formweave_users AS app_user
       WHERE session.session_hash = $1
         AND session.user_email = app_user.email
         AND session.expires_at > now()
         AND app_user.active = true
       RETURNING app_user.email, app_user.display_name, session.expires_at`,
      [sessionHash],
    );
    const session = result.rows[0];
    if (!session) return { ok: false };
    return {
      ok: true,
      mechanism: "session",
      principal: session.email,
      displayName: session.display_name,
      scopes: ["ui", "api"],
      expiresAt:
        session.expires_at?.toISOString?.() || session.expires_at,
    };
  }

  async #activeLock(principalKey) {
    const result = await this.database.pool.query(
      `SELECT locked_until
       FROM formweave_auth_failures
       WHERE principal_hash = $1
         AND locked_until > now()`,
      [principalKey],
    );
    return result.rows[0]?.locked_until?.toISOString?.() ||
      result.rows[0]?.locked_until ||
      null;
  }

  async #recordFailure(principalKey) {
    const result = await this.database.pool.query(
      `INSERT INTO formweave_auth_failures(
         principal_hash, failed_attempts, locked_until, updated_at
       )
       VALUES ($1, 1, NULL, now())
       ON CONFLICT (principal_hash) DO UPDATE
       SET failed_attempts = CASE
             WHEN formweave_auth_failures.locked_until IS NOT NULL
               AND formweave_auth_failures.locked_until <= now()
             THEN 1
             ELSE formweave_auth_failures.failed_attempts + 1
           END,
           locked_until = CASE
             WHEN (
               CASE
                 WHEN formweave_auth_failures.locked_until IS NOT NULL
                   AND formweave_auth_failures.locked_until <= now()
                 THEN 1
                 ELSE formweave_auth_failures.failed_attempts + 1
               END
             ) >= $2
             THEN now() + ($3 * interval '1 second')
             ELSE NULL
           END,
           updated_at = now()
       RETURNING locked_until`,
      [principalKey, this.maxFailures, this.lockoutSeconds],
    );
    return result.rows[0]?.locked_until?.toISOString?.() ||
      result.rows[0]?.locked_until ||
      null;
  }

  async #clearFailure(principalKey) {
    await this.database.pool.query(
      "DELETE FROM formweave_auth_failures WHERE principal_hash = $1",
      [principalKey],
    );
  }

  async #event(eventType, principalHash, clientHash, metadata) {
    const success = eventType.endsWith("_success");
    const locked = eventType === "principal_locked";
    const actorType =
      success && metadata.mechanism === "basic"
        ? "user"
        : success && metadata.mechanism === "bearer"
          ? "api_token"
          : "unknown";
    const actorId =
      metadata.actorId ||
      metadata.tokenId ||
      `hash:${String(principalHash || "").slice(0, 12)}`;
    await this.database.pool.query(
      `INSERT INTO formweave_auth_events(
         event_type, principal_hash, client_hash, metadata
       )
       VALUES ($1, $2, $3, $4)`,
      [eventType, principalHash, clientHash, metadata],
    );
    await this.database
      .appendAuditEvent({
        category: "authentication",
        severity: success ? "success" : locked ? "warning" : "error",
        eventType: `authentication.${eventType}`,
        outcome: success ? "succeeded" : locked ? "locked" : "failed",
        actorType,
        actorId,
        message: success
          ? `${metadata.mechanism === "bearer" ? "API token" : "User"} authentication succeeded.`
          : locked
            ? "Authentication principal was locked after repeated failures."
            : `${metadata.mechanism === "bearer" ? "API token" : "User"} authentication failed.`,
        metadata: {
          mechanism: metadata.mechanism,
          clientHash: String(clientHash || "").slice(0, 16),
          ...(metadata.displayName
            ? { displayName: metadata.displayName }
            : {}),
          ...(metadata.tokenPrefix
            ? { tokenPrefix: metadata.tokenPrefix }
            : {}),
        },
      })
      .catch((error) =>
        console.error("Could not persist unified authentication audit:", error),
      );
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeHexEqual(left, right) {
  try {
    const leftBytes = Buffer.from(String(left), "hex");
    const rightBytes = Buffer.from(String(right), "hex");
    return (
      leftBytes.length === rightBytes.length &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } catch {
    return false;
  }
}
