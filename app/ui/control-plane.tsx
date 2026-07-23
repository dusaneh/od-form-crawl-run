"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { FlowEdge, FlowNode, FormRun, RunStatus } from "../lib/models";

const tabs = ["Flow map", "Field contract", "Evidence", "Diagnostics"] as const;
type Tab = (typeof tabs)[number];

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

function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const nav = [["⌁", "Runs"]];

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
    ["Fetch pages", 58],
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
        // The evidence route is private and cannot be delegated to the public image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="evidence-image"
          src={node.evidence}
          alt={`Captured public page for ${node.title}`}
          loading="lazy"
        />
      ) : (
        <div className="evidence-empty">
          <span>NO CAPTURE</span>
          <strong>{node.title}</strong>
          <small>{node.sourceUrl ? shortHost(node.sourceUrl) : "Waiting for crawler"}</small>
        </div>
      )}
      <span className="evidence-watermark">
        {node.evidenceAvailable ? "REAL CAPTURE · NO VALUES ENTERED" : "EVIDENCE UNAVAILABLE"}
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
        <span>Read-only public-page evidence</span>
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

function FieldsPanel({ run }: { run: FormRun }) {
  const fields = run.contract ?? [];
  const visibleFields = fields.filter((field) => !field.hidden);
  const required = visibleFields.filter((field) => field.required).length;
  const sensitive = visibleFields.filter((field) => field.sensitive).length;

  return (
    <div className="contract-panel">
      <div className="contract-summary">
        <div>
          <span>OBSERVED CONTRACT</span>
          <strong>{visibleFields.length} fields</strong>
          <small>Extracted from fetched HTML</small>
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
            {visibleFields.map((field, index) => (
              <tr key={`${field.originState}-${field.key}-${index}`}>
                <td>
                  <code>{field.key}</code>
                </td>
                <td>{field.control}</td>
                <td>
                  <span className={`field-pill ${field.required ? "required" : ""}`}>
                    {field.required ? "required" : "optional"}
                  </span>
                  {field.sensitive && <span className="field-pill sensitive">sensitive</span>}
                  {field.options > 0 && <span className="field-pill">{field.options} options</span>}
                </td>
                <td>{field.originState}</td>
              </tr>
            ))}
            {!visibleFields.length && (
              <tr>
                <td colSpan={4} className="empty-table-cell">
                  No visible form fields were found in the fetched HTML.
                </td>
              </tr>
            )}
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
              {node.evidenceAvailable ? "captured" : "unavailable"} · {node.fingerprint}
            </span>
          </div>
        </article>
      ))}
      {!nodes.length && <p className="empty-panel-copy">Evidence will appear after a page is fetched.</p>}
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
  onLaunch: (urls: string[], mode: "crawl" | "dry_run") => Promise<void>;
  busy: boolean;
}) {
  const [urls, setUrls] = useState("");

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = urls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
    await onLaunch(values, "crawl");
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
            <span className="eyebrow">NEW READ-ONLY CRAWL</span>
            <h2 id="launch-title">Fetch and map public forms</h2>
            <p>One URL per line. FormWeave fetches the actual page and stores crawl evidence.</p>
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
            <small>Up to 12 public HTTP or HTTPS URLs; private-network targets are blocked</small>
          </label>
          <div className="safety-callout">
            <span>✓</span>
            <div>
              <strong>Read-only by construction</strong>
              <p>No fields are filled and no form is submitted. Use only public, non-tokenized URLs; screenshots use a fresh unauthenticated capture.</p>
            </div>
          </div>
          <div className="launch-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Starting…" : "Launch crawl"} <span>→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ControlPlane() {
  const [runs, setRuns] = useState<FormRun[]>([]);
  const [activeRun, setActiveRun] = useState<FormRun | null>(null);
  const [selectedNode, setSelectedNode] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Flow map");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
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
    async function loadRuns() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
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

  async function runAction(action: "request_review") {
    if (!activeRun) return;
    try {
      const response = await fetch(`/api/runs/${activeRun.id}`, {
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

  function chooseRun(run: FormRun) {
    setActiveRun(run);
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
                ? "Crawler API online"
                : apiState === "connecting"
                  ? "Connecting"
                  : "Crawler API unavailable"}
            </div>
            <button className="primary-button" onClick={() => setLaunchOpen(true)}>
              <span className="plus">+</span> New crawl
            </button>
          </div>
        </header>

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
                </div>
              </div>
            </div>
            <div className="run-actions">
              {activeRun.reportAvailable && (
                <a
                  className="secondary-button button-link"
                  href={`/api/runs/${encodeURIComponent(activeRun.id)}/report`}
                >
                  Download report
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
            <div><span>✓</span> Real public-page fetch</div>
            <div><span>✓</span> No form values entered</div>
            <div><span>✓</span> Evidence stored privately</div>
            <div className="locked"><span>⌕</span> Form submission disabled</div>
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
                {tab === "Diagnostics" && <span>{activeRun.findings.length}</span>}
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
            {activeTab === "Field contract" && <FieldsPanel run={activeRun} />}
            {activeTab === "Evidence" && <EvidencePanel nodes={activeRun.nodes} />}
            {activeTab === "Diagnostics" && <DiagnosticsPanel run={activeRun} />}
          </div>
        </section>
        ) : (
          <section className="empty-run-card">
            <span className="eyebrow">NO REAL CRAWLS YET</span>
            <h2>Start with a public form URL</h2>
            <p>FormWeave will fetch the page, extract its actual controls, capture evidence, and produce a downloadable report.</p>
            <button className="primary-button" onClick={() => setLaunchOpen(true)}>
              <span className="plus">+</span> Launch first crawl
            </button>
          </section>
        )}

        <Queue runs={runs} onSelect={chooseRun} />
        <footer className="app-footer">
          <span>FORMWEAVE CONTROL PLANE</span>
          <span>Read-only crawler v1 · Fingerprints use fetched form facts</span>
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
