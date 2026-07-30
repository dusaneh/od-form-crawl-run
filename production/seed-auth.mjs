import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hashPassword, sha256 } from "./auth-crypto.mjs";
import { loadEnvFile } from "../local/env.mjs";
import { createFormWeaveDatabase } from "../local/postgres/database.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

const sourcePath = path.resolve(projectRoot, process.argv[2] || "access.md");
const source = await readFile(sourcePath, "utf8");
const credentials = credentialsFromMarkdown(source);
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI;
if (!connectionString) {
  throw new Error("DATABASE_URL or POSTGRES_URI is required.");
}

const database = await createFormWeaveDatabase(connectionString);
const client = await database.pool.connect();
try {
  await client.query("BEGIN");
  for (const user of credentials.users || []) {
    const email = String(user.email || "").trim().toLowerCase();
    const displayName = String(user.displayName || email).trim();
    const credential = await hashPassword(String(user.password || ""));
    await client.query(
      `INSERT INTO formweave_users(
         email, display_name, password_salt, password_hash,
         password_parameters, active, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, true, now())
       ON CONFLICT (email) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           password_salt = EXCLUDED.password_salt,
           password_hash = EXCLUDED.password_hash,
           password_parameters = EXCLUDED.password_parameters,
           active = true,
           updated_at = now()`,
      [
        email,
        displayName,
        credential.salt,
        credential.hash,
        credential.parameters,
      ],
    );
  }

  for (const apiToken of credentials.apiTokens || []) {
    const token = String(apiToken.token || "");
    if (!token.startsWith("fw_") || token.length < 40) {
      throw new Error(`Invalid API token for ${apiToken.label || "unnamed token"}.`);
    }
    const tokenHash = sha256(token);
    const tokenId = `token_${tokenHash.slice(0, 18)}`;
    await client.query(
      `INSERT INTO formweave_api_tokens(
         token_id, label, token_prefix, token_hash, scopes, active
       )
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (token_hash) DO UPDATE
       SET label = EXCLUDED.label,
           scopes = EXCLUDED.scopes,
           active = true`,
      [
        tokenId,
        String(apiToken.label || tokenId),
        token.slice(0, 16),
        tokenHash,
        Array.isArray(apiToken.scopes) && apiToken.scopes.length
          ? apiToken.scopes
          : ["api"],
      ],
    );
  }
  await client.query("COMMIT");
  console.log(
    `Seeded ${credentials.users?.length || 0} UI users and ` +
      `${credentials.apiTokens?.length || 0} API tokens.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await database.close();
}

function credentialsFromMarkdown(markdown) {
  const match = markdown.match(
    /<!--\s*FORMWEAVE_AUTH_SEED_START\s*-->\s*```json\s*([\s\S]*?)```\s*<!--\s*FORMWEAVE_AUTH_SEED_END\s*-->/i,
  );
  if (!match) {
    throw new Error(
      "The access file does not contain a FormWeave authentication seed block.",
    );
  }
  return JSON.parse(match[1]);
}
