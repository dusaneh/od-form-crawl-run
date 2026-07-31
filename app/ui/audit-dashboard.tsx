"use client";

import { useCallback, useEffect, useState } from "react";

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
  availableUsers: {
    actorId: string;
    displayName: string;
  }[];
  loginSummary: {
    successes: number;
    failures: number;
  };
  loginHistory: AuditEvent[];
  llmTelemetry: {
    count: number;
    completed: number;
    failed: number;
    timedOut: number;
    averageDurationMs: number | null;
    p50DurationMs: number | null;
    p95DurationMs: number | null;
    maxDurationMs: number | null;
    byType: {
      callType: string;
      count: number;
      completed: number;
      failed: number;
      timedOut: number;
      averageDurationMs: number | null;
      p50DurationMs: number | null;
      p95DurationMs: number | null;
      maxDurationMs: number | null;
    }[];
    recent: {
      occurredAt: string;
      callType: string;
      outcome: string;
      durationMs: number | null;
      model: string | null;
      promptVersion: string | null;
      scopeId: string | null;
    }[];
  };
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

function duration(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} s`;
}

function callTypeLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function AuditDashboard() {
  const [hours, setHours] = useState("24");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [actorId, setActorId] = useState("");
  const [loginHours, setLoginHours] = useState(String(24 * 90));
  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      hours,
      limit: "250",
      loginHours,
      loginLimit: "100",
    });
    if (category) query.set("category", category);
    if (severity) query.set("severity", severity);
    if (actorId) query.set("actorId", actorId);
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
  }, [actorId, category, hours, loginHours, severity]);

  useEffect(() => {
    void load();
  }, [load]);

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
            <option value="4320">Last 180 days</option>
            <option value="8760">Last year</option>
            <option value="43800">All retained (up to 5 years)</option>
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
            <option value="llm">LLM calls</option>
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
        <label>
          User
          <select value={actorId} onChange={(event) => setActorId(event.target.value)}>
            <option value="">All users</option>
            {(data?.availableUsers || []).map((user) => (
              <option key={user.actorId} value={user.actorId}>
                {user.displayName === user.actorId
                  ? user.actorId
                  : `${user.displayName} · ${user.actorId}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Login history
          <select
            value={loginHours}
            onChange={(event) => setLoginHours(event.target.value)}
          >
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
            <option value="2160">Last 90 days</option>
            <option value="8760">Last year</option>
            <option value="43800">All retained (up to 5 years)</option>
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
            <small>{data?.loginHistory.length || 0} most recent shown</small>
          </header>
          <div className="audit-login-totals">
            <div>
              <strong>{data?.loginSummary.successes ?? "—"}</strong>
              <span>Successful</span>
            </div>
            <div>
              <strong>{data?.loginSummary.failures ?? "—"}</strong>
              <span>Failed or locked</span>
            </div>
          </div>
          <div className="audit-login-list">
            {(data?.loginHistory || []).map((event) => (
              <div key={event.id || `${event.occurredAt}-${event.eventType}`}>
                <i className={event.severity} />
                <span>
                  <strong>{displayActor(event)}</strong>
                  <small>{event.message}</small>
                </span>
                <time>{compactTime(event.occurredAt)}</time>
              </div>
            ))}
            {!data?.loginHistory.length && (
              <p>No login activity in the selected login-history window.</p>
            )}
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

      <section className="audit-dashboard-panel audit-llm-panel">
        <header>
          <div>
            <span>MODEL LATENCY</span>
            <h2>LLM calls by type</h2>
            <p>
              Timing and outcomes only. Prompts, screenshots, form values, and
              credentials are not retained in this telemetry.
            </p>
          </div>
          <small>{data?.llmTelemetry.count || 0} calls in this window</small>
        </header>
        <div className="audit-llm-summary">
          <div>
            <span>Average</span>
            <strong>{duration(data?.llmTelemetry.averageDurationMs)}</strong>
          </div>
          <div>
            <span>Median (p50)</span>
            <strong>{duration(data?.llmTelemetry.p50DurationMs)}</strong>
          </div>
          <div>
            <span>Slow end (p95)</span>
            <strong>{duration(data?.llmTelemetry.p95DurationMs)}</strong>
          </div>
          <div>
            <span>Timed out</span>
            <strong>{data?.llmTelemetry.timedOut ?? "—"}</strong>
          </div>
        </div>
        <div className="audit-llm-types">
          {(data?.llmTelemetry.byType || []).map((item) => (
            <div key={item.callType}>
              <strong>{callTypeLabel(item.callType)}</strong>
              <span>{item.count} calls</span>
              <span>avg {duration(item.averageDurationMs)}</span>
              <span>p95 {duration(item.p95DurationMs)}</span>
              <span>{item.timedOut} timed out</span>
              <span>{item.failed} failed</span>
            </div>
          ))}
          {!data?.llmTelemetry.byType.length && (
            <p>No completed or failed LLM calls have been recorded in this window.</p>
          )}
        </div>
        {!!data?.llmTelemetry.recent.length && (
          <div className="audit-llm-recent">
            <h3>Recent calls</h3>
            {data.llmTelemetry.recent.map((call, index) => (
              <div
                key={`${call.occurredAt}-${call.callType}-${call.scopeId || index}`}
              >
                <time>{compactTime(call.occurredAt)}</time>
                <strong>{callTypeLabel(call.callType)}</strong>
                <span className={call.outcome}>{call.outcome.replaceAll("_", " ")}</span>
                <span>{duration(call.durationMs)}</span>
                <code>{call.scopeId || "—"}</code>
              </div>
            ))}
          </div>
        )}
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
