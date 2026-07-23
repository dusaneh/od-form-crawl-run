import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlTargetsWithPlaywright,
  validatePlaywrightTarget,
} from "../local/playwright-crawler.mjs";
import { startFixtureServer } from "../test-sites/server.mjs";

test("loopback fixture targets require an explicit test-only opt in", () => {
  assert.throws(
    () => validatePlaywrightTarget("http://127.0.0.1:4179/fixtures/start"),
    /private|loopback|local/i
  );
  assert.equal(
    validatePlaywrightTarget("http://127.0.0.1:4179/fixtures/start", {
      allowLoopback: true,
    }),
    "http://127.0.0.1:4179/fixtures/start"
  );
});

test(
  "Playwright extracts rendered, noisy, iframe, and shadow-root forms without writes",
  { timeout: 90_000 },
  async () => {
    const fixture = await startFixtureServer();
    try {
      const events = [];
      const output = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/start`],
        "run_fixture_test",
        {
          browserMode: "headless",
          allowLoopback: true,
          onBrowserEvent: (kind, message, metadata = {}) => {
            events.push({ kind, message, metadata });
          },
        }
      );

      assert.equal(output.pages.length, 9);
      assert.equal(output.pages.filter((page) => page.error).length, 0);
      assert.equal(output.pages.filter((page) => page.screenshot).length, 9);
      assert.ok(
        output.pages.every(
          (page) =>
            page.rendered &&
            page.renderEngine === "playwright-chromium" &&
            page.screenshotProvider === "playwright-local-headless"
        )
      );
      assert.ok(
        output.pages.every((page) => !new URL(page.finalUrl).pathname.startsWith("/about"))
      );

      const pageAt = (pathname) =>
        output.pages.find((page) => new URL(page.finalUrl).pathname === pathname);
      const labelsAt = (pathname) =>
        (pageAt(pathname)?.fields || []).map((field) => field.label);

      assert.ok(labelsAt("/fixtures/semantic-application").includes("Legal name"));
      assert.ok(
        labelsAt("/fixtures/messy-intake").some((label) =>
          label.includes("Applicant display name")
        )
      );
      assert.ok(labelsAt("/fixtures/spa-enrollment").includes("Participant email"));
      assert.ok(labelsAt("/fixtures/shadow-form").includes("Case ID"));

      const iframePage = pageAt("/fixtures/iframe-request");
      assert.ok(iframePage.frameCount >= 2);
      assert.ok(iframePage.fields.some((field) => field.label === "Member number"));
      assert.ok(
        iframePage.fields.some(
          (field) =>
            field.frameUrl &&
            new URL(field.frameUrl).pathname === "/fixtures/embedded-intake"
        )
      );

      const shadowPage = pageAt("/fixtures/shadow-form");
      assert.ok(shadowPage.shadowRootCount >= 1);
      assert.ok(shadowPage.fields.some((field) => field.label === "Question"));

      const spaPage = pageAt("/fixtures/spa-enrollment");
      assert.ok(spaPage.hasScripts);
      assert.ok(spaPage.blockedWriteRequests >= 1);

      const wizardPage = pageAt("/fixtures/conditional-wizard");
      assert.equal(
        wizardPage.fields.find((field) => field.key === "dependent_count")?.hidden,
        true
      );
      assert.ok(
        output.contract.some(
          (field) => field.label === "Future conditional detail" && field.hidden
        )
      );

      const automationPage = pageAt("/fixtures/automation-gates");
      assert.ok(automationPage.allowedReadLikeRequests >= 1);
      assert.ok(automationPage.blockedWriteRequests >= 1);
      assert.equal(automationPage.unresolvedGate, "");
      assert.ok(
        automationPage.fields.some(
          (field) => field.label === "Application reference"
        )
      );
      assert.deepEqual(
        automationPage.automationActions.map((action) => action.category),
        [
          "cookie_consent",
          "welcome_banner",
          "optional_auth",
          "optional_offer",
          "safe_disclosure",
        ]
      );
      assert.ok(
        automationPage.automationActions.every(
          (action) =>
            action.beforeFingerprint &&
            action.afterFingerprint &&
            !action.error
        )
      );

      const captchaPage = pageAt("/fixtures/captcha-gate");
      assert.equal(captchaPage.captchaDetected, true);
      assert.equal(captchaPage.unresolvedGate, "captcha");
      assert.deepEqual(captchaPage.automationActions, []);
      assert.doesNotMatch(
        captchaPage.html,
        /<body[^>]*data-captcha-clicked/i
      );

      assert.ok(events.some((event) => event.kind === "state_wait_completed"));
      assert.ok(events.some((event) => event.kind === "automation_action_completed"));
      assert.ok(events.some((event) => event.kind === "read_like_post_allowed"));
      assert.ok(events.some((event) => event.kind === "captcha_handoff_required"));

      const nonReadRequests = fixture.requests.filter(
        (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method)
      );
      assert.deepEqual(
        nonReadRequests.map((request) => `${request.method} ${request.path}`),
        ["POST /fixtures/aura"]
      );
    } finally {
      await fixture.close();
    }
  }
);
