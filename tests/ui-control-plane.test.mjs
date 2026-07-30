import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date().toISOString();
const crawlFormId = "form_ui_fixture";
const field = {
  key: "participant_email",
  label: "Participant email",
  control: "email",
  required: true,
  sensitive: true,
  hidden: false,
  options: 0,
  selector: 'input[name="participant_email"]',
  originState: "page_01",
  originUrl: "https://forms.example.test/apply",
  rendered: true,
  testValue: "crawler.user@example.invalid",
  testValues: ["crawler.user@example.invalid"],
  testValueSource: "deterministic",
  entryStatus: "entered",
  sectionText: "Applicant details",
  sectionId: "section_applicant",
};
const hiddenField = {
  key: "csrf_token",
  label: "csrf token",
  control: "hidden",
  required: false,
  sensitive: false,
  hidden: true,
  options: 0,
  selector: 'input[name="csrf_token"]',
  originState: "page_01",
  originUrl: "https://forms.example.test/apply",
  rendered: true,
};
const finding = {
  id: "finding_fixture",
  tone: "success",
  code: "fixture_verified",
  title: "Rendered fixture verified",
  detail: "The browser UI is displaying persisted crawl facts.",
  time: "now",
};
const run = {
  id: "run_ui_fixture",
  name: "UI fixture crawl",
  targetUrl: "https://forms.example.test/apply",
  urls: ["https://forms.example.test/apply"],
  status: "completed",
  stage: "Crawl complete",
  progress: 100,
  mode: "probe",
  browserMode: "headless",
  nodes: [
    {
      id: "page_01",
      step: "01",
      title: "Fixture application",
      subtitle: "200 · 1 form · 1 field",
      fingerprint: "fixtureabc123",
      status: "complete",
      fields: 1,
      branches: 0,
      x: 34,
      y: 146,
      evidence: "/api/runs/run_ui_fixture/evidence/page_01",
      evidenceAvailable: true,
      sourceUrl: "https://forms.example.test/apply",
      pageTitle: "Fixture application",
      httpStatus: 200,
      durationMs: 320,
      forms: 1,
      fieldDetails: [field, hiddenField],
      formActions: [],
      screenshotProvider: "playwright-local-headless",
      stateEvidence: [
        {
          id: "state_01",
          sequence: 1,
          kind: "pre_advance",
          label: "Populated fixture application",
          url: "https://forms.example.test/apply",
          title: "Fixture application",
          fingerprint: "fixturestate123",
          capturedAt: now,
          fieldsVisible: 1,
          values: [
            {
              fieldKey: field.key,
              label: field.label,
              value: field.testValue,
              source: "deterministic",
            },
          ],
          evidence: "/api/runs/run_ui_fixture/evidence/page_01_state_01",
          evidenceAvailable: true,
          screenshotProvider: "playwright-local-headless",
        },
        {
          id: "state_02",
          sequence: 2,
          kind: "selected_branch_populated",
          label: "Final selected branch populated",
          url: "https://forms.example.test/apply",
          title: "Fixture application",
          fingerprint: "fixturestate456",
          capturedAt: now,
          fieldsVisible: 1,
          values: [
            {
              fieldKey: field.key,
              label: field.label,
              value: field.testValue,
              source: "deterministic_replay",
            },
          ],
          evidence: "/api/runs/run_ui_fixture/evidence/page_01_state_02",
          evidenceAvailable: true,
          screenshotProvider: "playwright-local-headless",
        },
      ],
      sensitiveMasks: 0,
      notes: ["Rendered in local Chromium."],
    },
    {
      id: "page_01_state_01",
      step: "01.1",
      title: "Populated fixture application",
      subtitle: "populated · 1 field",
      fingerprint: "fixturestate123",
      status: "complete",
      fields: 1,
      branches: 0,
      x: 258,
      y: 146,
      evidence: "/api/runs/run_ui_fixture/evidence/page_01_state_01",
      evidenceAvailable: true,
      sourceUrl: "https://forms.example.test/apply",
      screenshotProvider: "playwright-local-headless",
      sensitiveMasks: 0,
      notes: ["One synthetic value recorded."],
    },
  ],
  edges: [],
  findings: [finding],
  contract: [field, hiddenField],
  stats: {
    pagesAttempted: 1,
    pagesFetched: 1,
    formsFound: 1,
    fieldsFound: 1,
    screenshotsCaptured: 1,
    statesCaptured: 2,
    fieldsEntered: 1,
    entryFailures: 0,
    branchStates: 0,
    submissionsAttempted: 0,
    submissionsSucceeded: 0,
    bytesFetched: 4096,
    startedAt: now,
    finishedAt: now,
  },
  reportAvailable: true,
  analysisStatus: "skipped",
  artifacts: {
    runDirectory: "C:\\fixture\\run_ui_fixture",
    report: "C:\\fixture\\run_ui_fixture\\report.json",
    events: "C:\\fixture\\run_ui_fixture\\events.jsonl",
    pagesDirectory: "C:\\fixture\\run_ui_fixture\\pages",
    evidenceDirectory: "C:\\fixture\\run_ui_fixture\\evidence",
  },
  synthetic: false,
  liveApproved: false,
  createdAt: now,
  updatedAt: now,
  formIds: [crawlFormId],
};
const report = {
  id: run.id,
  generatedAt: now,
  targets: run.urls,
  stats: run.stats,
  browserMode: "headless",
  executionMode: "probe",
  renderEngine: "playwright-chromium",
  pages: [
    {
      requestedUrl: run.targetUrl,
      finalUrl: run.targetUrl,
      title: "Fixture application",
      heading: "Apply for fixture support",
      httpStatus: 200,
      contentType: "text/html",
      durationMs: 320,
      bytesFetched: 4096,
      fingerprint: "fixtureabc123",
      forms: 1,
      fields: [field, hiddenField],
      formActions: [],
      links: [],
      hasScripts: true,
      screenshotContentType: "image/png",
      screenshotProvider: "playwright-local-headless",
      htmlArtifact: "C:\\fixture\\run_ui_fixture\\pages\\page_01.html",
      screenshotArtifact: "C:\\fixture\\run_ui_fixture\\evidence\\page_01.png",
      rendered: true,
      renderEngine: "playwright-chromium",
      browserMode: "headless",
      sections: [
        {
          id: "section_applicant",
          label: "Applicant details",
          ordinal: 1,
          selector: "form",
          frameUrl: run.targetUrl,
          questionKeys: [field.key],
          guidanceIds: [],
        },
      ],
      stateEvidence: run.nodes[0].stateEvidence,
    },
  ],
  contract: [field, hiddenField],
  findings: [finding],
  analysis: {
    status: "skipped",
    model: "gpt-5.6",
    summary: "",
    pagePurpose: "",
    visibleForms: [],
    inferredFields: [],
    keyFindings: [],
    limitations: ["AI disabled for deterministic UI fixture."],
  },
  formDefinitions: [
    {
      formId: crawlFormId,
      sourceRunId: run.id,
      targetUrl: run.targetUrl,
      title: "Fixture application",
      status: "observed",
      eligibility: {
        status: "eligible",
        reasons: [],
      },
      script: {
        artifactId: "form_ui_artifact",
        scriptVersion: 1,
        sourceHash: "fixture-source-hash",
        path: "C:\\fixture\\generated\\form_ui_artifact\\v1",
      },
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        "x-formweave-contract-version": 3,
        "x-formweave-test-data": {
          [field.key]: field.testValue,
        },
        "x-formweave-test-data-purpose":
          "Synthetic crawl validation values.",
        type: "object",
        properties: {
          [field.key]: {
            type: "string",
            format: "email",
            "x-formweave-label": field.label,
            "x-formweave-control": field.control,
            "x-formweave-sensitive": true,
            "x-formweave-native-name": field.key,
            "x-formweave-options": [],
            "x-formweave-test-value": field.testValue,
            "x-formweave-test-value-source":
              "llm-authored-generated-script",
          },
        },
        required: [field.key],
        additionalProperties: false,
      },
      approvalEndpoint: `/api/forms/${crawlFormId}/approval`,
      runEndpoint: `/api/forms/${crawlFormId}/runs`,
    },
  ],
  artifacts: run.artifacts,
};
const traversalSettings = {
  version: 3,
  cookieConsent: "reject_non_essential",
  acceptCookiesWhenRequired: true,
  closeWelcomeBanners: true,
  dismissOptionalOffers: true,
  dismissOptionalAuth: true,
  expandSafeDisclosures: true,
  advanceIntroScreens: true,
  allowSameOriginReadLikePosts: true,
  pointerAndScrollPriming: true,
  unpredictablePopups: "observe_only",
  captchaPolicy: "detect_and_disqualify",
  enterTestValues: true,
  exerciseBranches: true,
  advanceFormSteps: true,
  stableWindowMs: 700,
  maxStateWaitMs: 12000,
  maxActionsPerPage: 10,
  maxFormStates: 24,
  maxBranchOptionsPerControl: 3,
  agentInstructions:
    "Use obviously synthetic values, exercise safe branch controls, advance intermediate states, and never activate terminal submit in Phase 1 Probe mode.",
  updatedAt: now,
};

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

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test(
  "control-plane renders reports and sends the selected browser visibility mode",
  { timeout: 120_000 },
  async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    const serverOutput = [];
    child.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
    child.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));
    let browser;
    try {
      const appUrl = `http://127.0.0.1:${port}`;
      await waitForHttp(appUrl);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      page.setDefaultTimeout(45_000);
      let launchPayload;
      let savedSettingsPayload;
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      );

      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === "/api/health") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "online",
              runtime: "local-filesystem",
              storageRoot: "C:\\fixture",
              openai: {
                configured: true,
                keySource: "OPENAI_KEY",
                model: "gpt-5.6",
              },
              browser: {
                engine: "playwright-chromium",
                modes: ["headless", "headful"],
              },
              activeCrawls: 0,
            }),
          });
          return;
        }
        if (url.pathname === "/api/runs" && request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ runs: [run] }),
          });
          return;
        }
        if (url.pathname === "/api/settings" && request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              settings: traversalSettings,
              settingsPath: "C:\\fixture\\data\\settings.json",
            }),
          });
          return;
        }
        if (url.pathname === "/api/settings" && request.method() === "PUT") {
          savedSettingsPayload = request.postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              settings: {
                ...savedSettingsPayload.settings,
                updatedAt: new Date().toISOString(),
              },
              settingsPath: "C:\\fixture\\data\\settings.json",
            }),
          });
          return;
        }
        if (url.pathname === "/api/runs" && request.method() === "POST") {
          launchPayload = request.postDataJSON();
          const launched = {
            ...run,
            id: "run_ui_launched",
            name: "forms.example.test crawl",
            status: "running",
            stage: "Queued for local fetch",
            progress: 2,
            mode: launchPayload.mode,
            browserMode: launchPayload.browserMode,
            reportAvailable: false,
            contract: [],
            stats: undefined,
            findings: [],
          };
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({ run: launched }),
          });
          return;
        }
        if (url.pathname === `/api/runs/${run.id}/report`) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(report),
          });
          return;
        }
        if (
          url.pathname === `/api/runs/${run.id}` &&
          request.method() === "GET"
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ run }),
          });
          return;
        }
        if (url.pathname.startsWith(`/api/runs/${run.id}/evidence/`)) {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: png,
          });
          return;
        }
        if (
          url.pathname === `/api/forms/${crawlFormId}` &&
          request.method() === "GET"
        ) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ form: report.formDefinitions[0] }),
          });
          return;
        }
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unhandled UI fixture route" }),
        });
      });

      await page.goto(`${appUrl}/control-plane`, { waitUntil: "networkidle" });
      await assert.doesNotReject(() =>
        page.getByText("1 pages and 1 visible fields captured.").waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("Apply for fixture support").waitFor()
      );

      await page.getByRole("tab", { name: "Traversal" }).click();
      await assert.doesNotReject(() =>
        page
          .getByRole("heading", { name: "State-by-state form verification" })
          .waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("Populated fixture application", { exact: true }).waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("1/1 fields verified", { exact: true }).first().waitFor()
      );
      await assert.doesNotReject(() =>
        page
          .getByText("Synthetic value entered and browser readback verified")
          .last()
          .waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("Required", { exact: true }).last().waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("Sensitive", { exact: true }).last().waitFor()
      );

      await page.getByRole("tab", { name: /Field contract/ }).click();
      await assert.doesNotReject(() =>
        page.getByText("Participant email", { exact: true }).waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("crawler.user@example.invalid", { exact: true }).waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByRole("button", { name: "Show 1 hidden controls" }).waitFor()
      );

      await page.getByRole("tab", { name: "Evidence" }).click();
      await assert.doesNotReject(() =>
        page
          .getByRole("img", { name: "Captured public page for Populated fixture application" })
          .waitFor()
      );
      const evidenceLink = page.getByRole("link", {
        name: "Open full screenshot evidence for Populated fixture application",
      });
      assert.equal(await evidenceLink.count(), 1);
      assert.equal(await evidenceLink.getAttribute("target"), "_blank");
      assert.equal(
        await evidenceLink.getAttribute("href"),
        "/api/runs/run_ui_fixture/evidence/page_01_state_01"
      );
      await assert.doesNotReject(() =>
        page
          .getByText("REAL CAPTURE · 1 SYNTHETIC VALUE RECORDED")
          .first()
          .waitFor()
      );
      const selectedBranchEvidence = page.getByRole("link", {
        name: "Open full screenshot evidence for Final selected branch populated",
      });
      assert.equal(await selectedBranchEvidence.count(), 1);
      assert.equal(
        await selectedBranchEvidence.getAttribute("href"),
        "/api/runs/run_ui_fixture/evidence/page_01_state_02"
      );

      await page.getByRole("tab", { name: /Diagnostics/ }).click();
      await assert.doesNotReject(() =>
        page.getByText("Rendered fixture verified", { exact: true }).waitFor()
      );

      await page.getByRole("button", { name: "Settings" }).click();
      await page
        .getByRole("heading", { name: "Traversal settings", exact: true })
        .waitFor();
      await page.getByLabel("Default response").selectOption("accept_all");
      await page
        .getByText("Close welcome banners", { exact: true })
        .click();
      assert.equal(
        await page.getByLabel(/Close welcome banners/).isChecked(),
        false
      );
      await page.getByRole("button", { name: "Save traversal policy" }).click();
      await page
        .getByText("Traversal policy saved for new crawler sessions.")
        .waitFor();
      assert.equal(savedSettingsPayload.settings.cookieConsent, "accept_all");
      assert.equal(savedSettingsPayload.settings.closeWelcomeBanners, false);
      assert.equal(savedSettingsPayload.settings.captchaPolicy, "detect_and_disqualify");

      await page.getByRole("button", { name: "Runs" }).click();
      await page.getByRole("button", { name: "New crawl" }).click();
      const headful = page.getByRole("button", { name: /Headful/ });
      await headful.click();
      assert.equal(await headful.getAttribute("aria-pressed"), "true");
      await page
        .getByLabel("Form URLs")
        .fill("https://forms.example.test/another-application");
      await page.getByRole("button", { name: /Launch probe/ }).click();
      await page.getByText(/Visible Phase 1 probe launched/).waitFor();
      assert.deepEqual(launchPayload, {
        urls: ["https://forms.example.test/another-application"],
        mode: "probe",
        browserMode: "headful",
        allowLocalTargets: false,
        discoverRelatedPages: true,
        fixtureAuthorities: {
          acknowledgement: false,
          consent: false,
          reviewConfirmation: false,
          signature: false,
          upload: false,
        },
      });

      await page.getByRole("button", { name: "New crawl" }).click();
      assert.equal(
        await page.getByRole("button", { name: /Live submission/ }).count(),
        0
      );
      await page.getByRole("button", { name: /Close launch dialog/ }).click();

      await page.goto(`${appUrl}/api-console`, { waitUntil: "networkidle" });
      await page
        .getByLabel("Run ID returned by crawl kickoff")
        .fill(run.id);
      await page.getByRole("button", { name: /Poll crawl once/ }).click();
      await page.waitForFunction(
        (expectedFormId) =>
          document.querySelector('input[placeholder="form_..."]')?.value ===
          expectedFormId,
        crawlFormId,
      );
      await page.getByRole("button", { name: /Fetch report/ }).click();

      const reportEvidence = page.getByRole("link", {
        name: "Open Populated fixture application evidence in a new tab",
      });
      await reportEvidence.waitFor();
      assert.equal(await reportEvidence.getAttribute("target"), "_blank");
      assert.equal(
        (await reportEvidence.getAttribute("href"))?.endsWith(
          "/api/runs/run_ui_fixture/evidence/page_01_state_01",
        ),
        true,
      );
      await page
        .getByRole("img", {
          name: "Populated fixture application evidence thumbnail",
        })
        .waitFor();
      await page
        .getByRole("heading", { name: "Forms, sections, and fields" })
        .waitFor();
      await page.getByText("Applicant details", { exact: true }).waitFor();
      await page.getByText("Participant email", { exact: true }).waitFor();
      await page.getByText("email", { exact: true }).last().waitFor();
      await page.getByText("required", { exact: true }).last().waitFor();
      await page.getByText("sensitive", { exact: true }).last().waitFor();
      await page.getByRole("button", { name: /Get schema/ }).click();
      await page
        .getByText("1 crawler test value loaded", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator('.api-console-generated-field input[type="email"]')
          .inputValue(),
        field.testValue,
      );
      await page.getByText("Test value", { exact: true }).waitFor();
    } finally {
      await browser?.close();
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      assert.equal(child.exitCode === 0 || child.killed, true, serverOutput.join(""));
    }
  }
);
