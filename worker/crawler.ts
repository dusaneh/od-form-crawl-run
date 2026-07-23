import type {
  FieldContract,
  Finding,
  FlowEdge,
  FlowNode,
} from "../app/lib/models";

export type ParsedLink = {
  url: string;
  text: string;
};

export type ParsedPage = {
  title: string;
  heading: string;
  forms: number;
  fields: Omit<FieldContract, "originState" | "originUrl">[];
  formActions: string[];
  links: ParsedLink[];
  hasScripts: boolean;
};

export type CrawlPage = ParsedPage & {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  durationMs: number;
  bytesFetched: number;
  fingerprint: string;
  html?: string;
  screenshot?: Uint8Array;
  screenshotContentType?: string;
  screenshotProvider?: string;
  error?: string;
};

export type CrawlOutput = {
  pages: CrawlPage[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  contract: FieldContract[];
  findings: Finding[];
};

type Attrs = Record<string, string>;

const MAX_HTML_BYTES = 1_500_000;
const MAX_PAGES = 12;
const MAX_DISCOVERY_DEPTH = 1;
const FORMISH_PATH =
  /(apply|application|form|intake|register|signup|enroll|eligib|benefit|service|request|step|page|start)/i;
const SENSITIVE_FIELD =
  /(name|email|phone|mobile|address|birth|dob|ssn|social.?security|income|salary|password|medical|health|veteran|gender|race|ethnic)/i;

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function cleanText(value: string) {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttrs(raw: string): Attrs {
  const attrs: Attrs = {};
  const expression =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(raw))) {
    const key = match[1].toLowerCase();
    attrs[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticKey(value: string, index: number) {
  const normalized = humanize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || `field_${index + 1}`;
}

function selectorFor(attrs: Attrs, tag: string, index: number) {
  if (attrs.id) return `#${attrs.id.replace(/["\\]/g, "\\$&")}`;
  if (attrs.name) return `${tag}[name="${attrs.name.replace(/["\\]/g, "\\$&")}"]`;
  return `${tag}:nth-of-type(${index + 1})`;
}

function labelMapFor(html: string) {
  const labels = new Map<string, string>();
  const expression = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(html))) {
    const attrs = parseAttrs(match[1]);
    if (attrs.for) labels.set(attrs.for, cleanText(match[2]));
  }
  return labels;
}

function wrappingLabel(html: string, offset: number) {
  const start = Math.max(0, offset - 500);
  const before = html.slice(start, offset);
  const openAt = before.toLowerCase().lastIndexOf("<label");
  const closedAt = before.toLowerCase().lastIndexOf("</label>");
  if (openAt < 0 || openAt < closedAt) return "";
  const absoluteOpen = start + openAt;
  const end = html.toLowerCase().indexOf("</label>", offset);
  if (end < 0 || end - absoluteOpen > 800) return "";
  const openEnd = html.indexOf(">", absoluteOpen);
  if (openEnd < 0 || openEnd > offset) return "";
  return cleanText(html.slice(openEnd + 1, end));
}

function parseControls(html: string) {
  const labels = labelMapFor(html);
  const fields: ParsedPage["fields"] = [];
  const expression =
    /<(input|select|textarea|button)\b([^>]*)(?:>([\s\S]*?)<\/\1\s*>|\/?>)/gi;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(html))) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttrs(match[2]);
    const body = match[3] ?? "";
    const inputType = (attrs.type || (tag === "input" ? "text" : tag)).toLowerCase();
    if (tag === "button" || ["submit", "reset", "button", "image"].includes(inputType)) {
      continue;
    }

    const hidden = inputType === "hidden" || "hidden" in attrs;
    const label =
      (attrs.id && labels.get(attrs.id)) ||
      attrs["aria-label"] ||
      wrappingLabel(html, match.index) ||
      attrs.placeholder ||
      cleanText(body) ||
      humanize(attrs.name || attrs.id || "");
    const sourceName = attrs.name || attrs.id || label;
    const key = semanticKey(sourceName, fields.length);
    const sensitive =
      ["password", "email", "tel", "date"].includes(inputType) ||
      SENSITIVE_FIELD.test(
        `${sourceName} ${label} ${attrs.autocomplete ?? ""}`
      );
    const options =
      tag === "select"
        ? (body.match(/<option\b/gi) ?? []).length
        : ["radio", "checkbox"].includes(inputType)
          ? 1
          : 0;

    fields.push({
      key,
      label: label || humanize(key),
      control: tag === "input" ? inputType : tag,
      required: "required" in attrs || attrs["aria-required"] === "true",
      sensitive,
      hidden,
      options,
      selector: selectorFor(attrs, tag, fields.length),
    });
  }
  return fields;
}

