type JsonObject = Record<string, unknown>;

export type ApiFailureIssue = {
  code: string;
  title: string;
  detail: string;
  source: string;
};

export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  response: unknown;
  issues: ApiFailureIssue[];
};

type FailureOptions = {
  force?: boolean;
};

const FAILURE_STATUSES = new Set([
  "blocked",
  "disqualified",
  "error",
  "failed",
  "rejected",
]);

const FAILURE_TONES = new Set(["danger", "error", "failed"]);

const FAILURE_GUIDANCE: Record<
  string,
  { title: string; detail: string }
> = {
  authentication_required: {
    title: "Authentication is required",
    detail: "Sign in again or provide a valid API Bearer token.",
  },
  authentication_locked: {
    title: "Authentication is temporarily locked",
    detail:
      "Too many invalid sign-in attempts triggered a temporary lock. Wait for the lockout period before retrying.",
  },
  admin_required: {
    title: "Administrator access is required",
    detail: "The signed-in identity does not have permission for this API call.",
  },
  control_plane_access_required: {
    title: "Control-plane access is restricted",
    detail: "This account is not authorized to use the control plane.",
  },
  external_target_access_required: {
    title: "This target requires elevated access",
    detail:
      "Regular operators and API tokens can run hosted crawls only against https://testforms.dbolab.io.",
  },
  invalid_target_url: {
    title: "The target URL is invalid",
    detail: "Enter a complete URL, including its http:// or https:// scheme.",
  },
  single_target_required: {
    title: "Exactly one target URL is required",
    detail: "Start the crawl with one URL only.",
  },
  related_page_discovery_disabled: {
    title: "Related-page discovery is disabled",
    detail: "Run a single explicit target instead of requesting related-page discovery.",
  },
  hosted_headful_unsupported: {
    title: "A visible browser is unavailable on the hosted service",
    detail: "Select headless browser mode and retry the call.",
  },
  method_not_allowed: {
    title: "The HTTP method is not allowed",
    detail: "Use the method documented for this API endpoint.",
  },
  upstream_unavailable: {
    title: "An internal service is unavailable",
    detail: "The API gateway could not reach one of its internal services. Retry after the service recovers.",
  },
  gateway_error: {
    title: "The API gateway could not complete the request",
    detail: "The gateway received an invalid or interrupted response from an internal service.",
  },
  network_error: {
    title: "The API could not be reached",
    detail: "Check the API address and network connection, then retry the request.",
  },
  request_timeout: {
    title: "The operation timed out",
    detail: "The operation did not finish within its allowed time.",
  },
  crawl_interrupted: {
    title: "The crawl was interrupted by a service restart",
    detail:
      "The service stopped before the crawl completed. Existing logs were preserved, but a new crawl is required.",
  },
  crawl_capacity_reached: {
    title: "Another browser run is already in progress",
    detail:
      "IntakeCR allows one browser run at a time. Wait for the active run to finish, then retry.",
  },
  openai_output_limit: {
    title: "AI script generation reached its output limit",
    detail:
      "OpenAI stopped before the crawl script was complete because the generated response reached the configured output-token limit.",
  },
  openai_analysis_failed: {
    title: "AI analysis could not be completed",
    detail: "The crawl data was retained, but AI enrichment failed.",
  },
  semantic_script_generation_failed: {
    title: "The page loaded, but its automation script was invalid",
    detail:
      "The rendered page, discovered fields, screenshot, and generation diagnostics were retained. The failure stopped further form interaction.",
  },
  fetch_failed: {
    title: "The target page could not be processed",
    detail: "The browser could not fetch or extract usable content from the target page.",
  },
  quality_floor: {
    title: "The crawl produced no usable form artifact",
    detail:
      "The crawl did not retain enough successfully fetched page and form evidence to produce a durable artifact.",
  },
  screenshot_unavailable: {
    title: "Screenshot evidence was unavailable",
    detail: "The crawl was preserved, but screenshot evidence could not be captured.",
  },
  challenge_detected: {
    title: "A browser challenge blocked the crawl",
    detail: "The site presented an interactive challenge that automation cannot complete.",
  },
  interactive_captcha: {
    title: "A CAPTCHA blocked automation",
    detail: "The form requires human verification, so no automated execution can continue.",
  },
  login_required: {
    title: "The form requires a login",
    detail: "The selected form is not available as a public, unauthenticated journey.",
  },
  cross_page_branching: {
    title: "The form has unsupported cross-page branching",
    detail: "The form depends on branching across pages that cannot be represented reliably for execution.",
  },
  script_missing: {
    title: "No executable crawl script was produced",
    detail: "The crawl did not produce or load an LLM-authored script for deterministic replay.",
  },
  form_not_approved: {
    title: "The form has not been approved",
    detail: "Approve this exact crawl-scoped form before trying to run it.",
  },
  approval_version_mismatch: {
    title: "The approval is for a different script version",
    detail: "Review and approve the current immutable script version before execution.",
  },
  validation_blocked: {
    title: "The submitted data failed form validation",
    detail: "Correct the returned field or branch validation issues and retry.",
  },
  required_field_not_actuated: {
    title: "A required field cannot be filled automatically",
    detail: "The executable script has no accepted action for a required field.",
  },
  type_mismatch: {
    title: "A value does not match the field contract",
    detail: "Supply a value or generated fixture that matches the field's required type.",
  },
  locator_unresolved: {
    title: "A form control could not be located reliably",
    detail: "The approved script could not resolve the expected control uniquely on the current page.",
  },
  field_verification_failed: {
    title: "A field value could not be verified",
    detail: "At least one field did not match when the browser read it back after entry.",
  },
  actuation_unverified: {
    title: "A browser action could not be verified",
    detail: "The script acted on a control, but browser readback did not prove the expected result.",
  },
  advance_no_navigation: {
    title: "The form did not advance",
    detail: "The script selected the progression control, but the expected next form state did not appear.",
  },
  form_change_suspected: {
    title: "The live form no longer matches the approved version",
    detail: "Execution stopped because the current page structure appears to have changed.",
  },
  repeated_state_unrepresentable: {
    title: "The form returned to a state that cannot be represented safely",
    detail: "Execution stopped instead of guessing how to continue through a repeated form state.",
  },
  terminal_submission_blocked: {
    title: "Final submission was not authorized",
    detail: "The run reached the submit action, but the request did not authorize a live submission.",
  },
  terminal_submission_unverified: {
    title: "Final submission could not be verified",
    detail: "The submit action ran, but the resulting page did not prove that the form was received.",
  },
  execution_error: {
    title: "The approved form execution failed",
    detail: "The browser execution stopped before it could complete.",
  },
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizedCode(value: unknown, fallback = "request_failed") {
  const candidate = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return candidate || fallback;
}

function humanizeCode(code: string) {
  const words = code.replaceAll("_", " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Request failed";
}

function inferCode(raw: string, fallback = "request_failed") {
  if (/max[_ ]output[_ ]tokens|output[- ]token limit/i.test(raw)) {
    return "openai_output_limit";
  }
  if (/screenshot.+(?:unavailable|failed|could not)|(?:unavailable|failed).+screenshot/i.test(raw)) {
    return "screenshot_unavailable";
  }
  if (/service restart|crawl.+interrupt/i.test(raw)) return "crawl_interrupted";
  if (/captcha/i.test(raw)) return "interactive_captcha";
  if (/timed? out|timeout/i.test(raw)) return "request_timeout";
  if (/failed to fetch|networkerror|network request failed/i.test(raw)) {
    return "network_error";
  }
  return normalizedCode(fallback);
}

function translatedDetail(code: string, raw: string) {
  if (code === "openai_output_limit") {
    return FAILURE_GUIDANCE.openai_output_limit.detail;
  }
  if (code === "screenshot_unavailable") {
    return FAILURE_GUIDANCE.screenshot_unavailable.detail;
  }
  if (code === "crawl_interrupted") {
    return FAILURE_GUIDANCE.crawl_interrupted.detail;
  }
  if (code === "semantic_script_generation_failed") {
    return FAILURE_GUIDANCE.semantic_script_generation_failed.detail;
  }
  if (code === "network_error") return FAILURE_GUIDANCE.network_error.detail;
  return raw || FAILURE_GUIDANCE[code]?.detail || "The API reported a failure without additional detail.";
}

function issueFrom(
  value: unknown,
  source: string,
  fallbackCode = "request_failed",
): ApiFailureIssue | null {
  const object = asObject(value);
  const raw = object
    ? text(
        object.detail ??
          object.error ??
          object.message ??
          object.rationale ??
          object.note ??
          object.title,
      )
    : text(value);
  const suppliedCode = object
    ? object.failureCode ?? object.code ?? object.outcome ?? object.status
    : fallbackCode;
  const code = inferCode(raw, normalizedCode(suppliedCode, fallbackCode));
  if (!raw && !code) return null;
  const suppliedTitle = object ? text(object.title ?? object.label) : "";
  const technicalTitle = suppliedTitle === code || suppliedTitle.includes("_");
  const guidance = FAILURE_GUIDANCE[code];
  return {
    code,
    title:
      guidance?.title ||
      (!technicalTitle && suppliedTitle ? suppliedTitle : humanizeCode(code)),
    detail: translatedDetail(code, raw),
    source,
  };
}

function statusOf(value: JsonObject | null) {
  return normalizedCode(value?.status ?? value?.outcome, "");
}

function hasFailureStatus(value: JsonObject | null) {
  return FAILURE_STATUSES.has(statusOf(value));
}

function isFailureEntry(value: unknown) {
  const object = asObject(value);
  if (!object) return Boolean(text(value));
  const tone = normalizedCode(object.tone ?? object.severity, "");
  const status = statusOf(object);
  const code = normalizedCode(object.failureCode ?? object.code, "");
  return (
    FAILURE_TONES.has(tone) ||
    FAILURE_STATUSES.has(status) ||
    Boolean(text(object.failureCode)) ||
    /(?:^|_)(?:blocked|disqualified|error|fail(?:ed|ure)?|interrupted|missing|unavailable)(?:_|$)/.test(
      code,
    ) ||
    ["quality_floor", "interactive_captcha", "challenge_detected"].includes(code)
  );
}

function looksLikeFailureText(value: unknown) {
  return /blocked|captcha|could not|error|fail|incomplete|interrupt|max[_ ]output[_ ]tokens|missing|timed? out|unavailable|unverified/i.test(
    text(value),
  );
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function primaryEntity(root: JsonObject | null) {
  for (const key of ["run", "execution", "form"]) {
    const candidate = asObject(root?.[key]);
    if (candidate) return { key, value: candidate };
  }
  return root ? { key: "response", value: root } : null;
}

function httpIssue(status: number, payload: unknown) {
  const object = asObject(payload);
  const fallbackCode =
    status === 0 ? "network_error" : normalizedCode(object?.code, `http_${status}`);
  const candidate =
    object ||
    (text(payload)
      ? { code: fallbackCode, detail: text(payload) }
      : {
          code: fallbackCode,
          detail:
            status === 0
              ? FAILURE_GUIDANCE.network_error.detail
              : `The API returned HTTP ${status}.`,
        });
  return issueFrom(candidate, "API response", fallbackCode);
}

export function apiFailureFrom(
  status: number,
  payload: unknown,
  options: FailureOptions = {},
): ApiFailure | null {
  const root = asObject(payload);
  const entity = primaryEntity(root);
  const eligibility = asObject(entity?.value.eligibility);
  const submission = asObject(entity?.value.submissionResult);
  const failed =
    options.force === true ||
    status === 0 ||
    status >= 400 ||
    hasFailureStatus(root) ||
    hasFailureStatus(entity?.value || null) ||
    statusOf(eligibility) === "disqualified" ||
    hasFailureStatus(submission) ||
    array(entity?.value.findings).some(isFailureEntry) ||
    Boolean(text(root?.error));

  if (!failed) return null;

  const collected: ApiFailureIssue[] = [];
  const add = (candidate: ApiFailureIssue | null) => {
    if (candidate) collected.push(candidate);
  };

  if (status === 0 || status >= 400 || text(root?.error)) {
    add(httpIssue(status, payload));
  }

  const value = entity?.value || root;
  if (value) {
    if (text(value.failureCode)) {
      add(
        issueFrom(
          {
            code: value.failureCode,
            detail: value.detail ?? value.error ?? value.message,
          },
          `${entity?.key || "response"} outcome`,
        ),
      );
    }

    for (const finding of array(value.findings)) {
      if (isFailureEntry(finding)) add(issueFrom(finding, "crawl finding"));
    }
    for (const issue of [...array(value.issues), ...array(root?.issues)]) {
      add(issueFrom(issue, "execution issue"));
    }
    for (const error of [...array(value.errors), ...array(root?.errors)]) {
      add(issueFrom(error, "validation error"));
    }
    for (const reason of array(eligibility?.reasons)) {
      add(issueFrom(reason, "eligibility decision"));
    }
    for (const flag of array(asObject(value.liveTraversal)?.flags)) {
      if (isFailureEntry(flag)) add(issueFrom(flag, "live traversal"));
    }
    for (const nodeValue of array(value.nodes)) {
      const node = asObject(nodeValue);
      if (!node) continue;
      const nodeSource = text(node.title) || text(node.sourceUrl) || "crawl page";
      const nodeFailed =
        hasFailureStatus(node) ||
        statusOf(node) === "review" ||
        looksLikeFailureText(node.subtitle);
      if (!nodeFailed) continue;
      if (looksLikeFailureText(node.subtitle)) {
        add(issueFrom(node.subtitle, nodeSource, "fetch_failed"));
      }
      for (const note of array(node.notes)) {
        if (looksLikeFailureText(note)) add(issueFrom(note, nodeSource));
      }
    }
    if (submission && hasFailureStatus(submission)) {
      add(issueFrom(submission, "submission result", "terminal_submission_unverified"));
    }
  }

  const issues = collected.filter((issue, index, all) => {
    const key = `${issue.code}|${issue.detail.toLowerCase().replace(/\s+/g, " ")}`;
    return (
      all.findIndex(
        (candidate) =>
          `${candidate.code}|${candidate.detail.toLowerCase().replace(/\s+/g, " ")}` === key,
      ) === index
    );
  });

  if (issues.length === 0) {
    add(
      issueFrom(
        {
          code:
            value?.failureCode ??
            root?.code ??
            (status ? `http_${status}` : "request_failed"),
          title: value?.stage,
          detail: value?.detail ?? value?.error ?? value?.message ?? value?.stage,
        },
        entity?.key || "API response",
      ),
    );
    issues.push(...collected);
  }

  const first = issues[0];
  return {
    status,
    code: normalizedCode(root?.code ?? value?.failureCode ?? first?.code, `http_${status}`),
    message:
      text(root?.error ?? root?.detail ?? value?.detail ?? value?.stage) ||
      first?.detail ||
      "Request failed.",
    response: payload,
    issues,
  };
}
