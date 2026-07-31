const POINTER_POINTS = Object.freeze([
  [0.12, 0.18],
  [0.52, 0.24],
  [0.82, 0.48],
  [0.42, 0.72],
  [0.18, 0.86],
]);

async function primeFrame(frame, { maxDocumentSteps, maxScrollSurfaces }) {
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

export async function primeInteractiveSurface(
  page,
  {
    maxDocumentSteps = 20,
    maxScrollSurfaces = 60,
  } = {},
) {
  const viewport = page.viewportSize() || { width: 1440, height: 1000 };
  let pointerMoves = 0;
  for (const [x, y] of POINTER_POINTS) {
    await page.mouse
      .move(Math.round(viewport.width * x), Math.round(viewport.height * y), {
        steps: 3,
      })
      .then(() => {
        pointerMoves += 1;
      })
      .catch(() => {});
  }

  const result = {
    pointerMoves,
    framesPrimed: 0,
    inaccessibleFrames: 0,
    documentScrollSteps: 0,
    scrollSurfacesPrimed: 0,
  };
  for (const frame of page.frames()) {
    try {
      const frameResult = await primeFrame(frame, {
        maxDocumentSteps,
        maxScrollSurfaces,
      });
      result.framesPrimed += 1;
      result.documentScrollSteps += frameResult.documentScrollSteps;
      result.scrollSurfacesPrimed += frameResult.scrollSurfacesPrimed;
    } catch {
      result.inaccessibleFrames += 1;
    }
  }
  return result;
}
