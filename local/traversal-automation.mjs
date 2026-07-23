import { createHash } from "node:crypto";

const COOKIE_REJECT =
  /reject(?: all)?(?: non[- ]?(?:essential|necessary))?|decline(?: all)?|essential cookies only|necessary cookies only/i;
const COOKIE_ACCEPT = /accept all cookies|allow all cookies|accept cookies|agree(?: to)? cookies/i;
const OPTIONAL_AUTH =
  /continue as guest|use without (?:an )?account|skip (?:sign[- ]?in|registration)|not now|maybe later/i;
const OPTIONAL_OFFER =
  /no thanks|decline offer|skip offer|continue without|maybe later/i;
const WELCOME_CLOSE = /^(?:close|dismiss|got it|okay|ok|skip|not now)$/i;
const INTRO_ADVANCE = /^(?:start|begin|get started|continue|next)$/i;
const CAPTCHA_TEXT =
  /verify (?:that )?you are human|i am human|captcha|security check|checking your browser|cloudflare turnstile/i;
const READ_LIKE_POST_PATH =
  /(?:^|\/)(?:aura|bootstrap|initialize|initialise|init|component|render|config)(?:\/|$)/i;

function visibleLocatorCandidates(locator, limit = 20) {
  return locator
    .all()
    .then(async (candidates) => {
      const visible = [];
      for (const candidate of candidates.slice(0, limit)) {
        if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
      }
      return visible;
    })
    .catch(() => []);
}

async function candidateLabel(locator) {
  return locator
    .evaluate((element) =>
      String(
        element.innerText ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.id ||
          element.tagName
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160)
    )
    .catch(() => "Unlabelled control");
}

async function stateFingerprint(page) {
  const [html, url] = await Promise.all([
    page.content().catch(() => ""),
    Promise.resolve(page.url()),
  ]);
  return createHash("sha256")
    .update(`${url}\n${html}`)
    .digest("hex")
    .slice(0, 16);
}

async function waitForMutationQuiet(page, quietMs, maxWaitMs) {
  return page
    .evaluate(
      ({ quiet, maximum }) =>
        new Promise((resolve) => {
          const target = document.documentElement;
          if (!target) {
            resolve({ quiet: true, mutations: 0 });
            return;
          }
          let mutations = 0;
          let quietTimer;
          let maximumTimer;
          const finish = (wasQuiet) => {
            clearTimeout(quietTimer);
            clearTimeout(maximumTimer);
            observer.disconnect();
            resolve({ quiet: wasQuiet, mutations });
          };
          const armQuietTimer = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => finish(true), quiet);
          };
          const observer = new MutationObserver(() => {
            mutations += 1;
            armQuietTimer();
          });
          observer.observe(target, {
            attributes: true,
            childList: true,
            subtree: true,
            characterData: true,
          });
          armQuietTimer();
          maximumTimer = setTimeout(() => finish(false), maximum);
        }),
      { quiet: quietMs, maximum: maxWaitMs }
    )
    .catch(() => ({ quiet: false, mutations: 0 }));
}

async function primeInteractiveSurface(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 1000 };
  const points = [
    [0.12, 0.18],
    [0.52, 0.24],
    [0.82, 0.48],
    [0.42, 0.72],
    [0.18, 0.86],
  ];
  for (const [x, y] of points) {
    await page.mouse
      .move(Math.round(viewport.width * x), Math.round(viewport.height * y), {
        steps: 3,
      })
      .catch(() => {});
  }
  await page
    .evaluate(async () => {
      const start = window.scrollY;
      const maximum = Math.max(
        0,
        Math.min(document.documentElement.scrollHeight - window.innerHeight, 2_400)
      );
      if (maximum > 0) {
        window.scrollTo({ top: maximum, behavior: "instant" });
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        window.scrollTo({ top: start, behavior: "instant" });
      }
    })
    .catch(() => {});
}

