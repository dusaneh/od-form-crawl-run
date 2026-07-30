"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AuditEvent = {
  id?: string;
  occurredAt: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  eventType: string;
  outcome: string;
  actorType: string;
  actorId?: string | null;
  scopeType?: string | null;
  scopeId?: string | null;
  parentScopeType?: string | null;
  parentScopeId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
};

type AuditPayload = {
  generatedAt: string;
  windowHours: number;
  summary: {
    total: number;
    successes: number;
    warnings: number;
    failures: number;
    loginSuccesses: number;
    loginFailures: number;
    crawlsCompleted: number;
    crawlsFailed: number;
    executionsCompleted: number;
    executionsFailed: number;
  };
  byCategory: { category: string; count: number }[];
  topActors: {
    actorType: string;
    actorId: string;
    count: number;
    lastSeenAt: string;
  }[];
  events: AuditEvent[];
};

function apiBase() {
  if (typeof window === "undefined") return "";
  return ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    window.location.port === "3000"
    ? "http://127.0.0.1:8787"
    : "";
}

function compactTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function displayActor(event: AuditEvent) {
  return event.actorId || (event.actorType === "system" ? "System" : "Unknown");
}

export function AuditDashboard() {
  const [hours, setHours] = useState("24");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ hours, limit: "250" });
    if (category) query.set("category", category);
    if (severity) query.set("severity", severity);
    try {
      const response = await fetch(
        `${apiBase()}/api/ops/audit?${query.toString()}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Audit API returned ${response.status}.`);
      }
      setData(payload.audit as AuditPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [category, hours, severity]);

  useEffect(() => {
    void load();
  }, [load]);

  const authEvents = useMemo(
    () => data?.events.filter((event) => event.category === "authentication") || [],
    [data],
  );
  const failureRate = data?.summary.total
    ? Math.round((data.summary.failures / data.summary.total) * 100)
    : 0;

  return (
    <main className="audit-dashboard-shell">
      <header className="audit-dashboard-header">
        <div>
          <span>FORMWEAVE OPERATIONS</span>
          <h1>Audit and reliability dashboard</h1>
          <p>
            Critical authentication, crawl, approval, and execution outcomes.
            Applicant values and request bodies are intentionally excluded.
          </p>
        </div>
        <div className={`audit-dashboard-live${error ? " error" : ""}`}>
          <i />
          <span>
            {loading
              ? "Refreshing"
              : error
                ? "Audit stream unavailable"
                : "Audit stream online"}
          </span>
          <small>
            {data?.generatedAt ? `As of ${compactTime(data.generatedAt)}` : "—"}
          </small>
        </div>
      </header>

      <section className="audit-dashboard-filters" aria-label="Audit filters">
        <label>
          Window
          <select value={hours} onChange={(event) => setHours(event.target.value)}>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
            <option value="2160">Last 90 days</option>
          </select>
        </label>
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            <option value="authentication">Authentication</option>
            <option value="api">API</option>
            <option value="crawl">Crawl</option>
            <option value="approval">Approval</option>
            <option value="execution">Execution</option>
          </select>
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">All severities</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Failure</option>
            <option value="info">Information</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </section>

      {error && (
        <section className="audit-dashboard-error" role="alert">
          <strong>Dashboard unavailable</strong>
          <span>{error}</span>
        </section>
      )}

      <section className="audit-dashboard-metrics">
        <article>
          <span>Events</span>
          <strong>{data?.summary.total ?? "—"}</strong>
          <small>Critical retained outcomes</small>
        </article>
        <article className="success">
          <span>Successes</span>
          <strong>{data?.summary.successes ?? "—"}</strong>
          <small>Verified positive milestones</small>
        </article>
        <article className="warning">
          <span>Warnings</span>
          <strong>{data?.summary.warnings ?? "—"}</strong>
          <small>Review or blocked outcomes</small>
        </article>
        <article className="failure">
          <span>Failures</span>
          <strong>{data?.summary.failures ?? "—"}</strong>
          <small>{failureRate}% of visible events</small>
        </article>
      </section>

      <section className="audit-dashboard-grid">
        <article className="audit-dashboard-panel audit-flow-panel">
          <header>
            <div>
              <span>PIPELINE HEALTH</span>
              <h2>Crawl through execution</h2>
            </div>
          </header>
          <div className="audit-flow">
            <div>
              <span>Crawls completed</span>
              <strong>{data?.summary.crawlsCompleted ?? "—"}</strong>
              <small>{data?.summary.crawlsFailed ?? 0} failed</small>
            </div>
            <b>→</b>
            <div>
              <span>Executions completed</span>
              <strong>{data?.summary.executionsCompleted ?? "—"}</strong>
              <small>{data?.summary.executionsFailed ?? 0} failed</small>
            </div>
          </div>
          <div className="audit-category-bars">
            {(data?.byCategory || []).map((item) => (
              <div key={item.category}>
                <span>{item.category}</span>
                <i
                  style={{
                    width: `${Math.max(
                      6,
                      Math.round(
                        (item.count / Math.max(1, data?.summary.total || 1)) * 100,
                      ),
                    )}%`,
                  }}
                />
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="audit-dashboard-panel">
          <header>
            <div>
              <span>ACCESS</span>
              <h2>Login activity</h2>
            </div>
          </header>
          <div className="audit-login-totals">
            <div>
              <strong>{data?.summary.loginSuccesses ?? "—"}</strong>
              <span>Successful</span>
            </div>
            <div>
              <strong>{data?.summary.loginFailures ?? "—"}</strong>
              <span>Failed or locked</span>
            </div>
          </div>
          <div className="audit-login-list">
            {authEvents.slice(0, 6).map((event) => (
              <div key={event.id || `${event.occurredAt}-${event.eventType}`}>
                <i className={event.severity} />
                <span>
                  <strong>{displayActor(event)}</strong>
                  <small>{event.message}</small>
                </span>
                <time>{compactTime(event.occurredAt)}</time>
              </div>
            ))}
            {!authEvents.length && <p>No login activity in this window.</p>}
          </div>
        </article>

        <article className="audit-dashboard-panel audit-actors-panel">
          <header>
            <div>
              <span>ATTRIBUTION</span>
              <h2>Most active identities</h2>
            </div>
          </header>
          <div className="audit-actor-list">
            {(data?.topActors || []).map((actor) => (
              <div key={`${actor.actorType}-${actor.actorId}`}>
                <span className={actor.actorType}>{actor.actorType}</span>
                <strong>{actor.actorId}</strong>
                <small>{actor.count} events</small>
              </div>
            ))}
            {!data?.topActors.length && <p>No attributed activity yet.</p>}
          </div>
        </article>
      </section>

      <section className="audit-dashboard-panel audit-event-panel">
        <header>
          <div>
            <span>DIAGNOSTIC TIMELINE</span>
            <h2>Critical event stream</h2>
          </div>
          <small>{data?.events.length || 0} shown</small>
        </header>
        <div className="audit-event-table">
          {(data?.events || []).map((event) => (
            <details key={event.id || `${event.occurredAt}-${event.eventType}`}>
              <summary>
                <i className={event.severity} />
                <time>{compactTime(event.occurredAt)}</time>
                <span className="category">{event.category}</span>
                <strong>{event.message}</strong>
                <span className="actor">
                  {event.actorType} · {displayActor(event)}
                </span>
                <code>{event.scopeId || "—"}</code>
              </summary>
              <div>
                <dl>
                  <dt>Event</dt>
                  <dd>{event.eventType}</dd>
                  <dt>Outcome</dt>
                  <dd>{event.outcome}</dd>
                  <dt>Scope</dt>
                  <dd>
                    {event.scopeType || "—"} · {event.scopeId || "—"}
                  </dd>
                </dl>
                <pre>{JSON.stringify(event.metadata || {}, null, 2)}</pre>
              </div>
            </details>
          ))}
          {!loading && !data?.events.length && (
            <div className="audit-dashboard-empty">
              No critical events match these filters.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
