import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../env.mjs";
import { createFormWeaveDatabase } from "./database.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
loadEnvFile(path.join(projectRoot, ".env"));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI;
const database = await createFormWeaveDatabase(connectionString, {
  migrate: false,
});
try {
  const connection = await database.ping();
  const applied = await database.migrate();
  console.log(
    JSON.stringify(
      {
        connected: connection.connected,
        database: connection.database,
        role: connection.role,
        engine: connection.engine,
        migrationsApplied: applied,
      },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
