import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlTargetsWithPlaywright,
  validatePlaywrightTarget,
} from "../local/playwright-crawler.mjs";
import { reconScriptFor } from "../local/recon-scripts/registry.mjs";
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
  "production-default crawl observes script-missing pages without heuristic actuation",
  { timeout: 60_000 },
  async () => {
    const fixture = await startFixtureServer();
    try {
      const events = [];
      const output = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/automation-gates`],
        "run_script_missing_observation",
        {
          browserMode: "headless",
          executionMode: "probe",
          allowLoopback: true,
          discoverLinks: false,
          traversalSettings: {
            stableWindowMs: 200,
            maxStateWaitMs: 2_000,
          },
          onBrowserEvent: (kind, message, metadata = {}) => {
            events.push({ kind, message, metadata });
          },
        }
      );

      assert.equal(output.pages.length, 1);
      const page = output.pages[0];
      assert.equal(page.certificationStatus, "script_missing");
      assert.equal(page.reconScriptId, "");
      assert.deepEqual(page.automationActions, []);
      assert.equal(page.fieldsEntered, 0);
      assert.equal(page.submissionsAttempted, 0);
      assert.equal(page.submissionsSucceeded, 0);
      assert.match(page.html, /onetrust-banner-sdk/);
      assert.ok(events.some((event) => event.kind === "recon_script_missing"));
      assert.ok(
        !events.some((event) =>
          [
            "automation_action_started",
            "automation_action_completed",
            "field_entry_completed",
            "fixture_terminal_submission_completed",
          ].includes(event.kind)
        )
      );
    } finally {
      await fixture.close();
    }
  }
);

test(
  "Playwright uses form-specific scripts across rendered, noisy, wild, and conditional probe fixtures",
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
          reconScriptResolver: reconScriptFor,
          executionMode: "probe",
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

      assert.equal(output.pages.length, 13);
      assert.equal(output.pages.filter((page) => page.error).length, 0);
      assert.equal(output.pages.filter((page) => page.screenshot).length, 13);
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
      const semanticPage = pageAt("/fixtures/semantic-application");
      const contactMethod = semanticPage.fields.find(
        (field) => field.name === "contact_method"
      );
      assert.equal(contactMethod.groupLabel, "Preferred contact method");
      assert.deepEqual(
        contactMethod.optionSet.map((option) => option.label),
        ["Email", "Phone"]
      );
      assert.ok(
        semanticPage.sections.some(
          (section) =>
            section.label === "Preferred contact method" &&
            section.questionKeys.includes(contactMethod.key)
        )
      );
      assert.ok(
        output.pages
          .filter(
            (page) =>
              page.forms &&
              !page.captchaDetected &&
              new URL(page.finalUrl).pathname !==
                "/fixtures/probe-defeating-widget"
          )
          .every((page) => page.fieldsEntered > 0)
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

      const styledPage = pageAt("/fixtures/styled-label-interception");
      assert.ok(styledPage.fieldsEntered >= 2);
      assert.ok(
        styledPage.automationActions.some(
          (action) =>
            action.category === "field_entry" &&
            action.label === "Housing type" &&
            action.outcome === "landed"
        )
      );

      const widgetPage = pageAt("/fixtures/probe-defeating-widget");
      assert.ok(widgetPage.entryFailures >= 1);
      assert.ok(
        widgetPage.automationActions.some(
          (action) =>
            action.outcome === "could_not_test" &&
            ["actuation_unverified", "could_not_test"].includes(
              action.failureCode
            )
        )
      );

      const delayedPage = pageAt("/fixtures/interaction-gated-delay");
      assert.ok(
        delayedPage.fields.some((field) => field.label === "Program code")
      );
      assert.ok(delayedPage.fieldsEntered >= 2);

      const decoyPage = pageAt("/fixtures/decoy-before-real");
      assert.equal(
        decoyPage.fields.find((field) => field.name === "newsletter_email")
          ?.entryStatus,
        "skipped"
      );
      assert.equal(
        decoyPage.fields.find((field) => field.name === "applicant_first_name")
          ?.entryStatus,
        "entered"
      );

      const spaPage = pageAt("/fixtures/spa-enrollment");
      assert.ok(spaPage.hasScripts);
      assert.ok(spaPage.blockedWriteRequests >= 1);
      assert.equal(spaPage.finalSubmission, "blocked");

      const messyPage = pageAt("/fixtures/messy-intake");
      const displayName = messyPage.fields.find(
        (field) => field.name === "displayName"
      );
      assert.ok(displayName.guidanceIds.length > 0);
      assert.ok(
        messyPage.guidanceRecords.some(
          (record) =>
            displayName.guidanceIds.includes(record.id) &&
            record.text === "This can be a nickname." &&
            record.scope === "question"
        )
      );
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
          executionMode: "probe",
          allowLoopback: true,
          reconScriptResolver: reconScriptFor,
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
      assert.equal(automationPage.unresolvedGate, "");
      assert.ok(
        !automationPage.fields.some(
          (field) => field.label === "Application reference"
        )
      );
      assert.deepEqual(automationPage.automationActions, []);
      assert.match(automationPage.html, /onetrust-banner-sdk/);

      const captchaPage = pageAt("/fixtures/captcha-gate");
      assert.equal(captchaPage.captchaDetected, true);
      assert.equal(captchaPage.unresolvedGate, "captcha");
      assert.deepEqual(captchaPage.automationActions, []);
      assert.doesNotMatch(
        captchaPage.html,
        /<body[^>]*data-captcha-clicked/i
      );

      assert.ok(events.some((event) => event.kind === "state_wait_completed"));
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

      await assert.rejects(
        () =>
          crawlTargetsWithPlaywright(
            [`${fixture.origin}/fixtures/conditional-wizard`],
            "run_fixture_live_rejected",
            {
              browserMode: "headless",
              executionMode: "live",
              allowLoopback: true,
              discoverLinks: false,
            }
          ),
        /must be probe or explicit synthetic submission/
      );
      assert.ok(
        fixture.requests.every(
          (request) =>
            request.path !== "/fixtures/write-probe" &&
            request.path !== "/fixtures/live-submit"
          )
      );

      const fixtureSubmission = await crawlTargetsWithPlaywright(
        [`${fixture.origin}/fixtures/conditional-wizard`],
        "run_loopback_fixture_submit",
        {
          browserMode: "headless",
          executionMode: "fixture_submit",
          allowLoopback: true,
          reconScriptResolver: reconScriptFor,
          discoverLinks: false,
          traversalSettings: {
            stableWindowMs: 300,
            maxStateWaitMs: 3_000,
            maxFormStates: 12,
            exerciseBranches: false,
          },
        }
      );
      const submittedPage = fixtureSubmission.pages[0];
      assert.equal(submittedPage.submissionsAttempted, 1);
      assert.equal(submittedPage.submissionsSucceeded, 1);
      assert.equal(submittedPage.finalSubmission, "submitted");
      assert.equal(submittedPage.certificationStatus, "fixture_submitted");
      assert.ok(
        fixture.requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/fixtures/live-submit"
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
