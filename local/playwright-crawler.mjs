import { chromium } from "playwright";
import {
  buildCrawlOutput,
  fingerprintPage,
  fingerprintPageInput,
  validateTargetUrl,
} from "./crawl-core.ts";
import { FINGERPRINT_ALGORITHM_VERSION } from "./fingerprint.ts";
import {
  detectCaptcha,
  isSameOriginReadLikePost,
  sanitizedEndpoint,
  waitForStableState,
} from "./traversal-automation.mjs";
import {
  installSubmissionGuards,
  traverseFormStates,
} from "./form-traversal.mjs";
import { generatedReconScriptFor } from "./recon-scripts/registry.mjs";
import { normalizeTraversalSettings } from "./traversal-settings.mjs";
import {
  branchTestValues,
  deterministicTestValue,
} from "./test-values.mjs";
import { captureFullPageAndTiles } from "./browser-evidence.mjs";
import { generateAndReplayForm } from "./production-generated-traversal.mjs";

const MAX_HTML_BYTES = 5_000_000;
const MAX_PAGES = 16;
const MAX_DISCOVERY_DEPTH = 1;
const MAX_DISCOVERED_LINKS_PER_PAGE = 12;
const FORMISH_PATH =
  /(apply|application|form|intake|register|signup|enroll|eligib|benefit|service|request|step|page|start|fixture)/i;
const SENSITIVE_FIELD =
  /(birth|dob|ssn|social.?security|income|salary|earnings|password|passcode|medical|health|disabil|immigration|citizenship|gender|race|ethnic|bank|routing|card|cvv|cvc)/i;

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

function journeyUrlKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return String(value || "");
  }
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

function fieldIdentity(field) {
  return `${field.frameUrl}|${field.selector || field.key}|${field.control}`;
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
      existing.optionValues = [
        ...new Set([
          ...(existing.optionValues || []),
          ...(rawField.optionValues || []),
        ]),
      ];
      existing.optionSet = [
        ...new Map(
          [...(existing.optionSet || []), ...(rawField.optionSet || [])].map(
            (option) => [option.value, option]
          )
        ).values(),
      ];
      existing.required ||= rawField.required;
      existing.sensitive ||= rawField.sensitive;
      existing.hidden &&= rawField.hidden;
      existing.guidanceIds = [
        ...new Set([
          ...(existing.guidanceIds || []),
          ...(rawField.guidanceIds || []),
        ]),
      ];
      continue;
    }

    let key = baseKey;
    let suffix = 2;
    while (result.some((field) => field.key === key)) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    const field = {
      name: rawField.name || "",
      id: rawField.id || "",
      key,
      label: rawField.label || humanize(key),
      control: rawField.control,
      required: rawField.required,
      sensitive: rawField.sensitive,
      hidden: rawField.hidden,
      options: rawField.options,
      selector: rawField.selector,
      selectorCandidates: rawField.selectorCandidates || [rawField.selector],
      frameUrl: rawField.frameUrl,
      rendered: true,
      optionSet: rawField.optionSet || [],
      optionValues: rawField.optionValues || [],
      groupLabel: rawField.groupLabel || "",
      requiredSource: rawField.requiredSource || "not_observed",
      validation: rawField.validation || {},
      upload: rawField.upload || {},
      consent: Boolean(rawField.consent),
      adminAssisted: Boolean(rawField.adminAssisted),
      canonicalProfileKey: rawField.canonicalProfileKey || "unmappable",
      repeatableSection: rawField.repeatableSection || "",
      addRowControl: rawField.addRowControl || "",
      otherSpecifyFor: rawField.otherSpecifyFor || "",
      sectionText: rawField.sectionText || "",
      sectionId: rawField.sectionId || "",
      guidanceIds: rawField.guidanceIds || [],
      questionRef: rawField.questionRef || "",
      formId: rawField.formId || "",
      testValue: rawField.testValue,
      testValues: rawField.testValues,
      testValueSource: rawField.testValueSource,
      entryStatus: rawField.entryStatus,
      entryError: rawField.entryError,
    };
    if (groupKey) seen.set(groupKey, result.length);
    result.push(field);
  }
  return result;
}

