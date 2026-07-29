export async function captureFullPageAndTiles(
  page,
  { tileHeight = 2_400, maxTiles = 12 } = {}
) {
  const full = await page.screenshot({
    animations: "disabled",
    fullPage: true,
    type: "png",
  });
  const dimensions = await page.evaluate(() => ({
    width: Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0,
      window.innerWidth
    ),
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
      window.innerHeight
    ),
  }));
  if (dimensions.height <= tileHeight * 2) {
    return {
      full: new Uint8Array(full),
      sensing: [new Uint8Array(full)],
      tiled: false,
      dimensions,
    };
  }
  const tileCount = Math.min(
    maxTiles,
    Math.ceil(dimensions.height / tileHeight)
  );
  const sensing = [];
  for (let index = 0; index < tileCount; index += 1) {
    const y = index * tileHeight;
    const height = Math.min(tileHeight, dimensions.height - y);
    if (height <= 0) break;
    try {
      const tile = await page.screenshot({
        animations: "disabled",
        type: "png",
        clip: {
          x: 0,
          y,
          width: Math.max(1, Math.min(dimensions.width, 1_440)),
          height,
        },
        captureBeyondViewport: true,
      });
      sensing.push(new Uint8Array(tile));
    } catch {
      break;
    }
  }
  return {
    full: new Uint8Array(full),
    sensing: sensing.length ? sensing : [new Uint8Array(full)],
    tiled: sensing.length > 0,
    dimensions,
    truncated: tileCount < Math.ceil(dimensions.height / tileHeight),
  };
}
