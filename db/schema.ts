import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const formRuns = sqliteTable("form_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetUrl: text("target_url").notNull(),
  urlsJson: text("urls_json").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  progress: integer("progress").notNull().default(0),
  mode: text("mode").notNull().default("crawl"),
  graphJson: text("graph_json").notNull(),
  findingsJson: text("findings_json").notNull(),
  synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(true),
  liveApproved: integer("live_approved", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  kind: text("kind").notNull(),
  reasonCode: text("reason_code"),
  message: text("message").notNull(),
  evidenceKey: text("evidence_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
