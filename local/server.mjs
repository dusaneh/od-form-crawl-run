import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crawlTargets, validateTargetUrl } from "../worker/crawler.ts";
import { analyzeCrawl, openAIConfiguration } from "./openai-analysis.mjs";

const localDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(localDirectory, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const source = readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(projectRoot, ".env"));

const port = Number.parseInt(process.env.FORMWEAVE_API_PORT || "8787", 10);
const host = process.env.FORMWEAVE_API_HOST || "127.0.0.1";
const dataRoot = path.resolve(
  projectRoot,
  process.env.FORMWEAVE_DATA_DIR || "data"
);
const runsRoot = path.join(dataRoot, "runs");
const logsRoot = path.join(dataRoot, "logs");
const aggregateLogPath = path.join(logsRoot, "crawler.jsonl");
const runningTasks = new Map();

await Promise.all([
  mkdir(runsRoot, { recursive: true }),
  mkdir(logsRoot, { recursive: true }),
]);

function runDirectory(runId) {
  if (!/^run_[a-z0-9]+$/i.test(runId)) throw new Error("Invalid run id.");
  return path.join(runsRoot, runId);
}

function artifactsFor(runId) {
  const directory = runDirectory(runId);
  return {
    runDirectory: directory,
    report: path.join(directory, "report.json"),
    events: path.join(directory, "events.jsonl"),
    pagesDirectory: path.join(directory, "pages"),
    evidenceDirectory: path.join(directory, "evidence"),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !/(key|token|secret|authorization|base64|image)/i.test(key)
    )
  );
}

async function logEvent(runId, kind, message, metadata = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    runId,
    kind,
    message,
    metadata: safeMetadata(metadata),
  };
  const line = `${JSON.stringify(event)}\n`;
  await mkdir(runDirectory(runId), { recursive: true });
  await Promise.all([
    appendFile(path.join(runDirectory(runId), "events.jsonl"), line, "utf8"),
    appendFile(aggregateLogPath, line, "utf8"),
  ]);
  console.log(
    `[${event.timestamp}] ${runId} ${kind}: ${message}`,
    Object.keys(event.metadata).length ? event.metadata : ""
  );
}