function dedupeFields(fields: ParsedPage["fields"]) {
  const result: ParsedPage["fields"] = [];
  const seen = new Map<string, number>();
  fields.forEach((field) => {
    const existingIndex = seen.get(field.key);
    if (
      existingIndex !== undefined &&
      ["radio", "checkbox"].includes(field.control) &&
      result[existingIndex].control === field.control
    ) {
      result[existingIndex] = {
        ...result[existingIndex],
        options: result[existingIndex].options + Math.max(1, field.options),
        required: result[existingIndex].required || field.required,
        sensitive: result[existingIndex].sensitive || field.sensitive,
      };
      return;
    }
    if (existingIndex === undefined) {
      seen.set(field.key, result.length);
      result.push(field);
      return;
    }
    let suffix = 2;
    let key = `${field.key}_${suffix}`;
    while (seen.has(key)) {
      suffix += 1;
      key = `${field.key}_${suffix}`;
    }
    seen.set(key, result.length);
    result.push({ ...field, key });
  });
  return result;
}

export function parsePageHtml(html: string, pageUrl: string): ParsedPage {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const formActions = forms
    .map((match) => absoluteUrl(parseAttrs(match[1]).action || pageUrl, pageUrl))
    .filter(Boolean);

  const controlSource = forms.length
    ? forms.map((match) => match[2]).join("\n")
    : html;
  const fields = dedupeFields(parseControls(controlSource));

  const links: ParsedLink[] = [];
  const seenLinks = new Set<string>();
  const linkExpression = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkExpression.exec(html))) {
    const href = parseAttrs(linkMatch[1]).href;
    const url = href ? absoluteUrl(href, pageUrl) : "";
    if (!url || seenLinks.has(url)) continue;
    seenLinks.add(url);
    links.push({ url, text: cleanText(linkMatch[2]).slice(0, 160) });
  }

  return {
    title: cleanText(titleMatch?.[1] ?? "").slice(0, 180),
    heading: cleanText(headingMatch?.[1] ?? "").slice(0, 180),
    forms: forms.length || (fields.length ? 1 : 0),
    fields,
    formActions: [...new Set(formActions)],
    links: links.slice(0, 100),
    hasScripts: /<script\b/i.test(html),
  };
}

