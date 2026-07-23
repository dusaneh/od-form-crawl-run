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
  { timeout: 180_000 },
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
      assert.equal(health.traversalSettingsVersion, 2);
      const corsResponse = await fetch(`${baseUrl}/api/health`, {
        headers: { origin: "http://127.0.0.1:3000" },
      });
      assert.equal(
        corsResponse.headers.get("access-control-allow-origin"),
        "http://127.0.0.1:3000"
      );
      assert.match(
        corsResponse.headers.get("access-control-allow-methods"),
        /PUT/
      );

      const settingsResponse = await fetch(`${baseUrl}/api/settings`);
      assert.equal(settingsResponse.status, 200);
      const settingsPayload = await settingsResponse.json();
      assert.equal(settingsPayload.settings.cookieConsent, "reject_non_essential");
      assert.equal(settingsPayload.settings.captchaPolicy, "detect_and_handoff");
      assert.equal(settingsPayload.settings.maxStateWaitMs, 12000);
      assert.equal(settingsPayload.settings.enterTestValues, true);
      assert.equal(settingsPayload.settings.exerciseBranches, true);
      assert.equal(settingsPayload.settings.advanceFormSteps, true);
      assert.equal(settingsPayload.settings.maxFormStates, 24);
      assert.match(settingsPayload.settings.agentInstructions, /synthetic/i);
      assert.equal(
        settingsPayload.settingsPath,
        path.join(dataRoot, "settings.json")
      );

      const saveSettingsResponse = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          settings: {
            ...settingsPayload.settings,
            stableWindowMs: 300,
            maxStateWaitMs: 3_000,
            maxFormStates: 8,
            maxBranchOptionsPerControl: 2,
            captchaPolicy: "click_and_bypass",
          },
        }),
      });
      assert.equal(saveSettingsResponse.status, 200);
      const savedSettings = await saveSettingsResponse.json();
      assert.equal(savedSettings.settings.stableWindowMs, 300);
      assert.equal(savedSettings.settings.captchaPolicy, "detect_and_handoff");
      assert.ok(savedSettings.settings.updatedAt);

      const reconciled = JSON.parse(
        await readFile(path.join(interruptedDirectory, "run.json"), "utf8")
      );
      assert.equal(reconciled.status, "failed");
      assert.equal(reconciled.progress, 100);
      assert.ok(
        reconciled.findings.some((finding) => finding.code === "crawl_interrupted")
      );

      const unapprovedLiveResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/conditional-wizard`],
          mode: "live",
          browserMode: "headless",
        }),
      });
      assert.equal(unapprovedLiveResponse.status, 400);

      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/start`],
          mode: "dry_run",
          browserMode: "headless",
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      const runId = created.run.id;
      assert.equal(created.run.browserMode, "headless");
      assert.equal(created.run.mode, "dry_run");
      assert.equal(created.run.liveApproved, false);
      assert.equal(created.run.traversalSettings.stableWindowMs, 300);

      const list = await waitForJson(
        `${baseUrl}/api/runs`,
        (value) =>
          value.runs.some(
            (run) =>
              run.id === runId &&
              ["completed", "awaiting_review", "failed"].includes(run.status)
          )
      );
      const finished = list.runs.find((run) => run.id === runId);
      assert.equal(finished.status, "awaiting_review", output.join(""));
      assert.equal(finished.reportAvailable, true);
      assert.ok(finished.stats.pagesFetched >= 9);
      assert.ok(
        finished.stats.screenshotsCaptured > finished.stats.pagesFetched
      );
      assert.ok(finished.stats.automationActions >= 5);
      assert.ok(finished.stats.stateExaminations >= finished.stats.pagesFetched);
      assert.ok(finished.stats.statesCaptured >= 6);
      assert.ok(finished.stats.fieldsEntered >= 6);
      assert.ok(finished.stats.branchStates >= 2);
      assert.equal(finished.stats.submissionsAttempted, 0);
      assert.ok(finished.stats.allowedReadLikeRequests >= 1);
      assert.ok(finished.stats.blockedWriteRequests >= 1);
      assert.equal(finished.stats.captchaPages, 1);

      const runDirectory = path.join(dataRoot, "runs", runId);
      const report = JSON.parse(
        await readFile(path.join(runDirectory, "report.json"), "utf8")
      );
      assert.equal(report.browserMode, "headless");
      assert.equal(report.executionMode, "dry_run");
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
      assert.ok(
        report.contract.some(
          (field) => field.label === "Application reference"
        )
      );
      assert.equal(report.traversalSettings.stableWindowMs, 300);
      assert.ok(report.pages.some((page) => page.captchaDetected));
      const wizardPage = report.pages.find(
        (page) =>
          new URL(page.finalUrl).pathname === "/fixtures/conditional-wizard"
      );
      assert.notEqual(wizardPage.finalSubmission, "submitted");
      assert.ok(wizardPage.stateEvidence.length >= 6);
      assert.ok(
        wizardPage.stateEvidence.every(
          (state) =>
            state.screenshotArtifact &&
            state.evidence &&
            !Object.hasOwn(state, "screenshot")
        )
      );

      const firstStateEvidence = wizardPage.stateEvidence[0];
      const stateEvidenceResponse = await fetch(
        `${baseUrl}${firstStateEvidence.evidence}`
      );
      assert.equal(stateEvidenceResponse.status, 200);
      assert.match(
        stateEvidenceResponse.headers.get("content-type"),
        /image\/png/
      );

      const events = await readFile(
        path.join(runDirectory, "events.jsonl"),
        "utf8"
      );
      assert.match(events, /"kind":"browser_launched"/);
      assert.match(events, /"kind":"evidence_captured"/);
      assert.match(events, /"kind":"automation_action_completed"/);
      assert.match(events, /"kind":"read_like_post_allowed"/);
      assert.match(events, /"kind":"captcha_handoff_required"/);
      assert.match(events, /"kind":"field_entry_completed"/);
      assert.match(events, /"kind":"state_evidence_captured"/);
      assert.match(events, /"kind":"final_submission_blocked"/);
      assert.match(events, /"kind":"crawl_needs_review"/);

      const nonReadRequests = fixture.requests.filter(
        (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method)
      );
      assert.ok(
        nonReadRequests.some(
          (request) =>
            request.method === "POST" && request.path === "/fixtures/aura"
        )
      );
      assert.ok(
        nonReadRequests.some(
          (request) =>
            request.method === "POST" && request.path === "/fixtures/autosave"
        )
      );
      assert.ok(
        nonReadRequests.every(
          (request) =>
            request.path === "/fixtures/aura" ||
            request.path === "/fixtures/autosave"
        )
      );
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