async function extractFrame(frame, pageUrl, frameIndex) {
  return frame.evaluate(
    ({ pageUrl: evaluatedPageUrl, sensitivePattern, evaluatedFrameIndex }) => {
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
          labels.join(" / ") ||
          labelledBy.join(" / ") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.getAttribute("title") ||
          text(element.closest("label")) ||
          text(legend) ||
          ""
        );
      };
      const groupLabelFor = (element) => {
        const fieldset = element.closest("fieldset");
        const group = element.closest('[role="group"],[role="radiogroup"]');
        const labelledBy = String(group?.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .map(text)
          .filter(Boolean);
        return (
          text(fieldset?.querySelector(":scope > legend")) ||
          labelledBy.join(" / ") ||
          group?.getAttribute("aria-label") ||
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
      const sectionElements = all(
        "form,fieldset,section,[role='group'],[role='radiogroup']"
      ).filter((element) => element.querySelector(selector));
      const sections = sectionElements.map((element, index) => {
        const parent = element.parentElement?.closest(
          "form,fieldset,section,[role='group'],[role='radiogroup']"
        );
        const parentIndex = parent ? sectionElements.indexOf(parent) : -1;
        const heading = element.querySelector(
          ":scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4"
        );
        return {
          id: `section_${evaluatedFrameIndex}_${index}`,
          ...(parentIndex >= 0
            ? { parentId: `section_${evaluatedFrameIndex}_${parentIndex}` }
            : {}),
          label:
            text(heading) ||
            element.getAttribute("aria-label") ||
            element.id ||
            (element.tagName.toLowerCase() === "form"
              ? "Form"
              : `Section ${index + 1}`),
          ordinal: index + 1,
          selector: selectorFor(element, index),
          frameUrl: location.href,
          questionKeys: [],
          guidanceIds: [],
        };
      });
      const guidanceRecords = [];
      const guidanceKeyToId = new Map();
      const guidanceKind = (value) =>
        /\b(?:eligible|eligibility|qualify|criteria)\b/i.test(value)
          ? "eligibility"
          : /\b(?:means|defined|definition)\b/i.test(value)
            ? "definition"
            : /\b(?:warning|required|must|do not|cannot)\b/i.test(value)
              ? "warning"
              : /\b(?:example|for example|e\.g\.)\b/i.test(value)
                ? "example"
                : /\b(?:privacy|confidential|share|data)\b/i.test(value)
                  ? "privacy"
                  : /\b(?:enter|select|choose|provide|include)\b/i.test(value)
                    ? "instruction"
                    : "other";
      const addGuidance = (element, scope, scopeId, source) => {
        const value = text(element).slice(0, 2_000);
        if (value.length < 3) return "";
        const key = `${scope}|${scopeId}|${value}`;
        if (guidanceKeyToId.has(key)) return guidanceKeyToId.get(key);
        const id = `guidance_${evaluatedFrameIndex}_${guidanceRecords.length}`;
        guidanceKeyToId.set(key, id);
        guidanceRecords.push({
          id,
          kind: guidanceKind(value),
          scope,
          scopeId,
          text: value,
          provenance: {
            source,
            selector: selectorFor(element, guidanceRecords.length),
            frameUrl: location.href,
          },
        });
        return id;
      };
      const questionReferencedElements = new Set(
        controls.flatMap((control) =>
          `${control.getAttribute("aria-describedby") || ""} ${
            control.getAttribute("aria-labelledby") || ""
          }`
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
        )
      );
      for (const [index, section] of sectionElements.entries()) {
        const sectionId = `section_${evaluatedFrameIndex}_${index}`;
        const candidates = Array.from(
          section.querySelectorAll(
            ":scope > .instructions,:scope > .instruction,:scope > .help,:scope > .hint,:scope > .description,:scope > [role='note'],:scope > p"
          )
        ).filter(
          (element) =>
            !element.closest("label") &&
            !questionReferencedElements.has(element)
        );
        sections[index].guidanceIds = candidates
          .map((element) =>
            addGuidance(element, "section", sectionId, "section-dom")
          )
          .filter(Boolean);
      }
      const fields = controls
        .filter((element) => {
          if (["button", "submit", "reset", "image"].includes(controlType(element))) {
            return false;
          }
          return !element.matches("button");
        })
        .map((element, index) => {
          const control = controlType(element);
          const groupLabel = groupLabelFor(element);
          const label =
            ["radio", "checkbox"].includes(control) && groupLabel
              ? groupLabel
              : labelFor(element);
          const name =
            element.getAttribute("name") ||
            element.getAttribute("data-field") ||
            element.getAttribute("aria-label") ||
            "";
          const id = element.id || "";
          const questionRef = name || id || selectorFor(element, index);
          const section = element.closest(
            "fieldset,section,[role='group'],[role='radiogroup'],form"
          );
          const sectionIndex = section ? sectionElements.indexOf(section) : -1;
          const sectionId =
            sectionIndex >= 0
              ? `section_${evaluatedFrameIndex}_${sectionIndex}`
              : `section_${evaluatedFrameIndex}_unsectioned`;
          const described = String(
            element.getAttribute("aria-describedby") || ""
          )
            .split(/\s+/)
            .map((describedId) => document.getElementById(describedId))
            .filter(Boolean);
          const labelledGuidance = String(
            element.getAttribute("aria-labelledby") || ""
          )
            .split(/\s+/)
            .map((labelledId) => ({
              id: labelledId,
              element: document.getElementById(labelledId),
            }))
            .filter(
              (item, labelledIndex) =>
                item.element &&
                (labelledIndex > 0 ||
                  /(?:help|hint|description|instruction|note)/i.test(item.id))
            )
            .map((item) => item.element);
          const nearby = Array.from(
            element
              .closest("label")
              ?.querySelectorAll("small,.help,.hint,.description,[role='note']") ||
              []
          );
          const guidanceIds = [
            ...described.map((item) =>
              addGuidance(
                item,
                "question",
                questionRef,
                "aria-describedby"
              )
            ),
            ...labelledGuidance.map((item) =>
              addGuidance(
                item,
                "question",
                questionRef,
                "aria-labelledby"
              )
            ),
            ...nearby.map((item) =>
              addGuidance(item, "question", questionRef, "nearby-dom")
            ),
          ].filter(Boolean);
          const options =
            element.tagName.toLowerCase() === "select"
              ? element.querySelectorAll("option").length
              : ["radio", "checkbox"].includes(control)
                ? 1
                : 0;
          const optionValues =
            element.tagName.toLowerCase() === "select"
              ? Array.from(element.options)
                  .filter((option) => !option.disabled && option.value)
                  .map((option) => option.value)
              : ["radio", "checkbox"].includes(control)
                ? [String(element.value || "true")]
                : [];
          const optionSet =
            element.tagName.toLowerCase() === "select"
              ? Array.from(element.options).map((option) => ({
                  value: String(option.value || ""),
                  label: text(option),
                }))
              : ["radio", "checkbox"].includes(control)
                ? [
                    {
                      value: String(element.value || "true"),
                      label:
                        labelFor(element) ||
                        String(element.value || "true"),
                    },
                  ]
                : [];
          const repeatable = element.closest(
            '[data-repeatable],.repeater,.repeatable,[class*="repeater" i]'
          );
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
            optionSet,
            optionValues,
            groupLabel,
            selector: selectorFor(element, index),
            selectorCandidates: [
              selectorFor(element, index),
              id ? `#${escapeAttribute(id)}` : "",
              name
                ? `${element.tagName.toLowerCase()}[name="${escapeAttribute(
                    name
                  )}"]`
                : "",
            ].filter(Boolean),
            requiredSource: element.hasAttribute("required")
              ? "required_attribute"
              : element.getAttribute("aria-required") === "true"
                ? "aria_required"
                : "not_observed",
            validation: {
              pattern: element.getAttribute("pattern") || "",
              min: element.getAttribute("min") || "",
              max: element.getAttribute("max") || "",
              minLength: element.getAttribute("minlength") || "",
              maxLength: element.getAttribute("maxlength") || "",
            },
            upload: {
              accept: element.getAttribute("accept") || "",
              maxSize:
                element.getAttribute("data-max-file-size") ||
                element.getAttribute("data-maxsize") ||
                "",
              maxFiles:
                element.getAttribute("data-max-files") ||
                (element.hasAttribute("multiple") ? "" : "1"),
            },
            consent: /\b(?:consent|agree|authorize|terms|privacy)\b/i.test(
              `${label} ${name} ${id}`
            ),
            adminAssisted: /\b(?:admin|administrator|staff|case worker|assisted)\b/i.test(
              `${label} ${name} ${id}`
            ),
            canonicalProfileKey: "unmappable",
            repeatableSection:
              repeatable?.getAttribute("data-repeatable") || "",
            addRowControl:
              text(
                repeatable?.querySelector(
                  'button,[role="button"],input[type="button"]'
                )
              ) || "",
            otherSpecifyFor: /\bother\b/i.test(label)
              ? name || id || label
              : "",
            sectionText: text(section).slice(0, 800),
            sectionId,
            guidanceIds,
            questionRef,
            formId: element.closest("form")?.id || "",
          };
        });
      if (
        fields.some(
          (field) =>
            field.sectionId ===
            `section_${evaluatedFrameIndex}_unsectioned`
        )
      ) {
        sections.push({
          id: `section_${evaluatedFrameIndex}_unsectioned`,
          label: "Unsectioned questions",
          ordinal: sections.length + 1,
          selector: "",
          frameUrl: location.href,
          questionKeys: [],
          guidanceIds: [],
        });
      }

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
        guidanceRecords,
        sections,
        forms: forms.length,
        formActions: [...new Set(actions)],
        links,
        hasScripts: all("script").length > 0,
        shadowRootCount,
      };
    },
    {
      pageUrl,
      sensitivePattern: SENSITIVE_FIELD.source,
      evaluatedFrameIndex: frameIndex,
    }
  );
}