export function fingerprintPage(page: ParsedPage) {
  const source = JSON.stringify({
    title: page.title,
    heading: page.heading,
    forms: page.forms,
    actions: page.formActions,
    fields: page.fields.map((field) => [
      field.key,
      field.control,
      field.required,
      field.options,
    ]),
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 4)}·${hex.slice(4)}`;
}

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function validateTargetUrl(value: string) {
  let url: URL;
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
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Private-network targets are not allowed.");
  }
  url.hash = "";
  return url.toString();
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function captureScreenshot(url: string) {
  const endpoint =
    "https://image.thum.io/get/png/noanimate/width/1200/crop/900/maxAge/0/?url=" +
    encodeURIComponent(url);
  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        accept: "image/png,image/*;q=0.9",
        "user-agent": "FormWeave Evidence Capture/1.0",
      },
    },
    22_000
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error(`Screenshot service returned ${response.status}.`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength < 1_000 || body.byteLength > 8_000_000) {
    throw new Error("Screenshot response size was invalid.");
  }
  return { body, contentType, provider: "thum.io" };
}

export async function crawlPage(url: string): Promise<CrawlPage> {
  const requestedUrl = validateTargetUrl(url);
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(
      requestedUrl,
      {
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2",
          "accept-language": "en-US,en;q=0.8",
          "user-agent":
            "FormWeaveCrawler/1.0 (+https://formweave-control-plane.dusanyu.chatgpt.site)",
        },
      },
      15_000
    );
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || requestedUrl;
    if (!response.ok) {
      throw new Error(`Target returned HTTP ${response.status}.`);
    }
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      throw new Error(`Expected HTML but received ${contentType || "an unknown content type"}.`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
      throw new Error(`HTML exceeded the ${MAX_HTML_BYTES.toLocaleString()} byte limit.`);
    }
    const html = new TextDecoder().decode(buffer);
    const parsed = parsePageHtml(html, finalUrl);
    const page: CrawlPage = {
      ...parsed,
      requestedUrl,
      finalUrl,
      httpStatus: response.status,
      contentType,
      durationMs: Date.now() - started,
      bytesFetched: buffer.byteLength,
      fingerprint: fingerprintPage(parsed),
      html,
    };

    try {
      const screenshot = await captureScreenshot(finalUrl);
      page.screenshot = screenshot.body;
      page.screenshotContentType = screenshot.contentType;
      page.screenshotProvider = screenshot.provider;
    } catch {
      // A screenshot is useful evidence but must not erase successful crawl data.
    }
    return page;
  } catch (error) {
    return {
      requestedUrl,
      finalUrl: requestedUrl,
      httpStatus: 0,
      contentType: "",
      durationMs: Date.now() - started,
      bytesFetched: 0,
      fingerprint: "unavailable",
      title: "",
      heading: "",
      forms: 0,
      fields: [],
      formActions: [],
      links: [],
      hasScripts: false,
      error: error instanceof Error ? error.message : "The target could not be fetched.",
    };
  }
}

function shouldDiscoverLink(link: ParsedLink, source: CrawlPage) {
  try {
    const candidate = new URL(link.url);
    const origin = new URL(source.finalUrl).origin;
    if (candidate.origin !== origin) return false;
    if (candidate.pathname === new URL(source.finalUrl).pathname) return false;
    return FORMISH_PATH.test(`${candidate.pathname} ${link.text}`);
  } catch {
    return false;
  }
}

function pageTitle(page: CrawlPage) {
  if (page.error) return new URL(page.requestedUrl).hostname;
  return (
    page.heading ||
    page.title ||
    new URL(page.finalUrl).pathname.split("/").filter(Boolean).pop() ||
    new URL(page.finalUrl).hostname
  );
}

export function buildCrawlOutput(pages: CrawlPage[], runId: string): CrawlOutput {
  const contract: FieldContract[] = [];
  const nodes: FlowNode[] = pages.map((page, index) => {
    const nodeId = `page_${String(index + 1).padStart(2, "0")}`;
    const visibleFields = page.fields.filter((field) => !field.hidden);
    const pageContract = page.fields.map((field) => ({
      ...field,
      originState: nodeId,
      originUrl: page.finalUrl,
    }));
    contract.push(...pageContract);
    const notes = page.error
      ? [page.error]
      : [
          `Fetched ${page.bytesFetched.toLocaleString()} bytes from the public page.`,
          `${page.forms} form${page.forms === 1 ? "" : "s"} and ${visibleFields.length} visible field${visibleFields.length === 1 ? "" : "s"} detected.`,
          page.hasScripts
            ? "Client-side scripts are present; dynamic states require operator review."
            : "No client-side script tag was observed in the fetched HTML.",
        ];
    if (!page.screenshot) notes.push("Screenshot capture was unavailable; crawl data is still preserved.");

    return {
      id: nodeId,
      step: String(index + 1).padStart(2, "0"),
      title: pageTitle(page).slice(0, 80),
      subtitle: page.error
        ? "Fetch failed"
        : `${page.httpStatus} · ${page.forms} forms · ${visibleFields.length} fields`,
      fingerprint: page.fingerprint,
      status: page.error ? "review" : "complete",
      fields: visibleFields.length,
      branches: page.formActions.length,
      x: 34 + index * 224,
      y: 146 + (index % 2 === 1 && pages.length > 4 ? 110 : 0),
      evidence: page.screenshot
        ? `/api/runs/${encodeURIComponent(runId)}/evidence/${nodeId}`
        : "",
      evidenceAvailable: Boolean(page.screenshot),
      sourceUrl: page.finalUrl,
      pageTitle: page.title,
      httpStatus: page.httpStatus,
      durationMs: page.durationMs,
      forms: page.forms,
      fieldDetails: pageContract,
      formActions: page.formActions,
      screenshotProvider: page.screenshotProvider,
      sensitiveMasks: 0,
      notes,
    };
  });

  const edges: FlowEdge[] = [];
  pages.forEach((page, index) => {
    page.formActions.forEach((action, actionIndex) => {
      const destination = pages.findIndex(
        (candidate) =>
          candidate.finalUrl === action || candidate.requestedUrl === action
      );
      if (destination >= 0 && destination !== index) {
        edges.push({
          id: `action_${index}_${actionIndex}`,
          from: nodes[index].id,
          to: nodes[destination].id,
          label: "form action",
          status: "observed",
          kind: "advance",
        });
      }
    });
  });

  if (!edges.length && nodes.length > 1) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({
        id: `target_${index}`,
        from: nodes[index].id,
        to: nodes[index + 1].id,
        label: "crawl target",
        status: "observed",
        kind: "advance",
      });
    }
  }

  const fetched = pages.filter((page) => !page.error);
  const failed = pages.filter((page) => page.error);
  const screenshotCount = pages.filter((page) => page.screenshot).length;
  const findings: Finding[] = [
    {
      id: `${runId}_summary`,
      tone: failed.length ? "warning" : "success",
      code: "crawl_finished",
      title: `${fetched.length} page${fetched.length === 1 ? "" : "s"} fetched`,
      detail: `${contract.filter((field) => !field.hidden).length} visible fields across ${fetched.reduce((sum, page) => sum + page.forms, 0)} forms were extracted from the returned HTML.`,
      time: "now",
    },
    {
      id: `${runId}_evidence`,
      tone: screenshotCount === pages.length ? "success" : "warning",
      code: "evidence_captured",
      title: `${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"} stored`,
      detail:
        "Captures were taken in a fresh unauthenticated browser context. No form values were entered.",
      time: "now",
    },
  ];
  if (pages.some((page) => page.hasScripts)) {
    findings.push({
      id: `${runId}_dynamic`,
      tone: "warning",
      code: "dynamic_review_required",
      title: "Client-side behavior detected",
      detail:
        "The HTML crawl is real, but script-driven conditional states are not certified automatically in this runtime.",
      time: "now",
    });
  }
  failed.forEach((page, index) => {
    findings.push({
      id: `${runId}_failed_${index}`,
      tone: "danger",
      code: "target_fetch_failed",
      title: `Could not fetch ${new URL(page.requestedUrl).hostname}`,
      detail: page.error ?? "The request failed.",
      time: "now",
    });
  });

  return { pages, nodes, edges, contract, findings };
}

export async function crawlTargets(
  urls: string[],
  runId: string,
  onProgress?: (state: { pages: number; queued: number }) => Promise<void> | void
) {
  const queue = urls.map((url) => ({ url: validateTargetUrl(url), depth: 0 }));
  const seen = new Set<string>();
  const pages: CrawlPage[] = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const batch: { url: string; depth: number }[] = [];
    while (queue.length && batch.length < 3 && pages.length + batch.length < MAX_PAGES) {
      const candidate = queue.shift()!;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      batch.push(candidate);
    }
    if (!batch.length) continue;

    const crawled = await Promise.all(batch.map((item) => crawlPage(item.url)));
    pages.push(...crawled);
    crawled.forEach((page, index) => {
      const depth = batch[index].depth;
      if (page.error || depth >= MAX_DISCOVERY_DEPTH) return;
      page.links
        .filter((link) => shouldDiscoverLink(link, page))
        .slice(0, 3)
        .forEach((link) => {
          if (!seen.has(link.url)) queue.push({ url: link.url, depth: depth + 1 });
        });
    });
    await onProgress?.({ pages: pages.length, queued: queue.length });
  }

  return buildCrawlOutput(pages, runId);
}
