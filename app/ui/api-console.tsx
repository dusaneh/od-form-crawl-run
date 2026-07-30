"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type JsonObject = Record<string, unknown>;
type CrawlMode = "probe" | "submit";
type FixtureAuthorities = {
  acknowledgement: boolean;
  consent: boolean;
  reviewConfirmation: boolean;
  signature: boolean;
  upload: boolean;
};
type Exchange = {
  id: string;
  sequence: number;
  createdAt: string;
  label: string;
  method: string;
  url: string;
  requestBody?: unknown;
  curl: string;
  status: number;
  response: unknown;
};
type ConsoleError = {
  status: number;
  code: string;
  message: string;
  response: unknown;
};

const DEFAULT_API = "";
const DEFAULT_TARGET =
  "http://localhost:9000/site_af_branch_cards/intake";
const DEFAULT_CAPTURE =
  "http://localhost:9000/site_af_branch_cards";
const commonErrors = [
  ["script_missing", "No LLM-authored script could be generated or loaded."],
  ["quality_floor", "The crawl did not collect enough verified evidence."],
  ["challenge_detected", "An interactive CAPTCHA disqualified the form."],
  ["cross_page_branching", "Cross-page branching was detected and is unsupported."],
  ["form_not_approved", "Approve this exact crawl-scoped form ID first."],
  ["approval_version_mismatch", "Approval pins a different script version or hash."],
  ["validation_blocked", "Run data does not satisfy the returned schema or branch."],
  ["actuation_unverified", "A scripted field action failed browser readback."],
  ["advance_no_navigation", "A progression action did not reach its expected state."],
  ["terminal_submission_unverified", "Submit ran, but success was not verified."],
];

function apiUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function pretty(value: unknown) {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function curlCommand(
  method: string,
  url: string,
  body?: unknown,
) {
  const parts = [
    `curl -sS -X ${method}`,
    shellQuote(url),
    "-H 'Authorization: Bearer <FORMWEAVE_API_TOKEN>'",
  ];
  if (body !== undefined) {
    parts.push("-H 'Content-Type: application/json'");
    parts.push(`--data ${shellQuote(JSON.stringify(body))}`);
  }
  return parts.join(" \\\n  ");
}

function errorFrom(status: number, payload: unknown): ConsoleError {
  const object =
    payload && typeof payload === "object" ? (payload as JsonObject) : {};
  return {
    status,
    code: String(object.code || `http_${status}`),
    message: String(object.error || object.detail || "Request failed."),
    response: payload,
  };
}

function captureBaseFor(target: string) {
  try {
    const url = new URL(target);
    const match = url.pathname.match(/^(\/site_[a-z0-9_]+)(?:\/|$)/i);
    return match ? `${url.origin}${match[1]}` : DEFAULT_CAPTURE;
  } catch {
    return DEFAULT_CAPTURE;
  }
}

function schemaProperties(inputSchema: JsonObject | null) {
  return inputSchema?.properties && typeof inputSchema.properties === "object"
    ? (inputSchema.properties as Record<string, JsonObject>)
    : {};
}

function schemaOptions(schema: JsonObject) {
  const labels = Array.isArray(schema["x-formweave-options"])
    ? (schema["x-formweave-options"] as JsonObject[])
    : [];
  return new Map(
    labels.map((option) => [
      String(option.value ?? ""),
      String(option.label ?? option.value ?? ""),
    ]),
  );
}

function browserConstraints(schema: JsonObject) {
  return schema["x-formweave-browser-constraints"] &&
    typeof schema["x-formweave-browser-constraints"] === "object"
    ? (schema["x-formweave-browser-constraints"] as JsonObject)
    : {};
}

function browserInputType(schema: JsonObject, control: string) {
  if (schema.type === "number" || schema.type === "integer") return "number";
  return [
    "date",
    "datetime-local",
    "email",
    "month",
    "password",
    "tel",
    "time",
    "url",
    "week",
  ].includes(control)
    ? control
    : "text";
}

function capturedSubmissions(value: unknown) {
  if (!value || typeof value !== "object") return [] as JsonObject[];
  const object = value as JsonObject;
  if (Array.isArray(object.submissions)) {
    return object.submissions.filter(
      (item): item is JsonObject =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  return object.fields && typeof object.fields === "object" ? [object] : [];
}

function captureVerification(
  inputSchema: JsonObject | null,
  runData: JsonObject,
  capture: unknown,
) {
  const submissions = capturedSubmissions(capture);
  if (!inputSchema || submissions.length === 0) return null;
  const capturedFields = submissions
    .map((submission) =>
      submission.fields && typeof submission.fields === "object"
        ? (submission.fields as JsonObject)
        : {},
    );
  const checks = Object.entries(runData).map(([key, expected]) => {
    const schema = schemaProperties(inputSchema)[key] || {};
    const nativeName = String(schema["x-formweave-native-name"] || key);
    const observed = capturedFields
      .filter((fields) => Object.hasOwn(fields, nativeName))
      .flatMap((fields) => {
        const value = fields[nativeName];
        return Array.isArray(value) ? value : [value];
      })
      .map((value) => String(value));
    let matched = false;
    let expectedDisplay = String(expected);
    if (typeof expected === "boolean") {
      expectedDisplay = expected ? "present/checked" : "absent/unchecked";
      matched = expected ? observed.length > 0 : observed.length === 0;
    } else if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      typeof (expected as JsonObject).filename === "string"
    ) {
      expectedDisplay = String((expected as JsonObject).filename);
      matched = observed.includes(expectedDisplay);
    } else if (Array.isArray(expected)) {
      const expectedValues = expected.map((value) => String(value));
      expectedDisplay = expectedValues.join(", ");
      matched = expectedValues.every((value) => observed.includes(value));
    } else {
      matched = observed.includes(String(expected));
    }
    return {
      key,
      nativeName,
      expected: expectedDisplay,
      observed,
      matched,
    };
  });
  return {
    submissionsChecked: submissions.length,
    matched: checks.filter((check) => check.matched).length,
    total: checks.length,
    passed: checks.length > 0 && checks.every((check) => check.matched),
    checks,
  };
}

function branchFor(schema: JsonObject) {
  return schema["x-formweave-branch"] &&
    typeof schema["x-formweave-branch"] === "object"
    ? (schema["x-formweave-branch"] as JsonObject)
    : null;
}

function fieldIsActive(schema: JsonObject, values: JsonObject) {
  const branch = branchFor(schema);
  return (
    !branch ||
    values[String(branch.fieldKey || "")] === branch.value
  );
}

function activePayload(
  inputSchema: JsonObject | null,
  values: JsonObject,
) {
  const result: JsonObject = {};
  for (const [key, schema] of Object.entries(schemaProperties(inputSchema))) {
    if (fieldIsActive(schema, values) && values[key] !== undefined) {
      result[key] = values[key];
    }
  }
  return result;
}

function fieldIsRequired(
  key: string,
  inputSchema: JsonObject | null,
  values: JsonObject,
) {
  if (
    Array.isArray(inputSchema?.required) &&
    inputSchema.required.includes(key)
  ) {
    return true;
  }
  const conditions = Array.isArray(inputSchema?.allOf)
    ? inputSchema.allOf
    : [];
  return conditions.some((condition) => {
    if (!condition || typeof condition !== "object") return false;
    const item = condition as JsonObject;
    const then = item.then && typeof item.then === "object"
      ? (item.then as JsonObject)
      : null;
    if (!then || !Array.isArray(then.required) || !then.required.includes(key)) {
      return false;
    }
    const ifClause = item.if && typeof item.if === "object"
      ? (item.if as JsonObject)
      : null;
    const properties =
      ifClause?.properties && typeof ifClause.properties === "object"
        ? (ifClause.properties as Record<string, JsonObject>)
        : {};
    return Object.entries(properties).every(
      ([triggerKey, trigger]) => values[triggerKey] === trigger.const,
    );
  });
}

export function ApiConsole() {
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [targetUrl, setTargetUrl] = useState(DEFAULT_TARGET);
  const [captureBaseUrl, setCaptureBaseUrl] = useState(DEFAULT_CAPTURE);
  const [browserMode, setBrowserMode] = useState<"headless" | "headful">(
    "headless",
  );
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("probe");
  const [allowLocalTargets, setAllowLocalTargets] = useState(false);
  const [discoverRelatedPages, setDiscoverRelatedPages] = useState(false);
  const [fixtureAuthorities, setFixtureAuthorities] = useState<FixtureAuthorities>({
    acknowledgement: false,
    consent: false,
    reviewConfirmation: false,
    signature: false,
    upload: false,
  });
  const [crawlId, setCrawlId] = useState("");
  const [crawl, setCrawl] = useState<JsonObject | null>(null);
  const [report, setReport] = useState<JsonObject | null>(null);
  const [formId, setFormId] = useState("");
  const [form, setForm] = useState<JsonObject | null>(null);
  const [inputValues, setInputValues] = useState<JsonObject>({});
  const [submit, setSubmit] = useState(false);
  const [executionId, setExecutionId] = useState("");
  const [execution, setExecution] = useState<JsonObject | null>(null);
  const [capture, setCapture] = useState<unknown>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [selectedExchangeId, setSelectedExchangeId] = useState("");
  const exchangeSequence = useRef(0);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (apiBase) return;
    const timer = window.setTimeout(() => {
      const localDevelopment =
        ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        window.location.port === "3000";
      setApiBase(
        localDevelopment ? "http://127.0.0.1:8787" : window.location.origin,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [apiBase]);

  const inputSchema = useMemo(() => {
    const value = form?.inputSchema;
    return value && typeof value === "object" ? (value as JsonObject) : null;
  }, [form]);
  const definitions = useMemo(() => {
    const value = report?.formDefinitions;
    return Array.isArray(value) ? (value as JsonObject[]) : [];
  }, [report]);
  const activeFields = useMemo(
    () =>
      Object.entries(schemaProperties(inputSchema)).filter(([, schema]) =>
        fieldIsActive(schema, inputValues),
      ),
    [inputSchema, inputValues],
  );
  const runData = useMemo(
    () => activePayload(inputSchema, inputValues),
    [inputSchema, inputValues],
  );
  const captureCheck = useMemo(
    () => captureVerification(inputSchema, runData, capture),
    [inputSchema, runData, capture],
  );
  const exchange =
    exchanges.find((item) => item.id === selectedExchangeId) ||
    exchanges.at(-1) ||
    null;
  const selectedExchangeIndex = exchange
    ? exchanges.findIndex((item) => item.id === exchange.id)
    : -1;

  async function request(
    label: string,
    method: string,
    path: string,
    body?: unknown,
  ) {
    setError(null);
    const url = apiUrl(apiBase, path);
    const recordExchange = (status: number, responsePayload: unknown) => {
      exchangeSequence.current += 1;
      const nextExchange: Exchange = {
        id: `exchange_${exchangeSequence.current}`,
        sequence: exchangeSequence.current,
        createdAt: new Date().toISOString(),
        label,
        method,
        url,
        requestBody: body,
        curl: curlCommand(method, url, body),
        status,
        response: responsePayload,
      };
      setExchanges((current) => [...current, nextExchange]);
      setSelectedExchangeId(nextExchange.id);
    };
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers:
          body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (caught) {
      const payload = {
        error: caught instanceof Error ? caught.message : String(caught),
      };
      recordExchange(0, payload);
      const nextError = errorFrom(0, payload);
      setError(nextError);
      throw nextError;
    }
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // Raw text remains visible in the exchange inspector.
    }
    recordExchange(response.status, payload);
    if (!response.ok) {
      const nextError = errorFrom(response.status, payload);
      setError(nextError);
      throw nextError;
    }
    return payload as JsonObject;
  }

  async function pollCrawl() {
    if (!crawlId) return;
    setBusy("poll-crawl");
    try {
      const payload = await request(
        "Poll crawl status once",
        "GET",
        `/api/runs/${encodeURIComponent(crawlId)}`,
      );
      const current =
        payload.run && typeof payload.run === "object"
          ? (payload.run as JsonObject)
          : undefined;
      if (!current) {
        const nextError = errorFrom(404, {
          error: `Crawl ${crawlId} was not found.`,
        });
        setError(nextError);
        return;
      }
      setCrawl(current);
      const ids = Array.isArray(current.formIds) ? current.formIds : [];
      if (ids[0]) setFormId(String(ids[0]));
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function loadReport(id = crawlId) {
    if (!id) return;
    setBusy("report");
    try {
      const payload = await request(
        "Get crawl report and schema definitions",
        "GET",
        `/api/runs/${encodeURIComponent(id)}/report`,
      );
      setReport(payload);
      const nextDefinitions = Array.isArray(payload.formDefinitions)
        ? (payload.formDefinitions as JsonObject[])
        : [];
      const nextId = String(nextDefinitions[0]?.formId || "");
      if (nextId) setFormId(nextId);
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function loadForm(id = formId) {
    if (!id) return;
    setBusy("schema");
    try {
      const payload = await request(
        "Get exact form input schema",
        "GET",
        `/api/forms/${encodeURIComponent(id)}`,
      );
      const nextForm =
        payload.form && typeof payload.form === "object"
          ? (payload.form as JsonObject)
          : null;
      setForm(nextForm);
      setInputValues({});
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function startCrawl() {
    try {
      new URL(targetUrl);
    } catch (caught) {
      setError({
        status: 0,
        code: "invalid_target_url",
        message: caught instanceof Error ? caught.message : "Invalid target URL.",
        response: null,
      });
      return;
    }
    setBusy("crawl");
    setCrawlId("");
    setCrawl(null);
    setReport(null);
    setForm(null);
    setFormId("");
    setInputValues({});
    setExecutionId("");
    setExecution(null);
    setCapture(null);
    try {
      setCaptureBaseUrl(captureBaseFor(targetUrl));
      const payload = await request("Start crawl", "POST", "/api/runs", {
        urls: [targetUrl],
        name: "API console crawl",
        mode: "probe",
        submit: crawlMode === "submit",
        browserMode,
        allowLocalTargets,
        discoverRelatedPages,
        componentAuthorities: fixtureAuthorities,
      });
      const run =
        payload.run && typeof payload.run === "object"
          ? (payload.run as JsonObject)
          : {};
      const id = String(run.id || run.crawlId || "");
      setCrawlId(id);
      setCrawl(run);
    } catch {
      // The structured request error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function approveForm() {
    if (!formId) return;
    setBusy("approve");
    try {
      const payload = await request(
        "Approve exact crawl-scoped form",
        "POST",
        `/api/forms/${encodeURIComponent(formId)}/approval`,
        {
          decision: "approved",
          actor: "api-console-operator",
          notes: "Approved through the local API console after report review.",
        },
      );
      if (payload.form && typeof payload.form === "object") {
        setForm(payload.form as JsonObject);
      }
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function pollExecution() {
    const id = executionId;
    if (!id) return;
    setBusy("poll-execution");
    try {
      const payload = await request(
        "Poll form execution once",
        "GET",
        `/api/executions/${encodeURIComponent(id)}`,
      );
      const current =
        payload.execution && typeof payload.execution === "object"
          ? (payload.execution as JsonObject)
          : {};
      setExecution(current);
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  async function runForm() {
    if (!formId) return;
    setBusy("run");
    setExecutionId("");
    setExecution(null);
    try {
      const payload = await request(
        submit ? "Run and submit approved form" : "Dry-run approved form",
        "POST",
        `/api/forms/${encodeURIComponent(formId)}/runs`,
        { data: runData, submit, browserMode },
      );
      const created =
        payload.execution && typeof payload.execution === "object"
          ? (payload.execution as JsonObject)
          : {};
      setExecutionId(String(created.executionId || ""));
      setExecution(created);
    } catch {
      // The structured error is already displayed.
    } finally {
      setBusy("");
    }
  }

  function setFieldValue(key: string, value: unknown) {
    setInputValues((current) =>
      activePayload(inputSchema, { ...current, [key]: value }),
    );
  }

  async function setFileValue(key: string, file?: File) {
    if (!file) {
      setFieldValue(key, undefined);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setFieldValue(key, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      contentBase64: window.btoa(binary),
    });
  }

  async function readCapture(action: "latest" | "list" | "clear") {
    setBusy(`capture-${action}`);
    try {
      const payload = await request(
        `${action} fixture submissions`,
        "POST",
        "/api/fixture-submissions",
        { captureBaseUrl, action },
      );
      setCapture(payload);
    } catch {
      if (action === "latest") setCapture(null);
    } finally {
      setBusy("");
    }
  }

  const formStatus = String(form?.status || "not loaded");
  const eligibility =
    form?.eligibility && typeof form.eligibility === "object"
      ? String((form.eligibility as JsonObject).status || "unknown")
      : "unknown";

  return (
    <main className="api-console-shell">
      <header className="api-console-header">
        <div>
          <a href="/control-plane" className="api-console-back">← Form intelligence</a>
          <span className="breadcrumb">DEVELOPER TOOLS / API CONSOLE</span>
          <h1>Crawl, approve, and run a form</h1>
          <p>
            A thin UI over the real crawl, report, approval, and execution
            APIs. Registered test-harness submissions can be read back from
            local or hosted testforms deployments.
          </p>
        </div>
      </header>

      {error && (
        <section className="api-console-error" role="alert">
          <strong>{error.code}</strong>
          <span>HTTP {error.status || "client"} · {error.message}</span>
        </section>
      )}

      <section className="api-console-grid">
        <div className="api-console-workflow">
          <article className="api-console-card">
            <div className="api-console-step">
              <span>1</span>
              <div>
                <h2>Kick off crawl</h2>
                <p>
                  One <code>POST /api/runs</code>. It returns immediately with
                  the crawl ID; this button does not poll.
                </p>
              </div>
            </div>
            <label>
              Form URL
              <input
                value={targetUrl}
                onChange={(event) => {
                  setTargetUrl(event.target.value);
                  setCaptureBaseUrl(captureBaseFor(event.target.value));
                }}
              />
            </label>
            <div className="api-console-callout">
              <strong>Choose the crawl boundary explicitly.</strong>
              <span>
                <code>probe</code> maps and tests with synthetic values but
                stops before terminal submit. <code>submit: true</code> uses
                the same LLM-authored script and synthetic values, activates
                the terminal action, and verifies the resulting state. This
                choice is available for public and explicitly allowed
                localhost targets.
              </span>
            </div>
            <div className="api-console-inline">
              <label>
                Crawl mode
                <select
                  value={crawlMode}
                  onChange={(event) =>
                    setCrawlMode(event.target.value as CrawlMode)
                  }
                >
                  <option value="probe">Probe — stop before submit</option>
                  <option value="submit">
                    Traverse and submit — synthetic values
                  </option>
                </select>
              </label>
              <label>
                Browser
                <select
                  value={browserMode}
                  onChange={(event) =>
                    setBrowserMode(event.target.value as "headless" | "headful")
                  }
                >
                  <option value="headless">Headless</option>
                  <option value="headful">Headful</option>
                </select>
              </label>
              <label>
                FormWeave API
                <input
                  value={apiBase}
                  onChange={(event) => setApiBase(event.target.value)}
                />
              </label>
            </div>
            <div className="api-console-switches">
              <label>
                <input
                  type="checkbox"
                  checked={discoverRelatedPages}
                  onChange={(event) =>
                    setDiscoverRelatedPages(event.target.checked)
                  }
                />
                <span>
                  <strong>Discover related same-site pages</strong>
                  <small>Bounded same-origin discovery; off means only the supplied URL.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowLocalTargets}
                  onChange={(event) =>
                    setAllowLocalTargets(event.target.checked)
                  }
                />
                <span>
                  <strong>Allow localhost test targets</strong>
                  <small>Required for a local fixture. Hosted FormWeave rejects this flag.</small>
                </span>
              </label>
            </div>
            <fieldset className="api-console-authorities">
              <legend>Per-crawl component authorities</legend>
              <p>
                These permit the LLM-authored script to model the selected
                component types with synthetic values. They do not authorize
                terminal submission; that is controlled separately by the
                crawl boundary above.
              </p>
                {(
                  [
                    ["consent", "Consent / terms"],
                    ["signature", "Signature"],
                    ["upload", "File upload"],
                    ["acknowledgement", "Acknowledgement"],
                    ["reviewConfirmation", "Review confirmation"],
                  ] as [keyof FixtureAuthorities, string][]
                ).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={fixtureAuthorities[key]}
                      onChange={(event) =>
                        setFixtureAuthorities((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
            </fieldset>
            <div className="api-console-actions">
              <button
                className="primary-button"
                onClick={startCrawl}
                disabled={Boolean(busy)}
              >
                {busy === "crawl" ? "Starting…" : "POST · Start crawl"}
              </button>
            </div>
            <div className="api-console-facts">
              <span><b>Crawl</b> {crawlId || "not started"}</span>
              <span><b>Initial status</b> {String(crawl?.status || "—")}</span>
              <span>
                <b>Terminal submit</b>{" "}
                {crawlMode === "submit" ? "requested" : "blocked"}
              </span>
              <span><b>Discovery</b> {discoverRelatedPages ? "on" : "off"}</span>
              <span><b>Local target</b> {allowLocalTargets ? "allowed" : "blocked"}</span>
            </div>
          </article>

          <article className="api-console-card">
            <div className="api-console-step">
              <span>2</span>
              <div>
                <h2>Poll status, then get the report</h2>
                <p>
                Each click makes exactly one call. The ID returned by the
                crawl kickoff is prefilled and polled directly.
                </p>
              </div>
            </div>
            <div className="api-console-callout">
              <strong>The poll does not contain the input schema.</strong>
              <span>
                It reports lifecycle state, progress, <code>reportAvailable</code>,
                and eventually <code>formIds</code>. Retrieve the report, then
                call the form-schema endpoint in step 3.
              </span>
            </div>
            <label>
              Run ID returned by crawl kickoff
              <input
                value={crawlId}
                placeholder="run_..."
                onChange={(event) => {
                  setCrawlId(event.target.value.trim());
                  setCrawl(null);
                  setReport(null);
                }}
              />
            </label>
            <div className="api-console-actions">
              <button
                className="secondary-button"
                onClick={pollCrawl}
                disabled={!crawlId || Boolean(busy)}
              >
                {busy === "poll-crawl"
                  ? "Polling…"
                  : "GET · Poll crawl once"}
              </button>
              <button
                className="primary-button"
                onClick={() => loadReport()}
                disabled={crawl?.reportAvailable !== true || Boolean(busy)}
              >
                {busy === "report" ? "Loading…" : "GET · Fetch report"}
              </button>
            </div>
            <div className="api-console-facts">
              <span><b>Status</b> {String(crawl?.status || "—")}</span>
              <span><b>Progress</b> {String(crawl?.progress ?? "—")}%</span>
              <span>
                <b>Report</b>{" "}
                {crawl?.reportAvailable === true ? "available" : "not ready"}
              </span>
              <span>
                <b>Form IDs</b>{" "}
                {Array.isArray(crawl?.formIds) && crawl.formIds.length
                  ? crawl.formIds.join(", ")
                  : "—"}
              </span>
            </div>
            <details className="api-console-json">
              <summary>Retrieved report</summary>
              <pre>{pretty(report) || "Fetch the report after it becomes available."}</pre>
            </details>
          </article>

          <article className="api-console-card">
            <div className="api-console-step">
              <span>3</span>
              <div>
                <h2>Get schema and approve</h2>
                <p>
                  Two explicit API calls using the exact crawl-scoped form and
                  script identity.
                </p>
              </div>
            </div>
            <label>
              Form ID from the status poll or report
              <input
                value={formId}
                onChange={(event) => setFormId(event.target.value)}
                placeholder="form_..."
              />
            </label>
            <div className="api-console-callout">
              <strong>Approval is a human review decision, not a submission test.</strong>
              <span>
                A completed eligible probe may be approved without terminal
                submission. Approval pins the exact crawl-scoped script and
                schema; the later run response is the evidence of whether an
                actual submission succeeded.
              </span>
            </div>
            {definitions.length > 1 && (
              <label className="api-console-secondary-field">
                Select another form found in the report
                <select
                  value={formId}
                  onChange={(event) => setFormId(event.target.value)}
                >
                  {definitions.map((definition) => (
                    <option
                      key={String(definition.formId)}
                      value={String(definition.formId)}
                    >
                      {String(definition.title || definition.formId)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="api-console-facts">
              <span><b>Form ID</b> {formId || "—"}</span>
              <span><b>Status</b> {formStatus}</span>
              <span><b>Eligibility</b> {eligibility}</span>
              <span>
                <b>Script</b>{" "}
                {String(
                  form?.script && typeof form.script === "object"
                    ? (form.script as JsonObject).scriptVersion || "—"
                    : "—",
                )}
              </span>
            </div>
            <div className="api-console-actions">
              <button
                className="secondary-button"
                onClick={() => loadForm()}
                disabled={!formId || Boolean(busy)}
              >
                {busy === "schema" ? "Loading…" : "GET · Get schema"}
              </button>
              <button
                className="primary-button"
                onClick={approveForm}
                disabled={
                  !formId ||
                  eligibility !== "eligible" ||
                  formStatus === "approved" ||
                  Boolean(busy)
                }
              >
                {busy === "approve"
                  ? "Approving…"
                  : formStatus === "approved"
                    ? "Approved"
                    : "POST · Approve form"}
              </button>
            </div>
            <details className="api-console-json" open>
              <summary>Input schema</summary>
              <pre>{pretty(inputSchema) || "Schema will appear here."}</pre>
            </details>
          </article>

          <article className="api-console-card">
            <div className="api-console-step">
              <span>4</span>
              <div>
                <h2>Enter data, start run, then poll it</h2>
                <p>
                  The schema-to-fields rendering below is the only automated
                  convenience. Starting and polling execution remain separate calls.
                </p>
              </div>
            </div>
            {!inputSchema ? (
              <div className="api-console-empty">
                Call <strong>GET · Get schema</strong> to create the run fields.
              </div>
            ) : (
              <div className="api-console-generated-form">
                {activeFields.map(([key, schema]) => {
                  const label = String(schema["x-formweave-label"] || key);
                  const required = fieldIsRequired(
                    key,
                    inputSchema,
                    inputValues,
                  );
                  const options = Array.isArray(schema.enum) ? schema.enum : [];
                  const optionLabels = schemaOptions(schema);
                  const control = String(
                    schema["x-formweave-control"] || schema.type || "text",
                  );
                  const constraints = browserConstraints(schema);
                  const value = inputValues[key];
                  const branch = branchFor(schema);
                  const fileField =
                    control === "file" ||
                    (schema.type === "object" &&
                      schema.properties &&
                      typeof schema.properties === "object" &&
                      "contentBase64" in schema.properties);
                  return (
                    <label className="api-console-generated-field" key={key}>
                      <span className="api-console-field-heading">
                        <strong>{label}</strong>
                        {required && <em>Required</em>}
                        {branch && <i>Conditional</i>}
                      </span>
                      {options.length ? (
                        <select
                          value={String(value ?? "")}
                          onChange={(event) =>
                            setFieldValue(
                              key,
                              event.target.value === ""
                                ? undefined
                                : event.target.value,
                            )
                          }
                        >
                          <option value="">
                            {required ? "Choose an option…" : "Not supplied"}
                          </option>
                          {options.map((option) => (
                            <option key={String(option)} value={String(option)}>
                              {optionLabels.get(String(option)) || String(option)}
                            </option>
                          ))}
                        </select>
                      ) : schema.type === "boolean" ? (
                        <select
                          value={
                            value === undefined ? "" : String(value)
                          }
                          onChange={(event) =>
                            setFieldValue(
                              key,
                              event.target.value === ""
                                ? undefined
                                : event.target.value === "true",
                            )
                          }
                        >
                          <option value="">Not supplied</option>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : fileField ? (
                        <input
                          type="file"
                          required={required}
                          onChange={(event) =>
                            void setFileValue(key, event.target.files?.[0])
                          }
                        />
                      ) : (
                        <input
                          type={
                            browserInputType(schema, control)
                          }
                          value={
                            typeof value === "string" ||
                            typeof value === "number"
                              ? value
                              : ""
                          }
                          required={required}
                          min={
                            typeof schema.minimum === "number"
                              ? schema.minimum
                              : typeof constraints.min === "string" &&
                                  constraints.min
                                ? constraints.min
                                : undefined
                          }
                          max={
                            typeof schema.maximum === "number"
                              ? schema.maximum
                              : typeof constraints.max === "string" &&
                                  constraints.max
                                ? constraints.max
                                : undefined
                          }
                          step={
                            typeof schema.multipleOf === "number"
                              ? schema.multipleOf
                              : undefined
                          }
                          minLength={
                            typeof schema.minLength === "number"
                              ? schema.minLength
                              : undefined
                          }
                          maxLength={
                            typeof schema.maxLength === "number"
                              ? schema.maxLength
                              : undefined
                          }
                          pattern={
                            typeof schema.pattern === "string"
                              ? schema.pattern
                              : undefined
                          }
                          placeholder={
                            typeof constraints.placeholder === "string" &&
                            constraints.placeholder
                              ? constraints.placeholder
                              : typeof schema["x-formweave-input-format"] ===
                                    "string" &&
                                  schema["x-formweave-input-format"]
                                ? String(schema["x-formweave-input-format"])
                                : undefined
                          }
                          inputMode={
                            typeof constraints.inputMode === "string" &&
                            constraints.inputMode
                              ? (constraints.inputMode as
                                  | "decimal"
                                  | "email"
                                  | "numeric"
                                  | "search"
                                  | "tel"
                                  | "text"
                                  | "url")
                              : undefined
                          }
                          onChange={(event) =>
                            setFieldValue(
                              key,
                              schema.type === "number" ||
                                schema.type === "integer"
                                ? event.target.value === ""
                                  ? undefined
                                  : Number(event.target.value)
                                : event.target.value === ""
                                  ? undefined
                                  : event.target.value,
                            )
                          }
                        />
                      )}
                      <code>{key}</code>
                    </label>
                  );
                })}
              </div>
            )}
            <details className="api-console-json" open>
              <summary>Generated run data payload</summary>
              <pre>{pretty(runData)}</pre>
            </details>
            <div className="api-console-runbar">
              <label className="api-console-check">
                <input
                  type="checkbox"
                  checked={submit}
                  onChange={(event) => setSubmit(event.target.checked)}
                />
                Activate terminal submit
              </label>
              <button
                className={submit ? "api-console-submit" : "primary-button"}
                onClick={runForm}
                disabled={formStatus !== "approved" || Boolean(busy)}
              >
                {busy === "run"
                  ? "Starting…"
                  : submit
                    ? "POST · Start run and submit"
                    : "POST · Start run without submit"}
              </button>
              <button
                className="secondary-button"
                onClick={pollExecution}
                disabled={!executionId || Boolean(busy)}
              >
                {busy === "poll-execution"
                  ? "Polling…"
                  : "GET · Poll execution once"}
              </button>
            </div>
            <label>
              Execution ID returned by run kickoff
              <input
                value={executionId}
                placeholder="exec_..."
                onChange={(event) => {
                  setExecutionId(event.target.value.trim());
                  setExecution(null);
                }}
              />
            </label>
            <div className="api-console-facts">
              <span><b>Execution</b> {executionId || "—"}</span>
              <span><b>Status</b> {String(execution?.status || "—")}</span>
              <span><b>Outcome</b> {String(execution?.outcome || "—")}</span>
              <span>
                <b>Verified</b> {String(execution?.fieldsVerified ?? "—")} /{" "}
                {String(execution?.fieldsAttempted ?? "—")}
              </span>
            </div>
            <details className="api-console-json">
              <summary>Execution result</summary>
              <pre>{pretty(execution) || "Execution results will appear here."}</pre>
            </details>
          </article>

          <article className="api-console-card">
            <div className="api-console-step">
              <span>5</span>
              <div>
                <h2>Verify captured submission</h2>
                <p>
                  Reads what any registered test site actually received. Use
                  all submissions for multi-step GET forms; the latest endpoint
                  contains only the final step.
                </p>
              </div>
            </div>
            <label>
              Capture-enabled fixture base URL
              <input
                value={captureBaseUrl}
                onChange={(event) => setCaptureBaseUrl(event.target.value)}
              />
            </label>
            <div className="api-console-actions">
              <button
                className="secondary-button"
                onClick={() => readCapture("clear")}
                disabled={Boolean(busy)}
              >
                Clear captures
              </button>
              <button
                className="secondary-button"
                onClick={() => readCapture("list")}
                disabled={Boolean(busy)}
              >
                Get all
              </button>
              <button
                className="primary-button"
                onClick={() => readCapture("latest")}
                disabled={Boolean(busy)}
              >
                Get latest submission
              </button>
            </div>
            <details className="api-console-json" open>
              <summary>Captured native form fields</summary>
              <pre>{pretty(capture) || "No captured submission loaded."}</pre>
            </details>
            {captureCheck && (
              <div
                className={
                  captureCheck.passed
                    ? "api-console-capture-check passed"
                    : "api-console-capture-check failed"
                }
              >
                <strong>
                  {captureCheck.passed
                    ? "Captured payload matches"
                    : "Captured payload differs"}
                </strong>
                <span>
                  {captureCheck.matched}/{captureCheck.total} run fields matched
                  across {captureCheck.submissionsChecked} retained submission
                  {captureCheck.submissionsChecked === 1 ? "" : "s"}.
                </span>
                <details>
                  <summary>Field comparison</summary>
                  <pre>{pretty(captureCheck.checks)}</pre>
                </details>
              </div>
            )}
          </article>
        </div>

        <aside className="api-console-side">
          <article className="api-console-card api-console-sticky">
            <span className="eyebrow">API EXCHANGE HISTORY</span>
            {exchanges.length > 0 && (
              <>
                <div className="api-console-history-nav">
                  <button
                    className="secondary-button"
                    disabled={selectedExchangeIndex <= 0}
                    onClick={() =>
                      setSelectedExchangeId(
                        exchanges[selectedExchangeIndex - 1].id,
                      )
                    }
                  >
                    ← Previous
                  </button>
                  <span>
                    {selectedExchangeIndex + 1} of {exchanges.length}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={
                      selectedExchangeIndex < 0 ||
                      selectedExchangeIndex >= exchanges.length - 1
                    }
                    onClick={() =>
                      setSelectedExchangeId(
                        exchanges[selectedExchangeIndex + 1].id,
                      )
                    }
                  >
                    Next →
                  </button>
                </div>
                <div className="api-console-history-list">
                  {exchanges.map((item) => (
                    <button
                      key={item.id}
                      className={item.id === exchange?.id ? "active" : ""}
                      onClick={() => setSelectedExchangeId(item.id)}
                    >
                      <span>{item.sequence}</span>
                      <strong>{item.label}</strong>
                      <small>
                        {item.method} · HTTP {item.status}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            )}
            <h2>{exchange?.label || "No request yet"}</h2>
            {exchange && (
              <>
                <div className="api-console-http">
                  <strong>{exchange.method}</strong>
                  <code>{exchange.url}</code>
                  <span
                    className={
                      exchange.status >= 200 && exchange.status < 400
                        ? "ok"
                        : "bad"
                    }
                  >
                    {exchange.status || "NETWORK"}
                  </span>
                </div>
                <small className="api-console-exchange-time">
                  {new Date(exchange.createdAt).toLocaleString()}
                </small>
                <details className="api-console-json" open>
                  <summary>Request payload</summary>
                  <pre>
                    {exchange.requestBody === undefined
                      ? "No request body."
                      : pretty(exchange.requestBody)}
                  </pre>
                </details>
                <details className="api-console-json" open>
                  <summary>Equivalent curl</summary>
                  <pre>{exchange.curl}</pre>
                </details>
                <details className="api-console-json">
                  <summary>Raw response</summary>
                  <pre>{pretty(exchange.response)}</pre>
                </details>
              </>
            )}
            <div className="api-console-errors">
              <span className="eyebrow">COMMON PATH ERRORS</span>
              {commonErrors.map(([code, detail]) => (
                <div key={code}>
                  <code>{code}</code>
                  <p>{detail}</p>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </main>
  );
}
