import { preparePageOnset } from "./executor/interaction-priming.mjs";

const CAPTCHA_TEXT =
  /verify (?:that )?you are human|prove (?:that )?you are human|i am human|captcha|security check|checking your browser|cloudflare turnstile/i;
const READ_LIKE_POST_PATH =
  /(?:^|\/)(?:aura|bootstrap|initialize|initialise|init|component|render|config)(?:\/|$)/i;

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
  const priming = settings.pointerAndScrollPriming
    ? await preparePageOnset(page)
    : null;
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
      ...(priming || {}),
    }
  );
  return {
    ...mutationResult,
    priming,
  };
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
      const visibleText = String(document.body?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        /recaptcha\s*v3|siteverify\s*v3|score-based|invisible verification/i.test(
          visibleText,
        ) &&
        /no action is required|protected by|invisible verification/i.test(
          visibleText,
        )
      ) {
        return {
          kind: "non_interactive",
          evidence: visibleText.slice(0, 160),
        };
      }
      const structural = all(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,[data-sitekey]'
      ).find(visible);
      if (structural) {
        return {
          kind: "interactive",
          evidence:
            structural.getAttribute("title") ||
            structural.getAttribute("src") ||
            structural.className ||
            "CAPTCHA widget",
        };
      }
      const imageChallenge = all('img[src^="data:image/"]').find((image) => {
        if (!visible(image)) return false;
        const rect = image.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 25) return false;
        const container = image.parentElement;
        if (!container) return false;
        const nearbyInputs = Array.from(
          container.querySelectorAll('input:not([type="hidden"])')
        ).filter(visible);
        return nearbyInputs.some((input) => {
          const id = input.id;
          const labelled =
            input.getAttribute("aria-label") ||
            input.getAttribute("placeholder") ||
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
          return !labelled;
        });
      });
      if (imageChallenge) {
        return {
          kind: "interactive",
          evidence: "Unlabelled distorted-image verification challenge",
        };
      }
      const textMatch = all(
        '[role="dialog"],[role="alert"],main,section,form,body'
      ).find(
        (element) =>
          visible(element) &&
          expression.test(String(element.innerText || "").slice(0, 2_000))
      );
      const fullMatchedText = textMatch
        ? String(textMatch.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
      if (
        /recaptcha\s*v3|score-based/i.test(fullMatchedText) &&
        /no action is required|protected by/i.test(fullMatchedText)
      ) {
        return {
          kind: "non_interactive",
          evidence: fullMatchedText.slice(0, 160),
        };
      }
      return fullMatchedText
        ? { kind: "interactive", evidence: fullMatchedText.slice(0, 160) }
        : null;
    }, CAPTCHA_TEXT.source)
    .catch(() => null);
}

export async function detectCaptcha(page) {
  let nonInteractive = null;
  for (const frame of page.frames()) {
    const result = await detectCaptchaInFrame(frame);
    if (!result) continue;
    if (result.kind === "interactive") {
      return {
        detected: true,
        nonInteractiveDetected: false,
        kind: "interactive",
        evidence: result.evidence,
        frameUrl: frame.url(),
      };
    }
    nonInteractive ||= {
      detected: false,
      nonInteractiveDetected: true,
      kind: "invisible",
      evidence: result.evidence,
      frameUrl: frame.url(),
    };
  }
  return (
    nonInteractive || {
      detected: false,
      nonInteractiveDetected: false,
      kind: "none",
    }
  );
}
