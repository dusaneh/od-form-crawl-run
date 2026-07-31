export const TRAVERSAL_SETTINGS_VERSION = 4;

export const DEFAULT_AGENT_INSTRUCTIONS = [
  "Select and traverse exactly one public form journey that most directly helps a person obtain an essential service or coordinate a referral through OneDegree.",
  "Prioritize intake, application, enrollment, service-request, referral, eligibility, or direct-access registration forms; use a contact or request-information form only when no direct service-access form is available.",
  "Do not explore alternate forms, unrelated information pages, provider or administrator portals, donation, volunteer, newsletter, survey, marketing, or general-feedback forms.",
  "Classify controls as deterministic, conditional, or human-review actions.",
  "Open every visible collapsed details, accordion, expando, or disclosure exactly once and re-examine the resulting state before unrelated progression.",
  "Treat cookie banners as session infrastructure: prefer rejecting non-essential cookies and otherwise use the minimum acceptance needed to expose the public form.",
  "Enter ordinary fields in DOM order and exercise safe select, radio, and checkbox branches.",
  "Use Next, Continue, Review, and equivalent controls to reveal later states.",
  "In Phase 1 Probe mode, never activate the terminal submit control.",
  "Never solve CAPTCHA, provide real credentials, or make a payment.",
  "Model upload, consent, authorization, terms, review-confirmation, and signature fields with conspicuously synthetic values when needed to expose or verify the form.",
  "Use obviously synthetic values and reserve example.invalid for email and URL values.",
].join(" ");

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
  captchaPolicy: "detect_and_disqualify",
  stableWindowMs: 700,
  maxStateWaitMs: 12_000,
  maxActionsPerPage: 10,
  enterTestValues: true,
  exerciseBranches: true,
  advanceFormSteps: true,
  maxFormStates: 24,
  maxBranchOptionsPerControl: 3,
  agentInstructions: DEFAULT_AGENT_INSTRUCTIONS,
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
  "enterTestValues",
  "exerciseBranches",
  "advanceFormSteps",
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
  normalized.captchaPolicy = "detect_and_disqualify";
  // Full safe disclosure discovery and legitimate rendering priming are
  // required sensing behavior, not optional semantic decision policies.
  normalized.expandSafeDisclosures = true;
  normalized.pointerAndScrollPriming = true;
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
  normalized.maxFormStates = boundedInteger(
    input.maxFormStates,
    DEFAULT_TRAVERSAL_SETTINGS.maxFormStates,
    1,
    30
  );
  normalized.maxBranchOptionsPerControl = boundedInteger(
    input.maxBranchOptionsPerControl,
    DEFAULT_TRAVERSAL_SETTINGS.maxBranchOptionsPerControl,
    1,
    8
  );
  const suppliedInstructions =
    typeof input.agentInstructions === "string" &&
    input.agentInstructions.trim().length >= 40
      ? input.agentInstructions.trim().slice(0, 8_000)
      : DEFAULT_AGENT_INSTRUCTIONS;
  normalized.agentInstructions = suppliedInstructions
    .replace(
      /In dry-run mode, never activate the final submit control\./gi,
      "In Phase 1 Probe mode, never activate the terminal submit control."
    )
    .replace(
      /Hard enforcement still owns CAPTCHA, credentials, files, legal acceptance, payment, dry-run final blocking, and Live approval\./gi,
      "Hard enforcement owns CAPTCHA, credentials, payment, and the Phase 1 terminal block."
    )
    .replace(
      /Never solve CAPTCHA, provide real credentials, make a payment, upload a file, sign, or accept legal terms\./gi,
      "Never solve CAPTCHA, provide real credentials, or make a payment. Model upload, consent, authorization, terms, review-confirmation, and signature fields with conspicuously synthetic values when needed to expose or verify the form."
    );
  normalized.version = TRAVERSAL_SETTINGS_VERSION;
  return normalized;
}
