/**
 * Structural artifact fingerprinting.
 *
 * This is the only implementation used by production crawls and harnesses.
 * Form-specific scripts may filter which controls are in scope before this
 * module is called, but they never provide or modify fingerprint facts.
 */

export const FINGERPRINT_ALGORITHM_VERSION = "formweave-structural-v3";

/** Maintained generated-ID patterns; changes require the golden regression. */
export const GENERATED_ID_PATTERNS = [
  { name: "gravity-html5-upload", pattern: /^html5_[a-z0-9_-]{5,}$/i },
  { name: "react-use-id", pattern: /^:r[a-z0-9]+:$/i },
  { name: "ember-runtime-id", pattern: /^ember\d+$/i },
  { name: "extjs-runtime-id", pattern: /^ext-gen\d+$/i },
  {
    name: "uuid-only-id",
    pattern:
      /^[{(]?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[)}]?$/i,
  },
] as const;

const TRANSIENT_QUERY_KEY =
  /(?:^|[_-])(?:session|sessionid|sid|token|nonce|state|code|signature|timestamp|cache|consent|csrf|xsrf)(?:$|[_-])/i;
const SESSION_CONTROL =
  /(?:^|[_-])(?:csrf|xsrf|authenticity|nonce|session|sessionid|viewstate|eventvalidation)(?:$|[_-])/i;
const CONSENT_FRAMEWORK_CONTROL =
  /(?:onetrust|optanon|cookiebot|cookieconsent|didomi|trustarc|quantcast-choice)/i;

export type FingerprintFieldSource = {
  name?: string;
  id?: string;
  key?: string;
  control?: string;
  type?: string;
  required?: boolean;
  requiredSource?: string;
  optionValues?: unknown[];
  sectionText?: string;
  hidden?: boolean;
};

export type FingerprintPageSource = {
  normalizedUrl?: string;
  finalUrl?: string;
  requestedUrl?: string;
  fields: FingerprintFieldSource[];
  stateEvidence?: unknown[];
};

export type StructuralFieldFact = {
  nameOrId: string;
  type: string;
  required: boolean;
  optionValues: string[];
  sectionText: string;
};

export type StructuralFingerprintFacts = {
  algorithmVersion: typeof FINGERPRINT_ALGORITHM_VERSION;
  normalizedUrl: string;
  fields: StructuralFieldFact[];
  stateCount: number;
  uploadPresence: boolean;
};

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeArtifactUrl(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRANSIENT_QUERY_KEY.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    return url.href;
  } catch {
    return raw;
  }
}

export function normalizeGeneratedId(value: unknown) {
  const identity = cleanText(value);
  if (!identity) return "";
  const match = GENERATED_ID_PATTERNS.find(({ pattern }) =>
    pattern.test(identity)
  );
  return match ? `[generated:${match.name}]` : identity;
}

function isFrameworkNoise(field: FingerprintFieldSource) {
  const identity = `${field.name || ""} ${field.id || ""} ${field.key || ""}`;
  if (CONSENT_FRAMEWORK_CONTROL.test(identity)) return true;
  return Boolean(field.hidden && SESSION_CONTROL.test(identity));
}

function fieldFact(field: FingerprintFieldSource): StructuralFieldFact {
  const rawIdentity = field.name || field.id || field.key || "";
  const values = [...new Set((field.optionValues || []).map(cleanText).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return {
    nameOrId: normalizeGeneratedId(rawIdentity),
    type: cleanText(field.control || field.type).toLowerCase(),
    required: Boolean(field.required),
    optionValues: values.length >= 2 ? values : [],
    sectionText: cleanText(field.sectionText),
  };
}

export function extractStructuralFingerprintFacts(
  page: FingerprintPageSource
): StructuralFingerprintFacts {
  const rawUrl = page.normalizedUrl || page.finalUrl || page.requestedUrl || "";
  const fields = (page.fields || [])
    .filter((field) => !isFrameworkNoise(field))
    .map(fieldFact)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  return {
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    normalizedUrl: normalizeArtifactUrl(rawUrl),
    fields,
    stateCount: Array.isArray(page.stateEvidence)
      ? Math.max(1, page.stateEvidence.length)
      : 1,
    uploadPresence: fields.some((field) => field.type === "file"),
  };
}

function fnv1a32(source: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function digestStructuralFingerprintFacts(
  facts: StructuralFingerprintFacts
) {
  const source = JSON.stringify(facts);
  const left = fnv1a32(source, 2166136261).toString(16).padStart(8, "0");
  const right = fnv1a32(source, 2246822507).toString(16).padStart(8, "0");
  return `${left}${right}`;
}

export function fingerprintArtifact(page: FingerprintPageSource) {
  const facts = extractStructuralFingerprintFacts(page);
  return {
    algorithmVersion: FINGERPRINT_ALGORITHM_VERSION,
    facts,
    digest: digestStructuralFingerprintFacts(facts),
  };
}
