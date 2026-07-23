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
  "Playwright traverses rendered, noisy, iframe, shadow-root, and conditional forms in dry and live modes",
  { timeout: 180_000 },
  async () => {
    const originalDisableOpenAI = process.env.FORMWEAVE_DISABLE_OPENAI;
    process.env.FORMWEAVE_DISABLE_OPENAI = "1";
    const fixture = await startFixtureServer();
    try {
      const events = [];
      const output = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/start`],
        "run_fixture_test",
        {
          browserMode: "headless",
          allowLoopback: true,
          executionMode: "dry_run",
          traversalSettings: {
            stableWindowMs: 300,
            maxStateWaitMs: 3_000,
            maxFormStates: 5,
            maxBranchOptionsPerControl: 2,
            exerciseBranches: false,
          },
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
      assert.ok(
        output.pages
          .filter((page) => page.forms && !page.captchaDetected)
          .every((page) => page.entryFailures === 0 && page.fieldsEntered > 0)
      );

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
      assert.equal(iframePage.finalSubmission, "blocked");

      const shadowPage = pageAt("/fixtures/shadow-form");
      assert.ok(shadowPage.shadowRootCount >= 1);
      assert.ok(shadowPage.fields.some((field) => field.label === "Question"));
      assert.equal(shadowPage.finalSubmission, "blocked");

      const spaPage = pageAt("/fixtures/spa-enrollment");
      assert.ok(spaPage.hasScripts);
      assert.ok(spaPage.blockedWriteRequests >= 1);
      assert.equal(spaPage.finalSubmission, "blocked");

      const messyPage = pageAt("/fixtures/messy-intake");
      assert.equal(messyPage.entryFailures, 0);
      assert.equal(
        messyPage.fields.find((field) => field.label === "Neighborhood")
          ?.testValue,
        "North test district"
      );
      assert.equal(
        messyPage.fields.find(
          (field) => field.label === "Text message updates"
        )?.testValue,
        "true"
      );

      const dryTraversal = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/conditional-wizard`],
        "run_fixture_dry_traversal_test",
        {
          browserMode: "headless",
          executionMode: "dry_run",
          allowLoopback: true,
          discoverLinks: false,
          traversalSettings: {
            stableWindowMs: 300,
            maxStateWaitMs: 3_000,
            maxFormStates: 24,
            maxBranchOptionsPerControl: 2,
          },
        }
      );
      const wizardPage = dryTraversal.pages[0];
      assert.equal(
        wizardPage.fields.find((field) => field.key === "dependent_count")?.hidden,
        false
      );
      assert.ok(wizardPage.fieldsEntered >= 6);
      assert.ok(wizardPage.branchStates >= 2);
      assert.equal(wizardPage.finalSubmission, "blocked");
      assert.ok(wizardPage.stateEvidence.length >= 6);
      assert.ok(
        wizardPage.stateEvidence.some(
          (state) => state.kind === "populated" && state.values.length >= 3
        )
      );
      assert.ok(
        wizardPage.stateEvidence.some(
          (state) => state.kind === "blocked_final" && state.values.length >= 3
        )
      );
      assert.ok(
        wizardPage.automationActions.some(
          (action) => action.category === "field_entry" && action.testValue
        )
      );
      assert.ok(
        wizardPage.automationActions.some(
          (action) => action.category === "branch_probe"
        )
      );
      assert.ok(
        wizardPage.automationActions.some(
          (action) => action.category === "final_submit_blocked"
        )
      );
      assert.ok(
        dryTraversal.contract.some(
          (field) =>
            field.label === "Number of dependents" &&
            field.entryStatus === "entered" &&
            field.testValue
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
        automationPage.automationActions
          .filter((action) =>
            [
              "cookie_consent",
              "welcome_banner",
              "optional_auth",
              "optional_offer",
              "safe_disclosure",
            ].includes(action.category)
          )
          .map((action) => action.category),
        [
          "cookie_consent",
          "welcome_banner",
          "optional_auth",
          "optional_offer",
          "safe_disclosure",
        ]
      );
      assert.ok(
        automationPage.automationActions
          .filter((action) => action.category !== "field_entry")
          .every(
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
      assert.ok(events.some((event) => event.kind === "field_entry_completed"));
      assert.ok(events.some((event) => event.kind === "state_evidence_captured"));
      assert.ok(events.some((event) => event.kind === "final_submission_blocked"));

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

      const liveOutput = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/conditional-wizard`],
        "run_fixture_live_test",
        {
          browserMode: "headless",
          executionMode: "live",
          allowLoopback: true,
          discoverLinks: false,
          traversalSettings: {
            stableWindowMs: 300,
            maxStateWaitMs: 3_000,
            maxFormStates: 16,
            maxBranchOptionsPerControl: 2,
            exerciseBranches: false,
          },
        }
      );
      assert.equal(liveOutput.pages.length, 1);
      const liveWizard = liveOutput.pages[0];
      assert.equal(liveWizard.finalSubmission, "submitted");
      assert.equal(liveWizard.submissionsAttempted, 1);
      assert.equal(liveWizard.submissionsSucceeded, 1);
      assert.ok(
        liveWizard.stateEvidence.some((state) => state.kind === "submitted")
      );
      assert.equal(
        fixture.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/fixtures/live-submit" &&
            request.body?.includes("fixture_run=formweave")
        ).length,
        1
      );
      assert.ok(
        fixture.requests.every(
          (request) => request.path !== "/fixtures/write-probe"
        )
      );
    } finally {
      await fixture.close();
      if (originalDisableOpenAI === undefined) {
        delete process.env.FORMWEAVE_DISABLE_OPENAI;
      } else {
        process.env.FORMWEAVE_DISABLE_OPENAI = originalDisableOpenAI;
      }
    }
  }
);
