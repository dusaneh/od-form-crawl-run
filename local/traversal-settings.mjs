export const TRAVERSAL_SETTINGS_VERSION = 1;

export const DEFAULT_TRAVERSAL_SETTINGS = Object.freeze({
  version: TRAVERSAL_SETTINGS_VERSION,
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
  maxStateWaitMs: 12_000,
  maxActionsPerPage: 10,
});

const BOOLEAN_KEYS = [
  "acceptCookiesWhenRequired",
  "closeWelcomeBanners",
  "dismissOptionalOffers",
  "dismissOptionalAuth",
  "expandSafeDisclosures",
  "advanceIntroScreens",
  "allowSameOriginReadLikePosts",
  "pointerAndScrollPriming",
];

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(parsed, maximum))
    : fallback;
}

export function normalizeTraversalSettings(input = {}) {
  const normalized = { ...DEFAULT_TRAVERSAL_SETTINGS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof input[key] === "boolean") normalized[key] = input[key];
  }
  if (
    ["reject_non_essential", "accept_all", "observe_only"].includes(
      input.cookieConsent
    )
  ) {
    normalized.cookieConsent = input.cookieConsent;
  }
  if (input.unpredictablePopups === "observe_only") {
    normalized.unpredictablePopups = "observe_only";
  }
  // CAPTCHA solving and bot-detection evasion are deliberately unsupported.
  normalized.captchaPolicy = "detect_and_handoff";
  normalized.stableWindowMs = boundedInteger(
    input.stableWindowMs,
    DEFAULT_TRAVERSAL_SETTINGS.stableWindowMs,
    300,
    3_000
  );
  normalized.maxStateWaitMs = boundedInteger(
    input.maxStateWaitMs,
    DEFAULT_TRAVERSAL_SETTINGS.maxStateWaitMs,
    3_000,
    30_000
  );
  normalized.maxActionsPerPage = boundedInteger(
    input.maxActionsPerPage,
    DEFAULT_TRAVERSAL_SETTINGS.maxActionsPerPage,
    1,
    25
  );
  normalized.version = TRAVERSAL_SETTINGS_VERSION;
  return normalized;
}
