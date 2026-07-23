import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureRunTables } from "../../../db/runtime";
import { formRuns, runEvents } from "../../../db/schema";
import { makeDemoRun, makeFreshGraph } from "../../lib/demo-run";
import type { FormRun } from "../../lib/models";

type RunRow = typeof formRuns.$inferSelect;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRun(row: RunRow): FormRun {
  const graph = parseJson<Pick<FormRun, "nodes" | "edges">>(row.graphJson, {
    nodes: [],
    edges: [],
  });

  return {
    id: row.id,
    name: row.name,
    targetUrl: row.targetUrl,
    urls: parseJson<string[]>(row.urlsJson, [row.targetUrl]),
    status: row.status as FormRun["status"],
    stage: row.stage,
    progress: row.progress,
    mode: row.mode as FormRun["mode"],
    nodes: graph.nodes,
    edges: graph.edges,
    findings: parseJson<FormRun["findings"]>(row.findingsJson, []),
    synthetic: row.synthetic,
    liveApproved: row.liveApproved,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function seedDemoIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: formRuns.id }).from(formRuns).limit(1);
  if (existing.length) return;

  const demo = makeDemoRun();
  await db.insert(formRuns).values({
    id: demo.id,
    name: demo.name,
    targetUrl: demo.targetUrl,
    urlsJson: JSON.stringify(demo.urls),
    status: demo.status,
    stage: demo.stage,
    progress: demo.progress,
    mode: demo.mode,
    graphJson: JSON.stringify({ nodes: demo.nodes, edges: demo.edges }),
    findingsJson: JSON.stringify(demo.findings),
    synthetic: demo.synthetic,
    liveApproved: demo.liveApproved,
    createdAt: demo.createdAt,
    updatedAt: demo.updatedAt,
  });
}

async function advanceSimulatedRuns(rows: RunRow[]) {
  const db = getDb();
  const now = Date.now();

  await Promise.all(
    rows.map(async (row) => {
      if (row.status !== "running" || row.id === "run_demo_housing_042") return;
      const elapsed = Math.max(0, (now - Date.parse(row.createdAt)) / 1000);
      const progress = Math.min(88, Math.max(row.progress, Math.round(6 + elapsed * 2.1)));
      const stage =
        progress < 20
          ? "Reading DOM + evidence"
          : progress < 42
            ? "Mapping fields"
            : progress < 72
              ? "Probing dynamic branches"
              : progress < 86
                ? "Certifying state graph"
                : "Human review required";
      const status = progress >= 86 ? "awaiting_review" : "running";

      if (progress !== row.progress || stage !== row.stage || status !== row.status) {
        await db
          .update(formRuns)
          .set({
            progress,
            stage,
            status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(formRuns.id, row.id));
      }
    })
  );
}

export async function GET() {
  try {
    await ensureRunTables();
    await seedDemoIfEmpty();
    const db = getDb();
    let rows = await db
      .select()
      .from(formRuns)
      .orderBy(desc(formRuns.createdAt))
      .limit(24);
    await advanceSimulatedRuns(rows);
    rows = await db
      .select()
      .from(formRuns)
      .orderBy(desc(formRuns.createdAt))
      .limit(24);

    return Response.json({ runs: rows.map(toRun) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load runs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureRunTables();
    const payload = (await request.json()) as {
      urls?: string[];
      name?: string;
      mode?: "crawl" | "dry_run" | "live";
    };
    const urls = (payload.urls ?? [])
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 12);

    if (!urls.length) {
      return Response.json({ error: "At least one URL is required." }, { status: 400 });
    }

    for (const value of urls) {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) {
        return Response.json(
          { error: "URLs must use http or https." },
          { status: 400 }
        );
      }
    }

    if (payload.mode === "live") {
      return Response.json(
        {
          error:
            "Live mode cannot be created directly. Complete review and record an explicit operator approval first.",
        },
        { status: 409 }
      );
    }

    const graph = makeFreshGraph();
    const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const now = new Date().toISOString();
    const host = new URL(urls[0]).hostname.replace(/^www\./, "");
    const name = payload.name?.trim() || `${host} intake`;
    const db = getDb();

    await db.insert(formRuns).values({
      id,
      name,
      targetUrl: urls[0],
      urlsJson: JSON.stringify(urls),
      status: "running",
      stage: "Starting isolated browser",
      progress: 6,
      mode: payload.mode === "dry_run" ? "dry_run" : "crawl",
      graphJson: JSON.stringify({ nodes: graph.nodes, edges: graph.edges }),
      findingsJson: JSON.stringify(graph.findings),
      synthetic: true,
      liveApproved: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(runEvents).values({
      runId: id,
      kind: "run_started",
      message: `Started a synthetic ${payload.mode === "dry_run" ? "dry run" : "crawl"} for ${urls.length} URL${urls.length === 1 ? "" : "s"}.`,
    });

    const [row] = await db.select().from(formRuns).where(eq(formRuns.id, id));
    return Response.json({ run: toRun(row) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to start run." },
      { status: 500 }
    );
  }
}