export async function waitForStableState(
  page,
  settings,
  onEvent,
  reason = "state examination"
) {
  const startedAt = Date.now();
  let networkIdle = true;
  await page
    .waitForLoadState("domcontentloaded", {
      timeout: Math.min(settings.maxStateWaitMs, 10_000),
    })
    .catch(() => {});
  await page
    .waitForLoadState("networkidle", {
      timeout: Math.min(settings.maxStateWaitMs, 6_000),
    })
    .catch(() => {
      networkIdle = false;
    });
  await page
    .evaluate(
      (maximum) =>
        Promise.race([
          document.fonts?.ready || Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, maximum)),
        ]),
      Math.min(settings.maxStateWaitMs, 4_000)
    )
    .catch(() => {});
  if (settings.pointerAndScrollPriming) {
    await primeInteractiveSurface(page);
  }
  const mutationResult = await waitForMutationQuiet(
    page,
    settings.stableWindowMs,
    settings.maxStateWaitMs
  );
  await onEvent?.(
    "state_wait_completed",
    `Completed deterministic wait before ${reason}.`,
    {
      reason,
      durationMs: Date.now() - startedAt,
      networkIdle,
      mutationQuiet: mutationResult.quiet,
      mutationsObserved: mutationResult.mutations,
      pointerAndScrollPrimed: settings.pointerAndScrollPriming,
    }
  );
  return mutationResult;
}

