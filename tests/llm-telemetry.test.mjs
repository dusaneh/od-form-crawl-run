import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLlmTelemetry } from "../local/audit/llm-telemetry.mjs";

test("LLM telemetry groups latency and outcomes without retaining model inputs", () => {
  const summary = summarizeLlmTelemetry([
    {
      occurredAt: "2026-07-30T00:00:03.000Z",
      outcome: "timed_out",
      scopeId: "run_1",
      metadata: {
        callType: "semantic_state_generation",
        durationMs: 360_000,
        model: "gpt-5.4-mini",
      },
    },
    {
      occurredAt: "2026-07-30T00:00:02.000Z",
      outcome: "completed",
      scopeId: "run_1",
      metadata: {
        callType: "semantic_state_generation",
        durationMs: 4_000,
        model: "gpt-5.4-mini",
      },
    },
    {
      occurredAt: "2026-07-30T00:00:01.000Z",
      outcome: "completed",
      scopeId: "run_1",
      metadata: {
        callType: "dynamics_classification",
        durationMs: 2_000,
        model: "gpt-5.4-mini",
      },
    },
  ]);

  assert.equal(summary.count, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.timedOut, 1);
  assert.equal(summary.p50DurationMs, 4_000);
  assert.equal(summary.p95DurationMs, 360_000);
  assert.equal(summary.byType[0].callType, "semantic_state_generation");
  assert.equal(summary.byType[0].timedOut, 1);
  assert.deepEqual(Object.keys(summary.recent[0]).sort(), [
    "callType",
    "durationMs",
    "model",
    "occurredAt",
    "outcome",
    "promptVersion",
    "scopeId",
  ]);
});
