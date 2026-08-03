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

async function waitForJson(url, predicate = () => true, timeoutMs = 180_000) {
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
  { timeout: 300_000 },
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
        FORMWEAVE_STORAGE: "filesystem",
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
      assert.equal(health.generationMode, "reuse_or_generate");
      assert.equal(health.traversalSettingsVersion, 4);
      const localAuditResponse = await fetch(`${baseUrl}/api/ops/audit`, {
        headers: {
          "x-formweave-auth-mechanism": "session",
          "x-formweave-auth-principal": "spoofed@example.test",
        },
      });
      assert.equal(localAuditResponse.status, 403);
      assert.equal(
        (await localAuditResponse.json()).code,
        "admin_required",
      );
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
      assert.equal(settingsPayload.settings.captchaPolicy, "detect_and_disqualify");
      assert.equal(settingsPayload.settings.maxStateWaitMs, 12000);
      assert.equal(settingsPayload.settings.enterTestValues, true);
      assert.equal(settingsPayload.settings.exerciseBranches, true);
      assert.equal(settingsPayload.settings.advanceFormSteps, true);
      assert.equal(settingsPayload.settings.maxFormStates, 24);
      assert.match(settingsPayload.settings.agentInstructions, /synthetic/i);
      assert.match(settingsPayload.settings.agentInstructions, /OneDegree/i);
      assert.match(
        settingsPayload.settings.agentInstructions,
        /exactly one public form journey/i,
      );
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
            maxFormStates: 24,
            maxBranchOptionsPerControl: 2,
            captchaPolicy: "click_and_bypass",
          },
        }),
      });
      assert.equal(saveSettingsResponse.status, 200);
      const savedSettings = await saveSettingsResponse.json();
      assert.equal(savedSettings.settings.stableWindowMs, 300);
      assert.equal(savedSettings.settings.captchaPolicy, "detect_and_disqualify");
      assert.ok(savedSettings.settings.updatedAt);

      const remoteCaptureResponse = await fetch(
        `${baseUrl}/api/fixture-submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            captureBaseUrl: "https://example.com/site_af_branch_cards",
            action: "latest",
          }),
        },
      );
      assert.equal(remoteCaptureResponse.status, 400);
      assert.equal(
        (await remoteCaptureResponse.json()).code,
        "invalid_capture_target",
      );

      const invalidCaptureActionResponse = await fetch(
        `${baseUrl}/api/fixture-submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            captureBaseUrl:
              "http://127.0.0.1:9000/site_af_branch_cards",
            action: "submit",
          }),
        },
      );
      assert.equal(invalidCaptureActionResponse.status, 400);
      assert.equal(
        (await invalidCaptureActionResponse.json()).code,
        "invalid_capture_target",
      );

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

      const multipleTargetsResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [
            "https://example.com/application",
            "https://example.org/intake",
          ],
          mode: "probe",
        }),
      });
      assert.equal(multipleTargetsResponse.status, 400);
      assert.equal(
        (await multipleTargetsResponse.json()).code,
        "single_target_required",
      );

      const retiredDiscoveryResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: ["https://example.com/application"],
          mode: "probe",
          discoverRelatedPages: true,
        }),
      });
      assert.equal(retiredDiscoveryResponse.status, 400);
      assert.equal(
        (await retiredDiscoveryResponse.json()).code,
        "related_page_discovery_disabled",
      );

      const blockedLocalResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/start`],
          mode: "probe",
          browserMode: "headless",
        }),
      });
      assert.equal(blockedLocalResponse.status, 400);
      assert.match(
        (await blockedLocalResponse.json()).error,
        /Private-network targets are not allowed/
      );

      const createResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/semantic-application`],
          mode: "probe",
          browserMode: "headless",
          allowLocalTargets: true,
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      const runId = created.run.id;
      assert.equal(created.run.browserMode, "headless");
      assert.equal(created.run.mode, "probe");
      assert.equal(created.run.submit, false);
      assert.deepEqual(created.run.componentAuthorities, {
        acknowledgement: false,
        consent: false,
        reviewConfirmation: false,
        signature: false,
        upload: false,
      });
      assert.equal(created.run.liveApproved, false);
      assert.equal(created.run.allowLocalTargets, true);
      assert.equal(created.run.traversalSettings.stableWindowMs, 300);

      const busyResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/start`],
          mode: "probe",
          browserMode: "headless",
          allowLocalTargets: true,
        }),
      });
      assert.equal(busyResponse.status, 429);
      const busy = await busyResponse.json();
      assert.equal(busy.code, "crawl_capacity_reached");
      assert.equal(busy.limit, 1);
      assert.deepEqual(busy.activeRun, { id: runId, kind: "crawl" });

      const busyHealth = await waitForJson(
        `${baseUrl}/api/health`,
        (value) => value.activeBrowserRuns === 1,
      );
      assert.equal(busyHealth.browserRunLimit, 1);

      const createdStatusResponse = await fetch(
        `${baseUrl}/api/runs/${runId}`
      );
      assert.equal(createdStatusResponse.status, 200);
      const createdStatus = await createdStatusResponse.json();
      assert.equal(createdStatus.run.id, runId);

      const missingStatusResponse = await fetch(
        `${baseUrl}/api/runs/run_doesnotexist`
      );
      assert.equal(missingStatusResponse.status, 404);

      const list = await waitForJson(
        `${baseUrl}/api/runs`,
        (value) =>
          value.runs.some(
            (run) =>
              run.id === runId &&
              ["completed", "awaiting_review", "disqualified", "failed"].includes(run.status)
          )
      );
      const finished = list.runs.find((run) => run.id === runId);
      assert.equal(finished.status, "awaiting_review", output.join(""));
      assert.equal(finished.reportAvailable, true);
      assert.equal(finished.stats.pagesFetched, 1);
      assert.ok(
        finished.stats.screenshotsCaptured >= finished.stats.pagesFetched
      );
      assert.equal(finished.stats.automationActions, 0);
      assert.ok(finished.stats.stateExaminations >= finished.stats.pagesFetched);
      assert.equal(finished.stats.statesCaptured, 0);
      assert.equal(finished.stats.fieldsEntered, 0);
      assert.equal(finished.stats.branchStates, 0);
      assert.equal(finished.stats.submissionsAttempted, 0);
      assert.equal(finished.stats.allowedReadLikeRequests, 0);
      assert.equal(finished.stats.blockedWriteRequests, 0);
      assert.equal(finished.stats.captchaPages, 0);

      const runDirectory = path.join(dataRoot, "runs", runId);
      const report = JSON.parse(
        await readFile(path.join(runDirectory, "report.json"), "utf8")
      );
      assert.equal(report.browserMode, "headless");
      assert.equal(report.executionMode, "probe");
      assert.equal(report.renderEngine, "playwright-chromium");
      assert.equal(report.evidencePolicy.mode, "key_moments");
      assert.equal(
        report.evidencePolicy.transientModelScreenshotsPersisted,
        false,
      );
      assert.ok(report.pages.every((page) => page.screenshotArtifact));
      assert.ok(report.pages.every((page) => page.htmlArtifact));
      assert.ok(
        report.contract.some((field) => field.label === "Legal name")
      );
      assert.ok(
        report.contract.some((field) => field.label === "Email address")
      );
      assert.equal(report.traversalSettings.stableWindowMs, 300);
      assert.ok(report.pages.every((page) => !page.captchaDetected));
      assert.equal(report.pages[0].finalSubmission, "not_requested");
      assert.equal(report.pages[0].stateEvidence.length, 0);
      assert.equal(report.pages[0].certificationStatus, "script_missing");

      const generatedEvidenceBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      await writeFile(
        path.join(
          runDirectory,
          "evidence",
          "page_01_generated_03_populated.png"
        ),
        generatedEvidenceBytes
      );
      const generatedEvidenceResponse = await fetch(
        `${baseUrl}/api/runs/${runId}/evidence/page_01_generated_03_populated`
      );
      assert.equal(generatedEvidenceResponse.status, 200);
      assert.equal(
        generatedEvidenceResponse.headers.get("content-type"),
        "image/png"
      );
      assert.deepEqual(
        Buffer.from(await generatedEvidenceResponse.arrayBuffer()),
        generatedEvidenceBytes
      );

      const servedReportResponse = await fetch(
        `${baseUrl}/api/runs/${runId}/report`
      );
      assert.equal(servedReportResponse.status, 200);
      const servedReport = await servedReportResponse.json();
      assert.deepEqual(servedReport.architectureExchanges, []);
      assert.equal(servedReport.runnerJourney.available, false);
      assert.match(
        servedReport.runnerJourney.summary,
        /No executable LLM-authored script/i,
      );

      const events = await readFile(
        path.join(runDirectory, "events.jsonl"),
        "utf8"
      );
      assert.match(events, /"kind":"browser_launched"/);
      assert.match(events, /"kind":"browser_closed"/);
      assert.match(events, /"kind":"evidence_captured"/);
      assert.match(events, /"kind":"recon_script_missing"/);
      assert.doesNotMatch(events, /"kind":"automation_action_completed"/);
      assert.doesNotMatch(events, /"kind":"field_entry_completed"/);
      assert.doesNotMatch(events, /"kind":"state_evidence_captured"/);
      assert.doesNotMatch(events, /"kind":"final_submission_blocked"/);
      assert.match(events, /"kind":"crawl_needs_review"/);

      const idleHealth = await waitForJson(
        `${baseUrl}/api/health`,
        (value) =>
          value.activeCrawls === 0 && value.activeBrowserRuns === 0,
      );
      assert.equal(idleHealth.activeExecutions, 0);

      const nonReadRequests = fixture.requests.filter(
        (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method)
      );
      assert.deepEqual(nonReadRequests, []);

      const publicSubmitWithoutModel = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: ["https://example.com/form"],
          mode: "probe",
          submit: true,
          browserMode: "headless",
          allowLocalTargets: false,
          componentAuthorities: {
            consent: true,
          },
        }),
      });
      assert.equal(publicSubmitWithoutModel.status, 409);
      const publicSubmitError = await publicSubmitWithoutModel.json();
      assert.equal(publicSubmitError.code, "script_missing");
      assert.match(publicSubmitError.error, /crawl-time submission is disabled/i);

      const fixtureSubmitResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: [`${fixture.origin}/fixtures/conditional-wizard`],
          mode: "fixture_submit",
          browserMode: "headless",
          allowLocalTargets: true,
        }),
      });
      assert.equal(fixtureSubmitResponse.status, 409);
      const fixtureSubmitError = await fixtureSubmitResponse.json();
      assert.equal(fixtureSubmitError.code, "script_missing");
      assert.match(fixtureSubmitError.error, /submission is disabled/i);
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
