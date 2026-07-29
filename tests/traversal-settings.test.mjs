import assert from "node:assert/strict";
import test from "node:test";
import {
  isSameOriginReadLikePost,
  sanitizedEndpoint,
} from "../local/traversal-automation.mjs";
import {
  DEFAULT_TRAVERSAL_SETTINGS,
  normalizeTraversalSettings,
} from "../local/traversal-settings.mjs";

function request({ method = "POST", resourceType = "fetch", url }) {
  return {
    method: () => method,
    resourceType: () => resourceType,
    url: () => url,
  };
}

test("traversal settings normalize bounded values and lock the CAPTCHA policy", () => {
  const normalized = normalizeTraversalSettings({
    cookieConsent: "accept_all",
    closeWelcomeBanners: false,
    captchaPolicy: "click_and_bypass",
    stableWindowMs: 1,
    maxStateWaitMs: 99_000,
    maxActionsPerPage: 0,
    maxFormStates: 99,
    maxBranchOptionsPerControl: 0,
    enterTestValues: false,
    agentInstructions: "too short",
  });

  assert.equal(normalized.version, 4);
  assert.equal(normalized.cookieConsent, "accept_all");
  assert.equal(normalized.closeWelcomeBanners, false);
  assert.equal(normalized.captchaPolicy, "detect_and_disqualify");
  assert.equal(normalized.stableWindowMs, 300);
  assert.equal(normalized.maxStateWaitMs, 30_000);
  assert.equal(normalized.maxActionsPerPage, 1);
  assert.equal(normalized.maxFormStates, 30);
  assert.equal(normalized.maxBranchOptionsPerControl, 1);
  assert.equal(normalized.enterTestValues, false);
  assert.equal(
    normalized.agentInstructions,
    DEFAULT_TRAVERSAL_SETTINGS.agentInstructions
  );
  assert.equal(DEFAULT_TRAVERSAL_SETTINGS.cookieConsent, "reject_non_essential");
  assert.equal(DEFAULT_TRAVERSAL_SETTINGS.maxFormStates, 24);
  assert.equal(DEFAULT_TRAVERSAL_SETTINGS.advanceFormSteps, true);
});

test("read-like POST classification is narrow, same-origin, and strips query data from logs", () => {
  const settings = normalizeTraversalSettings();
  const origin = "https://forms.example.test";

  assert.equal(
    isSameOriginReadLikePost(
      request({ url: `${origin}/application/aura?token=secret` }),
      origin,
      settings
    ),
    true
  );
  assert.equal(
    isSameOriginReadLikePost(
      request({ url: `${origin}/forms/submit` }),
      origin,
      settings
    ),
    false
  );
  assert.equal(
    isSameOriginReadLikePost(
      request({ url: "https://analytics.example.test/bootstrap" }),
      origin,
      settings
    ),
    false
  );
  assert.equal(
    isSameOriginReadLikePost(
      request({
        method: "GET",
        url: `${origin}/application/bootstrap`,
      }),
      origin,
      settings
    ),
    false
  );
  assert.equal(
    sanitizedEndpoint(`${origin}/application/aura?token=secret#private`),
    `${origin}/application/aura`
  );
});
