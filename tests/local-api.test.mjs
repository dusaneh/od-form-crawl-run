import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "../test-sites/server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForJson(url, predicate = () => true, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const value = await response.json();
        if (predicate(value)) return value;
      } else {
        lastError = new Error(`${url} returned ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

test(
  "local API persists browser reports, evidence, logs, and reconciles interrupted runs",
  { timeout: 120_000 },
  async () => {
    const fixture = await startFixtureServer();
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "formweave-api-"));
    const dataRoot = path.join(tempRoot, "data");
    const interruptedId = "run_recovertest";
    const interruptedDirectory = path.join(dataRoot, "runs", interruptedId);
    await mkdir(interruptedDirectory, { recursive: true });
    await writeFile(
      path.join(interruptedDirectory, "run.json"),
      `${JSON.stringify(
        {
          id: interruptedId,
          name: "Interrupted fixture crawl",
          targetUrl: `${fixture.origin}/fixtures/start`,
          urls: [`${fixture.origin}/fixtures/start`],
          status: "running",
          stage: "Rendering",
          progress: 44,
          mode: "crawl",
          browserMode: "headless",
          nodes: [],
          edges: [],
          findings: [],
          contract: [],
          reportAvailable: false,
          analysisStatus: "pending",
          synthetic: false,
          liveApproved: false,
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          updatedAt: new Date(Date.now() - 30_000).toISOString(),
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const port = await freePort();
    const output = [];
    const child = spawn(process.execPath, ["local/server.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        FORMWEAVE_API_HOST: "127.0.0.1",
        FORMWEAVE_API_PORT: String(port),
        FORMWEAVE_DATA_DIR: dataRoot,
        FORMWEAVE_ALLOW_LOCAL_TARGETS: "1",
        FORMWEAVE_DISABLE_OPENAI: "1",
        OPENAI_KEY: "",
        OPENAI_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const health = await waitForJson(`${baseUrl}/api/health`);
      assert.equal(health.browser.engine, "playwright-chromium");
      assert.deepEqual(health.browser.modes, ["headless", "headful"]);
      const corsResponse = await fetch(`${baseUrl}/api/health`, {
        headers: { origin: "http://127.0.0.1:3000" },
      });
      assert.equal(
        corsResponse.headers.get("access-control-allow-origin"),
        "http://127.0.0.1:3000"
      );

      const reconciled = JSON.parse(
        await readFile(path.join(interruptedDirectory, "run.json"), "utf8")
      );
      assert.equal(reconciled.status, "failed");
      assert.equal(reconciled.progress, 100);
      assert.ok(
        reconciled.findings.some((finding) => finding.code === "crawl_interrupted")
      );

      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/start`],
          mode: "crawl",
          browserMode: "headless",
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      const runId = created.run.id;
      assert.equal(created.run.browserMode, "headless");

      const list = await waitForJson(
        `${baseUrl}/api/runs`,
        (value) =>
          value.runs.some(
            (run) =>
              run.id === runId && ["completed", "failed"].includes(run.status)
          )
      );
      const finished = list.runs.find((run) => run.id === runId);
      assert.equal(finished.status, "completed", output.join(""));
      assert.equal(finished.reportAvailable, true);
      assert.ok(finished.stats.pagesFetched >= 7);
      assert.equal(
        finished.stats.screenshotsCaptured,
        finished.stats.pagesFetched
      );

      const runDirectory = path.join(dataRoot, "runs", runId);
      const report = JSON.parse(
        await readFile(path.join(runDirectory, "report.json"), "utf8")
      );
      assert.equal(report.browserMode, "headless");
      assert.equal(report.renderEngine, "playwright-chromium");
      assert.ok(report.pages.every((page) => page.screenshotArtifact));
      assert.ok(report.pages.every((page) => page.htmlArtifact));
      assert.ok(
        report.contract.some((field) => field.label === "Participant email")
      );
      assert.ok(
        report.contract.some((field) => field.label === "Member number")
      );
      assert.ok(report.contract.some((field) => field.label === "Case ID"));

      const events = await readFile(
        path.join(runDirectory, "events.jsonl"),
        "utf8"
      );
      assert.match(events, /"kind":"browser_launched"/);
      assert.match(events, /"kind":"evidence_captured"/);
      assert.match(events, /"kind":"crawl_completed"/);

      const writesAtServer = fixture.requests.filter(
        (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method)
      );
      assert.deepEqual(writesAtServer, []);
    } finally {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      await fixture.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
);
