import type {
  FieldContract,
  Finding,
  FlowEdge,
  FlowNode,
  GuidanceRecord,
  SectionRecord,
} from "../app/lib/models";
import {
  FINGERPRINT_ALGORITHM_VERSION,
  extractStructuralFingerprintFacts,
  fingerprintArtifact,
} from "./fingerprint.ts";

export type ParsedLink = {
  url: string;
  text: string;
};

export type ParsedPage = {
  normalizedUrl?: string;
  title: string;
  heading: string;
  forms: number;
  fields: Omit<FieldContract, "originState" | "originUrl">[];
  guidanceRecords?: GuidanceRecord[];
  sections?: SectionRecord[];
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
  fingerprintAlgorithmVersion: typeof FINGERPRINT_ALGORITHM_VERSION;
  fingerprintInput?: ReturnType<typeof fingerprintPageInput>;
  html?: string;
  screenshot?: Uint8Array;
  screenshotContentType?: string;
  screenshotProvider?: string;
  rendered?: boolean;
  renderEngine?: string;
  browserMode?: "headless" | "headful";
  frameCount?: number;
  shadowRootCount?: number;
  blockedWriteRequests?: number;
  allowedReadLikeRequests?: number;
  automationActions?: {
    category: string;
    label: string;
    strategy: string;
    beforeFingerprint?: string;
    afterFingerprint?: string;
    changed?: boolean;
    timestamp: string;
    stateId?: string;
    testValue?: string;
    outcome?: "landed" | "could_not_test";
    failureCode?: string;
    rationale?: string;
    error?: string;
  }[];
  captchaDetected?: boolean;
  unresolvedGate?: string;
  stateExaminations?: number;
  stateEvidence?: {
    id: string;
    sequence: number;
    kind: string;
    label: string;
    url: string;
    title: string;
    fingerprint: string;
    capturedAt: string;
    fieldsVisible: number;
    values: {
      fieldKey: string;
      label: string;
      value: string;
      source: string;
      control?: string;
      required?: boolean;
      sensitive?: boolean;
      adminAssisted?: boolean;
      classification?: string;
      rationale?: string;
      verified?: boolean;
    }[];
    screenshot?: Uint8Array;
    screenshotContentType?: string;
    screenshotProvider?: string;
  }[];
  fieldsEntered?: number;
  entryFailures?: number;
  branchStates?: number;
  submissionsAttempted?: number;
  submissionsSucceeded?: number;
  finalSubmission?:
    | "blocked"
    | "submitted"
    | "submitted_unverified"
    | "not_found"
    | "not_requested";
  submissionResult?: {
    verified: boolean;
    outcome: "success" | "failure" | "unknown";
    source: string;
    detail: string;
    criteria?: {
      assessmentId: string;
      confidence: "high" | "medium" | "low";
      markers: string[];
      rationale: string;
    } | null;
    provenance?: {
      generatedAt: string;
      model: string;
      promptVersion: string;
      responseId?: string | null;
      durationMs?: number;
    } | null;
    transport?: {
      clicked?: boolean;
      submitEventObserved?: boolean;
      writeRequestObserved?: boolean;
      verified: boolean;
      navigationStatus: number | null;
      stateChanged: boolean;
      detail: string;
    } | null;
  } | null;
  certificationStatus?:
    | "probe_completed"
    | "generated_script_validated"
    | "fixture_submitted"
    | "could_not_test"
    | "branching_logic_detected"
    | "script_missing"
    | "no_form";
  reconScriptId?: string;
  reconScriptVersion?: number;
  generatedArtifact?: {
    artifactId: string;
    scriptVersion: number;
    sourceHash: string;
    path: string;
    modelCalls: number;
    states: number;
  } | null;
  journeyUrls?: string[];
  entryMode?: "canonical" | "mid_flow" | "unknown";
  entryDetail?: string;
  journeyComplete?: boolean;
  haltReason?: string;
  semanticGenerationError?: string;
  semanticInteractionOccurred?: boolean;
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
    const optionSet =
      tag === "select"
        ? [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(
            (option) => {
              const optionAttrs = parseAttrs(option[1]);
              const optionLabel = cleanText(option[2]);
              return {
                value: optionAttrs.value ?? optionLabel,
                label: optionLabel,
              };
            }
          )
        : ["radio", "checkbox"].includes(inputType)
          ? [
              {
                value: attrs.value || "true",
                label: label || attrs.value || "true",
              },
            ]
          : [];

    fields.push({
      name: attrs.name || "",
      id: attrs.id || "",
      key,
      label: label || humanize(key),
      control: tag === "input" ? inputType : tag,
      required: "required" in attrs || attrs["aria-required"] === "true",
      sensitive,
      hidden,
      options,
      optionSet,
      optionValues: optionSet.map((option) => option.value),
      selector: selectorFor(attrs, tag, fields.length),
      selectorCandidates: [selectorFor(attrs, tag, fields.length)],
      requiredSource:
        "required" in attrs
          ? "required_attribute"
          : attrs["aria-required"] === "true"
            ? "aria_required"
            : "not_observed",
      validation: {
        pattern: attrs.pattern || "",
        min: attrs.min || "",
        max: attrs.max || "",
        minLength: attrs.minlength || "",
        maxLength: attrs.maxlength || "",
      },
      upload: {
        accept: attrs.accept || "",
        maxSize: attrs["data-max-file-size"] || attrs["data-maxsize"] || "",
        maxFiles: attrs["data-max-files"] || ("multiple" in attrs ? "" : "1"),
      },
      consent: /\b(?:consent|agree|authorize|terms|privacy)\b/i.test(
        `${label} ${attrs.name || ""} ${attrs.id || ""}`
      ),
      adminAssisted: /\b(?:admin|administrator|staff|case worker|assisted)\b/i.test(
        `${label} ${attrs.name || ""} ${attrs.id || ""}`
      ),
      canonicalProfileKey: "unmappable",
      repeatableSection: "",
      addRowControl: "",
      otherSpecifyFor: /\bother\b/i.test(label)
        ? attrs.name || attrs.id || label
        : "",
      sectionText: cleanText(html).slice(0, 800),
      formId: "",
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
        optionSet: [
          ...new Map(
            [
              ...(result[existingIndex].optionSet || []),
              ...(field.optionSet || []),
            ].map((option) => [option.value, option])
          ).values(),
        ],
        optionValues: [
          ...new Set([
            ...(result[existingIndex].optionValues || []),
            ...(field.optionValues || []),
          ]),
        ],
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
    normalizedUrl: absoluteUrl(pageUrl, pageUrl),
    title: cleanText(titleMatch?.[1] ?? "").slice(0, 180),
    heading: cleanText(headingMatch?.[1] ?? "").slice(0, 180),
    forms: forms.length || (fields.length ? 1 : 0),
    fields,
    formActions: [...new Set(formActions)],
    links: links.slice(0, 100),
    hasScripts: /<script\b/i.test(html),
  };
}

export function fingerprintPageInput(page: ParsedPage) {
  return extractStructuralFingerprintFacts(page);
}

export function fingerprintPage(page: ParsedPage) {
  return fingerprintArtifact(page).digest;
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
            "FormWeaveLocalCrawler/1.0",
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
      fingerprintAlgorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
      fingerprintInput: fingerprintPageInput(parsed),
      html,
    };

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
      fingerprintAlgorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
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
          ...(page.semanticGenerationError
            ? [
                `The page loaded, but IntakeCR could not generate a valid automation script: ${page.semanticGenerationError}`,
                page.semanticInteractionOccurred
                  ? "The failure stopped further form interaction; the current rendered observation, field inventory, and screenshot were retained."
                  : "No form interaction was attempted; the rendered observation, field inventory, and screenshot were retained.",
              ]
            : []),
          `${page.rendered ? "Rendered and serialized" : "Fetched"} ${page.bytesFetched.toLocaleString()} bytes from the public page.`,
          `${page.forms} form${page.forms === 1 ? "" : "s"} and ${visibleFields.length} visible field${visibleFields.length === 1 ? "" : "s"} detected.`,
          page.hasScripts
            ? page.rendered
              ? "Client-side scripts executed; unvisited conditional state transitions still require operator review."
              : "Client-side scripts are present; dynamic states require operator review."
            : "No client-side script tag was observed in the fetched HTML.",
          page.automationActions?.length
            ? `${page.automationActions.length} predictable traversal action${page.automationActions.length === 1 ? "" : "s"} completed before extraction.`
            : page.semanticGenerationError && page.semanticInteractionOccurred
              ? "The semantic traversal had already begun; the current rendered state was retained when later script generation failed."
            : "No control actuation occurred before extraction.",
          page.fieldsEntered
            ? `${page.fieldsEntered} synthetic field entr${page.fieldsEntered === 1 ? "y was" : "ies were"} exercised across ${page.stateEvidence?.length || 0} captured states.`
            : page.semanticGenerationError && page.semanticInteractionOccurred
              ? "The current rendered values were retained, but the interrupted semantic traversal could not provide a complete entered-field count."
            : "No synthetic field values were entered on this page.",
          page.semanticGenerationError
            ? "Semantic script generation failed; this page remains observation-only."
            : page.reconScriptId
            ? `Form-specific recon script ${page.reconScriptId}@${page.reconScriptVersion || 0} owned sequencing.`
            : "No LLM-generated form script matched; this page was extract-and-observe only.",
          page.entryMode === "mid_flow"
            ? `Partial journey: the supplied URL began after the first visible form step. ${page.entryDetail || ""}`.trim()
            : page.entryMode === "canonical"
              ? `Canonical entry observed. ${page.entryDetail || ""}`.trim()
              : `Journey entry could not be proven canonical. ${page.entryDetail || ""}`.trim(),
          page.journeyComplete === false
            ? `Journey halted after retaining prior states. ${page.haltReason || "See the failed action and state evidence."}`
            : `${page.journeyUrls?.length || 1} journey URL${(page.journeyUrls?.length || 1) === 1 ? "" : "s"} retained in this report page.`,
        ];
    if (!page.screenshot) notes.push("Screenshot capture was unavailable; crawl data is still preserved.");

    return {
      id: nodeId,
      step: String(index + 1).padStart(2, "0"),
      title: pageTitle(page).slice(0, 80),
      subtitle: page.error
        ? "Fetch failed"
        : page.semanticGenerationError
          ? `Script generation failed · ${visibleFields.length} fields retained`
        : `${page.httpStatus} · ${page.forms} forms · ${visibleFields.length} fields`,
      fingerprint: page.fingerprint,
      status:
        page.error ||
        page.semanticGenerationError ||
        page.captchaDetected ||
        page.unresolvedGate
          ? "review"
          : "complete",
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
      stateEvidence: [],
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

  const pageNodes = [...nodes];
  pages.forEach((page, pageIndex) => {
    const pageNode = pageNodes[pageIndex];
    let previousNodeId = pageNode.id;
    for (const [stateIndex, state] of (page.stateEvidence || []).entries()) {
      const stateNodeId = `${pageNode.id}_${state.id}`;
      const action = (page.automationActions || []).find(
        (candidate) => candidate.stateId === state.id
      );
      const halted = Boolean(action?.error || action?.outcome === "could_not_test");
      nodes.push({
        id: stateNodeId,
        step: `${pageNode.step}.${stateIndex + 1}`,
        title: state.label.slice(0, 80),
        subtitle: `${state.kind.replaceAll("_", " ")} · ${state.fieldsVisible} visible fields`,
        fingerprint: state.fingerprint,
        status: halted
          ? "review"
          : state.kind === "blocked_final"
            ? "locked"
            : "complete",
        fields: state.fieldsVisible,
        branches: state.kind === "branch" ? 1 : 0,
        x: pageNode.x + (stateIndex + 1) * 224,
        y:
          pageNode.y +
          (state.kind === "branch" ? 110 : stateIndex % 2 === 1 ? 50 : 0),
        evidence: `/api/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(stateNodeId)}`,
        evidenceAvailable: Boolean(state.screenshot),
        sourceUrl: state.url,
        pageTitle: state.title,
        screenshotProvider: state.screenshotProvider,
        stateEvidence: [],
        sensitiveMasks: 0,
        notes: [
          `${state.values.length} synthetic value${state.values.length === 1 ? "" : "s"} present at capture.`,
          ...(action?.failureCode
            ? [`Halted: ${action.failureCode} · ${action.error || action.rationale || ""}`]
            : []),
        ],
      });
      edges.push({
        id: `state_${pageIndex}_${stateIndex}`,
        from: previousNodeId,
        to: stateNodeId,
        label:
          state.kind === "branch" && action?.testValue
            ? `${action.label} = ${action.testValue}`
            : action?.label || state.kind.replaceAll("_", " "),
        status: halted ? "halted" : "verified",
        kind:
          halted
            ? "halt"
            : state.kind === "branch"
              ? "branch"
              : "advance",
      });
      previousNodeId = stateNodeId;
    }
  });

  const fetched = pages.filter((page) => !page.error);
  const failed = pages.filter((page) => page.error);
  const screenshotCount = pages.reduce(
    (count, page) =>
      count +
      (page.screenshot ? 1 : 0) +
      (page.stateEvidence || []).filter((state) => state.screenshot).length,
    0
  );
  const findings: Finding[] = [
    {
      id: `${runId}_summary`,
      tone:
        failed.length || pages.some((page) => page.semanticGenerationError)
          ? "warning"
          : "success",
      code: "crawl_finished",
      title: `${fetched.length} page${fetched.length === 1 ? "" : "s"} fetched`,
      detail: `${contract.filter((field) => !field.hidden).length} visible fields across ${fetched.reduce((sum, page) => sum + page.forms, 0)} forms were extracted from observed page content.`,
      time: "now",
    },
    {
      id: `${runId}_evidence`,
      tone: screenshotCount >= pages.length ? "success" : "warning",
      code: "evidence_captured",
      title: `${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"} stored`,
      detail:
        "Captures were taken in a fresh browser context. State evidence may contain clearly synthetic test values entered during traversal.",
      time: "now",
    },
  ];
  pages
    .filter((page) => page.semanticGenerationError)
    .forEach((page, index) => {
      findings.push({
        id: `${runId}_semantic_script_failed_${index}`,
        tone: "danger",
        code: "semantic_script_generation_failed",
        title: "Rendered page retained, but automation script generation failed",
        detail: `The page loaded and ${page.fields.filter((field) => !field.hidden).length} visible fields were captured. IntakeCR could not produce a valid semantic automation script: ${page.semanticGenerationError} ${page.semanticInteractionOccurred ? "The failure stopped further interaction and retained the current rendered state." : "No form interaction was attempted."}`,
        time: "now",
      });
    });
  if (pages.some((page) => page.hasScripts)) {
    findings.push({
      id: `${runId}_dynamic`,
      tone: "warning",
      code: "dynamic_review_required",
      title: "Client-side behavior detected",
      detail:
        pages.some((page) => page.rendered)
          ? "The rendered DOM was observed in local Chromium, but unvisited conditional or multi-step states are not yet certified automatically."
          : "The HTML crawl is real, but script-driven conditional states are not certified automatically in this runtime.",
      time: "now",
    });
  }
  const automationActions = pages.flatMap(
    (page) => page.automationActions || []
  );
  if (automationActions.length) {
    findings.push({
      id: `${runId}_automation`,
      tone: automationActions.some((action) => action.error)
        ? "warning"
        : "success",
      code: "predictable_traversal_completed",
      title: `${automationActions.length} predictable traversal action${automationActions.length === 1 ? "" : "s"} recorded`,
      detail:
        "LLM-authored field entries and progression decisions are retained in the event log with observed state identities.",
      time: "now",
    });
  }
  const fieldsEntered = pages.reduce(
    (sum, page) => sum + (page.fieldsEntered || 0),
    0
  );
  const stateEvidence = pages.reduce(
    (sum, page) => sum + (page.stateEvidence?.length || 0),
    0
  );
  if (fieldsEntered || stateEvidence) {
    const measuredBranchStates = pages.reduce(
      (sum, page) => sum + (page.branchStates || 0),
      0
    );
    findings.push({
      id: `${runId}_form_traversal`,
      tone: pages.some((page) => page.entryFailures) ? "warning" : "success",
      code: "form_states_exercised",
      title: `${fieldsEntered} synthetic field entr${fieldsEntered === 1 ? "y" : "ies"} across ${stateEvidence} captured states`,
      detail: measuredBranchStates
        ? `Values, selections, validations, and ${measuredBranchStates} measured conditional branch state${measuredBranchStates === 1 ? "" : "s"} were exercised by the selected form-specific script. Every state was captured before movement.`
        : "Values, selections, validations, and declared advance actions were exercised by the selected form-specific script. No conditional branch state was measured. Every state was captured before movement.",
      time: "now",
    });
  }
  const sensitiveFields = contract.filter(
    (field) => field.sensitive && !field.hidden
  );
  if (sensitiveFields.length) {
    findings.push({
      id: `${runId}_sensitive_fields`,
      tone: "warning",
      code: "sensitive_field",
      title: `${sensitiveFields.length} sensitive field${sensitiveFields.length === 1 ? "" : "s"} observed`,
      detail: `Sensitive metadata was retained for: ${sensitiveFields
        .map((field) => field.label)
        .join(", ")}. Synthetic discovery values do not authorize real applicant data.`,
      time: "now",
    });
  }
  const unmappableFields = contract.filter(
    (field) =>
      !field.hidden &&
      (!field.canonicalProfileKey ||
        field.canonicalProfileKey === "unmappable")
  );
  if (unmappableFields.length) {
    findings.push({
      id: `${runId}_unmappable_fields`,
      tone: "warning",
      code: "unmappable_field",
      title: `${unmappableFields.length} field${unmappableFields.length === 1 ? "" : "s"} require form-specific bindings`,
      detail: `The generated script retains these noncanonical questions without pretending they map to a shared applicant profile: ${unmappableFields
        .map((field) => field.label)
        .join(", ")}.`,
      time: "now",
    });
  }
  const choiceFieldsWithoutOptions = contract.filter(
    (field) =>
      !field.hidden &&
      ["radio", "select"].includes(field.control) &&
      Number(field.options || 0) === 0
  );
  if (choiceFieldsWithoutOptions.length) {
    findings.push({
      id: `${runId}_missing_options`,
      tone: "danger",
      code: "missing_options",
      title: "Choice controls were captured without their option inventory",
      detail: `Option extraction was incomplete for: ${choiceFieldsWithoutOptions
        .map((field) => field.label)
        .join(", ")}.`,
      time: "now",
    });
    findings.push({
      id: `${runId}_failed_extract_empty_choices`,
      tone: "danger",
      code: "failed_extract",
      title: "Choice option extraction was incomplete",
      detail: `The following enumerated controls could not be executed or certified because no option inventory was available: ${choiceFieldsWithoutOptions
        .map((field) => field.label)
        .join(", ")}.`,
      time: "now",
    });
  }
  const failedEntries = pages.reduce(
    (sum, page) => sum + Number(page.entryFailures || 0),
    0
  );
  if (failedEntries > 0) {
    findings.push({
      id: `${runId}_failed_extract`,
      tone: "danger",
      code: "failed_extract",
      title: `${failedEntries} scripted field or probe action${failedEntries === 1 ? "" : "s"} could not be verified`,
      detail:
        "The report retains the failed actions and their evidence; the run is not treated as complete form actuation.",
      time: "now",
    });
  }
  if (
    pages.some(
      (page) =>
        page.captchaDetected ||
        page.unresolvedGate === "captcha" ||
        /captcha|human challenge/i.test(page.haltReason || "")
    )
  ) {
    findings.push({
      id: `${runId}_interactive_captcha`,
      tone: "danger",
      code: "interactive_captcha",
      title: "Interactive CAPTCHA or human challenge blocked traversal",
      detail:
        "The challenge was detected and retained as evidence. FormWeave does not solve or bypass interactive CAPTCHAs.",
      time: "now",
    });
  }
  const paymentFields = contract.filter(
    (field) =>
      !field.hidden &&
      /\b(?:payment|card|cvv|cvc|expiry|routing|bank account)\b/i.test(
        `${field.key} ${field.name} ${field.label}`
      )
  );
  if (paymentFields.length) {
    findings.push({
      id: `${runId}_payment_fields`,
      tone: "danger",
      code: "payment_field",
      title: `${paymentFields.length} payment field${paymentFields.length === 1 ? "" : "s"} captured but protected`,
      detail:
        "Payment controls remain reportable metadata but are never populated by Phase 1 synthetic discovery.",
      time: "now",
    });
  }
  if (
    contract.some((field) => field.control === "password") ||
    pages.some((page) => /login|credential|sign[ -]?in/i.test(page.haltReason || ""))
  ) {
    findings.push({
      id: `${runId}_login_required`,
      tone: "danger",
      code: "login_required",
      title: "Authentication is required before form traversal can continue",
      detail:
        "Credential controls were captured without actuation. No username, password, or login action was attempted.",
      time: "now",
    });
  }
  const branchStates = pages.reduce(
    (sum, page) => sum + (page.branchStates || 0),
    0
  );
  if (branchStates) {
    findings.push({
      id: `${runId}_branching_logic`,
      tone: "warning",
      code: "branching_logic_detected",
      title: `${branchStates} conditional branch state${branchStates === 1 ? "" : "s"} detected`,
      detail:
        "Deterministically derived discovery probes changed the visible control contract. First-level same-page branches are interpreted and replayed from the retained script; deeper reveals halt before submission.",
      time: "now",
    });
  }
  const crossPageHalts = pages.filter((page) =>
    /cross-page conditional|cross-page branch|cross_page/i.test(
      page.haltReason || ""
    )
  );
  if (crossPageHalts.length) {
    findings.push({
      id: `${runId}_cross_page_branching`,
      tone: "danger",
      code: "cross_page_branching",
      title: "Cross-page branching detected and left unsupported",
      detail:
        "The LLM detected or could not rule out a dependency on an earlier-page answer. Phase 1 captured the arrival state and halted before actuating its fields or submitting.",
      time: "now",
    });
  }
  const submissionAttempts = pages.reduce(
    (sum, page) => sum + (page.submissionsAttempted || 0),
    0
  );
  const verifiedSubmissions = pages.reduce(
    (sum, page) => sum + (page.submissionsSucceeded || 0),
    0
  );
  if (submissionAttempts > verifiedSubmissions) {
    findings.push({
      id: `${runId}_submission_unverified`,
      tone: "danger",
      code: "terminal_submission_unverified",
      title: `${submissionAttempts - verifiedSubmissions} terminal submission attempt${submissionAttempts - verifiedSubmissions === 1 ? "" : "s"} not verified`,
      detail:
        "A browser submit event and HTTP success are insufficient. The rendered result did not provide an explicit LLM-assessed success confirmation or did not match retained result markers.",
      time: "now",
    });
  }
  const confirmedSubmissions = pages.filter(
    (page) =>
      page.finalSubmission === "submitted" &&
      page.submissionResult?.verified === true
  );
  if (confirmedSubmissions.length) {
    findings.push({
      id: `${runId}_submission_confirmed`,
      tone: "success",
      code: "terminal_submission_confirmed",
      title: `${confirmedSubmissions.length} terminal submission result${confirmedSubmissions.length === 1 ? "" : "s"} explicitly confirmed`,
      detail:
        "Transport checks passed and the rendered completion state matched an LLM-authored explicit success assessment or its retained deterministic markers.",
      time: "now",
    });
  }
  if (pages.some((page) => page.finalSubmission === "blocked")) {
    findings.push({
      id: `${runId}_submit_blocked`,
      tone: "success",
      code: "phase1_terminal_submission_blocked",
      title: "Phase 1 stopped at the terminal submission boundary",
      detail:
        "The completed synthetic values were captured as evidence, but the final submit control was not activated.",
      time: "now",
    });
  }
  pages
    .filter((page) => page.certificationStatus === "script_missing")
    .forEach((page, index) => {
      findings.push({
        id: `${runId}_script_missing_${index}`,
        tone: "warning",
        code: "could_not_test",
        title: "LLM-generated form script missing",
        detail: `${page.finalUrl} was extracted and observed with zero control actuation. Submission was disabled; shared browser code did not guess its sequencing.`,
        time: "now",
      });
    });
  pages
    .flatMap((page) =>
      (page.automationActions || []).filter(
        (action) => action.failureCode || action.outcome === "could_not_test"
      )
    )
    .forEach((action, index) => {
      const protectedCapture = [
        "upload_interaction",
        "legal_acceptance_interaction",
        "credential_interaction",
        "payment_interaction",
      ].includes(action.failureCode || "");
      findings.push({
        id: `${runId}_actuation_failure_${index}`,
        tone: protectedCapture ? "info" : "warning",
        code: action.failureCode || "could_not_test",
        title: protectedCapture
          ? `${action.label} captured without actuation`
          : `${action.label} could not be verified`,
        detail: protectedCapture
          ? action.error ||
            action.rationale ||
            "The protected control remains in the contract and was not actuated."
          : `${action.error || action.rationale || "The action did not land."} Before ${action.beforeFingerprint || "unavailable"}; after ${action.afterFingerprint || "unavailable"}; evidence ${action.stateId || "unavailable"}.`,
        time: "now",
      });
    });
  const allowedReadLikeRequests = pages.reduce(
    (sum, page) => sum + (page.allowedReadLikeRequests || 0),
    0
  );
  if (allowedReadLikeRequests) {
    findings.push({
      id: `${runId}_read_like_posts`,
      tone: "info",
      code: "read_like_initialization_allowed",
      title: `${allowedReadLikeRequests} read-oriented initialization request${allowedReadLikeRequests === 1 ? "" : "s"} allowed`,
      detail:
        "Only same-origin XHR/fetch POSTs matching configured framework initialization endpoints were allowed; form submission guards remained active.",
      time: "now",
    });
  }
  pages
    .filter((page) => page.captchaDetected)
    .forEach((page, index) => {
      findings.push({
        id: `${runId}_captcha_${index}`,
        tone: "warning",
        code: "challenge_detected",
        title: "Human verification requires operator handoff",
        detail: `A CAPTCHA or human-verification gate was detected at ${page.finalUrl}. FormWeave captured the state and did not attempt to solve or bypass it.`,
        time: "now",
      });
    });
  pages
    .filter((page) => page.unresolvedGate && !page.captchaDetected)
    .forEach((page, index) => {
      const gate = page.unresolvedGate || "unknown";
      findings.push({
        id: `${runId}_gate_${index}`,
        tone: "warning",
        code: /login|payment/i.test(gate)
          ? "login_or_payment_detected"
          : "could_not_test",
        title: "A traversal gate remains visible",
        detail: `The ${gate.replaceAll("_", " ")} gate at ${page.finalUrl} was not cleared by the configured predictable policies.`,
        time: "now",
      });
    });
  failed.forEach((page, index) => {
    findings.push({
      id: `${runId}_failed_${index}`,
      tone: "danger",
      code: "fetch_failed",
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
  const queue = urls.map((url) => validateTargetUrl(url));
  const seen = new Set<string>();
  const pages: CrawlPage[] = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const batch: string[] = [];
    while (queue.length && batch.length < 3 && pages.length + batch.length < MAX_PAGES) {
      const candidate = queue.shift()!;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      batch.push(candidate);
    }
    if (!batch.length) continue;

    const crawled = await Promise.all(batch.map((url) => crawlPage(url)));
    pages.push(...crawled);
    await onProgress?.({ pages: pages.length, queued: queue.length });
  }

  return buildCrawlOutput(pages, runId);
}
