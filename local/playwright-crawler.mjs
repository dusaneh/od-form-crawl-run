import { chromium } from "playwright";
import {
  buildCrawlOutput,
  fingerprintPage,
  validateTargetUrl,
} from "../worker/crawler.ts";

const MAX_HTML_BYTES = 5_000_000;
const MAX_PAGES = 12;
const MAX_DISCOVERY_DEPTH = 1;
const MAX_DISCOVERED_LINKS_PER_PAGE = 8;
const FORMISH_PATH =
  /(apply|application|form|intake|register|signup|enroll|eligib|benefit|service|request|step|page|start|fixture)/i;
const SENSITIVE_FIELD =
  /(name|email|phone|mobile|address|birth|dob|ssn|social.?security|income|salary|password|medical|health|veteran|gender|race|ethnic)/i;

function isLoopback(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

export function validatePlaywrightTarget(value, { allowLoopback = false } = {}) {
  if (!allowLoopback) return validateTargetUrl(value);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Targets must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Targets cannot include embedded credentials.");
  }
  for (const key of url.searchParams.keys()) {
    if (/(token|secret|password|auth|session|signature|api.?key)/i.test(key)) {
      throw new Error("Targets cannot include credential-like query parameters.");
    }
  }
  if (!isLoopback(url.hostname)) return validateTargetUrl(value);
  url.hash = "";
  return url.toString();
}

function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticKey(value, index) {
  const normalized = humanize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || `field_${index + 1}`;
}

function dedupeFields(rawFields) {
  const result = [];
  const seen = new Map();
  for (const rawField of rawFields) {
    const baseKey = semanticKey(
      rawField.name || rawField.id || rawField.label,
      result.length
    );
    const canGroup = ["radio", "checkbox"].includes(rawField.control);
    const groupKey = canGroup && rawField.name ? `${rawField.frameUrl}|${baseKey}` : "";
    const existingIndex = groupKey ? seen.get(groupKey) : undefined;
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      existing.options += 1;
      existing.required ||= rawField.required;
      existing.sensitive ||= rawField.sensitive;
      existing.hidden &&= rawField.hidden;
      continue;
    }

    let key = baseKey;
    let suffix = 2;
    while (result.some((field) => field.key === key)) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    const field = {
      key,
      label: rawField.label || humanize(key),
      control: rawField.control,
      required: rawField.required,
      sensitive: rawField.sensitive,
      hidden: rawField.hidden,
      options: rawField.options,
      selector: rawField.selector,
      frameUrl: rawField.frameUrl,
      rendered: true,
    };
    if (groupKey) seen.set(groupKey, result.length);
    result.push(field);
  }
  return result;
}