function apiHeaders(request, extra = {}) {
  const origin = request.headers.origin;
  const allowed =
    !origin ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
  return {
    "access-control-allow-origin": allowed && origin ? origin : "http://localhost:3000",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function jsonResponse(request, value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: apiHeaders(request, {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 100_000) throw new Error("Request body is too large.");
  return text ? JSON.parse(text) : {};
}

async function listRuns() {
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs = [];
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^run_[a-z0-9]+$/i.test(entry.name))
      .map(async (entry) => {
        try {
          runs.push(await readJson(path.join(runsRoot, entry.name, "run.json")));
        } catch {
          // An incomplete directory is ignored but remains available for inspection.
        }
      })
  );
  return runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function initialRun(id, urls, name, mode, now) {
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
  return {
    id,
    name,
    targetUrl: urls[0],
    urls,
    status: "running",
    stage: "Queued for local fetch",
    progress: 2,
    mode,
    nodes,
    edges: [],
    findings: [
      {
        id: `${id}_queued`,
        tone: "info",
        code: "crawl_queued",
        title: "Local crawl queued",
        detail: `${urls.length} public target${urls.length === 1 ? "" : "s"} will be fetched without entering or submitting data.`,
        time: "now",
      },
    ],
    contract: [],
    reportAvailable: false,
    analysisStatus: "pending",
    artifacts: artifactsFor(id),
    synthetic: false,
    liveApproved: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function saveRun(run) {
  await writeJson(path.join(runDirectory(run.id), "run.json"), run);
}

async function updateRun(run, patch) {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  await saveRun(run);
}

function extensionFor(contentType) {
  if (/jpe?g/i.test(contentType || "")) return ".jpg";
  if (/webp/i.test(contentType || "")) return ".webp";
  return ".png";
}

async function executeCrawl(run) {
  const startedAt = run.createdAt;
  const artifacts = artifactsFor(run.id);
  try {
    await Promise.all([
      mkdir(artifacts.pagesDirectory, { recursive: true }),
      mkdir(artifacts.evidenceDirectory, { recursive: true }),
    ]);
    await logEvent(
      run.id,
      "crawl_started",
      `Fetching ${run.urls.length} public target${run.urls.length === 1 ? "" : "s"}.`
    );
    await updateRun(run, { progress: 8, stage: "Fetching target HTML" });

    const output = await crawlTargets(run.urls, run.id, async ({ pages, queued }) => {
      await updateRun(run, {
        progress: Math.min(78, 12 + pages * 6),
        stage: `Fetched ${pages} page${pages === 1 ? "" : "s"} · ${queued} queued`,
      });
      await logEvent(run.id, "crawl_progress", "Crawl batch completed.", {
        pages,
        queued,
      });
    });
    await updateRun(run, { progress: 82, stage: "Persisting local evidence" });

    let screenshotsCaptured = 0;
    const reportPages = [];
    for (let index = 0; index < output.pages.length; index += 1) {
      const page = output.pages[index];
      const node = output.nodes[index];
      const pageNumber = String(index + 1).padStart(2, "0");
      let htmlArtifact;
      let screenshotArtifact;

      if (page.html) {
        htmlArtifact = path.join(artifacts.pagesDirectory, `page_${pageNumber}.html`);
        await writeFile(htmlArtifact, page.html, "utf8");
        await logEvent(run.id, "html_stored", `Stored returned HTML for ${page.finalUrl}.`, {
          path: htmlArtifact,
          bytes: page.bytesFetched,
        });
      }
      if (page.screenshot) {
        screenshotArtifact = path.join(
          artifacts.evidenceDirectory,
          `${node.id}${extensionFor(page.screenshotContentType)}`
        );
        await writeFile(screenshotArtifact, page.screenshot);
        screenshotsCaptured += 1;
        node.evidence = `/api/runs/${encodeURIComponent(run.id)}/evidence/${encodeURIComponent(node.id)}`;
        node.evidenceAvailable = true;
        await logEvent(
          run.id,
          "evidence_captured",
          `Stored screenshot evidence for ${page.finalUrl}.`,
          {
            path: screenshotArtifact,
            provider: page.screenshotProvider || "unknown",
          }
        );
      }

      const { screenshot, html, ...reportPage } = page;
      void screenshot;
      void html;
      reportPages.push({ ...reportPage, htmlArtifact, screenshotArtifact });
    }

    const fetchedPages = output.pages.filter((page) => !page.error);
    const finishedAt = new Date().toISOString();
    const stats = {
      pagesAttempted: output.pages.length,
      pagesFetched: fetchedPages.length,
      formsFound: fetchedPages.reduce((sum, page) => sum + page.forms, 0),
      fieldsFound: output.contract.filter((field) => !field.hidden).length,
      screenshotsCaptured,
      bytesFetched: fetchedPages.reduce((sum, page) => sum + page.bytesFetched, 0),
      startedAt,
      finishedAt,
    };

    await updateRun(run, {
      progress: 88,
      stage: "Analyzing crawl with OpenAI",
      nodes: output.nodes,
      edges: output.edges,
      findings: output.findings,
      contract: output.contract,
      stats,
    });
    const analysis = await analyzeCrawl(output.pages, (kind, message, metadata) =>
      logEvent(run.id, kind, message, metadata)
    );

    const analysisFindings = analysis.keyFindings.map((finding, index) => ({
      id: `${run.id}_analysis_${index}`,
      code: "openai_analysis",
      time: "now",
      ...finding,
    }));
    const findings = [...output.findings, ...analysisFindings];
    if (analysis.status === "failed") {
      findings.push({
        id: `${run.id}_analysis_failed`,
        tone: "warning",
        code: "openai_analysis_failed",
        title: "AI enrichment unavailable",
        detail: analysis.error,
        time: "now",
      });
    }

    const report = {
      id: run.id,
      generatedAt: finishedAt,
      targets: run.urls,
      stats,
      pages: reportPages,
      contract: output.contract,
      findings,
      analysis,
      artifacts,
    };
    await writeJson(artifacts.report, report);
    const allFailed = fetchedPages.length === 0;
    await updateRun(run, {
      status: allFailed ? "failed" : "completed",
      stage: allFailed ? "Crawl failed" : "Crawl complete",
      progress: 100,
      findings,
      reportAvailable: true,
      analysisStatus: analysis.status,
    });
    await logEvent(
      run.id,
      allFailed ? "crawl_failed" : "crawl_completed",
      allFailed
        ? "Every target failed; the report and logs were retained."
        : `Stored ${stats.fieldsFound} visible fields, ${screenshotsCaptured} screenshots, and the complete report locally.`,
      { report: artifacts.report }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The local crawl failed unexpectedly.";
    const finding = {
      id: `${run.id}_local_failed`,
      tone: "danger",
      code: "local_crawl_failed",
      title: "Local crawl failed",
      detail: message,
      time: "now",
    };
    await updateRun(run, {
      status: "failed",
      stage: "Crawl failed",
      progress: 100,
      findings: [...run.findings, finding],
      analysisStatus: "failed",
    });
    await logEvent(run.id, "crawl_failed", message);
  } finally {
    runningTasks.delete(run.id);
  }
}

async function createRun(request) {
  const payload = await bodyJson(request);
  const rawUrls = (payload.urls || [])
    .map((url) => String(url).trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!rawUrls.length) {
    return jsonResponse(request, { error: "At least one public URL is required." }, 400);
  }
  let urls;
  try {
    urls = [...new Set(rawUrls.map(validateTargetUrl))];
  } catch (error) {
    return jsonResponse(
      request,
      { error: error instanceof Error ? error.message : "A target URL is invalid." },
      400
    );
  }

  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const now = new Date().toISOString();
  const name =
    String(payload.name || "").trim().slice(0, 120) ||
    `${new URL(urls[0]).hostname.replace(/^www\./, "")} crawl`;
  const run = initialRun(
    id,
    urls,
    name,
    payload.mode === "dry_run" ? "dry_run" : "crawl",
    now
  );
  await mkdir(runDirectory(id), { recursive: true });
  await saveRun(run);
  await logEvent(id, "run_created", "Created a filesystem-backed local crawl.", {
    targets: urls.length,
  });
  const task = executeCrawl(run);
  runningTasks.set(id, task);
  return jsonResponse(request, { run }, 201);
}

async function serveFile(request, filePath, contentType, downloadName) {
  try {
    const body = await readFile(filePath);
    const disposition = downloadName
      ? `attachment; filename="${downloadName.replaceAll('"', "")}"`
      : "inline";
    return new Response(body, {
      headers: apiHeaders(request, {
        "content-type": contentType,
        "content-disposition": disposition,
      }),
    });
  } catch {
    return jsonResponse(request, { error: "Artifact is unavailable." }, 404);
  }
}

async function route(request) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: apiHeaders(request) });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    const openai = openAIConfiguration();
    return jsonResponse(request, {
      status: "online",
      runtime: "local-filesystem",
      storageRoot: dataRoot,
      openai: {
        configured: openai.configured,
        keySource: openai.keySource,
        model: openai.model,
      },
      activeCrawls: runningTasks.size,
    });
  }
  if (url.pathname === "/api/runs" && request.method === "GET") {
    return jsonResponse(request, { runs: await listRuns() });
  }
  if (url.pathname === "/api/runs" && request.method === "POST") {
    return createRun(request);
  }

  const evidenceMatch = url.pathname.match(
    /^\/api\/runs\/([^/]+)\/evidence\/([^/]+)$/
  );
  if (evidenceMatch && request.method === "GET") {
    const runId = decodeURIComponent(evidenceMatch[1]);
    const nodeId = decodeURIComponent(evidenceMatch[2]);
    if (!/^page_\d+$/i.test(nodeId)) {
      return jsonResponse(request, { error: "Invalid evidence id." }, 400);
    }
    const directory = artifactsFor(runId).evidenceDirectory;
    const entries = await readdir(directory).catch(() => []);
    const name = entries.find((entry) => entry.startsWith(`${nodeId}.`));
    if (!name) return jsonResponse(request, { error: "Evidence is unavailable." }, 404);
    const extension = path.extname(name).toLowerCase();
    const contentType =
      extension === ".jpg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    return serveFile(request, path.join(directory, name), contentType);
  }

  const reportMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/report$/);
  if (reportMatch && request.method === "GET") {
    const runId = decodeURIComponent(reportMatch[1]);
    return serveFile(
      request,
      artifactsFor(runId).report,
      "application/json; charset=utf-8",
      url.searchParams.get("download") === "1"
        ? `formweave-${runId}-report.json`
        : undefined
    );
  }

  const logsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
  if (logsMatch && request.method === "GET") {
    const runId = decodeURIComponent(logsMatch[1]);
    return serveFile(
      request,
      artifactsFor(runId).events,
      "application/x-ndjson; charset=utf-8",
      url.searchParams.get("download") === "1"
        ? `formweave-${runId}-events.jsonl`
        : undefined
    );
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && request.method === "PATCH") {
    const runId = decodeURIComponent(runMatch[1]);
    const filePath = path.join(runDirectory(runId), "run.json");
    try {
      const run = await readJson(filePath);
      const payload = await bodyJson(request);
      if (payload.action !== "request_review") {
        return jsonResponse(request, { error: "Unsupported run action." }, 400);
      }
      await updateRun(run, {
        status: "awaiting_review",
        stage: "Human review requested",
      });
      await logEvent(runId, "operator_request_review", "Run sent to human review.");
      return jsonResponse(request, { run });
    } catch {
      return jsonResponse(request, { error: "Run not found." }, 404);
    }
  }

  return jsonResponse(request, { error: "Local API route not found." }, 404);
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers,
      body:
        incoming.method === "GET" || incoming.method === "HEAD"
          ? undefined
          : await new Response(incoming).arrayBuffer(),
    });
    const response = await route(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local API error.";
    const response = jsonResponse(
      new Request(`http://${incoming.headers.host || `${host}:${port}`}/`),
      { error: message },
      500
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(await response.text());
  }
});

server.listen(port, host, () => {
  const openai = openAIConfiguration();
  console.log(`FormWeave local API: http://${host}:${port}`);
  console.log(`Local artifacts: ${dataRoot}`);
  console.log(
    `OpenAI analysis: ${openai.configured ? `configured via ${openai.keySource}` : "not configured"} · ${openai.model}`
  );
});
