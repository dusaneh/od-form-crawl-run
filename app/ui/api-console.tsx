"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  apiFailureFrom,
  type ApiFailure,
} from "@/app/lib/api-failure";

type JsonObject = Record<string, unknown>;
type CrawlMode = "probe" | "submit";
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
type LlmReasoningProfile = {
  semantic: ReasoningEffort;
  actuator: ReasoningEffort;
  analysis: ReasoningEffort;
};
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
type ConsoleError = ApiFailure;

const DEFAULT_API = "";
const DEFAULT_TARGET =
  "http://localhost:9000/site_af_branch_cards/intake";
const DEFAULT_CAPTURE =
  "http://localhost:9000/site_af_branch_cards";
const DEFAULT_LLM_REASONING: LlmReasoningProfile = {
  semantic: "none",
  actuator: "none",
  analysis: "none",
};
const REASONING_EFFORTS: ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];
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
  [
    "llm_reasoning_override_required",
    "Only the designated administrator may override LLM reasoning.",
  ],
  [
    "llm_reasoning_profile_invalid",
    "The per-call reasoning profile is malformed or unsupported.",
  ],
];

function apiUrl(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
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
  return apiFailureFrom(status, payload, { force: true }) as ConsoleError;
}

function FailureExplanation({ failure }: { failure: ConsoleError }) {
  return (
    <div className="api-console-failure-explanation">
      <div className="api-console-failure-heading">
        <span>WHAT WENT WRONG</span>
        <small>
          {failure.issues.length} {failure.issues.length === 1 ? "issue" : "issues"} found in the response
        </small>
      </div>
      <ol>
        {failure.issues.map((issue, index) => (
          <li key={`${issue.code}_${index}`}>
            <div>
              <strong>{issue.title}</strong>
              <code>{issue.code}</code>
            </div>
            <p>{issue.detail}</p>
            <small>Source: {issue.source}</small>
          </li>
        ))}
      </ol>
    </div>
  );
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

function crawlTestData(inputSchema: JsonObject | null) {
  if (!inputSchema) return {};
  const published =
    inputSchema["x-formweave-test-data"] &&
    typeof inputSchema["x-formweave-test-data"] === "object" &&
    !Array.isArray(inputSchema["x-formweave-test-data"])
      ? (inputSchema["x-formweave-test-data"] as JsonObject)
      : {};
  const values = { ...published };
  for (const [key, schema] of Object.entries(schemaProperties(inputSchema))) {
    if (
      !Object.hasOwn(values, key) &&
      Object.hasOwn(schema, "x-formweave-test-value")
    ) {
      values[key] = schema["x-formweave-test-value"];
    }
  }
  return values;
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

function objectItems(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function evidenceItemsForReport(report: JsonObject, crawlId: string) {
  const items: {
    id: string;
    url: string;
    label: string;
    kind: string;
    detail: string;
  }[] = [];
  const seen = new Set<string>();
  const add = (item: (typeof items)[number]) => {
    if (!item.url || seen.has(item.url)) return;
    seen.add(item.url);
    items.push(item);
  };

  for (const [pageIndex, page] of objectItems(report.pages).entries()) {
    const pageLabel = String(
      page.heading || page.title || `Page ${pageIndex + 1}`,
    );
    for (const state of objectItems(page.stateEvidence)) {
      if (
        state.evidenceAvailable !== true ||
        typeof state.evidence !== "string"
      ) {
        continue;
      }
      const values = Array.isArray(state.values) ? state.values.length : 0;
      add({
        id: String(state.id || `state_${pageIndex + 1}_${items.length + 1}`),
        url: state.evidence,
        label: String(state.label || pageLabel),
        kind: String(
          state.evidenceRole || state.kind || "state evidence",
        ).replaceAll("_", " "),
        detail: `${values} entered ${values === 1 ? "value" : "values"} · ${String(
          state.fieldsVisible ?? 0,
        )} visible fields`,
      });
    }
    if (page.screenshotArtifact) {
      const evidenceId = `page_${String(pageIndex + 1).padStart(2, "0")}`;
      add({
        id: evidenceId,
        url: `/api/runs/${encodeURIComponent(crawlId)}/evidence/${evidenceId}`,
        label: pageLabel,
        kind: "page capture",
        detail: `${String(page.httpStatus || "—")} · ${String(
          page.screenshotProvider || report.renderEngine || "browser",
        )}`,
      });
    }
  }

  for (const exchange of objectItems(report.architectureExchanges)) {
    const sensing =
      exchange.sensing && typeof exchange.sensing === "object"
        ? (exchange.sensing as JsonObject)
        : null;
    if (!sensing || typeof sensing.evidence !== "string") continue;
    add({
      id: String(exchange.id || `sensing_${items.length + 1}`),
      url: sensing.evidence,
      label: String(exchange.stateLabel || exchange.stateKey || "Model sensing"),
      kind: "model sensing",
      detail: `${String(sensing.visibleFields ?? 0)} visible fields supplied to the model`,
    });
  }
  return items;
}

function fallbackSchemaFromContract(contract: JsonObject[]) {
  return {
    type: "object",
    properties: Object.fromEntries(
      contract.map((field) => [
        String(field.key || field.name || field.id || "field"),
        {
          type: field.control === "number" ? "number" : "string",
          "x-formweave-label": field.label || field.key || "Observed field",
          "x-formweave-control": field.control || "text",
          "x-formweave-sensitive": field.sensitive === true,
          "x-formweave-legal-acceptance-type":
            field.legalAcceptanceType || null,
          "x-formweave-options": Array.isArray(field.optionSet)
            ? field.optionSet
            : [],
        },
      ]),
    ),
    required: contract
      .filter((field) => field.required === true)
      .map((field) => String(field.key || field.name || field.id || "field")),
  } satisfies JsonObject;
}

function conditionalRequiredKeys(inputSchema: JsonObject) {
  const keys = new Set<string>();
  for (const condition of objectItems(inputSchema.allOf)) {
    const then =
      condition.then && typeof condition.then === "object"
        ? (condition.then as JsonObject)
        : null;
    if (!then || !Array.isArray(then.required)) continue;
    for (const key of then.required) keys.add(String(key));
  }
  return keys;
}

function ReportPresentation({
  report,
  crawlId,
  apiBase,
}: {
  report: JsonObject;
  crawlId: string;
  apiBase: string;
}) {
  const stats =
    report.stats && typeof report.stats === "object"
      ? (report.stats as JsonObject)
      : {};
  const pages = objectItems(report.pages);
  const contract = objectItems(report.contract);
  const contractByKey = new Map(
    contract.map((field) => [String(field.key || ""), field]),
  );
  const evidence = evidenceItemsForReport(report, crawlId);
  const definitions = objectItems(report.formDefinitions);
  const runnerJourney =
    report.runnerJourney && typeof report.runnerJourney === "object"
      ? (report.runnerJourney as JsonObject)
      : null;
  const runnerSteps = objectItems(runnerJourney?.steps);
  const targets = Array.isArray(report.targets) ? report.targets : [];
  const forms = definitions.length
    ? definitions
    : [
        {
          formId: "",
          title: pages[0]?.title || pages[0]?.heading || "Observed form",
          targetUrl: pages[0]?.finalUrl || targets[0] || "",
          status: "observed",
          eligibility: { status: "not evaluated" },
          inputSchema: fallbackSchemaFromContract(contract),
        },
      ];

  return (
    <section
      className="api-console-report-presentation"
      aria-label="Crawl report presentation"
    >
      <div className="api-console-report-heading">
        <div>
          <span>REPORT REVIEW</span>
          <h3>What the crawler captured</h3>
        </div>
        <code>{String(report.id || crawlId)}</code>
      </div>

      <div className="api-console-report-metrics">
        <div><strong>{String(stats.pagesFetched ?? pages.length)}</strong><span>Pages</span></div>
        <div><strong>{String(stats.formsFound ?? forms.length)}</strong><span>Forms</span></div>
        <div><strong>{String(stats.fieldsFound ?? contract.length)}</strong><span>Visible fields</span></div>
        <div><strong>{evidence.length}</strong><span>Evidence images</span></div>
      </div>

      <section className="api-console-report-block">
        <div className="api-console-report-block-heading">
          <div>
            <h4>How the approved runner will complete this form</h4>
            <p>
              Human-readable execution order from the retained LLM-authored
              script. These are the actions approval authorizes the
              deterministic runner to replay.
            </p>
          </div>
          <span>{runnerSteps.length}</span>
        </div>
        {runnerJourney?.available === true && runnerSteps.length ? (
          <>
            <div className="api-console-runner-summary">
              <strong>{String(runnerJourney.summary || "")}</strong>
              {runnerJourney.approvalNote ? (
                <p>{String(runnerJourney.approvalNote)}</p>
              ) : null}
              <div>
                <span>Script {String(runnerJourney.scriptVersion || "—")}</span>
                <span>{String(runnerJourney.fieldCount || 0)} modeled fields</span>
                <span>
                  {String(runnerJourney.terminalActionCount || 0)} submit action
                </span>
              </div>
            </div>
            <ol className="api-console-runner-journey">
              {runnerSteps.map((step, stepIndex) => {
                const fields = objectItems(step.fields);
                const conditionalGroups = objectItems(step.conditionalGroups);
                const progression =
                  step.progression && typeof step.progression === "object"
                    ? (step.progression as JsonObject)
                    : null;
                return (
                  <li key={String(step.stateKey || `runner_step_${stepIndex}`)}>
                    <div className="api-console-runner-step-number">
                      {String(step.sequence || stepIndex + 1)}
                    </div>
                    <article>
                      <header>
                        <div>
                          <small>
                            {step.type === "preparation"
                              ? "PREPARE"
                              : `STATE ${stepIndex + 1}`}
                          </small>
                          <h5>{String(step.title || "Runner action")}</h5>
                        </div>
                        {step.route ? <code>{String(step.route)}</code> : null}
                      </header>
                      <p>{String(step.description || "")}</p>
                      {fields.length ? (
                        <div className="api-console-runner-fields">
                          {fields.map((field, fieldIndex) => (
                            <div key={String(field.key || `field_${fieldIndex}`)}>
                              <span aria-hidden="true">✓</span>
                              <div>
                                <strong>{String(field.instruction || field.label)}</strong>
                                <small>
                                  {String(field.control || "field")}
                                  {field.section ? ` · ${String(field.section)}` : ""}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {conditionalGroups.map((group, groupIndex) => {
                        const condition =
                          group.condition && typeof group.condition === "object"
                            ? (group.condition as JsonObject)
                            : {};
                        const conditionalFields = objectItems(group.fields);
                        return (
                          <section
                            className="api-console-runner-condition"
                            key={`${String(condition.fieldKey || "condition")}_${groupIndex}`}
                          >
                            <strong>
                              If applicable: {String(condition.instruction || "complete the revealed fields")}
                            </strong>
                            <div className="api-console-runner-fields">
                              {conditionalFields.map((field, fieldIndex) => (
                                <div
                                  key={String(
                                    field.key || `conditional_${fieldIndex}`,
                                  )}
                                >
                                  <span aria-hidden="true">↳</span>
                                  <div>
                                    <strong>
                                      {String(field.instruction || field.label)}
                                    </strong>
                                    <small>{String(field.control || "field")}</small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                      {progression ? (
                        <div
                          className={`api-console-runner-progression ${
                            progression.kind === "terminal_submit"
                              ? "terminal"
                              : ""
                          }`}
                        >
                          <span>
                            {progression.kind === "terminal_submit" ? "SUBMIT" : "NEXT"}
                          </span>
                          <div>
                            <strong>{String(progression.instruction || "")}</strong>
                            {progression.rationale ? (
                              <p>{String(progression.rationale)}</p>
                            ) : null}
                            {progression.observedOutcome ? (
                              <small>
                                Crawl result: {String(progression.observedOutcome).replaceAll("_", " ")}
                              </small>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <div className="api-console-empty">
            {String(
              runnerJourney?.summary ||
                "No LLM-authored executable script was available, so this report cannot describe runner actions.",
            )}
          </div>
        )}
      </section>

      <section className="api-console-report-block">
        <div className="api-console-report-block-heading">
          <div>
            <h4>Screenshot evidence</h4>
            <p>
              Only key transition, terminal, and failure moments are retained.
              Open any original in a separate tab for full-resolution review.
            </p>
          </div>
          <span>{evidence.length}</span>
        </div>
        {evidence.length ? (
          <div className="api-console-evidence-grid">
            {evidence.map((item) => (
              <article key={`${item.id}-${item.url}`}>
                <a
                  href={apiUrl(apiBase, item.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${item.label} evidence in a new tab`}
                >
                  {/* Evidence is private and served directly by the authenticated API. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={apiUrl(apiBase, item.url)}
                    alt={`${item.label} evidence thumbnail`}
                    loading="lazy"
                  />
                  <span>Open original ↗</span>
                </a>
                <div>
                  <small>{item.kind}</small>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="api-console-empty">
            This report did not retain any available screenshot evidence.
          </div>
        )}
      </section>

      <section className="api-console-report-block">
        <div className="api-console-report-block-heading">
          <div>
            <h4>Forms, sections, and fields</h4>
            <p>
              A readable view of the same crawl-scoped schema returned in the
              report. Step 3 still retrieves the exact executable schema.
            </p>
          </div>
          <span>{forms.length}</span>
        </div>
        <div className="api-console-form-overviews">
          {forms.map((definition, formIndex) => {
            const schema =
              definition.inputSchema &&
              typeof definition.inputSchema === "object"
                ? (definition.inputSchema as JsonObject)
                : fallbackSchemaFromContract(contract);
            const properties = schemaProperties(schema);
            const baseRequired = new Set(
              Array.isArray(schema.required)
                ? schema.required.map((key) => String(key))
                : [],
            );
            const conditionalRequired = conditionalRequiredKeys(schema);
            const requiredKeys = new Set([
              ...baseRequired,
              ...conditionalRequired,
            ]);
            const sectionGroups = new Map<
              string,
              [string, JsonObject][]
            >();
            for (const entry of Object.entries(properties)) {
              const observed = contractByKey.get(entry[0]);
              const section = String(
                observed?.sectionText || observed?.sectionId || "General",
              );
              const group = sectionGroups.get(section) || [];
              group.push(entry);
              sectionGroups.set(section, group);
            }
            const eligibility =
              definition.eligibility &&
              typeof definition.eligibility === "object"
                ? String(
                    (definition.eligibility as JsonObject).status || "unknown",
                  )
                : "unknown";
            return (
              <article
                className="api-console-form-overview"
                key={String(definition.formId || `observed_${formIndex}`)}
              >
                <header>
                  <div>
                    <small>FORM {formIndex + 1}</small>
                    <h5>{String(definition.title || "Observed form")}</h5>
                    {definition.formId ? (
                      <code>{String(definition.formId)}</code>
                    ) : (
                      <span>No executable form ID was produced</span>
                    )}
                  </div>
                  <div className="api-console-form-statuses">
                    <span>{String(definition.status || "observed")}</span>
                    <span className={eligibility === "eligible" ? "eligible" : ""}>
                      {eligibility}
                    </span>
                  </div>
                </header>
                <div className="api-console-form-summary">
                  <span><b>{Object.keys(properties).length}</b> fields</span>
                  <span><b>{requiredKeys.size}</b> required</span>
                  <span>
                    <b>
                      {Object.values(properties).filter(
                        (field) => field["x-formweave-sensitive"] === true,
                      ).length}
                    </b>{" "}
                    sensitive
                  </span>
                  <span><b>{sectionGroups.size}</b> sections</span>
                </div>
                <div className="api-console-section-list">
                  {[...sectionGroups.entries()].map(([section, fields]) => (
                    <section key={section}>
                      <div className="api-console-section-heading">
                        <strong>{section}</strong>
                        <span>{fields.length} {fields.length === 1 ? "field" : "fields"}</span>
                      </div>
                      <div className="api-console-field-list">
                        {fields.map(([key, field]) => {
                          const control = String(
                            field["x-formweave-control"] ||
                              field.type ||
                              "text",
                          );
                          const branch = branchFor(field);
                          const legal = String(
                            field["x-formweave-legal-acceptance-type"] || "",
                          );
                          const options = Array.isArray(
                            field["x-formweave-options"],
                          )
                            ? field["x-formweave-options"].length
                            : Array.isArray(field.enum)
                              ? field.enum.length
                              : 0;
                          return (
                            <div className="api-console-field-row" key={key}>
                              <div>
                                <strong>
                                  {String(field["x-formweave-label"] || key)}
                                </strong>
                                <code>{key}</code>
                              </div>
                              <div className="api-console-field-badges">
                                <span>{control}</span>
                                {requiredKeys.has(key) && (
                                  <span className="critical">required</span>
                                )}
                                {branch && <span className="dynamic">conditional</span>}
                                {field["x-formweave-sensitive"] === true && (
                                  <span className="sensitive">sensitive</span>
                                )}
                                {legal && <span className="legal">{legal}</span>}
                                {options > 0 && <span>{options} options</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
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
  const [llmReasoningPermission, setLlmReasoningPermission] = useState<{
    apiBase: string;
    allowed: boolean;
  } | null>(null);
  const [llmReasoning, setLlmReasoning] = useState<LlmReasoningProfile>(
    DEFAULT_LLM_REASONING,
  );
  const [fixtureAuthorities, setFixtureAuthorities] = useState<FixtureAuthorities>({
    acknowledgement: true,
    consent: true,
    reviewConfirmation: true,
    signature: true,
    upload: true,
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

  const hostedApi = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const target = new URL(apiBase || window.location.origin);
      return !isLoopbackHostname(target.hostname);
    } catch {
      return false;
    }
  }, [apiBase]);

  useEffect(() => {
    if (!hostedApi) return;
    setBrowserMode("headless");
    setAllowLocalTargets(false);
  }, [hostedApi]);

  useEffect(() => {
    if (!apiBase) return;
    let active = true;
    fetch(apiUrl(apiBase, "/api/health"), {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!active || !payload || typeof payload !== "object") return;
        const permissions = (payload as JsonObject).permissions;
        setLlmReasoningPermission({
          apiBase,
          allowed: Boolean(
            permissions &&
              typeof permissions === "object" &&
              (permissions as JsonObject).llmReasoningOverride === true,
          ),
        });
      })
      .catch(() => {
        if (active) setLlmReasoningPermission({ apiBase, allowed: false });
      });
    return () => {
      active = false;
    };
  }, [apiBase]);

  const canOverrideLlmReasoning =
    llmReasoningPermission?.apiBase === apiBase &&
    llmReasoningPermission.allowed;

  const inputSchema = useMemo(() => {
    const value = form?.inputSchema;
    return value && typeof value === "object" ? (value as JsonObject) : null;
  }, [form]);
  const schemaTestValues = useMemo(
    () => crawlTestData(inputSchema),
    [inputSchema],
  );
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
  const selectedExchangeFailure = useMemo(
    () =>
      exchange
        ? apiFailureFrom(exchange.status, exchange.response)
        : null,
    [exchange],
  );

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
    const responseFailure = apiFailureFrom(response.status, payload);
    if (responseFailure) setError(responseFailure);
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
      const terminalFailure = apiFailureFrom(200, payload);
      if (terminalFailure) setError(terminalFailure);
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
      const nextSchema =
        nextForm?.inputSchema && typeof nextForm.inputSchema === "object"
          ? (nextForm.inputSchema as JsonObject)
          : null;
      setInputValues(crawlTestData(nextSchema));
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
      setError(
        errorFrom(0, {
          code: "invalid_target_url",
          error:
            caught instanceof Error ? caught.message : "Invalid target URL.",
        }),
      );
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
        browserMode: hostedApi ? "headless" : browserMode,
        allowLocalTargets: hostedApi ? false : allowLocalTargets,
        componentAuthorities: fixtureAuthorities,
        ...(canOverrideLlmReasoning ? { llmReasoning } : {}),
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
      const terminalFailure = apiFailureFrom(200, payload);
      if (terminalFailure) setError(terminalFailure);
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
          <div className="api-console-error-summary">
            <strong>{error.code}</strong>
            <span>HTTP {error.status || "client"} · {error.message}</span>
          </div>
          <FailureExplanation failure={error} />
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
                  <option value="headful" disabled={hostedApi}>
                    Headful — local workstation only
                  </option>
                </select>
                {hostedApi ? (
                  <small>
                    Hosted crawls run Chromium on the remote worker, so a
                    visible browser cannot open on your computer.
                  </small>
                ) : null}
              </label>
              <label>
                IntakeCR API
                <input
                  value={apiBase}
                  onChange={(event) => setApiBase(event.target.value)}
                />
              </label>
            </div>
            <div className="api-console-callout">
              <strong>Single resource-access form per crawl.</strong>
              <span>
                The LLM may select one observed action to reach an intake,
                application, enrollment, service-request, referral,
                eligibility, direct-access registration, or fallback contact
                form. It does not crawl alternate forms or unrelated same-site
                pages.
              </span>
            </div>
            {canOverrideLlmReasoning ? (
              <fieldset className="api-console-reasoning">
                <legend>Admin-only LLM reasoning</legend>
                <p>
                  Per-crawl override for <code>dbosmail@gmail.com</code>. The
                  current default remains <code>none</code>; higher levels can
                  improve difficult decisions but cost more time and tokens.
                </p>
                {(
                  [
                    ["semantic", "Semantic planning"],
                    ["actuator", "Actuators and repairs"],
                    ["analysis", "Final report analysis"],
                  ] as [keyof LlmReasoningProfile, string][]
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <select
                      value={llmReasoning[key]}
                      onChange={(event) =>
                        setLlmReasoning((current) => ({
                          ...current,
                          [key]: event.target.value as ReasoningEffort,
                        }))
                      }
                    >
                      {REASONING_EFFORTS.map((effort) => (
                        <option key={effort} value={effort}>
                          {effort}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="api-console-switches">
              <label>
                <input
                  type="checkbox"
                  checked={allowLocalTargets}
                  disabled={hostedApi}
                  onChange={(event) =>
                    setAllowLocalTargets(event.target.checked)
                  }
                />
                <span>
                  <strong>Allow localhost test targets</strong>
                  <small>
                    {hostedApi
                      ? "Unavailable on a hosted API: localhost would refer to the remote server, not your computer."
                      : "Required only when the API and fixture are running on this workstation."}
                  </small>
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
              <span><b>Scope</b> one LLM-selected form journey</span>
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
            {report && (
              <ReportPresentation
                report={report}
                crawlId={crawlId}
                apiBase={apiBase}
              />
            )}
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
              <>
                <div className="api-console-test-data-banner">
                  <div>
                    <strong>
                      {Object.keys(schemaTestValues).length} crawler test{" "}
                      {Object.keys(schemaTestValues).length === 1
                        ? "value"
                        : "values"}{" "}
                      loaded
                    </strong>
                    <span>
                      These are the synthetic values used to validate the
                      pinned script. Edit or replace them before a real run.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInputValues(schemaTestValues)}
                    disabled={Object.keys(schemaTestValues).length === 0}
                  >
                    Reset to crawl test data
                  </button>
                </div>
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
                  const hasCrawlTestValue = Object.hasOwn(
                    schema,
                    "x-formweave-test-value",
                  );
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
                        {hasCrawlTestValue && <b>Test value</b>}
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
                        <>
                          <input
                            type="file"
                            required={required}
                            onChange={(event) =>
                              void setFileValue(key, event.target.files?.[0])
                            }
                          />
                          {value &&
                            typeof value === "object" &&
                            !Array.isArray(value) &&
                            typeof (value as JsonObject).filename ===
                              "string" && (
                              <small className="api-console-test-file">
                                Ready:{" "}
                                {String((value as JsonObject).filename)}
                              </small>
                            )}
                        </>
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
              </>
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
                Submit the form at its terminal action
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
                      exchange.status >= 200 &&
                      exchange.status < 400 &&
                      !selectedExchangeFailure
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
                {selectedExchangeFailure && (
                  <FailureExplanation failure={selectedExchangeFailure} />
                )}
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
