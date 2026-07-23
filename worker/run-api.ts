import type { CrawlStats, FormRun } from "../app/lib/models";
import { crawlTargets, validateTargetUrl } from "./crawler";

export interface RunApiEnv {
  DB: D1Database;
  EVIDENCE: R2Bucket;
}

type RunRow = {
  id: string;
  name: string;
  target_url: string;
  urls_json: string;
  status: string;
  stage: string;
  progress: number;
  mode: string;
  graph_json: string;
  findings_json: string;
  synthetic: number;
  live_approved: number;
  created_at: string;
  updated_at: string;
};

let schemaReady: Promise<void> | undefined;

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function ensureSchema(env: RunApiEnv) {
  schemaReady ??= (async () => {
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
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS form_runs_created_at_idx ON form_runs (created_at DESC)"
      ),
    ]);
  })();
  await schemaReady;
}

function toRun(row: RunRow): FormRun {
  const graph = parseJson<Partial<FormRun>>(row.graph_json, {});
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    urls: parseJson<string[]>(row.urls_json, [row.target_url]),
    status: row.status as FormRun["status"],
    stage: row.stage,
    progress: row.progress,
    mode: row.mode as FormRun["mode"],
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
    findings: parseJson<FormRun["findings"]>(row.findings_json, []),
    contract: graph.contract ?? [],
    stats: graph.stats,
    reportAvailable: graph.reportAvailable ?? false,
    synthetic: Boolean(row.synthetic),
    liveApproved: Boolean(row.live_approved),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findRun(env: RunApiEnv, id: string) {
  return (await env.DB.prepare("SELECT * FROM form_runs WHERE id = ? LIMIT 1")
    .bind(id)
    .first<RunRow>()) as RunRow | null;
}

async function addEvent(
  env: RunApiEnv,
  runId: string,
  kind: string,
  message: string,
  reasonCode?: string,
  evidenceKey?: string
) {
  await env.DB.prepare(
    `INSERT INTO run_events
      (run_id, kind, reason_code, message, evidence_key)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(runId, kind, reasonCode ?? null, message, evidenceKey ?? null)
    .run();
}

async function updateRunProgress(
  env: RunApiEnv,
  id: string,
  progress: number,
  stage: string
) {
  await env.DB.prepare(
    `UPDATE form_runs
       SET progress = ?, stage = ?, updated_at = ?
     WHERE id = ? AND status = 'running'`
  )
    .bind(progress, stage, new Date().toISOString(), id)
    .run();
}

async function executeCrawl(
  env: RunApiEnv,
  runId: string,
  urls: string[],
  startedAt: string
) {
  try {
    await addEvent(
      env,
      runId,
      "crawl_started",
      `Fetching ${urls.length} public target${urls.length === 1 ? "" : "s"}.`
    );
    await updateRunProgress(env, runId, 8, "Fetching target HTML");

    const output = await crawlTargets(urls, runId, async ({ pages, queued }) => {
      const attempted = pages + queued;
      const progress = Math.min(82, 12 + pages * 6);
      await updateRunProgress(
        env,
        runId,
        progress,
        `Fetched ${pages} page${pages === 1 ? "" : "s"} · ${attempted} discovered`
      );
    });
    await updateRunProgress(env, runId, 86, "Persisting crawl evidence");

    let screenshotsCaptured = 0;
    await Promise.all(
      output.pages.map(async (page, index) => {
        if (!page.screenshot) return;
        const nodeId = output.nodes[index].id;
        const key = `runs/${runId}/evidence/${nodeId}`;
        await env.EVIDENCE.put(key, page.screenshot, {
          httpMetadata: {
            contentType: page.screenshotContentType || "image/png",
            cacheControl: "private, max-age=3600",
          },
          customMetadata: {
            runId,
            nodeId,
            sourceUrl: page.finalUrl.slice(0, 900),
            capturedAt: new Date().toISOString(),
            provider: page.screenshotProvider ?? "unknown",
          },
        });
        screenshotsCaptured += 1;
        await addEvent(
          env,
          runId,
          "evidence_captured",
          `Stored a screenshot for ${page.finalUrl}.`,
          undefined,
          key
        );
      })
    );

    const finishedAt = new Date().toISOString();
    const fetchedPages = output.pages.filter((page) => !page.error);
    const stats: CrawlStats = {
      pagesAttempted: output.pages.length,
      pagesFetched: fetchedPages.length,
      formsFound: fetchedPages.reduce((sum, page) => sum + page.forms, 0),
      fieldsFound: output.contract.filter((field) => !field.hidden).length,
      screenshotsCaptured,
      bytesFetched: fetchedPages.reduce((sum, page) => sum + page.bytesFetched, 0),
      startedAt,
      finishedAt,
    };
    const report = {
      id: runId,
      generatedAt: finishedAt,
      targets: urls,
      stats,
      pages: output.pages.map(({ screenshot, ...page }) => {
        void screenshot;
        return page;
      }),
      contract: output.contract,
      findings: output.findings,
    };
    await env.EVIDENCE.put(
      `runs/${runId}/report.json`,
      JSON.stringify(report, null, 2),
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, max-age=60",
        },
        customMetadata: { runId, generatedAt: finishedAt },
      }
    );

    const graphJson = JSON.stringify({
      nodes: output.nodes,
      edges: output.edges,
      contract: output.contract,
      stats,
      reportAvailable: true,
    });
    const allFailed = fetchedPages.length === 0;
    await env.DB.prepare(
      `UPDATE form_runs
         SET status = ?, stage = ?, progress = 100, graph_json = ?,
             findings_json = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        allFailed ? "failed" : "completed",
        allFailed ? "Crawl failed" : "Crawl complete",
        graphJson,
        JSON.stringify(output.findings),
        finishedAt,
        runId
      )
      .run();
    await addEvent(
      env,
      runId,
      allFailed ? "crawl_failed" : "crawl_completed",
      allFailed
        ? "Every target failed. Review the diagnostics for the exact response."
        : `Crawl completed with ${stats.fieldsFound} visible fields and ${screenshotsCaptured} screenshots.`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The crawl worker failed unexpectedly.";
    const finding = {
      id: `${runId}_worker_failed`,
      tone: "danger",
      code: "crawl_worker_failed",
      title: "Crawl worker failed",
      detail: message,
      time: "now",
    };
    await env.DB.prepare(
      `UPDATE form_runs
         SET status = 'failed', stage = ?, progress = 100,
             findings_json = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind("Crawl failed", JSON.stringify([finding]), new Date().toISOString(), runId)
      .run();
    await addEvent(env, runId, "crawl_failed", message, "crawl_worker_failed");
  }
}

async function listRuns(env: RunApiEnv) {
  const result = await env.DB.prepare(
    `SELECT * FROM form_runs
      WHERE synthetic = 0
      ORDER BY created_at DESC
      LIMIT 50`
  ).all<RunRow>();
  return json({ runs: (result.results ?? []).map((row) => toRun(row as RunRow)) });
}

async function createRun(request: Request, env: RunApiEnv) {
  const payload = (await request.json()) as {
    urls?: string[];
    name?: string;
    mode?: "crawl" | "dry_run";
  };
  const rawUrls = (payload.urls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!rawUrls.length) {
    return json({ error: "At least one public URL is required." }, { status: 400 });
  }

  let urls: string[];
  try {
    urls = [...new Set(rawUrls.map(validateTargetUrl))];
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "A target URL is invalid." },
      { status: 400 }
    );
  }

  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const now = new Date().toISOString();
  const host = new URL(urls[0]).hostname.replace(/^www\./, "");
  const name = payload.name?.trim().slice(0, 120) || `${host} crawl`;
  const nodes = urls.map((url, index) => ({
    id: `target_${String(index + 1).padStart(2, "0")}`,
    step: String(index + 1).padStart(2, "0"),
    title: new URL(url).hostname,
    subtitle: "Queued for fetch",
    fingerprint: "pending",
    status: index === 0 ? "active" : "queued",
    fields: 0,
    branches: 0,
    x: 34 + index * 224,
    y: 146,
    evidence: "",
    evidenceAvailable: false,
    sourceUrl: url,
    sensitiveMasks: 0,
    notes: ["The target has been queued for a real server-side fetch."],
  }));
  const finding = {
    id: `${id}_queued`,
    tone: "info",
    code: "crawl_queued",
    title: "Crawl queued",
    detail: `${urls.length} public target${urls.length === 1 ? "" : "s"} will be fetched without entering or submitting data.`,
    time: "now",
  };

  await env.DB.prepare(
    `INSERT INTO form_runs
      (id, name, target_url, urls_json, status, stage, progress, mode,
       graph_json, findings_json, synthetic, live_approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', 'Queued for fetch', 2, ?, ?, ?, 0, 0, ?, ?)`
  )
    .bind(
      id,
      name,
      urls[0],
      JSON.stringify(urls),
      payload.mode === "dry_run" ? "dry_run" : "crawl",
      JSON.stringify({ nodes, edges: [], contract: [], reportAvailable: false }),
      JSON.stringify([finding]),
      now,
      now
    )
    .run();
  await addEvent(
    env,
    id,
    "run_created",
    `Created a real crawl for ${urls.length} public target${urls.length === 1 ? "" : "s"}.`
  );
  const row = await findRun(env, id);
  return {
    response: json({ run: toRun(row!) }, { status: 201 }),
    background: executeCrawl(env, id, urls, now),
  };
}

async function patchRun(request: Request, env: RunApiEnv, id: string) {
  const run = await findRun(env, id);
  if (!run || run.synthetic) {
    return json({ error: "Run not found." }, { status: 404 });
  }
  const payload = (await request.json()) as { action?: string };
  if (payload.action !== "request_review") {
    return json(
      { error: "Only completed-run review requests are currently supported." },
      { status: 400 }
    );
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE form_runs
       SET status = 'awaiting_review', stage = 'Human review requested', updated_at = ?
     WHERE id = ?`
  )
    .bind(now, id)
    .run();
  await addEvent(env, id, "operator_request_review", "Run sent to human review.");
  const updated = await findRun(env, id);
  return json({ run: toRun(updated!) });
}

async function serveEvidence(env: RunApiEnv, runId: string, nodeId: string) {
  if (!/^run_[a-z0-9]+$/i.test(runId) || !/^page_\d+$/i.test(nodeId)) {
    return json({ error: "Invalid evidence path." }, { status: 400 });
  }
  const run = await findRun(env, runId);
  if (!run || run.synthetic) return json({ error: "Run not found." }, { status: 404 });
  const object = await env.EVIDENCE.get(`runs/${runId}/evidence/${nodeId}`);
  if (!object) return json({ error: "Evidence is unavailable." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-security-policy", "default-src 'none'");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

async function serveReport(env: RunApiEnv, runId: string) {
  if (!/^run_[a-z0-9]+$/i.test(runId)) {
    return json({ error: "Invalid run id." }, { status: 400 });
  }
  const run = await findRun(env, runId);
  if (!run || run.synthetic) return json({ error: "Run not found." }, { status: 404 });
  const object = await env.EVIDENCE.get(`runs/${runId}/report.json`);
  if (!object) return json({ error: "Report is not ready." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set(
    "content-disposition",
    `attachment; filename="formweave-${runId}-report.json"`
  );
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

export async function handleRunApi(
  request: Request,
  env: RunApiEnv
): Promise<
  | Response
  | {
      response: Response;
      background: Promise<void>;
    }
  | null
> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/runs")) return null;
  await ensureSchema(env);

  if (url.pathname === "/api/runs") {
    if (request.method === "GET") return listRuns(env);
    if (request.method === "POST") return createRun(request, env);
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const evidenceMatch = url.pathname.match(
    /^\/api\/runs\/([^/]+)\/evidence\/([^/]+)$/
  );
  if (evidenceMatch && request.method === "GET") {
    return serveEvidence(
      env,
      decodeURIComponent(evidenceMatch[1]),
      decodeURIComponent(evidenceMatch[2])
    );
  }
  const reportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/report$/);
  if (reportMatch && request.method === "GET") {
    return serveReport(env, decodeURIComponent(reportMatch[1]));
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "PATCH") {
    return patchRun(request, env, decodeURIComponent(runMatch[1]));
  }
  return json({ error: "Run API route not found." }, { status: 404 });
}
