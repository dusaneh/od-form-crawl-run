import { env } from "cloudflare:workers";

let initialized = false;

export async function ensureRunTables() {
  if (initialized) return;
  if (!env.DB) {
    throw new Error("The DB binding is unavailable.");
  }

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS form_runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        urls_json TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'crawl',
        graph_json TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        synthetic INTEGER NOT NULL DEFAULT 1,
        live_approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        reason_code TEXT,
        message TEXT NOT NULL,
        evidence_key TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS run_events_run_id_idx ON run_events (run_id)"
    ),
  ]);

  initialized = true;
}
