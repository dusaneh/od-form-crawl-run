const POINTER_PATH = Object.freeze([
  Object.freeze({ x: 0.12, y: 0.18, easing: "ease_in", durationMs: 160 }),
  Object.freeze({ x: 0.52, y: 0.24, easing: "ease_out", durationMs: 210 }),
  Object.freeze({ x: 0.82, y: 0.48, easing: "smooth", durationMs: 180 }),
  Object.freeze({ x: 0.42, y: 0.72, easing: "ease_in_out", durationMs: 250 }),
  Object.freeze({ x: 0.18, y: 0.86, easing: "ease_out", durationMs: 200 }),
]);

const PAGE_ONSET_MARKER = "__intakecrDeterministicPageOnsetV1";

function easedProgress(kind, value) {
  if (kind === "ease_in") return value * value;
  if (kind === "ease_out") return 1 - (1 - value) ** 2;
  if (kind === "ease_in_out") {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - (-2 * value + 2) ** 3 / 2;
  }
  return value * value * (3 - 2 * value);
}

async function movePointerDeterministically(page) {
  const viewport = page.viewportSize() || { width: 1440, height: 1000 };
  let current = {
    x: Math.round(viewport.width * 0.5),
    y: Math.round(viewport.height * 0.5),
  };
  await page.mouse.move(current.x, current.y).catch(() => {});
  let pointerSamples = 1;
  let elapsedMs = 0;
  for (const segment of POINTER_PATH) {
    const target = {
      x: Math.round(viewport.width * segment.x),
      y: Math.round(viewport.height * segment.y),
    };
    const start = current;
    const steps = 10;
    for (let index = 1; index <= steps; index += 1) {
      const progress = easedProgress(segment.easing, index / steps);
      await page.mouse
        .move(
          Math.round(start.x + (target.x - start.x) * progress),
          Math.round(start.y + (target.y - start.y) * progress),
        )
        .catch(() => {});
      pointerSamples += 1;
      const delayMs = Math.max(1, Math.round(segment.durationMs / steps));
      elapsedMs += delayMs;
      await page.waitForTimeout(delayMs).catch(() => {});
    }
    current = target;
  }
  return {
    pointerMoves: POINTER_PATH.length,
    pointerSamples,
    pointerDurationMs: elapsedMs,
    pointerMotionProfile: "deterministic_varied_easing",
  };
}

async function expandFrameDisclosures(
  frame,
  { maxDisclosurePasses, maxDisclosures },
) {
  return frame.evaluate(
    async ({ passLimit, disclosureLimit }) => {
      const attemptedMarker = "data-intakecr-onset-expansion-attempted";
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const visible = (element) => {
        if (!element?.isConnected) return false;
        const style = getComputedStyle(element);
        const rectangle = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      };
      const collapsedBootstrapTarget = (element) => {
        const selector =
          element.getAttribute("data-bs-target") ||
          element.getAttribute("data-target") ||
          (element.getAttribute("href") || "").startsWith("#")
            ? element.getAttribute("data-bs-target") ||
              element.getAttribute("data-target") ||
              element.getAttribute("href")
            : "";
        if (!selector) return true;
        try {
          const target = document.querySelector(selector);
          return !target?.matches(".show, .in, [aria-hidden='false']");
        } catch {
          return true;
        }
      };
      const isCollapsedDisclosure = (element) => {
        if (element.tagName === "SUMMARY") {
          return !element.closest("details")?.open;
        }
        if (element.getAttribute("aria-expanded") === "false") return true;
        if (
          element.matches("[data-bs-toggle='collapse'], [data-toggle='collapse']")
        ) {
          return collapsedBootstrapTarget(element);
        }
        return false;
      };
      const result = {
        disclosuresAttempted: 0,
        disclosuresOpened: 0,
        detailsOpened: 0,
        disclosureButtonsOpened: 0,
      };
      for (let pass = 0; pass < passLimit; pass += 1) {
        const remaining = Math.max(
          0,
          disclosureLimit - result.disclosuresAttempted,
        );
        if (remaining === 0) break;
        const candidates = [
          ...document.querySelectorAll(
            "details:not([open]) > summary, [aria-expanded='false'], [data-bs-toggle='collapse'], [data-toggle='collapse']",
          ),
        ]
          .filter(
            (element) =>
              !element.hasAttribute(attemptedMarker) &&
              visible(element) &&
              isCollapsedDisclosure(element),
          )
          .slice(0, remaining);
        if (candidates.length === 0) break;
        for (const element of candidates) {
          const wasDetails = element.tagName === "SUMMARY";
          element.setAttribute(attemptedMarker, "true");
          result.disclosuresAttempted += 1;
          element.scrollIntoView({ block: "center", inline: "nearest" });
          element.click();
          await nextFrame();
          const opened = wasDetails
            ? element.closest("details")?.open === true
            : element.getAttribute("aria-expanded") === "true" ||
              !isCollapsedDisclosure(element);
          if (opened) {
            result.disclosuresOpened += 1;
            if (wasDetails) result.detailsOpened += 1;
            else result.disclosureButtonsOpened += 1;
          }
        }
      }
      return result;
    },
    {
      passLimit: maxDisclosurePasses,
      disclosureLimit: maxDisclosures,
    },
  );
}