async function extractFrame(frame, pageUrl) {
  return frame.evaluate(
    ({ pageUrl: evaluatedPageUrl, sensitivePattern }) => {
      const sensitive = new RegExp(sensitivePattern, "i");
      const roots = [document];
      let shadowRootCount = 0;
      for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) {
            roots.push(element.shadowRoot);
            shadowRootCount += 1;
          }
        }
      }

      const all = (selector) =>
        roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
      const text = (element) =>
        String(element?.innerText || element?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      const escapeAttribute = (value) =>
        String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const selectorFor = (element, index) => {
        if (element.id) return `#${escapeAttribute(element.id)}`;
        if (element.getAttribute("name")) {
          return `${element.tagName.toLowerCase()}[name="${escapeAttribute(
            element.getAttribute("name")
          )}"]`;
        }
        const role = element.getAttribute("role");
        if (role) return `[role="${escapeAttribute(role)}"]`;
        return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
      };
      const labelFor = (element) => {
        const fieldset = element.closest("fieldset");
        const legend = fieldset?.querySelector(":scope > legend");
        const labels = Array.from(element.labels || [])
          .map(text)
          .filter(Boolean);
        const labelledBy = String(element.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .map(text)
          .filter(Boolean);
        return (
          text(legend) ||
          labels.join(" / ") ||
          labelledBy.join(" / ") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.getAttribute("title") ||
          text(element.closest("label")) ||
          ""
        );
      };
      const hiddenFor = (element) => {
        if (
          element.getAttribute("type")?.toLowerCase() === "hidden" ||
          element.hidden ||
          element.getAttribute("aria-hidden") === "true"
        ) {
          return true;
        }
        const style = getComputedStyle(element);
        return (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          element.getClientRects().length === 0
        );
      };
      const controlType = (element) => {
        const tag = element.tagName.toLowerCase();
        if (tag === "input") return (element.getAttribute("type") || "text").toLowerCase();
        if (tag === "select" || tag === "textarea") return tag;
        return element.getAttribute("role") || (element.isContentEditable ? "textbox" : tag);
      };

      const selector =
        'input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]';
      const controls = all(selector);
      const fields = controls
        .filter((element) => {
          if (["button", "submit", "reset", "image"].includes(controlType(element))) {
            return false;
          }
          return !element.matches("button");
        })
        .map((element, index) => {
          const control = controlType(element);
          const label = labelFor(element);
          const name =
            element.getAttribute("name") ||
            element.getAttribute("data-field") ||
            element.getAttribute("aria-label") ||
            "";
          const id = element.id || "";
          const options =
            element.tagName.toLowerCase() === "select"
              ? element.querySelectorAll("option").length
              : ["radio", "checkbox"].includes(control)
                ? 1
                : 0;
          return {
            name,
            id,
            label,
            control,
            required:
              element.matches(":required") ||
              element.getAttribute("aria-required") === "true",
            sensitive:
              ["password", "email", "tel", "date"].includes(control) ||
              sensitive.test(
                `${name} ${id} ${label} ${element.getAttribute("autocomplete") || ""}`
              ),
            hidden: hiddenFor(element),
            options,
            selector: selectorFor(element, index),
          };
        });

      const forms = all("form");
      const actions = forms
        .map((form) => {
          try {
            return new URL(form.getAttribute("action") || evaluatedPageUrl, evaluatedPageUrl)
              .href;
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      const links = all("a[href]")
        .map((anchor) => {
          try {
            const url = new URL(anchor.getAttribute("href"), evaluatedPageUrl);
            url.hash = "";
            return { url: url.href, text: text(anchor).slice(0, 160) };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return {
        fields,
        forms: forms.length,
        formActions: [...new Set(actions)],
        links,
        hasScripts: all("script").length > 0,
        shadowRootCount,
      };
    },
    { pageUrl, sensitivePattern: SENSITIVE_FIELD.source }
  );
}

async function extractRenderedPage(page, requestedUrl, response, browserMode) {
  const finalUrl = page.url() || requestedUrl;
  const startedExtraction = Date.now();
  const mainOrigin = new URL(finalUrl).origin;
  const frameResults = [];

  for (const frame of page.frames()) {
    const frameUrl = frame.url() || finalUrl;
    let include = frame === page.mainFrame();
    if (!include) {
      try {
        include = new URL(frameUrl).origin === mainOrigin;
      } catch {
        include = false;
      }
    }
    if (!include) continue;
    try {
      const extracted = await extractFrame(frame, frameUrl);
      frameResults.push({ ...extracted, frameUrl });
    } catch {
      // A detached or inaccessible child frame should not invalidate its page.
    }
  }

  const fields = dedupeFields(
    frameResults.flatMap((result) =>
      result.fields.map((field) => ({ ...field, frameUrl: result.frameUrl }))
    )
  );
  const html = await page.content();
  const bytesFetched = Buffer.byteLength(html, "utf8");
  if (bytesFetched > MAX_HTML_BYTES) {
    throw new Error(
      `Rendered HTML exceeded the ${MAX_HTML_BYTES.toLocaleString()} byte limit.`
    );
  }
  const title = (await page.title()).trim().slice(0, 180);
  const heading = await page
    .locator("h1")
    .first()
    .textContent()
    .catch(() => "");
  const parsed = {
    title,
    heading: String(heading || "").replace(/\s+/g, " ").trim().slice(0, 180),
    forms:
      frameResults.reduce((sum, result) => sum + result.forms, 0) ||
      (fields.length ? 1 : 0),
    fields,
    formActions: [
      ...new Set(frameResults.flatMap((result) => result.formActions)),
    ],
    links: [
      ...new Map(
        frameResults
          .flatMap((result) => result.links)
          .map((link) => [link.url, link])
      ).values(),
    ].slice(0, 200),
    hasScripts: frameResults.some((result) => result.hasScripts),
  };
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: true,
    type: "png",
  });

  return {
    ...parsed,
    requestedUrl,
    finalUrl,
    httpStatus: response?.status() || 0,
    contentType: response?.headers()["content-type"] || "text/html",
    durationMs: Date.now() - startedExtraction,
    bytesFetched,
    fingerprint: fingerprintPage(parsed),
    html,
    screenshot: new Uint8Array(screenshot),
    screenshotContentType: "image/png",
    screenshotProvider: `playwright-local-${browserMode}`,
    rendered: true,
    renderEngine: "playwright-chromium",
    browserMode,
    frameCount: frameResults.length,
    shadowRootCount: frameResults.reduce(
      (sum, result) => sum + result.shadowRootCount,
      0
    ),
  };
}

function shouldDiscoverLink(link, source) {
  try {
    const candidate = new URL(link.url);
    const sourceUrl = new URL(source.finalUrl);
    if (candidate.origin !== sourceUrl.origin) return false;
    if (candidate.pathname === sourceUrl.pathname) return false;
    return FORMISH_PATH.test(`${candidate.pathname} ${link.text}`);
  } catch {
    return false;
  }
}

function failedPage(requestedUrl, error, durationMs) {
  return {
    requestedUrl,
    finalUrl: requestedUrl,
    httpStatus: 0,
    contentType: "",
    durationMs,
    bytesFetched: 0,
    fingerprint: "unavailable",
    title: "",
    heading: "",
    forms: 0,
    fields: [],
    formActions: [],
    links: [],
    hasScripts: false,
    rendered: true,
    renderEngine: "playwright-chromium",
    error: error instanceof Error ? error.message : "The browser crawl failed.",
  };
}

async function crawlOne(context, url, browserMode, onBrowserEvent) {
  const page = await context.newPage();
  const startedAt = Date.now();
  let blockedRequests = 0;
  await page.route("**/*", async (route) => {
    const method = route.request().method().toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      blockedRequests += 1;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
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

  try {
    await onBrowserEvent?.("browser_page_opened", `Opening ${url} in local Chromium.`, {
      browserMode,
    });
    const response = await page.goto(url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    const settleMs = Number.parseInt(
      process.env.FORMWEAVE_RENDER_SETTLE_MS || "700",
      10
    );
    await page.waitForTimeout(Math.max(0, Math.min(settleMs, 5_000)));
    if (browserMode === "headful") {
      const headedPauseMs = Number.parseInt(
        process.env.FORMWEAVE_HEADFUL_PAUSE_MS || "1200",
        10
      );
      await page.waitForTimeout(Math.max(300, Math.min(headedPauseMs, 10_000)));
    }
    if (!response) throw new Error("The browser navigation returned no response.");
    if (!response.ok()) {
      throw new Error(`Target returned HTTP ${response.status()}.`);
    }
    const pageResult = await extractRenderedPage(page, url, response, browserMode);
    pageResult.durationMs = Date.now() - startedAt;
    pageResult.blockedWriteRequests = blockedRequests;
    await onBrowserEvent?.(
      "browser_page_extracted",
      `Rendered and extracted ${pageResult.finalUrl}.`,
      {
        browserMode,
        fields: pageResult.fields.filter((field) => !field.hidden).length,
        forms: pageResult.forms,
        frames: pageResult.frameCount,
        shadowRoots: pageResult.shadowRootCount,
        blockedWriteRequests: blockedRequests,
      }
    );
    return pageResult;
  } catch (error) {
    return failedPage(url, error, Date.now() - startedAt);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function crawlTargetsWithPlaywright(
  urls,
  runId,
  {
    browserMode = "headless",
    allowLoopback = false,
    onProgress,
    onBrowserEvent,
  } = {}
) {
  if (!["headless", "headful"].includes(browserMode)) {
    throw new Error("Browser mode must be headless or headful.");
  }
  const queue = urls.map((url) => ({
    url: validatePlaywrightTarget(url, { allowLoopback }),
    depth: 0,
  }));
  const seen = new Set();
  const pages = [];
  await onBrowserEvent?.(
    "browser_launched",
    `Launching local Chromium in ${browserMode} mode.`,
    { browserMode }
  );
  const browser = await chromium.launch({
    headless: browserMode === "headless",
    slowMo: browserMode === "headful" ? 60 : 0,
  });
  const context = await browser.newContext({
    acceptDownloads: false,
    bypassCSP: false,
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    locale: "en-US",
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 },
  });

  try {
    while (queue.length && pages.length < MAX_PAGES) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      const page = await crawlOne(
        context,
        candidate.url,
        browserMode,
        onBrowserEvent
      );
      pages.push(page);
      if (!page.error && candidate.depth < MAX_DISCOVERY_DEPTH) {
        page.links
          .filter((link) => shouldDiscoverLink(link, page))
          .slice(0, MAX_DISCOVERED_LINKS_PER_PAGE)
          .forEach((link) => {
            if (!seen.has(link.url)) {
              queue.push({ url: link.url, depth: candidate.depth + 1 });
            }
          });
      }
      await onProgress?.({ pages: pages.length, queued: queue.length });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await onBrowserEvent?.(
      "browser_closed",
      `Closed the local ${browserMode} Chromium session.`,
      { browserMode }
    );
  }

  return buildCrawlOutput(pages, runId);
}