async function extractRenderedPage(page, requestedUrl, response, browserMode) {
  const finalUrl = page.url() || requestedUrl;
  const startedExtraction = Date.now();
  const mainOrigin = new URL(finalUrl).origin;
  const frameResults = [];

  for (const [frameIndex, frame] of page.frames().entries()) {
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
      const extracted = await extractFrame(frame, frameUrl, frameIndex);
      frameResults.push({ ...extracted, frameUrl });
    } catch {
      // A detached or inaccessible child frame should not invalidate its page.
    }
  }

  const fields = dedupeFields(
    frameResults.flatMap((result) =>
      result.fields.map((field) => ({ ...field, frameUrl: result.frameUrl }))
    )
  ).map((field, index) => {
    const descriptor = {
      ...field,
      type: field.control,
      tag: field.control === "select" ? "select" : "",
      options: (field.optionSet || []).map((option) => ({
        value: option.value,
        label: option.label,
        disabled: false,
      })),
      groupOptions: (field.optionSet || []).map((option) => ({
        value: option.value,
        label: option.label,
        disabled: false,
      })),
    };
    return {
      ...field,
      testValue:
        field.testValue ?? deterministicTestValue(descriptor, index),
      testValues:
        field.testValues ??
        branchTestValues(descriptor, 8),
      testValueSource: field.testValueSource ?? "deterministic",
      entryStatus: field.entryStatus ?? (field.hidden ? "skipped" : undefined),
    };
  });
  const fieldByQuestionRef = new Map(
    fields.map((field) => [field.questionRef, field])
  );
  const guidanceRecords = frameResults
    .flatMap((result) => result.guidanceRecords || [])
    .map((record) =>
      record.scope === "question"
        ? {
            ...record,
            scopeId:
              fieldByQuestionRef.get(record.scopeId)?.key || record.scopeId,
          }
        : record
    );
  const sections = frameResults
    .flatMap((result) => result.sections || [])
    .map((section) => ({
      ...section,
      questionKeys: fields
        .filter(
          (field) => field.sectionId === section.id && !field.hidden
        )
        .map((field) => field.key),
      guidanceIds: [
        ...new Set([
          ...(section.guidanceIds || []),
          ...fields
            .filter((field) => field.sectionId === section.id)
            .flatMap((field) => field.guidanceIds || []),
        ]),
      ],
    }));
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
    normalizedUrl: finalUrl,
    title,
    heading: String(heading || "").replace(/\s+/g, " ").trim().slice(0, 180),
    forms:
      frameResults.reduce((sum, result) => sum + result.forms, 0) ||
      (fields.length ? 1 : 0),
    fields,
    guidanceRecords,
    sections,
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
  const capture = await captureFullPageAndTiles(page);

  return {
    ...parsed,
    requestedUrl,
    finalUrl,
    httpStatus: response?.status() || 0,
    contentType: response?.headers()["content-type"] || "text/html",
    durationMs: Date.now() - startedExtraction,
    bytesFetched,
    fingerprint: fingerprintPage(parsed),
    fingerprintAlgorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    fingerprintInput: fingerprintPageInput(parsed),
    html,
    screenshot: capture.full,
    sensingScreenshots: capture.sensing,
    screenshotTiled: capture.tiled,
    screenshotDimensions: capture.dimensions,
    screenshotTilesTruncated: Boolean(capture.truncated),
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

async function crawlOne(
  context,
  url,
  browserMode,
  executionMode,
  fixtureAuthorities,
  traversalSettings,
  onBrowserEvent,
  allowLoopback,
  reconScriptResolver,
  enableGeneratedTraversal,
  artifactRunDirectory,
  generatedScriptRoot,
  runId
) {
  const page = await context.newPage();
  const targetOrigin = new URL(url).origin;
  page.setDefaultTimeout(
    Math.max(1_000, Math.min(traversalSettings.maxStateWaitMs, 8_000))
  );
  const startedAt = Date.now();
  let blockedRequests = 0;
  let allowedReadLikeRequests = 0;
  const reportedBlockedEndpoints = new Set();
  const reportedAllowedEndpoints = new Set();
  let allowSameOriginWritesUntil = 0;
  let allowFinalWritesUntil = 0;
  let allowedFinalWriteOrigin = "";
  const authorizeWrites = ({ scope, durationMs, reason, origin = "" }) => {
    const until = Date.now() + Math.max(250, Math.min(durationMs, 15_000));
    if (scope === "final-action") {
      allowFinalWritesUntil = Math.max(allowFinalWritesUntil, until);
      allowedFinalWriteOrigin = origin;
    } else {
      allowSameOriginWritesUntil = Math.max(allowSameOriginWritesUntil, until);
    }
    onBrowserEvent?.(
      "interaction_write_window_opened",
      `Authorized a bounded ${scope} write window for ${reason}.`,
      { scope, durationMs, reason, ...(origin ? { origin } : {}) }
    );
    return () => {
      if (scope === "final-action") {
        if (allowFinalWritesUntil === until) {
          allowFinalWritesUntil = 0;
          allowedFinalWriteOrigin = "";
        }
      } else if (allowSameOriginWritesUntil === until) {
        allowSameOriginWritesUntil = 0;
      }
    };
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (
      isSameOriginReadLikePost(request, targetOrigin, traversalSettings)
    ) {
      allowedReadLikeRequests += 1;
      const endpoint = sanitizedEndpoint(request.url());
      if (!reportedAllowedEndpoints.has(endpoint)) {
        reportedAllowedEndpoints.add(endpoint);
        await onBrowserEvent?.(
          "read_like_post_allowed",
          `Allowed a same-origin browser initialization request to ${endpoint}.`,
          { method, endpoint, resourceType: request.resourceType() }
        );
      }
      await route.continue();
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      let requestOrigin = "";
      try {
        requestOrigin = new URL(request.url()).origin;
      } catch {
        requestOrigin = "";
      }
      const now = Date.now();
      const interactionAllowed =
        (now <= allowFinalWritesUntil &&
          requestOrigin === allowedFinalWriteOrigin) ||
        (now <= allowSameOriginWritesUntil && requestOrigin === targetOrigin);
      if (interactionAllowed) {
        const endpoint = sanitizedEndpoint(request.url());
        await onBrowserEvent?.(
          "interaction_write_allowed",
          `Allowed an interaction-triggered ${method} request to ${endpoint}.`,
          { method, endpoint, resourceType: request.resourceType(), executionMode }
        );
        await route.continue();
        return;
      }
      blockedRequests += 1;
      const endpoint = sanitizedEndpoint(request.url());
      const key = `${method} ${endpoint}`;
      if (!reportedBlockedEndpoints.has(key)) {
        reportedBlockedEndpoints.add(key);
        await onBrowserEvent?.(
          "browser_write_request_blocked",
          `Blocked browser request ${method} ${endpoint}.`,
          { method, endpoint, resourceType: request.resourceType() }
        );
      }
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await installSubmissionGuards(page, executionMode);

  try {
    await onBrowserEvent?.("browser_page_opened", `Opening ${url} in local Chromium.`, {
      browserMode,
    });
    const response = await page.goto(url, {
      timeout: 45_000,
      waitUntil: "domcontentloaded",
    });
    if (!response) throw new Error("The browser navigation returned no response.");
    if (!response.ok()) {
      throw new Error(`Target returned HTTP ${response.status()}.`);
    }
    const reconScript = reconScriptResolver(page.url(), { allowLoopback });
    await waitForStableState(
      page,
      traversalSettings,
      onBrowserEvent,
      "observation-only state examination"
    );
    const observedCaptcha = await detectCaptcha(page);
    const automation = {
      actions: [],
      captchaDetected: observedCaptcha.detected,
      unresolvedGate: observedCaptcha.detected ? "captcha" : "",
      stateExaminations: 1,
    };
    if (observedCaptcha.detected) {
      await onBrowserEvent?.(
        "captcha_handoff_required",
        "CAPTCHA or human-verification gate detected; observation-only mode performed no interaction.",
        observedCaptcha
      );
    }
    if (reconScript) {
      await onBrowserEvent?.(
        "recon_script_selected",
        `Selected form-specific recon script ${reconScript.id}@${reconScript.version}.`,
        { id: reconScript.id, version: reconScript.version },
      );
    } else if (enableGeneratedTraversal) {
      await onBrowserEvent?.(
        "generated_script_preflight_started",
        "Checking for a compatible retained LLM-authored script; a new semantic generation pass will run only when no retained script matches.",
        { url: page.url() },
      );
    }
    if (reconScript && typeof reconScript.preparePage === "function") {
      await reconScript.preparePage({
        page,
        settings: traversalSettings,
        onEvent: onBrowserEvent,
      });
    }
    const rebaseline = async (baselineUrl, metadata = {}) => {
      await onBrowserEvent?.(
        "branch_rebaseline_started",
        `Restoring ${baselineUrl} before a branch probe.`,
        metadata
      );
      const baselineResponse = await page.goto(baselineUrl, {
        timeout: 45_000,
        waitUntil: "domcontentloaded",
      });
      if (!baselineResponse || !baselineResponse.ok()) {
        throw new Error(
          `Branch re-baseline navigation failed with HTTP ${
            baselineResponse?.status() || 0
          }.`
        );
      }
      await waitForStableState(
        page,
        traversalSettings,
        onBrowserEvent,
        "observation-only branch rebaseline"
      );
      automation.stateExaminations += 1;
      await onBrowserEvent?.(
        "branch_rebaseline_completed",
        `Restored ${baselineUrl} before branch actuation.`,
        metadata
      );
    };
    let generatedTraversal = null;
    if (
      !reconScript &&
      enableGeneratedTraversal &&
      !automation.captchaDetected &&
      automation.unresolvedGate !== "captcha"
    ) {
      generatedTraversal = await generateAndReplayForm({
        page,
        runId,
        runDirectory: artifactRunDirectory,
        scriptRegistryRoot: generatedScriptRoot,
        executionMode,
        fixtureAuthorities,
        browserMode,
        authorizeWrites,
        onEvent: onBrowserEvent,
      });
      if (!generatedTraversal) {
        await onBrowserEvent?.(
          "recon_script_missing",
          "No form-bearing surface was present; the page remains observation-only.",
          { url: page.url() },
        );
      }
    } else if (!reconScript) {
      await onBrowserEvent?.(
        "recon_script_missing",
        "No LLM-generated form script matches this target; actuation is disabled.",
        { url: page.url() },
      );
    }
    const formTraversal =
      automation.captchaDetected || automation.unresolvedGate === "captcha"
        ? {
            actions: [],
            evidence: [],
            observedFields: [],
            fieldsEntered: 0,
            entryFailures: 0,
            branchStates: 0,
            submissionsAttempted: 0,
            submissionsSucceeded: 0,
            finalSubmission: "not_requested",
          }
        : generatedTraversal ||
          (await traverseFormStates(page, {
              browserMode,
              settings: traversalSettings,
              authorizeWrites,
              onEvent: onBrowserEvent,
              reconScript,
              rebaseline,
              executionMode,
            }));
    if (browserMode === "headful") {
      const headedPauseMs = Number.parseInt(
        process.env.FORMWEAVE_HEADFUL_PAUSE_MS || "1200",
        10
      );
      await page.waitForTimeout(Math.max(300, Math.min(headedPauseMs, 10_000)));
    }
    const pageResult = await extractRenderedPage(page, url, response, browserMode);
    const extractedFields = [...pageResult.fields];
    const extractedMetadata = new Map(
      extractedFields.map((field) => [
        `${field.control}|${field.name || field.id || field.key}`,
        field,
      ])
    );
    const fieldMap = new Map(
      (reconScript?.contractFromObserved ? [] : pageResult.fields).map((field) => [
        fieldIdentity(field),
        field,
      ])
    );
    for (const observed of formTraversal.observedFields) {
      const identity = fieldIdentity(observed);
      const existing = fieldMap.get(identity);
      const metadata = extractedMetadata.get(
        `${observed.control}|${observed.name || observed.id || observed.key}`
      );
      if (!existing && metadata) {
        fieldMap.delete(fieldIdentity(metadata));
      }
      fieldMap.set(
        identity,
        existing
          ? {
              ...existing,
              ...observed,
              key: existing.key,
              label: existing.label || observed.label,
            }
          : metadata
            ? {
                ...metadata,
                ...observed,
                key: metadata.key,
                groupLabel: metadata.groupLabel || observed.groupLabel,
                sectionId: metadata.sectionId || observed.sectionId,
                guidanceIds:
                  metadata.guidanceIds || observed.guidanceIds || [],
                optionSet:
                  metadata.optionSet?.length
                    ? metadata.optionSet
                    : observed.optionSet,
                validation:
                  Object.values(observed.validation || {}).some(Boolean)
                    ? observed.validation
                    : metadata.validation,
                upload:
                  Object.values(observed.upload || {}).some(Boolean)
                    ? observed.upload
                    : metadata.upload,
                consent: Boolean(metadata.consent || observed.consent),
                adminAssisted: Boolean(
                  metadata.adminAssisted || observed.adminAssisted,
                ),
                repeatableSection:
                  observed.repeatableSection || metadata.repeatableSection,
                addRowControl:
                  observed.addRowControl || metadata.addRowControl,
              }
            : observed
      );
    }
    if (typeof reconScript?.contractFilter === "function") {
      for (const [identity, field] of fieldMap) {
        if (!reconScript.contractFilter(field)) fieldMap.delete(identity);
      }
    }
    pageResult.fields = [...fieldMap.values()];
    pageResult.sections = (pageResult.sections || []).map((section) => ({
      ...section,
      questionKeys: pageResult.fields
        .filter(
          (field) => field.sectionId === section.id && !field.hidden
        )
        .map((field) => field.key),
    }));
    pageResult.forms ||= pageResult.fields.length ? 1 : 0;
    pageResult.durationMs = Date.now() - startedAt;
    pageResult.blockedWriteRequests = blockedRequests;
    pageResult.allowedReadLikeRequests = allowedReadLikeRequests;
    pageResult.automationActions = [
      ...automation.actions,
      ...formTraversal.actions,
    ];
    pageResult.captchaDetected =
      automation.captchaDetected ||
      formTraversal.captchaDetected === true;
    pageResult.unresolvedGate =
      automation.unresolvedGate ||
      formTraversal.unresolvedGate ||
      "";
    pageResult.stateExaminations =
      generatedTraversal?.stateExaminations ??
      generatedTraversal?.generatedArtifact?.modelCallsThisRun ??
      automation.stateExaminations;
    pageResult.stateEvidence = formTraversal.evidence;
    pageResult.fieldsEntered = formTraversal.fieldsEntered;
    pageResult.entryFailures = formTraversal.entryFailures;
    pageResult.branchStates = formTraversal.branchStates;
    pageResult.submissionsAttempted = formTraversal.submissionsAttempted;
    pageResult.submissionsSucceeded = formTraversal.submissionsSucceeded;
    pageResult.finalSubmission = formTraversal.finalSubmission;
    pageResult.submissionResult = formTraversal.submissionResult || null;
    pageResult.certificationStatus =
      formTraversal.certificationStatus ||
      (reconScript ? "probe_completed" : "script_missing");
    pageResult.reconScriptId = formTraversal.reconScriptId || reconScript?.id || "";
    pageResult.reconScriptVersion =
      formTraversal.reconScriptVersion || reconScript?.version || 0;
    pageResult.generatedArtifact = formTraversal.generatedArtifact || null;
    pageResult.journeyUrls = formTraversal.journeyUrls || [pageResult.finalUrl];
    pageResult.entryMode = formTraversal.entryMode || "unknown";
    pageResult.entryDetail = formTraversal.entryDetail || "";
    pageResult.journeyComplete = formTraversal.journeyComplete !== false;
    pageResult.haltReason = formTraversal.haltReason || "";
    pageResult.fingerprintInput = fingerprintPageInput(pageResult);
    pageResult.fingerprint = fingerprintPage(pageResult);
    pageResult.fingerprintAlgorithmVersion = FINGERPRINT_ALGORITHM_VERSION;
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
        allowedReadLikeRequests,
        automationActions:
          automation.actions.length + formTraversal.actions.length,
        stateEvidence: formTraversal.evidence.length,
        fieldsEntered: formTraversal.fieldsEntered,
        entryFailures: formTraversal.entryFailures,
        branchStates: formTraversal.branchStates,
        submissionsAttempted: formTraversal.submissionsAttempted,
        submissionsSucceeded: formTraversal.submissionsSucceeded,
        finalSubmission: formTraversal.finalSubmission,
        submissionResult: formTraversal.submissionResult || null,
        certificationStatus: pageResult.certificationStatus,
        reconScriptId: pageResult.reconScriptId,
        reconScriptVersion: pageResult.reconScriptVersion,
        captchaDetected: pageResult.captchaDetected,
        unresolvedGate: pageResult.unresolvedGate,
        stateExaminations: pageResult.stateExaminations,
        journeyUrls: pageResult.journeyUrls,
        entryMode: pageResult.entryMode,
        journeyComplete: pageResult.journeyComplete,
        haltReason: pageResult.haltReason,
      }
    );
    return pageResult;
  } catch (error) {
    await onBrowserEvent?.(
      "browser_page_failed",
      `Browser crawl failed before a reportable page artifact could be produced: ${error?.message || "Unknown browser error"}`,
      {
        url,
        errorName: error?.name || "Error",
      },
    );
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
    executionMode = "probe",
    fixtureAuthorities = {},
    allowLoopback = false,
    discoverLinks = true,
    traversalSettings = {},
    onProgress,
    onBrowserEvent,
    reconScriptResolver = generatedReconScriptFor,
    enableGeneratedTraversal = false,
    artifactRunDirectory = null,
    generatedScriptRoot = null,
  } = {}
) {
  if (!["headless", "headful"].includes(browserMode)) {
    throw new Error("Browser mode must be headless or headful.");
  }
  if (!["probe", "dry_run", "fixture_submit"].includes(executionMode)) {
    throw new Error(
      "Crawl execution mode must be probe or explicit synthetic submission."
    );
  }
  const normalizedSettings = normalizeTraversalSettings(traversalSettings);
  const queue = urls.map((url) => ({
    url: validatePlaywrightTarget(url, { allowLoopback }),
    depth: 0,
  }));
  const seen = new Set();
  const journeySeen = new Set();
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
      if (
        !candidate ||
        seen.has(candidate.url) ||
        journeySeen.has(journeyUrlKey(candidate.url))
      ) {
        continue;
      }
      seen.add(candidate.url);
      const page = await crawlOne(
        context,
        candidate.url,
        browserMode,
        executionMode,
        fixtureAuthorities,
        normalizedSettings,
        onBrowserEvent,
        allowLoopback,
        reconScriptResolver,
        enableGeneratedTraversal,
        artifactRunDirectory,
        generatedScriptRoot,
        runId
      );
      pages.push(page);
      for (const journeyUrl of page.journeyUrls || []) {
        journeySeen.add(journeyUrlKey(journeyUrl));
      }
      if (
        discoverLinks &&
        !page.error &&
        candidate.depth < MAX_DISCOVERY_DEPTH
      ) {
        page.links
          .filter((link) => shouldDiscoverLink(link, page))
          .slice(0, MAX_DISCOVERED_LINKS_PER_PAGE)
          .forEach((link) => {
            if (
              !seen.has(link.url) &&
              !journeySeen.has(journeyUrlKey(link.url))
            ) {
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