async function primeFrameScrolling(
  frame,
  { maxDocumentSteps, maxScrollSurfaces },
) {
  return frame.evaluate(
    async ({ documentSteps, surfaceLimit }) => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const result = {
        documentScrollSteps: 0,
        scrollSurfacesPrimed: 0,
      };
      const startingY = window.scrollY;
      for (let index = 0; index < documentSteps; index += 1) {
        const viewport = Math.max(window.innerHeight, 1);
        const maximum = Math.max(
          0,
          document.documentElement.scrollHeight - viewport,
        );
        if (window.scrollY >= maximum - 2) break;
        window.scrollTo({
          top: Math.min(maximum, window.scrollY + Math.max(240, viewport * 0.8)),
          behavior: "instant",
        });
        window.dispatchEvent(new Event("scroll"));
        result.documentScrollSteps += 1;
        await nextFrame();
      }
      const finalMaximum = Math.max(
        0,
        document.documentElement.scrollHeight - Math.max(window.innerHeight, 1),
      );
      if (window.scrollY < finalMaximum - 2) {
        window.scrollTo({ top: finalMaximum, behavior: "instant" });
        window.dispatchEvent(new Event("scroll"));
        result.documentScrollSteps += 1;
        await nextFrame();
      }
      const surfaces = [...document.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.scrollHeight > element.clientHeight + 8 &&
            ["auto", "scroll"].includes(style.overflowY)
          );
        })
        .slice(0, surfaceLimit);
      for (const element of surfaces) {
        const startingTop = element.scrollTop;
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        result.scrollSurfacesPrimed += 1;
        await nextFrame();
        element.scrollTop = startingTop;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      window.scrollTo({ top: startingY, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
      return result;
    },
    {
      documentSteps: maxDocumentSteps,
      surfaceLimit: maxScrollSurfaces,
    },
  );
}

async function claimPageOnset(page) {
  return page.mainFrame().evaluate((marker) => {
    const identity = `${location.href}|${document.contentType}`;
    if (globalThis[marker] === identity) return false;
    Object.defineProperty(globalThis, marker, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: identity,
    });
    return true;
  }, PAGE_ONSET_MARKER);
}

export async function primeInteractiveSurface(
  page,
  {
    maxDocumentSteps = 20,
    maxScrollSurfaces = 60,
    maxDisclosurePasses = 4,
    maxDisclosures = 80,
  } = {},
) {
  const pointer = await movePointerDeterministically(page);
  const result = {
    pageOnsetPerformed: true,
    ...pointer,
    framesPrimed: 0,
    inaccessibleFrames: 0,
    documentScrollSteps: 0,
    scrollSurfacesPrimed: 0,
    disclosuresAttempted: 0,
    disclosuresOpened: 0,
    detailsOpened: 0,
    disclosureButtonsOpened: 0,
  };
  for (const frame of page.frames()) {
    try {
      const expanded = await expandFrameDisclosures(frame, {
        maxDisclosurePasses,
        maxDisclosures: Math.max(
          0,
          maxDisclosures - result.disclosuresAttempted,
        ),
      });
      result.disclosuresAttempted += expanded.disclosuresAttempted;
      result.disclosuresOpened += expanded.disclosuresOpened;
      result.detailsOpened += expanded.detailsOpened;
      result.disclosureButtonsOpened += expanded.disclosureButtonsOpened;
      const scrolled = await primeFrameScrolling(frame, {
        maxDocumentSteps,
        maxScrollSurfaces,
      });
      result.framesPrimed += 1;
      result.documentScrollSteps += scrolled.documentScrollSteps;
      result.scrollSurfacesPrimed += scrolled.scrollSurfacesPrimed;
    } catch {
      result.inaccessibleFrames += 1;
    }
  }
  await page.waitForTimeout(100).catch(() => {});
  return result;
}

export async function preparePageOnset(page, options = {}) {
  const claimed = await claimPageOnset(page).catch(() => false);
  if (!claimed) {
    return {
      pageOnsetPerformed: false,
      pageOnsetReason: "already_prepared",
      pointerMoves: 0,
      pointerSamples: 0,
      pointerDurationMs: 0,
      pointerMotionProfile: "deterministic_varied_easing",
      framesPrimed: 0,
      inaccessibleFrames: 0,
      documentScrollSteps: 0,
      scrollSurfacesPrimed: 0,
      disclosuresAttempted: 0,
      disclosuresOpened: 0,
      detailsOpened: 0,
      disclosureButtonsOpened: 0,
    };
  }
  return primeInteractiveSurface(page, options);
}
