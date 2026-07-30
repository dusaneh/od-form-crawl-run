import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../env.mjs";
import { createFormWeaveDatabase } from "./database.mjs";
import { retryDatabaseStartup } from "./startup.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI;
const outcome = await retryDatabaseStartup(
  async () => {
    const database = await createFormWeaveDatabase(connectionString, {
      migrate: false,
    });
    try {
      return {
        connection: await database.ping(),
        applied: await database.migrate(),
      };
    } finally {
      await database.close();
    }
  },
  {
    onRetry: ({ attempt, delayMs, error }) => {
      console.error(
        `PostgreSQL startup attempt ${attempt} failed transiently; retrying in ${delayMs}ms: ${error.message}`,
      );
    },
  },
);

console.log(
  JSON.stringify(
    {
      connected: outcome.connection.connected,
      database: outcome.connection.database,
      role: outcome.connection.role,
      engine: outcome.connection.engine,
      migrationsApplied: outcome.applied,
    },
    null,
    2,
  ),
);