export function sanitizedEndpoint(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export function isSameOriginReadLikePost(request, pageOrigin, settings) {
  if (!settings.allowSameOriginReadLikePosts) return false;
  if (request.method().toUpperCase() !== "POST") return false;
  if (!["xhr", "fetch"].includes(request.resourceType())) return false;
  try {
    const url = new URL(request.url());
    return url.origin === pageOrigin && READ_LIKE_POST_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export async function installReadOnlyGuards(page) {
  await page.addInitScript(() => {
    window.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    Object.defineProperty(HTMLFormElement.prototype, "submit", {
      configurable: false,
      value() {},
    });
    Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
      configurable: false,
      value() {},
    });
  });
}

async function detectCaptchaInFrame(frame) {
  return frame
    .evaluate((pattern) => {
      const expression = new RegExp(pattern, "i");
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const all = (selector) =>
        roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
      const visible = (element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const structural = all(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,[data-sitekey]'
      ).find(visible);
      if (structural) {
        return (
          structural.getAttribute("title") ||
          structural.getAttribute("src") ||
          structural.className ||
          "CAPTCHA widget"
        );
      }
      const textMatch = all(
        '[role="dialog"],[role="alert"],main,section'
      ).find(
        (element) =>
          visible(element) &&
          expression.test(String(element.innerText || "").slice(0, 2_000))
      );
      return textMatch
        ? String(textMatch.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160)
        : "";
    }, CAPTCHA_TEXT.source)
    .catch(() => "");
}

export async function detectCaptcha(page) {
  for (const frame of page.frames()) {
    const evidence = await detectCaptchaInFrame(frame);
    if (evidence) return { detected: true, evidence, frameUrl: frame.url() };
  }
  return { detected: false };
}

async function performAction(
  page,
  locator,
  category,
  strategy,
  settings,
  onEvent
) {
  const label = await candidateLabel(locator);
  const beforeFingerprint = await stateFingerprint(page);
  await onEvent?.(
    "automation_action_started",
    `Applying predictable ${category.replaceAll("_", " ")} action: ${label}.`,
    { category, label, strategy, beforeFingerprint }
  );
  let error = "";
  try {
    await locator.click({ timeout: 4_000 });
    await waitForStableState(page, settings, onEvent, `${category} action`);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Automation action failed.";
  }
  const afterFingerprint = await stateFingerprint(page);
  const action = {
    category,
    label,
    strategy,
    beforeFingerprint,
    afterFingerprint,
    changed: beforeFingerprint !== afterFingerprint,
    timestamp: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  if (error) {
    await onEvent?.(
      "automation_action_failed",
      `Predictable ${category.replaceAll("_", " ")} action failed: ${label}.`,
      { ...action, error }
    );
    return action;
  }
  await onEvent?.(
    "automation_action_completed",
    `Completed predictable ${category.replaceAll("_", " ")} action: ${label}.`,
    action
  );
  return action;
}

async function firstVisible(locators) {
  for (const [locator, strategy] of locators) {
    const candidates = await visibleLocatorCandidates(locator, 12);
    if (candidates.length) return { locator: candidates[0], strategy };
  }
  return null;
}

async function cookieCandidate(page, settings) {
  if (settings.cookieConsent === "observe_only") return null;
  const reject = await firstVisible([
    [page.locator("#onetrust-reject-all-handler"), "OneTrust reject control"],
    [page.locator(".ot-pc-refuse-all-handler"), "OneTrust preference reject control"],
    [page.getByRole("button", { name: COOKIE_REJECT }), "accessible reject label"],
  ]);
  if (settings.cookieConsent === "reject_non_essential" && reject) return reject;
  const accept = await firstVisible([
    [page.locator("#onetrust-accept-btn-handler"), "OneTrust accept control"],
    [page.getByRole("button", { name: COOKIE_ACCEPT }), "accessible accept label"],
  ]);
  if (settings.cookieConsent === "accept_all") return accept || reject;
  return settings.acceptCookiesWhenRequired ? accept : null;
}

async function safeModalCandidate(page, expression, category) {
  const candidates = await visibleLocatorCandidates(
    page.getByRole("button", { name: expression }),
    30
  );
  for (const candidate of candidates) {
    const safe = await candidate
      .evaluate((element, candidateCategory) => {
        const container = element.closest(
          '[role="dialog"],[aria-modal="true"],.modal,.popup,.welcome,.coachmark,[class*="modal"],[class*="popup"],[class*="welcome"]'
        );
        if (!container) return false;
        if (container.closest("#onetrust-consent-sdk")) return false;
        if (element.closest("form")) return false;
        return candidateCategory.length > 0;
      }, category)
      .catch(() => false);
    if (safe) return candidate;
  }
  return null;
}

async function safeDisclosureCandidates(page) {
  const candidates = await visibleLocatorCandidates(
    page.locator(
      'button[aria-expanded="false"][aria-controls],[role="button"][aria-expanded="false"][aria-controls],summary'
    ),
    20
  );
  const safe = [];
  for (const candidate of candidates) {
    const allowed = await candidate
      .evaluate((element) => {
        if (element.closest("#onetrust-consent-sdk")) return false;
        if (element.closest("form")) return false;
        const text = String(
          element.innerText || element.getAttribute("aria-label") || ""
        );
        return !/cookie|privacy|captcha|human/i.test(text);
      })
      .catch(() => false);
    if (allowed) safe.push(candidate);
  }
  return safe.slice(0, 3);
}

async function safeIntroCandidate(page) {
  const candidates = await visibleLocatorCandidates(
    page.getByRole("button", { name: INTRO_ADVANCE }),
    20
  );
  for (const candidate of candidates) {
    const safe = await candidate
      .evaluate((element) => {
        if (element.closest("form")) return false;
        if (element.closest("#onetrust-consent-sdk")) return false;
        const type = String(element.getAttribute("type") || "button").toLowerCase();
        return type === "button";
      })
      .catch(() => false);
    if (safe) return candidate;
  }
  return null;
}

async function unresolvedGate(page) {
  const cookie = await firstVisible([
    [page.locator("#onetrust-banner-sdk"), "OneTrust banner"],
    [page.getByRole("button", { name: COOKIE_ACCEPT }), "cookie consent"],
  ]);
  if (cookie) return "cookie_consent";
  const captcha = await detectCaptcha(page);
  if (captcha.detected) return "captcha";
  return "";
}

async function waitForVisibleFormSurface(page, settings, onEvent) {
  const startedAt = Date.now();
  const timeoutMs = Math.min(settings.maxStateWaitMs, 8_000);
  let visibleControls = 0;
  try {
    const handle = await page.waitForFunction(
      () => {
        const roots = [document];
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot) roots.push(element.shadowRoot);
          }
        }
        const controls = roots.flatMap((root) =>
          Array.from(
            root.querySelectorAll(
              'input:not([type="hidden"]),select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="switch"]'
            )
          )
        );
        return controls.filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            element.getClientRects().length > 0
          );
        }).length;
      },
      undefined,
      { timeout: timeoutMs, polling: 200 }
    );
    visibleControls = Number(await handle.jsonValue()) || 0;
    await handle.dispose();
  } catch {
    // A page can legitimately contain no form surface; the hard bound is the fallback.
  }
  await onEvent?.(
    "form_surface_wait_completed",
    visibleControls
      ? `Observed ${visibleControls} visible form control${visibleControls === 1 ? "" : "s"} after predictable gate handling.`
      : "No visible form surface appeared during the bounded post-gate wait.",
    {
      durationMs: Date.now() - startedAt,
      timeoutMs,
      visibleControls,
    }
  );
  return visibleControls;
}

