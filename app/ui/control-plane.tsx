"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { makeDemoRun } from "../lib/demo-run";
import type { FlowEdge, FlowNode, FormRun, RunStatus } from "../lib/models";

const fallbackRun = makeDemoRun();
const tabs = ["Flow map", "Field contract", "Evidence", "Diagnostics"] as const;
type Tab = (typeof tabs)[number];

const fieldRows = [
  ["first_name", "text", "required", "identity"],
  ["date_of_birth", "date", "sensitive", "identity"],
  ["household_size", "select", "3 options", "household"],
  ["veteran_status", "radio", "2 options", "household"],
  ["annual_income", "currency", "sensitive", "income"],
  ["benefits_received", "checkbox[]", "6 options", "income"],
  ["dependent_age", "number", "conditional", "children"],
  ["other_housing_need", "text", "companion field", "household"],
];

const diagnostics = [
  ["locator_unresolved", "A declared field locator did not resolve."],
  ["type_mismatch", "The live control type differs from its contract."],
  ["actuation_unverified", "A write could not be read back exactly."],
  ["advance_no_navigation", "The advance action produced no state fingerprint change."],
  ["validation_blocked", "The form’s own validation prevented progress."],
  ["drift_fingerprint", "DOM-derived facts no longer match the trusted form."],
  ["captcha_handoff", "Interactive verification requires a human."],
  ["ambiguous_advance", "More than one plausible forward action was found."],
];

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

