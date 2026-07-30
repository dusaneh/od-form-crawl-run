"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ArchitectureExchange,
  BrowserMode,
  CrawlReport,
  ExecutionMode,
  FieldContract,
  FixtureAuthorities,
  FlowEdge,
  FlowNode,
  FormRun,
  LiveTraversalField,
  LiveTraversalFlag,
  RunStatus,
  StateEvidence,
  TraversalSettings,
} from "../lib/models";

const tabs = [
  "Report",
  "Traversal",
  "Flow map",
  "Field contract",
  "Evidence",
  "Diagnostics",
] as const;
type Tab = (typeof tabs)[number];
type Surface = "runs" | "settings";

const defaultTraversalSettings: TraversalSettings = {
  version: 4,
  cookieConsent: "reject_non_essential",
  acceptCookiesWhenRequired: true,
  closeWelcomeBanners: true,
  dismissOptionalOffers: true,
  dismissOptionalAuth: true,
  expandSafeDisclosures: true,
  advanceIntroScreens: true,
  allowSameOriginReadLikePosts: true,
  pointerAndScrollPriming: true,
  unpredictablePopups: "observe_only",
  captchaPolicy: "detect_and_disqualify",
  stableWindowMs: 700,
  maxStateWaitMs: 12000,
  maxActionsPerPage: 10,
  enterTestValues: true,
  exerciseBranches: true,
  advanceFormSteps: true,
  maxFormStates: 24,
  maxBranchOptionsPerControl: 3,
  agentInstructions:
    "Use the selected form-specific generated script to traverse as much of the public form as possible with format-plausible synthetic test data. Exercise declared choice branches from a re-baselined state and use only script-declared intermediate advances. Phase 1 never activates the terminal submit control. Never solve CAPTCHA, provide real credentials, or make a payment. Model upload, consent, authorization, terms, review-confirmation, and signature fields with conspicuously synthetic values when needed to expose or verify the form.",
};

type RuntimeStatus = {
  status: "online";
  runtime: "local-filesystem" | "postgresql";
  storageRoot?: string;
  storage?: {
    engine: "filesystem" | "postgresql";
    root?: string;
    database?: string;
    role?: string;
    connected?: boolean;
  };
  openai: {
    configured: boolean;
    keySource: string;
    model: string;
  };
  browser?: {
    engine: string;
    modes: BrowserMode[];
  };
  generationMode?: "forced_fresh" | "reuse_or_generate";
  traversalSettingsVersion?: number;
  activeCrawls: number;
};

function apiUrl(path: string) {
  if (
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    window.location.port === "3000"
  ) {
    return `http://127.0.0.1:8787${path}`;
  }
  return path;
}

function shortHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function statusLabel(status: RunStatus) {
  return {
    running: "Crawling",
    paused: "Paused",
    awaiting_review: "Needs review",
    disqualified: "Disqualified",
    completed: "Complete",
    certified: "Certified",
    failed: "Failed",
  }[status];
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "just now";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Sidebar({
  surface,
  onChange,
}: {
  surface: Surface;
  onChange: (surface: Surface) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nav: { icon: string; label: string; surface: Surface }[] = [
    { icon: "⌁", label: "Runs", surface: "runs" },
    { icon: "⚙", label: "Settings", surface: "settings" },
  ];

  return (
    <aside className={`sidebar ${expanded ? "sidebar-expanded" : ""}`}>
      <button
        className="brand-mark"
        onClick={() => setExpanded((value) => !value)}
        aria-label="Toggle navigation"
      >
        <span>F</span>
      </button>
      <nav aria-label="Primary navigation">
        {nav.map((item) => (
          <button
            className={`nav-item ${surface === item.surface ? "active" : ""}`}
            key={item.surface}
            onClick={() => onChange(item.surface)}
            aria-current={surface === item.surface ? "page" : undefined}
            title={item.label}
          >
            <span className="nav-glyph" aria-hidden="true">
              {item.icon}
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="avatar" title="FormWeave crawler">
          FW
        </div>
      </div>
    </aside>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "green" | "amber" | "blue" | "red";
}) {
  return (
    <article className="stat-card">
      <div className={`stat-signal ${tone}`} />
      <div>
        <p>{label}</p>
        <div className="stat-value-row">
          <strong>{value}</strong>
          <span>{detail}</span>
        </div>
      </div>
    </article>
  );
}

function ProgressRail({ progress }: { progress: number }) {
  const stages = [
    ["Queue", 8],
    ["Render pages", 58],
    ["Extract fields", 84],
    ["Store evidence", 100],
  ] as const;

  return (
    <div className="progress-rail" aria-label={`${progress}% complete`}>
      {stages.map(([label, end], index) => {
        const previous = index === 0 ? 0 : stages[index - 1][1];
        const fill = Math.max(0, Math.min(100, ((progress - previous) / (end - previous)) * 100));
        return (
          <div className="progress-stage" key={label}>
            <div className="progress-track">
              <span style={{ width: `${fill}%` }} />
            </div>
            <div className="progress-label">
              <span className={progress >= end ? "done" : progress > previous ? "current" : ""}>
                {progress >= end ? "✓" : index + 1}
              </span>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GraphEdge({
  edge,
  nodes,
}: {
  edge: FlowEdge;
  nodes: FlowNode[];
}) {
  const from = nodes.find((node) => node.id === edge.from);
  const to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) return null;

  const startX = from.x + 180;
  const startY = from.y + 47;
  const endX = to.x;
  const endY = to.y + 47;
  const dx = endX - startX;
  const dy = endY - startY;
  const width = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = startX + dx / 2;
  const midY = startY + dy / 2;

  return (
    <>
      <div
        className={`graph-edge ${edge.status} ${edge.kind ?? "advance"}`}
        style={{
          left: startX,
          top: startY,
          width,
          transform: `rotate(${angle}deg)`,
        }}
      />
      {edge.label && (
        <span
          className={`edge-label ${edge.status}`}
          style={{ left: midX, top: midY - 11 }}
        >
          {edge.label}
        </span>
      )}
    </>
  );
}

function FlowGraph({
  run,
  selectedNode,
  onSelect,
}: {
  run: FormRun;
  selectedNode: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="graph-scroll">
      <div
        className="graph-canvas"
        style={{ width: `${Math.max(900, 70 + run.nodes.length * 224)}px` }}
      >
        <div className="lane-label primary">Fetched pages</div>
        <div className="lane-label branch">Discovered targets</div>
        <div className="graph-grid" />
        {run.edges.map((edge) => (
          <GraphEdge key={edge.id} edge={edge} nodes={run.nodes} />
        ))}
        {run.nodes.map((node) => (
          <button
            key={node.id}
            className={`flow-node ${node.status} ${
              selectedNode === node.id ? "selected" : ""
            }`}
            style={{ left: node.x, top: node.y }}
            onClick={() => onSelect(node.id)}
          >
            <span className="node-step">{node.step}</span>
            <span className="node-status-dot" />
            <strong>{node.title}</strong>
            <small>{node.subtitle}</small>
            <span className="node-meta">
              <span>{node.fields} fields</span>
              <code>{node.fingerprint}</code>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EvidencePreview({ node }: { node: FlowNode }) {
  return (
    <div className={`evidence-preview evidence-${node.id}`}>
      {node.evidenceAvailable && node.evidence ? (
        <a
          className="evidence-open-link"
          href={apiUrl(node.evidence)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open full screenshot evidence for ${node.title}`}
          title="Open full screenshot"
        >
          {/* The evidence route is private and cannot be delegated to the public image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="evidence-image"
            src={apiUrl(node.evidence)}
            alt={`Captured public page for ${node.title}`}
            loading="lazy"
          />
          <span className="evidence-open-hint">Open full image ↗</span>
        </a>
      ) : (
        <div className="evidence-empty">
          <span>NO CAPTURE</span>
          <strong>{node.title}</strong>
          <small>{node.sourceUrl ? shortHost(node.sourceUrl) : "Waiting for crawler"}</small>
        </div>
      )}
      <span className="evidence-watermark">
        {node.evidenceAvailable
          ? node.evidenceValueCount === undefined
            ? "REAL CAPTURE"
            : node.evidenceValueCount > 0
              ? `REAL CAPTURE · ${node.evidenceValueCount} SYNTHETIC ${
                  node.evidenceValueCount === 1 ? "VALUE" : "VALUES"
                } RECORDED`
              : "REAL CAPTURE · NO VALUES ENTERED"
          : "EVIDENCE UNAVAILABLE"}
      </span>
    </div>
  );
}

function Inspector({ node }: { node: FlowNode }) {
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span className={`eyebrow node-tone-${node.status}`}>PAGE {node.step}</span>
          <h3>{node.title}</h3>
        </div>
      </div>
      <EvidencePreview node={node} />
      <div className="evidence-caption">
        <span>Synthetic traversal evidence</span>
        <span>{node.screenshotProvider ?? "No provider"}</span>
      </div>
      <div className="inspector-metrics">
        <div>
          <span>Fingerprint</span>
          <code>{node.fingerprint}</code>
        </div>
        <div>
          <span>Fields observed</span>
          <strong>{node.fields}</strong>
        </div>
        <div>
          <span>Forms observed</span>
          <strong>{node.forms ?? 0}</strong>
        </div>
        <div>
          <span>HTTP result</span>
          <strong>{node.httpStatus || (node.status === "queued" ? "Pending" : "Failed")}</strong>
        </div>
      </div>
      <div className="inspector-notes">
        <div className="section-title">
          <span>State notes</span>
          <span>{node.notes.length}</span>
        </div>
        {node.notes.map((note) => (
          <p key={note}>
            <span>✓</span>
            {note}
          </p>
        ))}
      </div>
    </aside>
  );
}

function FieldsPanel({
  run,
  report,
}: {
  run: FormRun;
  report: CrawlReport | null;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const fields = run.contract ?? [];
  const visibleFields = fields.filter((field) => !field.hidden);
  const displayedFields = showHidden ? fields : visibleFields;
  const required = visibleFields.filter((field) => field.required).length;
  const sensitive = visibleFields.filter((field) => field.sensitive).length;
  const hidden = fields.length - visibleFields.length;
  const guidanceById = new Map(
    (report?.pages.flatMap((page) => page.guidanceRecords || []) || []).map(
      (record) => [record.id, record]
    )
  );
  const sectionById = new Map(
    (report?.pages.flatMap((page) => page.sections || []) || []).map(
      (section) => [section.id, section]
    )
  );

  return (
    <div className="contract-panel">
      <div className="contract-summary">
        <div>
          <span>OBSERVED CONTRACT</span>
          <strong>{visibleFields.length} fields</strong>
          <small>
            {run.browserMode
              ? "Extracted from the rendered browser DOM"
              : "Extracted from the source crawl facts"}
          </small>
        </div>
        <div>
          <span>REQUIRED</span>
          <strong>{required} fields</strong>
          <small>Native required or aria-required</small>
        </div>
        <div>
          <span>POTENTIALLY SENSITIVE</span>
          <strong>{sensitive} fields</strong>
          <small>Detected from type, name, and label</small>
        </div>
        <div>
          <span>HIDDEN / SYSTEM</span>
          <strong>{hidden} controls</strong>
          <small>Preserved in the report, hidden here by default</small>
        </div>
      </div>
      {hidden > 0 && (
        <div className="contract-toolbar">
          <span>
            Showing {displayedFields.length} of {fields.length} extracted controls
          </span>
          <button onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? "Hide system controls" : `Show ${hidden} hidden controls`}
          </button>
        </div>
      )}
      <div className="field-table-wrap">
        <table className="field-table">
          <thead>
            <tr>
              <th>Observed label</th>
              <th>Control</th>
              <th>Semantic key</th>
              <th>Default / test value</th>
              <th>Entry result</th>
              <th>Contract</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {displayedFields.map((field, index) => (
              <tr key={`${field.originState}-${field.key}-${index}`}>
                <td className="field-label-cell">
                  <strong>{field.label || "Unlabelled control"}</strong>
                  {field.sectionId && (
                    <small className="field-section-label">
                      {sectionById.get(field.sectionId)?.label || field.sectionId}
                    </small>
                  )}
                  {(field.groupLabel ||
                    field.optionSet?.length ||
                    field.guidanceIds?.length) && (
                    <details className="field-contract-context">
                      <summary>Question context</summary>
                      {field.groupLabel && (
                        <p>
                          <span>Group legend</span>
                          {field.groupLabel}
                        </p>
                      )}
                      {Boolean(field.optionSet?.length) && (
                        <p>
                          <span>Options</span>
                          {field.optionSet
                            ?.map(
                              (option) =>
                                `${option.label || option.value} [${option.value}]`
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {field.guidanceIds?.map((guidanceId) => {
                        const guidance = guidanceById.get(guidanceId);
                        return guidance ? (
                          <p key={guidanceId}>
                            <span>{guidance.kind}</span>
                            {guidance.text}
                          </p>
                        ) : null;
                      })}
                    </details>
                  )}
                </td>
                <td>{field.control}</td>
                <td>
                  <code>{field.key}</code>
                </td>
                <td>
                  <code className="test-value-cell">
                    {field.testValue || "unavailable"}
                  </code>
                </td>
                <td>
                  <span className={`field-pill ${field.entryStatus ?? "skipped"}`}>
                    {field.entryStatus ?? "not attempted"}
                  </span>
                  {field.entryError && <small title={field.entryError}>entry error</small>}
                </td>
                <td>
                  <span className={`field-pill ${field.required ? "required" : ""}`}>
                    {field.required ? "required" : "optional"}
                  </span>
                  {field.sensitive && <span className="field-pill sensitive">sensitive</span>}
                  {field.hidden && <span className="field-pill hidden">hidden</span>}
                  {field.options > 0 && <span className="field-pill">{field.options} options</span>}
                </td>
                <td>
                  <span className="origin-cell">{field.originState}</span>
                  <small>{shortHost(field.originUrl)}</small>
                </td>
              </tr>
            ))}
            {!displayedFields.length && (
              <tr>
                <td colSpan={7} className="empty-table-cell">
                  No visible form fields were found in the observed page content.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type TraversalDisplayField = {
  key: string;
  label: string;
  control: string;
  status: "pending" | "verified" | "failed";
  required: boolean;
  sensitive: boolean;
  consent: boolean;
  adminAssisted: boolean;
  upload: boolean;
  classification:
    | "deterministic"
    | "deterministic_replay"
    | "llm_generated"
    | "conditional"
    | "human_review";
  sectionText: string;
  formId: string;
  source: string;
  rationale: string;
  error: string;
  name: string;
  selector: string;
  validation: string;
  options: number;
};

type TraversalDisplayState = {
  id: string;
  sequence: number;
  kind: string;
  label: string;
  description: string;
  status: "active" | "verified" | "review" | "failed";
  fingerprint: string;
  capturedAt: string;
  fieldsVisible: number;
  fields: TraversalDisplayField[];
  flags: LiveTraversalFlag[];
};

function validationSummary(field?: FieldContract) {
  if (!field?.validation) return "";
  return Object.entries(field.validation)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");
}

function displayField(
  value: StateEvidence["values"][number] | LiveTraversalField,
  contract?: FieldContract
): TraversalDisplayField {
  const liveStatus = "status" in value ? value.status : "verified";
  return {
    key: value.fieldKey,
    label: value.label || contract?.label || value.fieldKey,
    control: value.control || contract?.control || "control",
    status: liveStatus,
    required: Boolean(value.required ?? contract?.required),
    sensitive: Boolean(value.sensitive ?? contract?.sensitive),
    consent: Boolean(value.consent ?? contract?.consent),
    adminAssisted: Boolean(value.adminAssisted ?? contract?.adminAssisted),
    upload: Boolean(value.upload ?? contract?.control === "file"),
    classification:
      value.classification ||
      (contract?.testValues && contract.testValues.length > 1
        ? "conditional"
        : "deterministic"),
    sectionText: value.sectionText || contract?.sectionText || "",
    formId: value.formId || contract?.formId || "",
    source: value.source || contract?.testValueSource || "observed",
    rationale: ("rationale" in value && value.rationale) || "",
    error: ("error" in value && value.error) || contract?.entryError || "",
    name: contract?.name || contract?.id || "",
    selector: contract?.selector || "",
    validation: validationSummary(contract),
    options: contract?.options || 0,
  };
}

function sectionName(fields: TraversalDisplayField[], index: number) {
  const formId = fields.find((field) => field.formId)?.formId;
  if (formId) return `Form section · ${formId}`;
  const text = fields.find((field) => field.sectionText)?.sectionText;
  if (text) {
    const concise = text.replace(/\s+/g, " ").trim().slice(0, 92);
    return concise.length < text.trim().length ? `${concise}…` : concise;
  }
  return `Observed section ${index + 1}`;
}

function ArchitectureExchangePanel({
  exchanges,
}: {
  exchanges: ArchitectureExchange[];
}) {
  if (!exchanges.length) {
    return (
      <section className="architecture-exchange-empty">
        <strong>No four-layer exchange was retained for this run</strong>
        <span>
          Legacy and observation-only runs do not have generated-state provenance.
        </span>
      </section>
    );
  }

  return (
    <section className="architecture-exchange">
      <header className="architecture-exchange-header">
        <div>
          <span className="eyebrow">FOUR-LAYER HANDOFF</span>
          <h4>What crossed each architecture boundary</h4>
          <p>
            Sensing facts, semantic decisions, stored mechanics, and deterministic
            results are shown separately. Labels identify architectural roles; this
            run-local pilot is not presented as canonical D1/D3 certification.
          </p>
        </div>
        <span>
          {exchanges.some(
            (exchange) => exchange.decisionTiming === "retained_prior_run"
          )
            ? `${exchanges.length} retained script states · 0 traversal-model calls this replay`
            : `${exchanges.length} model-examined states`}
        </span>
      </header>

      <div className="architecture-state-list">
        {exchanges.map((exchange, index) => (
          <details
            className={`architecture-state architecture-state-${exchange.status}`}
            key={exchange.stateKey}
            open={index === 0 || undefined}
          >
            <summary>
              <span className="architecture-state-number">
                {String(exchange.sequence).padStart(2, "0")}
              </span>
              <div>
                <strong>{exchange.label}</strong>
                <small>
                  {exchange.stateKey} · {exchange.route}
                </small>
              </div>
              <div className="architecture-state-facts">
                <span>{exchange.semantics.model}</span>
                <span>
                  {exchange.decisionTiming === "retained_prior_run"
                    ? "prior LLM decision"
                    : `${(exchange.semantics.durationMs / 1000).toFixed(1)}s`}
                </span>
                <span>{exchange.execution.fieldsVerified} verified</span>
              </div>
              <span className="state-chevron">⌄</span>
            </summary>

            <div className="architecture-state-body">
              <div className="architecture-layer-flow">
                <article className="architecture-layer sensing">
                  <header>
                    <span>01</span>
                    <div>
                      <strong>Browser sensing</strong>
                      <small>Executor physics role → Semantic layer</small>
                    </div>
                  </header>
                  <p>
                    The shared toolbox settled the page and supplied facts. It made no
                    semantic action decision.
                  </p>
                  <dl>
                    <div><dt>Controls</dt><dd>{exchange.sensing.controlsObserved}</dd></div>
                    <div><dt>Actions</dt><dd>{exchange.sensing.actionsObserved}</dd></div>
                    <div><dt>Sections</dt><dd>{exchange.sensing.sectionsObserved}</dd></div>
                    <div><dt>Guidance</dt><dd>{exchange.sensing.guidanceObserved}</dd></div>
                  </dl>
                  <details className="architecture-payload">
                    <summary>Inspect sensing payload</summary>
                    <code>{exchange.sensing.url}</code>
                    <code>
                      screenshot {exchange.sensing.screenshotSha256.slice(0, 16)} ·{" "}
                      {exchange.sensing.screenshotBytes.toLocaleString()} bytes
                    </code>
                    <code>
                      accessibility {exchange.sensing.accessibilityCharacters.toLocaleString()} chars
                    </code>
                    <code>
                      prior states {exchange.sensing.priorStates} · contract fields{" "}
                      {exchange.sensing.existingContractFields}
                    </code>
                    {exchange.sensing.evidence && (
                      <a
                        href={apiUrl(exchange.sensing.evidence)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open screenshot supplied to the model ↗
                      </a>
                    )}
                  </details>
                </article>

                <span className="architecture-flow-arrow">→</span>

                <article className="architecture-layer semantics">
                  <header>
                    <span>02</span>
                    <div>
                      <strong>Semantic decision</strong>
                      <small>LLM → D2-shaped contract + script proposal</small>
                    </div>
                  </header>
                  <p>
                    {exchange.decisionTiming === "retained_prior_run"
                      ? "The model interpreted this state during the original generation run. This replay reused that retained decision and made zero traversal-model calls. A separate post-crawl report analysis may still run."
                      : "The model interpreted the observed state once and proposed typed fields, actions, and one progression."}
                  </p>
                  <dl>
                    <div><dt>Fields</dt><dd>{exchange.semantics.fieldsProposed}</dd></div>
                    <div><dt>Actions</dt><dd>{exchange.semantics.actionsProposed}</dd></div>
                    <div><dt>Accepted</dt><dd>{exchange.semantics.acceptedActions}</dd></div>
                    <div>
                      <dt>Protected</dt>
                      <dd>{exchange.semantics.rejectedActions.length}</dd>
                    </div>
                  </dl>
                  <details className="architecture-payload">
                    <summary>Inspect semantic exchange</summary>
                    <code>proposal {exchange.semantics.proposalId}</code>
                    <code>
                      {exchange.semantics.promptVersion} ·{" "}
                      {exchange.decisionTiming === "retained_prior_run"
                        ? "retained generation provenance"
                        : `attempt ${exchange.semantics.attempts}`}
                    </code>
                    <code>
                      progression {exchange.semantics.progression?.kind || "none"} ·{" "}
                      {exchange.semantics.progression?.key || "none"}
                    </code>
                    {exchange.semantics.rejectedActions.map((rejection, rejectionIndex) => (
                      <span className="architecture-rejection" key={`${rejection.code}-${rejectionIndex}`}>
                        {rejection.code}: {rejection.detail}
                      </span>
                    ))}
                  </details>
                </article>

                <span className="architecture-flow-arrow">→</span>

                <article className="architecture-layer script">
                  <header>
                    <span>03</span>
                    <div>
                      <strong>Generated mechanics</strong>
                      <small>Generated-script role → executor</small>
                    </div>
                  </header>
                  <p>
                    The stored form program supplied exact selectors, synthetic values,
                    and the typed progression. Replay did not call the model.
                  </p>
                  <dl>
                    <div><dt>Version</dt><dd>{exchange.script.scriptVersion}</dd></div>
                    <div><dt>Fields</dt><dd>{exchange.script.fields.length}</dd></div>
                    <div><dt>Progression</dt><dd>{exchange.script.progression.kind}</dd></div>
                    <div><dt>Selectors</dt><dd>{exchange.script.fields.reduce((sum, field) => sum + field.selectors.length, 0) + exchange.script.progression.selectors.length}</dd></div>
                  </dl>
                  <details className="architecture-payload">
                    <summary>Inspect stored script instructions</summary>
                    <code>state source {exchange.script.sourceHash.slice(0, 20)}</code>
                    <code>form source {exchange.script.completeSourceHash.slice(0, 20)}</code>
                    <code>{exchange.script.storedPath}</code>
                    <div className="architecture-field-instructions">
                      {exchange.script.fields.map((field) => (
                        <div key={field.key}>
                          <strong>{field.key}</strong>
                          <span>{field.control} · {field.actionKind}</span>
                          <code>{field.selectors[0] || "no selector"}</code>
                          <small>
                            value {JSON.stringify(field.testValue)} · {field.safetyDisposition}
                          </small>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>

                <span className="architecture-flow-arrow">→</span>

                <article className="architecture-layer execution">
                  <header>
                    <span>04</span>
                    <div>
                      <strong>Deterministic result</strong>
                      <small>Executor + physics role → result envelope</small>
                    </div>
                  </header>
                  <p>
                    The browser performed only stored instructions, verified readback,
                    enforced the submit boundary, and retained evidence.
                  </p>
                  <dl>
                    <div><dt>Attempted</dt><dd>{exchange.execution.fieldsAttempted}</dd></div>
                    <div><dt>Verified</dt><dd>{exchange.execution.fieldsVerified}</dd></div>
                    <div><dt>Skipped</dt><dd>{exchange.execution.fieldsSkipped}</dd></div>
                    <div><dt>Failures</dt><dd>{exchange.execution.fieldFailures}</dd></div>
                  </dl>
                  <details className="architecture-payload">
                    <summary>Inspect result envelope</summary>
                    <code>{exchange.execution.progressionOutcome}</code>
                    <code>state identity {exchange.execution.observedStateIdentity}</code>
                    {exchange.execution.evidence.map((evidence, evidenceIndex) => (
                      <a
                        href={apiUrl(evidence.url)}
                        target="_blank"
                        rel="noreferrer"
                        key={`${evidence.id}-${evidence.kind}-${evidenceIndex}`}
                      >
                        {evidence.kind}: {evidence.label} · {evidence.values} values ↗
                      </a>
                    ))}
                  </details>
                </article>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function StateFieldRow({
  field,
  dynamic,
}: {
  field: TraversalDisplayField;
  dynamic: boolean;
}) {
  const hasDetails = Boolean(
    field.name ||
      field.selector ||
      field.validation ||
      field.rationale ||
      field.sectionText
  );
  return (
    <article className={`traversal-field traversal-field-${field.status}`}>
      <span className="traversal-field-check" aria-label={`${field.status} field`}>
        {field.status === "verified" ? "✓" : field.status === "failed" ? "×" : "·"}
      </span>
      <div className="traversal-field-main">
        <div className="traversal-field-title">
          <strong>{field.label}</strong>
          <span className="field-control-kind">{field.control}</span>
        </div>
        <div className="traversal-field-badges">
          {field.required && <span className="field-signal required">Required</span>}
          {(field.classification === "conditional" || dynamic) && (
            <span className="field-signal dynamic">Dynamic / branching</span>
          )}
          {field.adminAssisted && (
            <span className="field-signal notable">Administrative</span>
          )}
          {field.consent && <span className="field-signal notable">Consent</span>}
          {field.upload && <span className="field-signal notable">Document upload</span>}
          {field.sensitive && <span className="field-signal neutral">Sensitive</span>}
          {field.options > 0 && (
            <span className="field-signal neutral">{field.options} options</span>
          )}
        </div>
        <small className={field.status === "failed" ? "field-status-error" : ""}>
          {field.status === "verified"
            ? "Synthetic value entered and browser readback verified"
            : field.status === "failed"
              ? field.error || "The field could not be verified"
              : "Waiting for actuation and readback"}
        </small>
        {hasDetails && (
          <details className="field-metadata">
            <summary>Field metadata</summary>
            <dl>
              {field.name && <div><dt>Raw identity</dt><dd><code>{field.name}</code></dd></div>}
              {field.selector && <div><dt>Selector</dt><dd><code>{field.selector}</code></dd></div>}
              {field.validation && <div><dt>Validation</dt><dd>{field.validation}</dd></div>}
              {field.source && <div><dt>Planner source</dt><dd>{field.source}</dd></div>}
              {field.rationale && <div><dt>Decision</dt><dd>{field.rationale}</dd></div>}
              {field.sectionText && (
                <div className="field-context-row">
                  <dt>Observed context</dt>
                  <dd>{field.sectionText.slice(0, 520)}</dd>
                </div>
              )}
            </dl>
          </details>
        )}
      </div>
    </article>
  );
}

function TraversalStateCard({
  state,
  defaultOpen,
}: {
  state: TraversalDisplayState;
  defaultOpen: boolean;
}) {
  const verified = state.fields.filter((field) => field.status === "verified").length;
  const failed = state.fields.filter((field) => field.status === "failed").length;
  const sectionGroups = new Map<string, TraversalDisplayField[]>();
  for (const field of state.fields) {
    const key = field.formId || field.sectionText || "observed";
    const group = sectionGroups.get(key) || [];
    group.push(field);
    sectionGroups.set(key, group);
  }
  const sections = [...sectionGroups.values()];

  return (
    <details
      className={`traversal-state traversal-state-${state.status}`}
      open={defaultOpen || undefined}
    >
      <summary>
        <span className="state-sequence">
          {state.status === "verified" ? "✓" : state.status === "failed" ? "!" : state.sequence}
        </span>
        <div className="state-summary-copy">
          <span className="state-kind">{state.kind.replaceAll("_", " ")}</span>
          <strong>{state.label}</strong>
          <small>{state.description}</small>
        </div>
        <div className="state-summary-metrics">
          <span>{verified}/{state.fields.length} fields verified</span>
          {failed > 0 && <span className="danger-copy">{failed} failed</span>}
          {state.fingerprint && <code>{state.fingerprint}</code>}
        </div>
        <span className="state-chevron">⌄</span>
      </summary>
      <div className="traversal-state-body">
        <div className="state-meta-strip">
          <span>{state.fieldsVisible || state.fields.length} visible controls</span>
          <span>{sections.length} form {sections.length === 1 ? "section" : "sections"}</span>
          <span>{state.capturedAt ? new Date(state.capturedAt).toLocaleTimeString() : "live"}</span>
          <span className={`state-verification ${state.status}`}>
            {state.status === "active"
              ? "Actuating and verifying"
              : state.status === "verified"
                ? "State verified"
                : state.status === "failed"
                  ? "Concerning condition"
                  : "Review required"}
          </span>
        </div>
        {state.flags.length > 0 && (
          <div className="state-flags">
            {state.flags.map((flag, index) => (
              <div className={`state-flag ${flag.tone}`} key={`${flag.code}-${index}`}>
                <span>{flag.tone === "danger" ? "!" : "i"}</span>
                <div>
                  <strong>{flag.label}</strong>
                  {flag.detail && <small>{flag.detail}</small>}
                </div>
              </div>
            ))}
          </div>
        )}
        {sections.map((fields, index) => (
          <section className="traversal-form-section" key={`${state.id}-section-${index}`}>
            <header>
              <div>
                <span>SECTION {String(index + 1).padStart(2, "0")}</span>
                <strong>{sectionName(fields, index)}</strong>
              </div>
              <span>{fields.length} {fields.length === 1 ? "field" : "fields"}</span>
            </header>
            <div className="traversal-fields">
              {fields.map((field, fieldIndex) => (
                <StateFieldRow
                  field={field}
                  dynamic={state.kind === "branch"}
                  key={`${field.key}-${fieldIndex}`}
                />
              ))}
            </div>
          </section>
        ))}
        {!state.fields.length && (
          <div className="state-empty-fields">
            <strong>No values entered in this state</strong>
            <span>The state was still captured and identified before actuation.</span>
          </div>
        )}
      </div>
    </details>
  );
}

function TraversalPanel({
  run,
  report,
}: {
  run: FormRun;
  report: CrawlReport | null;
}) {
  const contractByKey = new Map(
    (run.contract || []).map((field) => [field.key, field])
  );
  const liveStates: TraversalDisplayState[] = (run.liveTraversal?.states || []).map(
    (state) => ({
      ...state,
      fingerprint: state.fingerprint || "",
      capturedAt: state.capturedAt || "",
      fieldsVisible: state.fieldsVisible || 0,
      fields: state.fields.map((field) =>
        displayField(field, contractByKey.get(field.fieldKey))
      ),
    })
  );
  const evidenceStates: TraversalDisplayState[] = run.nodes.flatMap((node) =>
    (node.stateEvidence || []).map((state) => {
      const actions = report?.pages
        .flatMap((page) => page.automationActions || [])
        .filter((action) => action.stateId === state.id);
      const flags: LiveTraversalFlag[] = (actions || [])
        .filter((action) => action.outcome === "could_not_test" || action.error)
        .map((action) => ({
          tone: "danger",
          code: action.failureCode || "verification_failed",
          label: action.label,
          detail: action.error || action.rationale,
        }));
      return {
        id: `${node.id}-${state.id}`,
        sequence: state.sequence,
        kind: state.kind,
        label: state.label,
        description:
          state.kind === "branch"
            ? "A declared option was exercised and the resulting dynamic state was captured."
            : state.kind === "blocked_final"
              ? "The form reached its terminal boundary after value verification; submission remained blocked."
              : "The browser captured this state after deterministic examination and readback.",
        status: flags.length ? "failed" : "verified",
        fingerprint: state.fingerprint,
        capturedAt: state.capturedAt,
        fieldsVisible: state.fieldsVisible,
        fields: state.values.map((value) =>
          displayField(value, contractByKey.get(value.fieldKey))
        ),
        flags,
      };
    })
  );
  const states = liveStates.length ? liveStates : evidenceStates;
  const activeFields = (run.liveTraversal?.currentFields || []).map((field) =>
    displayField(field, contractByKey.get(field.fieldKey))
  );
  const workingState: TraversalDisplayState | null =
    run.status === "running"
      ? {
          id: "working",
          sequence: states.length + 1,
          kind: "working",
          label: run.liveTraversal?.currentLabel || run.stage,
          description:
            "FormWeave is examining the current rendered state and verifies each field after actuation.",
          status: "active",
          fingerprint: "",
          capturedAt: "",
          fieldsVisible: activeFields.length,
          fields: activeFields,
          flags: run.liveTraversal?.flags || [],
        }
      : null;
  const displayStates = workingState ? [...states, workingState] : states;
  const verifiedStates = displayStates.filter((state) => state.status === "verified").length;
  const failedStates = displayStates.filter((state) => state.status === "failed").length;
  const verifiedFields = new Set(
    displayStates.flatMap((state) =>
      state.fields
        .filter((field) => field.status === "verified")
        .map((field) => field.key)
    )
  ).size;
  const reportScriptPage = report?.pages.find((page) => page.reconScriptId);
  const displayedScriptId =
    run.liveTraversal?.scriptId ||
    reportScriptPage?.reconScriptId ||
    "Recorded plan";
  const displayedScriptVersion =
    run.liveTraversal?.scriptVersion ||
    reportScriptPage?.reconScriptVersion ||
    0;

  return (
    <div className="traversal-console">
      <header className="traversal-console-header">
        <div>
          <span className="eyebrow">
            {run.status === "running" ? "LIVE TRAVERSAL" : "RECORDED TRAVERSAL"}
          </span>
          <h3>State-by-state form verification</h3>
          <p>
            Review what was discovered, filled, read back, and certified. Values remain
            summarized while field semantics and concerns stay inspectable.
          </p>
        </div>
        <div className="traversal-console-status">
          <span className={run.status === "running" ? "live" : "recorded"} />
          {run.status === "running" ? "Updating every 3 seconds" : "Persisted local evidence"}
        </div>
      </header>

      <div className="traversal-overview">
        <div><span>States</span><strong>{displayStates.length}</strong><small>{verifiedStates} greenlit</small></div>
        <div><span>Verified fields</span><strong>{verifiedFields}</strong><small>Actuated plus read back</small></div>
        <div><span>Concerning states</span><strong className={failedStates ? "danger-copy" : ""}>{failedStates}</strong><small>Shown in red</small></div>
        <div><span>Recon script</span><strong className="script-summary">{displayedScriptId}</strong><small>{displayedScriptVersion ? `version ${displayedScriptVersion}` : "no version recorded"}</small></div>
      </div>

      <div className="state-progress-strip" aria-label="Traversal state progress">
        {displayStates.map((state) => (
          <span
            className={`state-progress-marker ${state.status}`}
            key={`progress-${state.id}`}
            title={state.label}
          >
            {state.status === "verified" ? "✓" : state.status === "failed" ? "!" : state.sequence}
          </span>
        ))}
      </div>

      <ArchitectureExchangePanel exchanges={report?.architectureExchanges || []} />

      <div className="traversal-state-list">
        {displayStates.map((state, index) => (
          <TraversalStateCard
            state={state}
            defaultOpen={
              state.status === "active" ||
              state.status === "failed" ||
              index === displayStates.length - 1
            }
            key={`${state.id}-${index}`}
          />
        ))}
        {!displayStates.length && (
          <div className="traversal-empty">
            {run.status === "running" && <span className="report-spinner" />}
            <strong>
              {run.status === "running"
                ? "Waiting for the first browser state"
                : "No traversal state evidence was recorded"}
            </strong>
            <p>
              {run.status === "running"
                ? "Fields will appear here as they are entered and verified."
                : report
                  ? "This is a completed observation without retained populated-state evidence. Review the report status and event log; no actuation success is implied."
                  : "No persisted report or live state exchange is available for this run."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function ReportPanel({
  run,
  report,
  loading,
  error,
}: {
  run: FormRun;
  report: CrawlReport | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <div className="report-empty">
        <span className="report-spinner" />
        <strong>Loading the local report</strong>
        <p>The screen is reading the same report.json file stored on disk.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="report-empty report-error">
        <strong>Report unavailable</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="report-empty">
        <strong>{run.status === "running" ? "Crawl still running" : "No report yet"}</strong>
        <p>
          {run.status === "running"
            ? `${run.stage}. This view will populate automatically.`
            : "The run has not produced a local report artifact."}
        </p>
      </div>
    );
  }

  const analysis = report.analysis;
  const isRendered = report.renderEngine === "playwright-chromium";
  const visibleFields = report.contract.filter((field) => !field.hidden);
  const hiddenFields = report.contract.length - visibleFields.length;
  const stateEvidence = report.pages.flatMap((page) => page.stateEvidence ?? []);
  const localScreenshots =
    report.pages.filter((page) => page.screenshotArtifact).length +
    stateEvidence.filter((state) => state.screenshotArtifact).length;
  const traversalActions = report.pages.flatMap((page) =>
    (page.automationActions ?? []).map((action) => ({
      ...action,
      page:
        (page.stateEvidence ?? []).find((state) => state.id === action.stateId)
          ?.label || "Generated replay",
    }))
  );
  const incompleteJourneys = report.pages.filter(
    (page) => page.journeyComplete === false
  );
  const midFlowEntries = report.pages.filter(
    (page) => page.entryMode === "mid_flow"
  );
  const generatedPages = report.pages.filter(
    (page) => page.generatedArtifact || page.reconScriptId
  );
  const choiceFields = visibleFields
    .filter((field) =>
      ["select", "radio", "checkbox", "switch"].includes(field.control)
    )
    .map((field) => {
      const recordedOptions = (field.optionSet || []).filter(
        (option) => option.value !== ""
      );
      const enteredValues = new Set(
        (Array.isArray(field.testValue)
          ? field.testValue
          : [field.testValue]
        )
          .filter((value) => value !== undefined && value !== null)
          .map((value) => String(value))
      );
      const options = recordedOptions.map((option) => ({
          ...option,
          exercised:
            field.entryStatus === "entered" &&
            (enteredValues.has(String(option.value)) ||
              enteredValues.has(String(option.label)) ||
              (field.control === "checkbox" &&
                String(field.testValue).toLowerCase() === "true" &&
                recordedOptions.length === 1)),
        }));
      return {
        field,
        options,
        exercised: options.filter((option) => option.exercised),
        untested: options.filter((option) => !option.exercised),
      };
    });
  const exercisedChoiceOptions = choiceFields.reduce(
    (sum, item) => sum + item.exercised.length,
    0
  );
  const substantiveChoiceOptions = choiceFields.reduce(
    (sum, item) => sum + item.options.length,
    0
  );

  return (
    <div className="report-panel">
      <section className="report-hero">
        <div>
          <span className="eyebrow">LOCAL REPORT · {report.id}</span>
          <h3>
            {analysis?.summary ||
              `${report.stats.pagesFetched} pages and ${report.stats.fieldsFound} visible fields captured.`}
          </h3>
          <p>
            {analysis?.pagePurpose ||
              (isRendered
                ? "Deterministic rendered-DOM extraction with locally persisted evidence and logs."
                : "Deterministic source-crawl extraction with locally persisted report facts.")}
          </p>
        </div>
        <div className={`analysis-chip ${analysis?.status ?? "pending"}`}>
          <span />
          {analysis?.status === "completed"
            ? `AI analyzed · ${analysis.model}`
            : analysis?.status === "failed"
              ? "AI analysis failed"
              : analysis?.status === "skipped"
                ? "AI analysis skipped"
                : "AI analysis pending"}
        </div>
      </section>

      <section
        className={`journey-integrity ${
          incompleteJourneys.length || midFlowEntries.length ? "warning" : "complete"
        }`}
        aria-label="Journey completeness"
      >
        <div className="journey-integrity-icon">
          {incompleteJourneys.length || midFlowEntries.length ? "!" : "✓"}
        </div>
        <div>
          <span className="eyebrow">JOURNEY INTEGRITY</span>
          <strong>
            {incompleteJourneys.length
              ? `${incompleteJourneys.length} journey${incompleteJourneys.length === 1 ? "" : "s"} halted with partial coverage`
              : midFlowEntries.length
                ? `${midFlowEntries.length} supplied URL${midFlowEntries.length === 1 ? "" : "s"} began mid-flow`
                : "No reported journey halt"}
          </strong>
          <p>
            {incompleteJourneys.length
              ? "Earlier verified states remain in this report. The halt reason and missing terminal coverage are shown per page below."
              : midFlowEntries.length
                ? "The report covers the supplied intermediate step and its successors; preceding steps are not claimed."
                : `${generatedPages.length} page${generatedPages.length === 1 ? "" : "s"} used retained LLM-authored scripts or generated artifacts.`}
          </p>
        </div>
      </section>

      <section className="report-metrics" aria-label="Report totals">
        <div><span>Pages fetched</span><strong>{report.stats.pagesFetched}</strong><small>{report.stats.pagesAttempted} attempted</small></div>
        <div><span>Forms found</span><strong>{report.stats.formsFound}</strong><small>{isRendered ? "Across rendered pages" : "Across source crawl pages"}</small></div>
        <div><span>Visible fields</span><strong>{report.stats.fieldsFound}</strong><small>{hiddenFields} hidden controls retained</small></div>
        <div>
          <span>Screenshots local</span>
          <strong>{localScreenshots}</strong>
          <small>{report.stats.screenshotsCaptured} reported by source crawl</small>
        </div>
        <div><span>{isRendered ? "DOM bytes" : "Source bytes"}</span><strong>{formatBytes(report.stats.bytesFetched)}</strong><small>{isRendered ? "Serialized rendered HTML" : "Reported by the source crawl"}</small></div>
        <div><span>Traversal actions</span><strong>{report.stats.automationActions ?? 0}</strong><small>LLM-authored replay decisions</small></div>
        <div><span>State examinations</span><strong>{report.stats.stateExaminations ?? 0}</strong><small>Novel states sent to the model</small></div>
        <div><span>Read-like init</span><strong>{report.stats.allowedReadLikeRequests ?? 0}</strong><small>Classified same-origin requests</small></div>
        <div><span>Writes blocked</span><strong>{report.stats.blockedWriteRequests ?? 0}</strong><small>Submission safety guard</small></div>
        <div><span>States captured</span><strong>{report.stats.statesCaptured ?? 0}</strong><small>Values visible before movement</small></div>
        <div><span>Fields entered</span><strong>{report.stats.fieldsEntered ?? 0}</strong><small>{report.stats.entryFailures ?? 0} entry failures</small></div>
        <div><span>Branch states</span><strong>{report.stats.branchStates ?? 0}</strong><small>Revealed dynamic states</small></div>
        <div>
          <span>Final submissions</span>
          <strong>{report.stats.submissionsSucceeded ?? 0}</strong>
          <small>
            {report.executionMode === "fixture_submit"
              ? `${report.stats.submissionsAttempted ?? 0} attempted · ${
                  report.stats.submissionsSucceeded
                    ? "transport + rendered result verified"
                    : "no verified completion"
                }`
              : "Blocked at the public terminal boundary"}
          </small>
        </div>
      </section>

      {choiceFields.length ? (
        <section className="report-section choice-coverage-section">
          <div className="section-title">
            <span>Choice-path coverage</span>
            <span>
              {exercisedChoiceOptions}/{substantiveChoiceOptions}
            </span>
          </div>
          <div
            className={`choice-coverage-callout ${
              exercisedChoiceOptions < substantiveChoiceOptions
                ? "partial"
                : "complete"
            }`}
          >
            <strong>
              {exercisedChoiceOptions < substantiveChoiceOptions
                ? "Partial option coverage"
                : "All recorded options exercised"}
            </strong>
            <p>
              A verified field entry proves the selected value worked. It does not
              prove unselected radio, checkbox, or dropdown paths behave the same.
            </p>
          </div>
          <div className="choice-coverage-list">
            {choiceFields.map(({ field, options, exercised, untested }) => (
              <article key={`${field.originState}-${field.key}`}>
                <div>
                  <strong>{field.label || field.key}</strong>
                  <small>
                    {field.control} · {exercised.length}/{options.length} options
                    exercised
                  </small>
                </div>
                <div className="choice-option-list">
                  {options.map((option) => (
                    <span
                      className={option.exercised ? "exercised" : "untested"}
                      key={`${field.key}-${option.value}`}
                      title={
                        option.exercised
                          ? "Entered and verified in this run"
                          : "Recorded in the contract but not actuated in this run"
                      }
                    >
                      {option.exercised ? "✓" : "·"}{" "}
                      {option.label || option.value}
                    </span>
                  ))}
                  {!options.length && (
                    <span className="untested">
                      Option labels were not retained; coverage is unknown
                    </span>
                  )}
                </div>
                {untested.length > 0 && (
                  <small className="choice-coverage-gap">
                    Not exercised:{" "}
                    {untested
                      .map((option) => option.label || option.value)
                      .join(", ")}
                  </small>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {traversalActions.length ? (
        <section className="report-section">
          <div className="section-title">
            <span>Predictable traversal audit</span>
            <span>{traversalActions.length}</span>
          </div>
          <div className="automation-audit-list">
            {traversalActions.map((action, index) => (
              <article key={`${action.timestamp}-${action.category}-${index}`}>
                <span className="policy-badge automatic">
                  {action.category.replaceAll("_", " ")}
                </span>
                <div>
                  <strong>{action.label}</strong>
                  <small>
                    {action.page} · {action.strategy}
                  </small>
                </div>
                <code title="Observed action result or before/after state identity">
                  {action.beforeFingerprint || action.afterFingerprint
                    ? `${action.beforeFingerprint || "unknown"} → ${
                        action.afterFingerprint || "unknown"
                      }`
                    : `${action.outcome || "recorded"} · ${
                        action.stateId || action.classification || "no state id"
                      }`}
                </code>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="report-section">
        <div className="section-title">
          <span>Crawled pages</span>
          <span>{report.pages.length}</span>
        </div>
        <div className="page-report-list">
          {report.pages.map((page, index) => (
            <article
              className={
                page.journeyComplete === false || page.entryMode === "mid_flow"
                  ? "journey-page-warning"
                  : ""
              }
              key={`${page.finalUrl}-${index}`}
            >
              <div className="page-report-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="page-report-main">
                <strong>{page.heading || page.title || shortHost(page.finalUrl)}</strong>
                <a href={page.finalUrl} target="_blank" rel="noreferrer">{page.finalUrl}</a>
                <div>
                  <span>HTTP {page.httpStatus || "failed"}</span>
                  <span>{page.forms} forms</span>
                  <span>{page.fields.filter((field) => !field.hidden).length} visible fields</span>
                  <span>{formatBytes(page.bytesFetched)}</span>
                  <span>{page.durationMs} ms</span>
                  {(page.automationActions?.length ?? 0) > 0 && (
                    <span>{page.automationActions?.length} traversal actions</span>
                  )}
                  {page.captchaDetected && <span>CAPTCHA · review required</span>}
                  {page.unresolvedGate && !page.captchaDetected && (
                    <span>{page.unresolvedGate.replaceAll("_", " ")} unresolved</span>
                  )}
                  {(page.fieldsEntered ?? 0) > 0 && (
                    <span>{page.fieldsEntered} values entered</span>
                  )}
                  {(page.stateEvidence?.length ?? 0) > 0 && (
                    <span>{page.stateEvidence?.length} states captured</span>
                  )}
                  {page.finalSubmission === "blocked" && (
                    <span>final submit blocked</span>
                  )}
                  {page.finalSubmission === "submitted" && (
                    <span>submission confirmed</span>
                  )}
                  {page.finalSubmission === "submitted_unverified" && (
                    <span className="warning-badge">
                      submission {page.submissionResult?.outcome || "unknown"}
                    </span>
                  )}
                  {page.certificationStatus && (
                    <span>{page.certificationStatus.replaceAll("_", " ")}</span>
                  )}
                  {page.entryMode === "mid_flow" && (
                    <span className="warning-badge">partial · mid-flow entry</span>
                  )}
                  {page.journeyComplete === false && (
                    <span className="warning-badge">journey halted</span>
                  )}
                </div>
                <div className="page-journey-details">
                  <span>
                    <strong>Entry:</strong>{" "}
                    {(page.entryMode || "unknown").replaceAll("_", " ")}
                    {page.entryDetail ? ` · ${page.entryDetail}` : ""}
                  </span>
                  <span>
                    <strong>Coverage:</strong>{" "}
                    {page.journeyComplete === false
                      ? "partial"
                      : "complete from supplied URL"}{" "}
                    · {page.journeyUrls?.length || 1} observed route
                    {(page.journeyUrls?.length || 1) === 1 ? "" : "s"}
                  </span>
                  <span>
                    <strong>Actuation:</strong> {page.fieldsEntered || 0} verified
                    values · {page.entryFailures || 0} failures
                  </span>
                  {page.submissionResult && (
                    <>
                      <span>
                        <strong>Submission result:</strong>{" "}
                        {page.submissionResult.outcome} ·{" "}
                        {page.submissionResult.verified
                          ? "explicit rendered confirmation verified"
                          : "not verified"}{" "}
                        · {page.submissionResult.source.replaceAll("_", " ")}
                      </span>
                      <span>
                        <strong>Transport proof:</strong>{" "}
                        {page.submissionResult.transport?.verified
                          ? "verified"
                          : "not verified"}
                        {" · submit event "}
                        {page.submissionResult.transport?.submitEventObserved
                          ? "observed"
                          : "not observed"}
                        {" · write request "}
                        {page.submissionResult.transport?.writeRequestObserved
                          ? "observed"
                          : "not observed"}
                        {" · HTTP "}
                        {page.submissionResult.transport?.navigationStatus ?? "same-page"}
                        {" · state change "}
                        {page.submissionResult.transport?.stateChanged ? "observed" : "not observed"}
                      </span>
                      <span>
                        <strong>Rendered success criteria:</strong>{" "}
                        {page.submissionResult.criteria?.confidence || "unscored"}
                        {page.submissionResult.criteria?.markers?.length
                          ? ` · ${page.submissionResult.criteria.markers.join(" | ")}`
                          : " · no markers retained"}
                      </span>
                    </>
                  )}
                  {page.reconScriptId && (
                    <span>
                      <strong>Script:</strong> {page.reconScriptId}@
                      {page.reconScriptVersion || 0}
                    </span>
                  )}
                  {page.generatedArtifact && (
                    <span title={page.generatedArtifact.sourceHash}>
                      <strong>Generated artifact:</strong>{" "}
                      {page.generatedArtifact.states} states ·{" "}
                      {page.generatedArtifact.modelCallsThisRun ??
                        page.generatedArtifact.modelCalls}{" "}
                      model calls this run ·{" "}
                      {page.generatedArtifact.lifecycle
                        ? `${page.generatedArtifact.lifecycle.replaceAll("_", " ")} · `
                        : ""}
                      hash{" "}
                      {page.generatedArtifact.sourceHash.slice(0, 12)}
                    </span>
                  )}
                  {page.haltReason && (
                    <span className="halt-reason">
                      <strong>Halt:</strong> {page.haltReason}
                    </span>
                  )}
                </div>
              </div>
              <div className="page-report-artifacts">
                <span className={page.htmlArtifact ? "available" : ""}>HTML</span>
                <span className={page.screenshotArtifact ? "available" : ""}>PNG</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {analysis?.visibleForms?.length ? (
        <section className="report-section">
          <div className="section-title">
            <span>AI form inventory</span>
            <span>{analysis.visibleForms.length}</span>
          </div>
          <div className="form-inventory">
            {analysis.visibleForms.map((form) => <span key={form}>{form}</span>)}
          </div>
        </section>
      ) : null}

      {analysis?.inferredFields?.length ? (
        <section className="report-section">
          <div className="section-title">
            <span>Screenshot-inferred controls</span>
            <span>{analysis.inferredFields.length}</span>
          </div>
          <p className="section-explainer">
            These are deliberately separate from the {visibleFields.length} DOM-observed fields.
          </p>
          <div className="field-table-wrap">
            <table className="field-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Control</th>
                  <th>Default test value</th>
                  <th>Confidence</th>
                  <th>Evidence</th>
                  <th>Origin</th>
                </tr>
              </thead>
              <tbody>
                {analysis.inferredFields.map((field, index) => (
                  <tr key={`${field.originUrl}-${field.label}-${index}`}>
                    <td className="field-label-cell">{field.label}</td>
                    <td>{field.control}</td>
                    <td className="field-test-value">
                      {field.defaultTestValue || "Human review"}
                    </td>
                    <td><span className={`confidence-pill ${field.confidence}`}>{field.confidence}</span></td>
                    <td>{field.evidence}</td>
                    <td>{shortHost(field.originUrl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="report-section">
        <div className="section-title">
          <span>Findings</span>
          <span>{report.findings.length}</span>
        </div>
        <div className="report-findings">
          {report.findings.map((finding) => (
            <article className={`finding ${finding.tone}`} key={finding.id}>
              <div className="finding-icon">
                {finding.tone === "success" ? "✓" : finding.tone === "warning" ? "!" : finding.tone === "danger" ? "×" : "i"}
              </div>
              <div>
                <code>{finding.code}</code>
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {analysis?.limitations?.length ? (
        <section className="report-section limitations-section">
          <div className="section-title">
            <span>Known limitations</span>
            <span>{analysis.limitations.length}</span>
          </div>
          {analysis.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
        </section>
      ) : null}

      {report.artifacts && (
        <section className="report-section artifact-section">
          <div className="section-title">
            <span>Local artifacts</span>
            <span>ON DISK</span>
          </div>
          <dl>
            <div><dt>Run directory</dt><dd><code>{report.artifacts.runDirectory}</code></dd></div>
            <div><dt>Report</dt><dd><code>{report.artifacts.report}</code></dd></div>
            <div><dt>Event log</dt><dd><code>{report.artifacts.events}</code></dd></div>
            <div><dt>{isRendered ? "Rendered HTML" : "Page HTML"}</dt><dd><code>{report.artifacts.pagesDirectory}</code></dd></div>
            <div><dt>Screenshots</dt><dd><code>{report.artifacts.evidenceDirectory}</code></dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}

function EvidencePanel({ nodes }: { nodes: FlowNode[] }) {
  const proofKinds = new Set<StateEvidence["kind"]>([
    "branch",
    "selected_branch_populated",
    "pre_advance",
    "post_advance",
    "blocked_final",
    "submitted",
  ]);
  const rawItems = nodes.flatMap((node) =>
    (node.stateEvidence ?? [])
      .filter(
        (state) =>
          proofKinds.has(state.kind) ||
          (state.kind === "populated" && state.values.length > 0)
      )
      .map((state) => ({
        node: {
          ...node,
          id: `${node.id}-${state.id}`,
          title: state.label,
          fingerprint: state.fingerprint,
          evidence: state.evidence ?? "",
          evidenceAvailable: state.evidenceAvailable,
          evidenceValueCount: state.values.length,
          screenshotProvider: state.screenshotProvider,
        },
        label: state.label,
        detail: `${(state.evidenceRole || state.kind).replaceAll("_", " ")} · ${state.values.length} values`,
      }))
  );
  const itemsByEvidence = new Map<string, (typeof rawItems)[number]>();
  for (const item of rawItems) {
    const key = item.node.evidence || item.node.id;
    const existing = itemsByEvidence.get(key);
    if (!existing || item.node.evidenceValueCount !== undefined) {
      itemsByEvidence.set(key, item);
    }
  }
  const items = [...itemsByEvidence.values()];
  const sensingItems = nodes.filter(
    (node) =>
      node.evidenceAvailable &&
      !itemsByEvidence.has(node.evidence || node.id)
  );
  return (
    <div className="evidence-sections">
      <section>
        <div className="section-title">
          <span>Verified traversal evidence</span>
          <span>{items.length}</span>
        </div>
        <p className="evidence-section-copy">
          Compact proof from immediately before and after progression,
          terminal submission results, and the final boundary when traversal
          stops.
        </p>
        <div className="evidence-gallery">
          {items.map((item) => (
            <article key={item.node.id}>
              <EvidencePreview node={item.node} />
              <div>
                <strong>{item.label}</strong>
                <span>
                  {item.node.evidenceAvailable ? "captured" : "unavailable"} · {item.detail}
                </span>
              </div>
            </article>
          ))}
          {!items.length && (
            <p className="empty-panel-copy">
              No traversal proof was produced. Check Diagnostics for a missing
              script, actuation failure, or blocked transition.
            </p>
          )}
        </div>
      </section>
      <section className="sensing-evidence-section">
        <div className="section-title">
          <span>Sensing captures</span>
          <span>{sensingItems.length}</span>
        </div>
        <p className="evidence-section-copy">
          Observation-only fallback captures. Routine screenshots used as
          transient model input are not stored as client-facing evidence.
        </p>
        <div className="evidence-gallery">
          {sensingItems.map((node) => (
            <article key={`sensing-${node.id}`}>
              <EvidencePreview node={node} />
              <div>
                <strong>{node.title}</strong>
                <span>captured · sensing only</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DiagnosticsPanel({ run }: { run: FormRun }) {
  return (
    <div className="diagnostics-panel">
      <div className="findings-list">
        <div className="section-title">
          <span>Structured crawl findings</span>
          <span>{run.findings.length}</span>
        </div>
        {run.findings.map((finding) => (
          <article className={`finding ${finding.tone}`} key={finding.id}>
            <div className="finding-icon">
              {finding.tone === "success"
                ? "✓"
                : finding.tone === "warning"
                  ? "!"
                  : finding.tone === "danger"
                    ? "×"
                    : "i"}
            </div>
            <div>
              <code>{finding.code}</code>
              <strong>{finding.title}</strong>
              <p>{finding.detail}</p>
            </div>
            <time>{finding.time}</time>
          </article>
        ))}
        {!run.findings.length && (
          <p className="empty-panel-copy">No findings have been recorded yet.</p>
        )}
      </div>
    </div>
  );
}

function Queue({ runs, onSelect }: { runs: FormRun[]; onSelect: (run: FormRun) => void }) {
  const samples = runs.slice(0, 8);

  return (
    <section className="queue-card">
      <div className="queue-header">
        <div>
          <h2>Run queue</h2>
          <p>Every real crawl in one audit trail.</p>
        </div>
      </div>
      <div className="queue-table-wrap">
        <table className="queue-table">
          <thead>
            <tr>
              <th>Form</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Coverage</th>
              <th>Last activity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {samples.map((run) => (
              <tr key={run.id} onClick={() => onSelect(run)}>
                <td>
                  <span className="table-form-icon">{run.name.charAt(0)}</span>
                  <span>
                    <strong>{run.name}</strong>
                    <small>{shortHost(run.targetUrl)}</small>
                  </span>
                </td>
                <td>
                  <span className="mode-pill">
                    {run.browserMode === "headful"
                      ? "Headful"
                      : run.browserMode === "headless"
                        ? "Headless"
                        : "Legacy"}
                  </span>
                </td>
                <td>
                  <span className={`table-status ${run.status}`}>
                    {statusLabel(run.status)}
                  </span>
                </td>
                <td>
                  <div className="coverage-cell">
                    <div>
                      <span style={{ width: `${run.progress}%` }} />
                    </div>
                    {run.progress}%
                  </div>
                </td>
                <td>{relativeTime(run.updatedAt)}</td>
                <td><button aria-label={`Open ${run.name}`}>›</button></td>
              </tr>
            ))}
            {!samples.length && (
              <tr>
                <td colSpan={6} className="empty-table-cell">
                  No real crawls yet. Launch one to populate this audit trail.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LaunchModal({
  open,
  onClose,
  onLaunch,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onLaunch: (
    urls: string[],
    mode: ExecutionMode,
    browserMode: BrowserMode,
    allowLocalTargets: boolean,
    discoverRelatedPages: boolean,
    fixtureAuthorities: FixtureAuthorities
  ) => Promise<void>;
  busy: boolean;
}) {
  const [urls, setUrls] = useState("");
  const [browserMode, setBrowserMode] = useState<BrowserMode>("headless");
  const [allowLocalTargets, setAllowLocalTargets] = useState(false);
  const [discoverRelatedPages, setDiscoverRelatedPages] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("probe");
  const fixtureAuthorities: FixtureAuthorities = {
    acknowledgement: false,
    consent: false,
    reviewConfirmation: false,
    signature: false,
    upload: false,
  };

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = urls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
    await onLaunch(
      values,
      executionMode,
      browserMode,
      allowLocalTargets,
      discoverRelatedPages,
      fixtureAuthorities
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="launch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="launch-heading">
          <div>
            <span className="eyebrow">NEW FORM TRAVERSAL</span>
            <h2 id="launch-title">Populate, branch, and map forms</h2>
            <p>One URL per line. When no retained script exists, FormWeave calls the LLM at each novel state, stores a versioned script, then performs deterministic validation replay.</p>
          </div>
          <button onClick={onClose} aria-label="Close launch dialog">×</button>
        </div>
        <form onSubmit={submit}>
          <label>
            Form URLs
            <textarea
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder={"https://example.gov/apply\nhttps://example.org/intake"}
              spellCheck={false}
              required
            />
            <small>
              Up to 12 HTTP or HTTPS URLs. Private networks stay blocked; an
              explicit opt-in below permits loopback test sites only.
            </small>
          </label>
          <label className="localhost-opt-in related-page-discovery">
            <input
              type="checkbox"
              checked={discoverRelatedPages}
              onChange={(event) => setDiscoverRelatedPages(event.target.checked)}
            />
            <span>
              <strong>Discover related same-site pages</strong>
              <small>
                Follow at most 12 same-origin links, one level deep, when the
                link URL or text contains: apply, application, form, intake,
                register, signup, enroll, eligibility, benefit, service,
                request, step, page, start, or fixture.
              </small>
            </span>
          </label>
          <label className="localhost-opt-in">
            <input
              type="checkbox"
              checked={allowLocalTargets}
              onChange={(event) => {
                setAllowLocalTargets(event.target.checked);
                if (!event.target.checked) setExecutionMode("probe");
              }}
            />
            <span>
              <strong>Allow localhost test sites for this run</strong>
              <small>
                Permits localhost, *.localhost, ::1, and 127.0.0.0/8. Other
                private-network addresses remain blocked.
              </small>
            </span>
          </label>
          <fieldset>
            <legend>Browser visibility</legend>
            <button
              type="button"
              className={browserMode === "headless" ? "selected" : ""}
              aria-pressed={browserMode === "headless"}
              onClick={() => setBrowserMode("headless")}
            >
              <span aria-hidden="true">◉</span>
              <strong>Headless</strong>
              <small>Run Chromium in the background. Best for routine and automated crawls.</small>
            </button>
            <button
              type="button"
              className={browserMode === "headful" ? "selected" : ""}
              aria-pressed={browserMode === "headful"}
              onClick={() => setBrowserMode("headful")}
            >
              <span aria-hidden="true">▣</span>
              <strong>Headful</strong>
              <small>Open visible local Chromium so you can watch every page render.</small>
            </button>
          </fieldset>
          <fieldset className="execution-mode-fieldset">
            <legend>Execution boundary</legend>
            <button
              type="button"
              className={executionMode === "probe" ? "selected" : ""}
              aria-pressed={executionMode === "probe"}
              onClick={() => setExecutionMode("probe")}
            >
              <span aria-hidden="true">◇</span>
              <strong>Phase 1 Probe</strong>
              <small>
                Generate or replay a versioned script, enter synthetic values,
                test declared branches, and stop at the terminal boundary.
              </small>
            </button>
            <button
              type="button"
              className={executionMode === "fixture_submit" ? "selected" : ""}
              aria-pressed={executionMode === "fixture_submit"}
              disabled={!allowLocalTargets}
              onClick={() => setExecutionMode("fixture_submit")}
            >
              <span aria-hidden="true">✓</span>
              <strong>Submit localhost test form</strong>
              <small>
                Generate and validate an LLM-authored script, then complete and
                submit the recognized loopback fixture with synthetic values.
              </small>
            </button>
          </fieldset>
          {executionMode === "fixture_submit" && (
            <div className="fixture-authorities">
              <strong>Special components use the normal crawl policy</strong>
              <p>
                Upload, consent, acknowledgement, review confirmation, and
                signature fields are modeled only when the LLM-authored script
                declares the action and safety accepts it. This is the same for
                public and local forms; the crawler uses synthetic values and
                never infers an end user&apos;s choice.
              </p>
              <p className="fixture-authorities-boundary">
                Never authorized here: CAPTCHA solving, credentials or login,
                payment data, or end-user files. Those remain disqualification
                or approved-execution boundaries.
              </p>
            </div>
          )}
          <div
            className={`safety-callout ${
              executionMode === "fixture_submit" ? "live" : ""
            }`}
          >
            <span>{executionMode === "fixture_submit" ? "!" : "✓"}</span>
            <div>
              <strong>
                {executionMode === "fixture_submit"
                  ? "Terminal submission is enabled for localhost"
                  : "Terminal submission remains blocked"}
              </strong>
              <p>
                {executionMode === "fixture_submit"
                  ? "The crawler will submit synthetic values and capture the resulting state. The API enforces the loopback-only boundary."
                  : "The LLM decides actions during generation and stores the script. Validation replay is deterministic and stops before terminal submission."}
              </p>
            </div>
          </div>
          <div className="launch-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy}
            >
              {busy
                ? "Starting…"
                : executionMode === "fixture_submit"
                  ? "Launch and submit test"
                  : "Launch probe"}{" "}
              <span>→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsToggle({
  checked,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  label: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

function TraversalSettingsPanel({
  settings,
  settingsPath,
  saving,
  onSave,
}: {
  settings: TraversalSettings | null;
  settingsPath: string;
  saving: boolean;
  onSave: (settings: TraversalSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TraversalSettings>(
    settings ?? defaultTraversalSettings
  );

  function setBoolean(
    key:
      | "acceptCookiesWhenRequired"
      | "closeWelcomeBanners"
      | "dismissOptionalOffers"
      | "dismissOptionalAuth"
      | "expandSafeDisclosures"
      | "advanceIntroScreens"
      | "allowSameOriginReadLikePosts"
      | "pointerAndScrollPriming"
      | "enterTestValues"
      | "exerciseBranches"
      | "advanceFormSteps",
    value: boolean
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const policyRows = [
    {
      obstacle: "Cookie consent",
      behavior:
        draft.cookieConsent === "reject_non_essential"
          ? "Reject non-essential cookies; accept only when it is the sole safe path"
          : draft.cookieConsent === "accept_all"
            ? "Accept cookies"
            : "Observe and request review",
      disposition: draft.cookieConsent === "observe_only" ? "Review" : "Automatic",
    },
    {
      obstacle: "Welcome banners and optional offers",
      behavior: "Close predictable overlays and continue as guest when clearly optional",
      disposition:
        draft.closeWelcomeBanners && draft.dismissOptionalOffers
          ? "Automatic"
          : "Observed",
    },
    {
      obstacle: "Intro and disclosure screens",
      behavior: "Expand safe disclosures and advance explicit non-submit intro controls",
      disposition:
        draft.expandSafeDisclosures && draft.advanceIntroScreens
          ? "Automatic"
          : "Observed",
    },
    {
      obstacle: "Form fields and validation",
      behavior:
        "Enter synthetic defaults in DOM order, trigger change/blur validation, and record failures",
      disposition: draft.enterTestValues ? "Automatic" : "Observed",
    },
    {
      obstacle: "Conditional branches and steps",
      behavior:
        "Exercise bounded select, radio, and checkbox options; populate revealed fields; advance intermediate states",
      disposition:
        draft.exerciseBranches && draft.advanceFormSteps
          ? "Automatic"
          : "Observed",
    },
    {
      obstacle: "Final submission",
      behavior:
        "Phase 1 Probe captures completed values and stops at the terminal boundary. Approved-live execution belongs to Phase 2.",
      disposition: "Review",
    },
    {
      obstacle: "App initialization",
      behavior:
        "Allow classified initialization and bounded same-origin validation/autosave requests caused by synthetic interactions",
      disposition: draft.allowSameOriginReadLikePosts ? "Automatic" : "Blocked",
    },
    {
      obstacle: "CAPTCHA / human verification",
      behavior: "Detect, capture evidence, log the gate, and stop for a person",
      disposition: "Human review",
    },
    {
      obstacle: "Unpredictable ads or popups",
      behavior: "Observe and capture; do not add a nondeterministic replay action",
      disposition: "Observed",
    },
    {
      obstacle: "Terms, age, payment, or required authentication",
      behavior: "Never agree, attest, pay, sign in, or create an account automatically",
      disposition: "Human review",
    },
  ];

  return (
    <section className="settings-page">
      <div className="settings-hero">
        <div>
          <span className="eyebrow">PREDICTABLE TRAVERSAL POLICY</span>
          <h2>Automate safe obstacles. Preserve every decision.</h2>
          <p>
            New crawler sessions snapshot this policy. Every predictable action is
            fingerprinted and logged so the deterministic runner can replay it; uncertain
            or consequential gates stop for review.
          </p>
        </div>
        <div className="settings-snapshot">
          <span>POLICY VERSION</span>
          <strong>v{draft.version}</strong>
          <small>
            {settings?.updatedAt
              ? `Saved ${relativeTime(settings.updatedAt)}`
              : "Loading local policy"}
          </small>
        </div>
      </div>

      <div className="settings-grid">
        <article className="settings-section">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">CONSENT</span>
              <h3>Cookie gates</h3>
            </div>
            <span className="policy-badge automatic">Predictable</span>
          </div>
          <label className="settings-field">
            Default response
            <select
              value={draft.cookieConsent}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  cookieConsent: event.target
                    .value as TraversalSettings["cookieConsent"],
                }))
              }
            >
              <option value="reject_non_essential">
                Reject non-essential cookies (recommended)
              </option>
              <option value="accept_all">Accept cookies</option>
              <option value="observe_only">Observe only and request review</option>
            </select>
            <small>
              A consent click is recorded only when its label and visible gate are
              predictable.
            </small>
          </label>
          <SettingsToggle
            checked={draft.acceptCookiesWhenRequired}
            label="Allow accept-only fallback"
            detail="Use Accept only when no reject or necessary-only route exists and it is required to reveal the public form."
            onChange={(value) => setBoolean("acceptCookiesWhenRequired", value)}
          />
        </article>

        <article className="settings-section">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">FORM EXERCISE</span>
              <h3>Populate and traverse states</h3>
            </div>
            <span className="policy-badge automatic">State evidence</span>
          </div>
          <SettingsToggle
            checked={draft.enterTestValues}
            label="Enter synthetic test values"
            detail="Populate supported controls in DOM order, trigger native input/change/blur validation, and report every success or failure."
            onChange={(value) => setBoolean("enterTestValues", value)}
          />
          <SettingsToggle
            checked={draft.exerciseBranches}
            label="Exercise choice branches"
            detail="Probe bounded select, radio, checkbox, and switch options, populate newly revealed fields, and capture each state."
            onChange={(value) => setBoolean("exerciseBranches", value)}
          />
          <SettingsToggle
            checked={draft.advanceFormSteps}
            label="Advance intermediate form steps"
            detail="Use only the selected form script's declared intermediate advances. Phase 1 stops at the terminal submit boundary."
            onChange={(value) => setBoolean("advanceFormSteps", value)}
          />
        </article>

        <article className="settings-section">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">OVERLAYS</span>
              <h3>Predictable blockers</h3>
            </div>
            <span className="policy-badge automatic">Audited</span>
          </div>
          <SettingsToggle
            checked={draft.closeWelcomeBanners}
            label="Close welcome banners"
            detail="Dismiss clearly labeled welcome, tour, announcement, and informational overlays."
            onChange={(value) => setBoolean("closeWelcomeBanners", value)}
          />
          <SettingsToggle
            checked={draft.dismissOptionalOffers}
            label="Dismiss optional offers"
            detail="Use No thanks, Not now, Skip, or equivalent when the offer is not required."
            onChange={(value) => setBoolean("dismissOptionalOffers", value)}
          />
          <SettingsToggle
            checked={draft.dismissOptionalAuth}
            label="Continue without optional sign-in"
            detail="Choose Continue as guest or equivalent; never create an account or enter credentials."
            onChange={(value) => setBoolean("dismissOptionalAuth", value)}
          />
        </article>

        <article className="settings-section">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">PAGE STATE</span>
              <h3>Reveal the stable form</h3>
            </div>
            <span className="policy-badge automatic">Deterministic</span>
          </div>
          <SettingsToggle
            checked={draft.expandSafeDisclosures}
            label="Expand safe disclosures"
            detail="Open collapsed help and detail regions that do not submit, consent, authenticate, or mutate form data."
            onChange={(value) => setBoolean("expandSafeDisclosures", value)}
          />
          <SettingsToggle
            checked={draft.advanceIntroScreens}
            label="Advance explicit intro screens"
            detail="Click only non-submit Start, Continue, or Next controls outside a form."
            onChange={(value) => setBoolean("advanceIntroScreens", value)}
          />
          <SettingsToggle
            checked={draft.pointerAndScrollPriming}
            label="Prime hover and lazy-load state"
            detail="Use a fixed pointer sweep and reversible scroll before examination to trigger legitimate hover and viewport loading."
            onChange={(value) => setBoolean("pointerAndScrollPriming", value)}
          />
        </article>

        <article className="settings-section">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">NETWORK SAFETY</span>
              <h3>Read-like initialization</h3>
            </div>
            <span className="policy-badge review">Interaction windows</span>
          </div>
          <SettingsToggle
            checked={draft.allowSameOriginReadLikePosts}
            label="Allow classified initialization POSTs"
            detail="Permit same-origin render/bootstrap requests outside interaction windows. Validation and autosave writes are allowed only immediately after a synthetic action."
            onChange={(value) => setBoolean("allowSameOriginReadLikePosts", value)}
          />
          <div className="settings-locked">
            <span>LOCKED</span>
            <p>
              Autonomous form submissions remain blocked. Phase 1 grants a short
              submit window only for a classified intermediate step; terminal
              submission authority does not exist in this phase.
            </p>
          </div>
        </article>

        <article className="settings-section settings-advanced">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">WAIT STRATEGY</span>
              <h3>State examination</h3>
            </div>
            <span className="policy-badge automatic">Bounded</span>
          </div>
          <div className="settings-number-grid">
            <label className="settings-field">
              DOM quiet window
              <input
                type="number"
                min={300}
                max={3000}
                step={100}
                value={draft.stableWindowMs}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    stableWindowMs: Number(event.target.value),
                  }))
                }
              />
              <small>Milliseconds without a DOM mutation before examination.</small>
            </label>
            <label className="settings-field">
              Maximum state wait
              <input
                type="number"
                min={3000}
                max={30000}
                step={1000}
                value={draft.maxStateWaitMs}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxStateWaitMs: Number(event.target.value),
                  }))
                }
              />
              <small>Hard bound for navigation, fonts, network, and DOM settling.</small>
            </label>
            <label className="settings-field">
              Actions per page
              <input
                type="number"
                min={1}
                max={25}
                value={draft.maxActionsPerPage}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxActionsPerPage: Number(event.target.value),
                  }))
                }
              />
              <small>Ceiling that prevents loops or runaway overlay handling.</small>
            </label>
            <label className="settings-field">
              State evidence limit
              <input
                type="number"
                min={1}
                max={30}
                value={draft.maxFormStates}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxFormStates: Number(event.target.value),
                  }))
                }
              />
              <small>Maximum populated, branch, advance, and result screenshots per page.</small>
            </label>
            <label className="settings-field">
              Branch options per control
              <input
                type="number"
                min={1}
                max={8}
                value={draft.maxBranchOptionsPerControl}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    maxBranchOptionsPerControl: Number(event.target.value),
                  }))
                }
              />
              <small>Bounded alternatives for selects, radios, checkboxes, and switches.</small>
            </label>
          </div>
        </article>

        <article className="settings-section settings-agent-prompt">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">AGENT POLICY</span>
              <h3>Natural-language traversal instructions</h3>
            </div>
            <span className="policy-badge automatic">LLM + fallback</span>
          </div>
          <label className="settings-field">
            Instructions for control classification and test-value generation
            <textarea
              value={draft.agentInstructions}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  agentInstructions: event.target.value,
                }))
              }
              rows={8}
              spellCheck
            />
            <small>
              The LLM proposes values, branches, and advance classifications. Hard
              enforcement owns CAPTCHA, credentials, files, legal acceptance,
              payment, and the Phase 1 terminal block.
            </small>
          </label>
        </article>

        <article className="settings-section settings-review">
          <div className="settings-section-heading">
            <div>
              <span className="eyebrow">HUMAN BOUNDARY</span>
              <h3>Never bypass verification</h3>
            </div>
            <span className="policy-badge human">Human review</span>
          </div>
          <div className="settings-boundary">
            <strong>CAPTCHA and “are you human” checks</strong>
            <p>
              Detect the challenge, take a screenshot, record the state, and mark the run
              for review. The crawler does not click, solve, or disguise itself to bypass
              bot protection.
            </p>
          </div>
          <div className="settings-boundary">
            <strong>Unpredictable or consequential choices</strong>
            <p>
              Ads, legal acceptance, age attestations, payment, required login, and
              account creation are evidence-only gates until a person decides.
            </p>
          </div>
        </article>
      </div>

      <article className="settings-policy-table">
        <div className="settings-section-heading">
          <div>
            <span className="eyebrow">OPERATING INSTRUCTIONS</span>
            <h3>What the crawler may traverse</h3>
          </div>
          <span className="settings-path" title={settingsPath}>
            {settingsPath || "data/settings.json"}
          </span>
        </div>
        <div className="policy-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Obstacle</th>
                <th>Instruction</th>
                <th>Disposition</th>
              </tr>
            </thead>
            <tbody>
              {policyRows.map((row) => (
                <tr key={row.obstacle}>
                  <td>{row.obstacle}</td>
                  <td>{row.behavior}</td>
                  <td>
                    <span
                      className={`policy-badge ${
                        row.disposition === "Human review"
                          ? "human"
                          : row.disposition === "Review"
                            ? "review"
                            : "automatic"
                      }`}
                    >
                      {row.disposition}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="settings-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() => setDraft({ ...defaultTraversalSettings })}
        >
          Reset recommended defaults
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={saving || !settings}
          onClick={() => onSave(draft)}
        >
          {saving ? "Saving…" : "Save traversal policy"}
        </button>
      </div>
    </section>
  );
}

export function ControlPlane() {
  const [surface, setSurface] = useState<Surface>("runs");
  const [runs, setRuns] = useState<FormRun[]>([]);
  const [activeRun, setActiveRun] = useState<FormRun | null>(null);
  const [selectedNode, setSelectedNode] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Report");
  const [report, setReport] = useState<CrawlReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [traversalSettings, setTraversalSettings] =
    useState<TraversalSettings | null>(null);
  const [settingsPath, setSettingsPath] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [apiState, setApiState] = useState<"connecting" | "online" | "offline">(
    "connecting"
  );

  const node = useMemo(
    () =>
      activeRun?.nodes.find((item) => item.id === selectedNode) ??
      activeRun?.nodes[0],
    [activeRun, selectedNode]
  );

  useEffect(() => {
    let disposed = false;
    let loading = false;
    async function loadRuns() {
      if (loading) return;
      loading = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const [response, healthResponse] = await Promise.all([
          fetch(apiUrl("/api/runs"), {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(apiUrl("/api/health"), {
            cache: "no-store",
            signal: controller.signal,
          }).catch(() => null),
        ]);
        if (healthResponse?.ok) {
          setRuntime((await healthResponse.json()) as RuntimeStatus);
        }
        if (!response.ok) throw new Error("API unavailable");
        const data = (await response.json()) as { runs: FormRun[] };
        if (disposed) return;
        setRuns(data.runs);
        setApiState("online");
        setActiveRun((current) => {
          const refreshed = current
            ? data.runs.find((item) => item.id === current.id)
            : undefined;
          return refreshed ?? data.runs[0] ?? null;
        });
      } catch {
        if (!disposed) setApiState("offline");
      } finally {
        window.clearTimeout(timeout);
        loading = false;
      }
    }
    loadRuns();
    const interval = window.setInterval(loadRuns, 3000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    async function loadSettings() {
      try {
        const response = await fetch(apiUrl("/api/settings"), {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Settings API unavailable.");
        const data = (await response.json()) as {
          settings: TraversalSettings;
          settingsPath: string;
        };
        if (!disposed) {
          setTraversalSettings(data.settings);
          setSettingsPath(data.settingsPath);
        }
      } catch (error) {
        if (!disposed) {
          setToast(
            error instanceof Error
              ? error.message
              : "Unable to read the local traversal policy."
          );
        }
      }
    }
    loadSettings();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const runId = activeRun?.id;
    if (!runId || !activeRun.reportAvailable) {
      return;
    }
    const selectedRunId = runId;

    async function loadReport() {
      setReportLoading(true);
      setReportError("");
      try {
        const response = await fetch(
          apiUrl(`/api/runs/${encodeURIComponent(selectedRunId)}/report`),
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error(`Report API returned ${response.status}.`);
        const data = (await response.json()) as CrawlReport;
        if (!disposed) setReport(data);
      } catch (error) {
        if (!disposed) {
          setReportError(
            error instanceof Error ? error.message : "Unable to read the local report."
          );
        }
      } finally {
        if (!disposed) setReportLoading(false);
      }
    }

    loadReport();
    return () => {
      disposed = true;
    };
  }, [activeRun?.id, activeRun?.reportAvailable, activeRun?.updatedAt]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function launch(
    urls: string[],
    mode: ExecutionMode,
    browserMode: BrowserMode,
    allowLocalTargets: boolean,
    discoverRelatedPages: boolean,
    fixtureAuthorities: FixtureAuthorities
  ) {
    setLaunching(true);
    try {
      const response = await fetch(apiUrl("/api/runs"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls,
          mode,
          browserMode,
          allowLocalTargets,
          discoverRelatedPages,
          fixtureAuthorities,
        }),
      });
      const data = (await response.json()) as { run?: FormRun; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error ?? "Unable to launch.");
      setRuns((current) => [data.run!, ...current]);
      setActiveRun(data.run);
      setActiveTab("Traversal");
      setReport(null);
      setSelectedNode(data.run.nodes[0]?.id ?? "welcome");
      setLaunchOpen(false);
      setToast(
        `${browserMode === "headful" ? "Visible" : "Headless"} ${
          mode === "fixture_submit" ? "localhost submission test" : "Phase 1 probe"
        } launched for ${urls.length} target${urls.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to launch session.");
    } finally {
      setLaunching(false);
    }
  }

  async function runAction(action: "request_review") {
    if (!activeRun) return;
    try {
      const response = await fetch(apiUrl(`/api/runs/${activeRun.id}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Action failed.");
      const updated = { ...activeRun, status: "awaiting_review" as RunStatus };
      setActiveRun(updated);
      setRuns((current) => current.map((run) => (run.id === updated.id ? updated : run)));
      setToast("Review requested.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Action failed.");
    }
  }

  async function saveTraversalSettings(settings: TraversalSettings) {
    setSettingsSaving(true);
    try {
      const response = await fetch(apiUrl("/api/settings"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await response.json()) as {
        settings?: TraversalSettings;
        settingsPath?: string;
        error?: string;
      };
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? "Unable to save traversal policy.");
      }
      setTraversalSettings(data.settings);
      if (data.settingsPath) setSettingsPath(data.settingsPath);
      setToast("Traversal policy saved for new crawler sessions.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Unable to save traversal policy."
      );
    } finally {
      setSettingsSaving(false);
    }
  }

  function chooseRun(run: FormRun) {
    setActiveRun(run);
    setReport(null);
    setReportError("");
    setActiveTab("Report");
    setSelectedNode(
      run.nodes.find((item) => item.status === "active")?.id ??
        run.nodes[0]?.id ??
        "welcome"
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const runningCount = runs.filter((run) => run.status === "running").length;
  const completedCount = runs.filter(
    (run) => run.status === "completed" || run.status === "certified"
  ).length;
  const reviewCount = runs.filter((run) => run.status === "awaiting_review").length;
  const failedCount = runs.filter((run) => run.status === "failed").length;

  return (
    <div className="app-shell">
      <Sidebar surface={surface} onChange={setSurface} />
      <main className="app-main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              FORM OPERATIONS / {surface === "runs" ? "RUNS" : "SETTINGS"}
            </span>
            <h1>{surface === "runs" ? "Form intelligence" : "Traversal settings"}</h1>
          </div>
          <div className="topbar-actions">
            <div className={`environment-pill ${apiState}`}>
              <span />
              {apiState === "online"
                ? runtime?.runtime === "local-filesystem"
                  ? `Local crawler · ${runtime.openai.configured ? "AI ready" : "AI key missing"}`
                  : `PostgreSQL crawler · ${runtime?.openai.configured ? "AI ready" : "AI key missing"}`
                : apiState === "connecting"
                  ? "Connecting"
                  : "Crawler API unavailable"}
            </div>
            {runtime?.generationMode === "forced_fresh" && (
              <div className="environment-pill audit-mode">
                <span />
                Fresh-generation audit mode
              </div>
            )}
            {surface === "runs" && (
              <>
                <a className="secondary-button console-link" href="/api-console">
                  API console
                </a>
                <button className="primary-button" onClick={() => setLaunchOpen(true)}>
                  <span className="plus">+</span> New crawl
                </button>
              </>
            )}
          </div>
        </header>

        {surface === "runs" ? (
          <>
        <section className="stats-grid" aria-label="Run summary">
          <StatCard label="Active crawls" value={String(runningCount).padStart(2, "0")} detail="Fetching public targets" tone="green" />
          <StatCard label="Completed" value={String(completedCount).padStart(2, "0")} detail="Reports available" tone="blue" />
          <StatCard label="Needs review" value={String(reviewCount).padStart(2, "0")} detail="Operator requested" tone="amber" />
          <StatCard label="Failed" value={String(failedCount).padStart(2, "0")} detail="Actionable diagnostics" tone="red" />
        </section>

        {activeRun ? (
        <section className="run-card">
          <div className="run-header">
            <div className="run-title-row">
              <div className="run-logo">{activeRun.name.charAt(0)}</div>
              <div>
                <div className="run-name-line">
                  <h2>{activeRun.name}</h2>
                  <span className={`run-status ${activeRun.status}`}>
                    <i />
                    {statusLabel(activeRun.status)}
                  </span>
                </div>
                <div className="run-url-line">
                  <span>⌁</span>
                  <span>{shortHost(activeRun.targetUrl)}</span>
                  <span>·</span>
                  <code>{activeRun.id}</code>
                  <span>·</span>
                  <span>
                    {activeRun.stats?.pagesFetched ?? activeRun.nodes.length} pages · {activeRun.urls.length} seeds
                  </span>
                  {activeRun.browserMode && (
                    <>
                      <span>·</span>
                      <span>{activeRun.browserMode === "headful" ? "Headful browser" : "Headless browser"}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>
                    {activeRun.mode === "fixture_submit"
                      ? "Localhost submit test"
                      : "Phase 1 Probe"}
                  </span>
                </div>
              </div>
            </div>
            <div className="run-actions">
              {activeRun.reportAvailable && (
                <a
                  className="secondary-button button-link"
                  href={apiUrl(`/api/runs/${encodeURIComponent(activeRun.id)}/report?download=1`)}
                >
                  Download report
                </a>
              )}
              {runtime && (
                <a
                  className="secondary-button button-link"
                  href={apiUrl(`/api/runs/${encodeURIComponent(activeRun.id)}/logs?download=1`)}
                >
                  Download logs
                </a>
              )}
              {activeRun.status === "completed" && (
                <button className="secondary-button" onClick={() => runAction("request_review")}>
                  Send to review
                </button>
              )}
            </div>
          </div>
          <div className="run-progress">
            <div className="stage-copy">
              <span>{activeRun.stage}</span>
              <strong>{activeRun.progress}%</strong>
            </div>
            <ProgressRail progress={activeRun.progress} />
          </div>
          <div className="trust-strip">
            <div><span>✓</span> {activeRun.browserMode ? "Local Playwright render" : "Persisted crawl facts"}</div>
            <div><span>✓</span> Synthetic test values only</div>
            <div><span>✓</span> Every populated state captured locally</div>
            <div
              className={
                activeRun.mode === "fixture_submit" &&
                (activeRun.stats?.submissionsSucceeded ?? 0) > 0
                  ? ""
                  : "locked"
              }
            >
              <span>
                {activeRun.mode === "fixture_submit" &&
                (activeRun.stats?.submissionsSucceeded ?? 0) > 0
                  ? "✓"
                  : "⌕"}
              </span>{" "}
              {activeRun.mode === "fixture_submit"
                ? (activeRun.stats?.submissionsSucceeded ?? 0) > 0
                  ? "Localhost test submission verified"
                  : "Localhost test submission explicitly enabled"
                : "Terminal submission blocked"}
            </div>
          </div>

          <div className="workspace-tabs" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                className={activeTab === tab ? "active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
                {tab === "Report" && activeRun.stats && (
                  <span>{activeRun.stats.fieldsFound}</span>
                )}
                {tab === "Diagnostics" && <span>{activeRun.findings.length}</span>}
              </button>
            ))}
          </div>

          <div className={`workspace workspace-${activeTab.toLowerCase().replaceAll(" ", "-")}`}>
            {activeTab === "Report" && (
              <ReportPanel
                run={activeRun}
                report={report}
                loading={reportLoading}
                error={reportError}
              />
            )}
            {activeTab === "Traversal" && (
              <TraversalPanel run={activeRun} report={report} />
            )}
            {activeTab === "Flow map" && (
              <>
                <div className="graph-panel">
                  <div className="graph-toolbar">
                    <div>
                      <span className="graph-live-dot" />
                      Observed page graph
                      <small>{activeRun.nodes.length} pages · {activeRun.edges.length} links</small>
                    </div>
                    <div>
                      <span><i className="verified" /> Fetched</span>
                      <span><i className="observed" /> Review</span>
                    </div>
                  </div>
                  <FlowGraph
                    run={activeRun}
                    selectedNode={selectedNode}
                    onSelect={setSelectedNode}
                  />
                </div>
                {node && <Inspector node={node} />}
              </>
            )}
            {activeTab === "Field contract" && (
              <FieldsPanel run={activeRun} report={report} />
            )}
            {activeTab === "Evidence" && <EvidencePanel nodes={activeRun.nodes} />}
            {activeTab === "Diagnostics" && <DiagnosticsPanel run={activeRun} />}
          </div>
        </section>
        ) : (
          <section className="empty-run-card">
            <span className="eyebrow">NO REAL CRAWLS YET</span>
            <h2>Start with a public form URL</h2>
            <p>FormWeave will render the page, extract its actual controls, capture evidence, and produce a downloadable report.</p>
            <button className="primary-button" onClick={() => setLaunchOpen(true)}>
              <span className="plus">+</span> Launch first crawl
            </button>
          </section>
        )}

        <Queue runs={runs} onSelect={chooseRun} />
          </>
        ) : (
          <TraversalSettingsPanel
            key={traversalSettings?.updatedAt ?? "loading"}
            settings={traversalSettings}
            settingsPath={settingsPath}
            saving={settingsSaving}
            onSave={saveTraversalSettings}
          />
        )}
        <footer className="app-footer">
          <span>FORMWEAVE CONTROL PLANE</span>
          <span>
            {runtime
              ? runtime.runtime === "postgresql"
                ? `PostgreSQL · ${runtime.storage?.database || "connected"} · ${runtime.openai.model}`
                : `Local storage · ${runtime.storageRoot || runtime.storage?.root || "data"} · ${runtime.openai.model}`
              : "Read-only crawler v1 · Fingerprints use fetched form facts"}
          </span>
        </footer>
      </main>

      <LaunchModal
        open={launchOpen}
        onClose={() => setLaunchOpen(false)}
        onLaunch={launch}
        busy={launching}
      />
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}
