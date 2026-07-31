function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

function roundedAverage(values) {
  if (!values.length) return null;
  return Math.round(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
}

function normalizedCall(event) {
  const metadata =
    event?.metadata && typeof event.metadata === "object"
      ? event.metadata
      : {};
  const durationMs = Number(metadata.durationMs);
  return {
    occurredAt: event.occurredAt,
    callType: String(metadata.callType || "unknown"),
    outcome: String(event.outcome || "observed"),
    durationMs:
      Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    model: metadata.model ? String(metadata.model) : null,
    promptVersion: metadata.promptVersion
      ? String(metadata.promptVersion)
      : null,
    scopeId: event.scopeId || null,
  };
}

export function summarizeLlmTelemetry(events, { recentLimit = 20 } = {}) {
  const calls = (events || []).map(normalizedCall);
  const groups = new Map();
  for (const call of calls) {
    const current = groups.get(call.callType) || [];
    current.push(call);
    groups.set(call.callType, current);
  }
  const summarize = (items) => {
    const durations = items
      .map((item) => item.durationMs)
      .filter((value) => value !== null);
    return {
      count: items.length,
      completed: items.filter((item) => item.outcome === "completed").length,
      failed: items.filter((item) => item.outcome === "failed").length,
      timedOut: items.filter((item) => item.outcome === "timed_out").length,
      averageDurationMs: roundedAverage(durations),
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      maxDurationMs: durations.length ? Math.max(...durations) : null,
    };
  };
  return {
    ...summarize(calls),
    byType: [...groups.entries()]
      .map(([callType, items]) => ({
        callType,
        ...summarize(items),
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.callType.localeCompare(right.callType),
      ),
    recent: calls.slice(0, recentLimit),
  };
}