function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const nav = [
    ["⌁", "Runs"],
    ["◇", "Forms"],
    ["⌘", "Scripts"],
    ["▦", "Evidence"],
    ["◌", "Review"],
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
        {nav.map(([icon, label], index) => (
          <button className={`nav-item ${index === 0 ? "active" : ""}`} key={label}>
            <span className="nav-glyph" aria-hidden="true">
              {icon}
            </span>
            <span className="nav-label">{label}</span>
            {label === "Review" && <span className="nav-count">2</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item">
          <span className="nav-glyph" aria-hidden="true">
            ?
          </span>
          <span className="nav-label">Help</span>
        </button>
        <div className="avatar" title="Maya Chen">
          MC
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
    ["Discover", 16],
    ["Map fields", 38],
    ["Probe branches", 74],
    ["Certify", 92],
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
      <div className="graph-canvas">
        <div className="lane-label primary">Primary path</div>
        <div className="lane-label branch">Observed variants</div>
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
      <div className="mock-browser-bar">
        <i />
        <i />
        <i />
        <span>secure intake form</span>
      </div>
      <div className="mock-form">
        <div className="mock-form-copy">
          <span className="mock-kicker">HOUSING SUPPORT</span>
          <strong>{node.title}</strong>
          <span className="mock-line wide" />
          <span className="mock-line medium" />
        </div>
        <div className="mock-fields">
          <span />
          <span />
          <span className="short" />
        </div>
        {node.sensitiveMasks > 0 && (
          <>
            <div className="mask mask-one">MASKED</div>
            <div className="mask mask-two">MASKED</div>
          </>
        )}
        {node.id === "captcha" && (
          <div className="captcha-box">
            <span>☑</span>
            Human verification
          </div>
        )}
      </div>
      <span className="evidence-watermark">
        SYNTHETIC · {node.sensitiveMasks} MASKS
      </span>
    </div>
  );
}

function Inspector({ node }: { node: FlowNode }) {
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <span className={`eyebrow node-tone-${node.status}`}>STATE {node.step}</span>
          <h3>{node.title}</h3>
        </div>
        <button aria-label="More state options">•••</button>
      </div>
      <EvidencePreview node={node} />
      <div className="evidence-caption">
        <span>Pre-advance evidence</span>
        <span>{node.sensitiveMasks} masks applied</span>
      </div>
      <div className="inspector-metrics">
        <div>
          <span>Fingerprint</span>
          <code>{node.fingerprint}</code>
        </div>
        <div>
          <span>Fields declared</span>
          <strong>{node.fields}</strong>
        </div>
        <div>
          <span>Dynamic variants</span>
          <strong>{node.branches}</strong>
        </div>
        <div>
          <span>Write contract</span>
          <strong>{node.status === "queued" ? "Pending" : "Verified"}</strong>
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

function FieldsPanel() {
  return (
    <div className="contract-panel">
      <div className="contract-summary">
        <div>
          <span>DECLARED CONTRACT</span>
          <strong>43 fields</strong>
          <small>Any subset accepted at runtime</small>
        </div>
        <div>
          <span>DYNAMIC EXPANSIONS</span>
          <strong>10 fields</strong>
          <small>All with trigger lineage</small>
        </div>
        <div>
          <span>SENSITIVE</span>
          <strong>18 fields</strong>
          <small>Mask-required evidence</small>
        </div>
      </div>
      <div className="field-table-wrap">
        <table className="field-table">
          <thead>
            <tr>
              <th>Semantic key</th>
              <th>Raw control</th>
              <th>Contract</th>
              <th>Origin state</th>
            </tr>
          </thead>
          <tbody>
            {fieldRows.map((row) => (
              <tr key={row[0]}>
                <td>
                  <code>{row[0]}</code>
                </td>
                <td>{row[1]}</td>
                <td>
                  <span className={`field-pill ${row[2].replaceAll(" ", "-")}`}>
                    {row[2]}
                  </span>
                </td>
                <td>{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EvidencePanel({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="evidence-gallery">
      {nodes.slice(0, 6).map((node) => (
        <article key={node.id}>
          <EvidencePreview node={node} />
          <div>
            <strong>{node.title}</strong>
            <span>
              {node.sensitiveMasks} masks · {node.fingerprint}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function DiagnosticsPanel({ run }: { run: FormRun }) {
  return (
    <div className="diagnostics-panel">
      <div className="diagnostic-list">
        <div className="section-title">
          <span>Closed reason codes</span>
          <span>{diagnostics.length}</span>
        </div>
        {diagnostics.map(([code, text]) => (
          <div className="diagnostic-row" key={code}>
            <code>{code}</code>
            <span>{text}</span>
            <i>0</i>
          </div>
        ))}
      </div>
      <div className="findings-list">
        <div className="section-title">
          <span>Latest structured findings</span>
          <span>Live</span>
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
      </div>
    </div>
  );
}

function Queue({ runs, onSelect }: { runs: FormRun[]; onSelect: (run: FormRun) => void }) {
  const samples =
    runs.length > 1
      ? runs.slice(0, 5)
      : [
          ...runs,
          makeDemoRun({
            id: "run_shelter_031",
            name: "HomeFirst Coordinated Entry",
            targetUrl: "https://homefirst.example/get-help",
            status: "certified",
            stage: "Runtime ready",
            progress: 100,
            updatedAt: "2026-07-23T02:48:00.000Z",
          }),
          makeDemoRun({
            id: "run_drift_018",
            name: "County Rapid Rehousing",
            targetUrl: "https://county.example/rehousing/apply",
            status: "awaiting_review",
            stage: "Fingerprint drift",
            progress: 62,
            updatedAt: "2026-07-22T22:32:00.000Z",
          }),
        ];

  return (
    <section className="queue-card">
      <div className="queue-header">
        <div>
          <h2>Run queue</h2>
          <p>Every crawl, dry run, and runtime execution in one audit trail.</p>
        </div>
        <button className="text-button">View all <span>→</span></button>
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
                    {run.mode === "dry_run" ? "Dry run" : run.mode}
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
  onLaunch: (urls: string[], mode: "crawl" | "dry_run") => Promise<void>;
  busy: boolean;
}) {
  const [urls, setUrls] = useState(
    "https://apply.example.org/housing-intake\nhttps://apply.example.org/benefits"
  );
  const [mode, setMode] = useState<"crawl" | "dry_run">("crawl");

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = urls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
    await onLaunch(values, mode);
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
            <span className="eyebrow">NEW ISOLATED SESSION</span>
            <h2 id="launch-title">Launch form discovery</h2>
            <p>One URL per line. Each target gets an isolated, resumable browser context.</p>
          </div>
          <button onClick={onClose} aria-label="Close launch dialog">×</button>
        </div>
        <form onSubmit={submit}>
          <label>
            Form URLs
            <textarea
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              spellCheck={false}
              required
            />
            <small>Up to 12 HTTP or HTTPS URLs in one batch</small>
          </label>
          <fieldset>
            <legend>Run mode</legend>
            <button
              type="button"
              className={mode === "crawl" ? "selected" : ""}
              onClick={() => setMode("crawl")}
            >
              <span>⌁</span>
              <strong>Crawl + map</strong>
              <small>Discover states, probe branches, generate contracts.</small>
            </button>
            <button
              type="button"
              className={mode === "dry_run" ? "selected" : ""}
              onClick={() => setMode("dry_run")}
            >
              <span>◌</span>
              <strong>Verified dry run</strong>
              <small>Replay known scripts without advancing the final submit.</small>
            </button>
          </fieldset>
          <div className="safety-callout">
            <span>✓</span>
            <div>
              <strong>Synthetic data is enforced</strong>
              <p>Final submit cannot be reached until the run is certified and a named operator records live approval.</p>
            </div>
          </div>
          <div className="launch-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Starting…" : "Launch session"} <span>→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ControlPlane() {
  const [runs, setRuns] = useState<FormRun[]>([fallbackRun]);
  const [activeRun, setActiveRun] = useState<FormRun>(fallbackRun);
  const [selectedNode, setSelectedNode] = useState("household");
  const [activeTab, setActiveTab] = useState<Tab>("Flow map");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [toast, setToast] = useState("");
  const [apiState, setApiState] = useState<"connecting" | "online" | "demo">(
    "connecting"
  );

  const node = useMemo(
    () => activeRun.nodes.find((item) => item.id === selectedNode) ?? activeRun.nodes[0],
    [activeRun, selectedNode]
  );

  useEffect(() => {
    let disposed = false;
    async function loadRuns() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
        if (!response.ok) throw new Error("API unavailable");
        const data = (await response.json()) as { runs: FormRun[] };
        if (disposed || !data.runs.length) return;
        setRuns(data.runs);
        setApiState("online");
        setActiveRun((current) => {
          const refreshed = data.runs.find((item) => item.id === current.id);
          return refreshed ?? data.runs[0];
        });
      } catch {
        if (!disposed) setApiState("demo");
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
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function launch(urls: string[], mode: "crawl" | "dry_run") {
    setLaunching(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls, mode }),
      });
      const data = (await response.json()) as { run?: FormRun; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error ?? "Unable to launch.");
      setRuns((current) => [data.run!, ...current]);
      setActiveRun(data.run);
      setSelectedNode(data.run.nodes[0]?.id ?? "welcome");
      setLaunchOpen(false);
      setToast(`${mode === "dry_run" ? "Dry run" : "Crawl"} launched for ${urls.length} target${urls.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to launch session.");
    } finally {
      setLaunching(false);
    }
  }

  async function runAction(action: "pause" | "resume" | "request_review") {
    try {
      const response = await fetch(`/api/runs/${activeRun.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Action failed.");
      const optimisticStatus =
        action === "pause" ? "paused" : action === "resume" ? "running" : "awaiting_review";
      const updated = { ...activeRun, status: optimisticStatus as RunStatus };
      setActiveRun(updated);
      setRuns((current) => current.map((run) => (run.id === updated.id ? updated : run)));
      setToast(
        action === "pause"
          ? "Run paused at the last verified checkpoint."
          : action === "resume"
            ? "Run resumed."
            : "Review requested."
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Action failed.");
    }
  }

  function chooseRun(run: FormRun) {
    setActiveRun(run);
    setSelectedNode(
      run.nodes.find((item) => item.status === "active")?.id ??
        run.nodes[0]?.id ??
        "welcome"
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">FORM OPERATIONS / RUNS</span>
            <h1>Form intelligence</h1>
          </div>
          <div className="topbar-actions">
            <div className={`environment-pill ${apiState}`}>
              <span />
              {apiState === "online"
                ? "Sandbox API online"
                : apiState === "connecting"
                  ? "Connecting"
                  : "Demo dataset"}
            </div>
            <button className="icon-button" aria-label="Notifications">
              <span>•</span>
              ♢
            </button>
            <button className="primary-button" onClick={() => setLaunchOpen(true)}>
              <span className="plus">+</span> New crawl
            </button>
          </div>
        </header>

        <section className="stats-grid" aria-label="Run summary">
          <StatCard label="Active sessions" value="03" detail="2 crawling · 1 paused" tone="green" />
          <StatCard label="Runtime ready" value="12" detail="+3 this week" tone="blue" />
          <StatCard label="Needs review" value="02" detail="1 CAPTCHA handoff" tone="amber" />
          <StatCard label="Drift detected" value="01" detail="Structure changed" tone="red" />
        </section>

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
                  <span>{activeRun.urls.length} targets</span>
                </div>
              </div>
            </div>
            <div className="run-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  runAction(activeRun.status === "paused" ? "resume" : "pause")
                }
              >
                {activeRun.status === "paused" ? "▶ Resume" : "Ⅱ Pause"}
              </button>
              <button className="secondary-button" onClick={() => runAction("request_review")}>
                Send to review
              </button>
              <button className="more-button" aria-label="More run actions">•••</button>
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
            <div><span>✓</span> Synthetic data only</div>
            <div><span>✓</span> Verify every write</div>
            <div><span>✓</span> Evidence masking active</div>
            <div className="locked"><span>⌕</span> Submit gate locked</div>
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
                {tab === "Diagnostics" && <span>2</span>}
              </button>
            ))}
          </div>

          <div className={`workspace workspace-${activeTab.toLowerCase().replaceAll(" ", "-")}`}>
            {activeTab === "Flow map" && (
              <>
                <div className="graph-panel">
                  <div className="graph-toolbar">
                    <div>
                      <span className="graph-live-dot" />
                      Live state graph
                      <small>{activeRun.nodes.length} states · 3 variants</small>
                    </div>
                    <div>
                      <span><i className="verified" /> Verified</span>
                      <span><i className="observed" /> Review</span>
                      <button aria-label="Fit graph">⊡</button>
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
            {activeTab === "Field contract" && <FieldsPanel />}
            {activeTab === "Evidence" && <EvidencePanel nodes={activeRun.nodes} />}
            {activeTab === "Diagnostics" && <DiagnosticsPanel run={activeRun} />}
          </div>
        </section>

        <Queue runs={runs} onSelect={chooseRun} />
        <footer className="app-footer">
          <span>FORMWEAVE CONTROL PLANE</span>
          <span>Executor contract v2.4 · Fingerprints use DOM facts only</span>
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
