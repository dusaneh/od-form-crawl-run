import { chromium } from "playwright";

import { installSubmissionGuards } from "./form-traversal.mjs";
import {
  executeApprovedFormScript,
  loadApprovedFormScript,
} from "./production-generated-traversal.mjs";
import {
  detectCaptcha,
  isSameOriginReadLikePost,
  sanitizedEndpoint,
  waitForStableState,
} from "./traversal-automation.mjs";
import { normalizeTraversalSettings } from "./traversal-settings.mjs";

function sameOrigin(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

export async function executeApprovedForm({
  targetUrl,
  scriptPath,
  inputData,
  submit,
  browserMode = "headless",
  traversalSettings,
  onEvent,
}) {
  const stored = await loadApprovedFormScript(scriptPath);
  if (stored.plan.initialUrl !== targetUrl) {
    throw new Error(
      "Approved form target does not match the immutable script target.",
    );
  }
  const settings = normalizeTraversalSettings(traversalSettings || {});
  const browser = await chromium.launch({
    headless: browserMode !== "headful",
    slowMo: browserMode === "headful" ? 60 : 0,
  });
  let context;
  let page;
  const targetOrigin = new URL(targetUrl).origin;
  let allowSameOriginWritesUntil = 0;
  let allowFinalWritesUntil = 0;
  let allowedFinalWriteOrigin = "";
  const authorizeWrites = ({ scope, durationMs, reason, origin = "" }) => {
    const until = Date.now() + Math.max(250, Math.min(durationMs, 15_000));
    if (scope === "final-action") {
      allowFinalWritesUntil = Math.max(allowFinalWritesUntil, until);
      allowedFinalWriteOrigin = origin;
    } else {
      allowSameOriginWritesUntil = Math.max(
        allowSameOriginWritesUntil,
        until,
      );
    }
    onEvent?.("approved_write_window_opened", "Opened a bounded approved write window.", {
      scope,
      reason,
      origin: origin ? new URL(origin).origin : "",
    });
    return () => {
      if (scope === "final-action" && allowFinalWritesUntil === until) {
        allowFinalWritesUntil = 0;
        allowedFinalWriteOrigin = "";
      } else if (
        scope !== "final-action" &&
        allowSameOriginWritesUntil === until
      ) {
        allowSameOriginWritesUntil = 0;
      }
    };
  };
  try {
    context = await browser.newContext({
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(
      Math.max(1_000, Math.min(settings.maxStateWaitMs, 8_000)),
    );
    await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (isSameOriginReadLikePost(request, targetOrigin, settings)) {
      await route.continue();
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const now = Date.now();
      const requestOrigin = sameOrigin(request.url(), targetOrigin)
        ? targetOrigin
        : "";
      const permitted =
        (now <= allowSameOriginWritesUntil &&
          requestOrigin === targetOrigin) ||
        (now <= allowFinalWritesUntil &&
          requestOrigin === allowedFinalWriteOrigin);
      if (!permitted) {
        await onEvent?.(
          "approved_write_blocked",
          "Blocked a write outside the active approved interaction window.",
          {
            method,
            endpoint: sanitizedEndpoint(request.url()),
          },
        );
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
    });
    await installSubmissionGuards(page, "approved_live");
    await onEvent?.(
      "approved_execution_browser_started",
      "Opened the approved form in local Chromium.",
      { browserMode, targetOrigin },
    );
    const response = await page.goto(targetUrl, {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
    });
    if (!response || !response.ok()) {
      throw new Error(
        `Approved form navigation failed with HTTP ${response?.status() ?? "unknown"}.`,
      );
    }
    await waitForStableState(
      page,
      settings,
      onEvent,
      "approved execution state examination",
    );
    const captcha = await detectCaptcha(page);
    if (captcha.detected) {
      return {
        status: "failed",
        outcome: "disqualified",
        failureCode: "interactive_captcha",
        detail:
          "An interactive CAPTCHA was present at execution time; no user data was entered.",
        issues: [],
        fieldsAttempted: 0,
        fieldsVerified: 0,
        fieldsFailed: 0,
        submitted: false,
        submissionResult: null,
      };
    }
    return await executeApprovedFormScript({
      page,
      stored,
      inputData,
      submit,
      authorizeWrites,
      onEvent,
    });
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    await onEvent?.(
      "approved_execution_browser_closed",
      "Closed the approved execution browser.",
      {},
    );
  }
}
