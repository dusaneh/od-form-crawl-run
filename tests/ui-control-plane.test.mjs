import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date().toISOString();
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
  mode: "crawl",
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
      sensitiveMasks: 0,
      notes: ["Rendered in local Chromium."],
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
};
const report = {
  id: run.id,
  generatedAt: now,
  targets: run.urls,
  stats: run.stats,
  browserMode: "headless",
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
  artifacts: run.artifacts,
};
const traversalSettings = {
  version: 1,
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
  captchaPolicy: "detect_and_handoff",
  stableWindowMs: 700,
  maxStateWaitMs: 12000,
  maxActionsPerPage: 10,
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

      await page.route("http://127.0.0.1:8787/**", async (route) => {
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
        if (url.pathname === `/api/runs/${run.id}/evidence/page_01`) {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: png,
          });
          return;
        }
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unhandled UI fixture route" }),
        });
      });

      await page.goto(appUrl, { waitUntil: "networkidle" });
      await assert.doesNotReject(() =>
        page.getByText("1 pages and 1 visible fields captured.").waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByText("Apply for fixture support").waitFor()
      );

      await page.getByRole("tab", { name: /Field contract/ }).click();
      await assert.doesNotReject(() =>
        page.getByText("Participant email", { exact: true }).waitFor()
      );
      await assert.doesNotReject(() =>
        page.getByRole("button", { name: "Show 1 hidden controls" }).waitFor()
      );

      await page.getByRole("tab", { name: "Evidence" }).click();
      await assert.doesNotReject(() =>
        page
          .getByRole("img", { name: "Captured public page for Fixture application" })
          .waitFor()
      );
      const evidenceLink = page.getByRole("link", {
        name: "Open full screenshot evidence for Fixture application",
      });
      assert.equal(await evidenceLink.getAttribute("target"), "_blank");
      assert.equal(
        await evidenceLink.getAttribute("href"),
        "http://127.0.0.1:8787/api/runs/run_ui_fixture/evidence/page_01"
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
      assert.equal(savedSettingsPayload.settings.captchaPolicy, "detect_and_handoff");

      await page.getByRole("button", { name: "Runs" }).click();
      await page.getByRole("button", { name: "New crawl" }).click();
      const headful = page.getByRole("button", { name: /Headful/ });
      await headful.click();
      assert.equal(await headful.getAttribute("aria-pressed"), "true");
      await page
        .getByLabel("Form URLs")
        .fill("https://forms.example.test/another-application");
      await page.getByRole("button", { name: /Launch crawl/ }).click();
      await page.getByText(/Visible crawl launched/).waitFor();
      assert.deepEqual(launchPayload, {
        urls: ["https://forms.example.test/another-application"],
        mode: "crawl",
        browserMode: "headful",
      });
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