export async function runPredictableAutomations(page, settings, onEvent) {
  const actions = [];
  let examinations = 0;
  const examine = async (reason) => {
    examinations += 1;
    await waitForStableState(page, settings, onEvent, reason);
  };

  await examine("initial state examination");
  let captcha = await detectCaptcha(page);
  if (captcha.detected) {
    await onEvent?.(
      "captcha_handoff_required",
      "CAPTCHA or human-verification gate detected; no interaction attempted.",
      captcha
    );
    return {
      actions,
      captchaDetected: true,
      unresolvedGate: "captcha",
      stateExaminations: examinations,
    };
  }

  const cookie = await cookieCandidate(page, settings);
  if (cookie && actions.length < settings.maxActionsPerPage) {
    actions.push(
      await performAction(
        page,
        cookie.locator,
        "cookie_consent",
        cookie.strategy,
        settings,
        onEvent
      )
    );
    examinations += 1;
  }

  captcha = await detectCaptcha(page);
  if (captcha.detected) {
    await onEvent?.(
      "captcha_handoff_required",
      "CAPTCHA or human-verification gate detected after deterministic gate handling; no interaction attempted.",
      captcha
    );
    return {
      actions,
      captchaDetected: true,
      unresolvedGate: "captcha",
      stateExaminations: examinations,
    };
  }

  const modalPolicies = [
    [settings.closeWelcomeBanners, WELCOME_CLOSE, "welcome_banner"],
    [settings.dismissOptionalAuth, OPTIONAL_AUTH, "optional_auth"],
    [settings.dismissOptionalOffers, OPTIONAL_OFFER, "optional_offer"],
  ];
  for (const [enabled, expression, category] of modalPolicies) {
    if (!enabled || actions.length >= settings.maxActionsPerPage) continue;
    const candidate = await safeModalCandidate(page, expression, category);
    if (!candidate) continue;
    actions.push(
      await performAction(
        page,
        candidate,
        category,
        "accessible modal action",
        settings,
        onEvent
      )
    );
    examinations += 1;
  }

  if (
    settings.expandSafeDisclosures &&
    actions.length < settings.maxActionsPerPage
  ) {
    const disclosures = await safeDisclosureCandidates(page);
    for (const disclosure of disclosures) {
      if (actions.length >= settings.maxActionsPerPage) break;
      actions.push(
        await performAction(
          page,
          disclosure,
          "safe_disclosure",
          "aria-controls disclosure",
          settings,
          onEvent
        )
      );
      examinations += 1;
    }
  }

  if (
    settings.advanceIntroScreens &&
    actions.length < settings.maxActionsPerPage
  ) {
    const intro = await safeIntroCandidate(page);
    if (intro) {
      actions.push(
        await performAction(
          page,
          intro,
          "intro_advance",
          "non-form explicit button",
          settings,
          onEvent
        )
      );
      examinations += 1;
    }
  }

  if (actions.length) {
    await waitForVisibleFormSurface(page, settings, onEvent);
    await examine("final post-automation state examination");
  }

  return {
    actions,
    captchaDetected: false,
    unresolvedGate: await unresolvedGate(page),
    stateExaminations: examinations,
  };
}
