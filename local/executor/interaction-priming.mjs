const POINTER_PATH = Object.freeze([
  Object.freeze({ x: 0.12, y: 0.18, easing: "ease_in", durationMs: 160 }),
  Object.freeze({ x: 0.52, y: 0.24, easing: "ease_out", durationMs: 210 }),
  Object.freeze({ x: 0.82, y: 0.48, easing: "smooth", durationMs: 180 }),
  Object.freeze({ x: 0.42, y: 0.72, easing: "ease_in_out", durationMs: 250 }),
  Object.freeze({ x: 0.18, y: 0.86, easing: "ease_out", durationMs: 200 }),
]);

const PAGE_ONSET_MARKER = "__intakecrDeterministicPageOnsetV2";

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

async function applicantSurfaceSnapshot(page) {
  return page.mainFrame().evaluate(() => {
    const visible = (element) => {
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
    const applicantControls = [
      ...document.querySelectorAll(
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), select, textarea",
      ),
    ];
    const keyFor = (element, index) =>
      element.id ||
      element.getAttribute("name") ||
      `${element.tagName.toLowerCase()}:${element.getAttribute("type") || ""}:${index}`;
    return {
      visibleApplicantControls: applicantControls
        .map((element, index) => ({ element, key: keyFor(element, index) }))
        .filter(({ element }) => visible(element))
        .map(({ key }) => key),
      visibleForms: [...document.querySelectorAll("form")]
        .map((element, index) => ({
          element,
          key: element.id || element.getAttribute("name") || `form:${index}`,
        }))
        .filter(({ element }) => visible(element))
        .map(({ key }) => key),
    };
  });
}

async function primeFrameScrolling(
  frame,
  { maxDocumentSteps },
) {
  return frame.evaluate(
    async ({ documentSteps }) => {
      const nextFrame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const result = {
        documentScrollSteps: 0,
        scrollSurfacesPrimed: 0,
        scrollSurfacesDeferred: 0,
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
      // Nested scroll regions can be application controls: scrolling a terms
      // panel may enable an acceptance button. Merely seeing overflow is not
      // enough authority to actuate it. Leave those regions untouched so the
      // generated per-form actuator can own and verify any required sequence.
      result.scrollSurfacesDeferred = [...document.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.scrollHeight > element.clientHeight + 8 &&
            ["auto", "scroll"].includes(style.overflowY)
          );
        }).length;
      window.scrollTo({ top: startingY, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
      return result;
    },
    {
      documentSteps: maxDocumentSteps,
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
  } = {},
) {
  const beforeSurface = await applicantSurfaceSnapshot(page).catch(() => ({
    visibleApplicantControls: [],
    visibleForms: [],
  }));
  const pointer = await movePointerDeterministically(page);
  const result = {
    pageOnsetPerformed: true,
    ...pointer,
    framesPrimed: 0,
    inaccessibleFrames: 0,
    documentScrollSteps: 0,
    scrollSurfacesPrimed: 0,
    scrollSurfacesDeferred: 0,
    disclosuresAttempted: 0,
    disclosuresOpened: 0,
    detailsOpened: 0,
    disclosureButtonsOpened: 0,
  };
  for (const frame of page.frames()) {
    try {
      const scrolled = await primeFrameScrolling(frame, {
        maxDocumentSteps,
      });
      result.framesPrimed += 1;
      result.documentScrollSteps += scrolled.documentScrollSteps;
      result.scrollSurfacesPrimed += scrolled.scrollSurfacesPrimed;
      result.scrollSurfacesDeferred += scrolled.scrollSurfacesDeferred;
    } catch {
      result.inaccessibleFrames += 1;
    }
  }
  await page.waitForTimeout(100).catch(() => {});
  const afterSurface = await applicantSurfaceSnapshot(page).catch(() => ({
    visibleApplicantControls: [],
    visibleForms: [],
  }));
  const beforeControls = new Set(beforeSurface.visibleApplicantControls);
  const beforeForms = new Set(beforeSurface.visibleForms);
  result.revealedApplicantControls = afterSurface.visibleApplicantControls.filter(
    (key) => !beforeControls.has(key),
  ).length;
  result.revealedForms = afterSurface.visibleForms.filter(
    (key) => !beforeForms.has(key),
  ).length;
  result.interactionGatePrepared =
    result.revealedApplicantControls > 0 || result.revealedForms > 0;
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
      scrollSurfacesDeferred: 0,
      disclosuresAttempted: 0,
      disclosuresOpened: 0,
      detailsOpened: 0,
      disclosureButtonsOpened: 0,
      revealedApplicantControls: 0,
      revealedForms: 0,
      interactionGatePrepared: false,
    };
  }
  return primeInteractiveSurface(page, options);
}
