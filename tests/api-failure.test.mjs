import assert from "node:assert/strict";
import test from "node:test";

import { apiFailureFrom } from "../app/lib/api-failure.ts";

test("successful API payloads are not reported as failures", () => {
  assert.equal(
    apiFailureFrom(200, {
      run: { status: "completed", findings: [{ tone: "info", code: "done" }] },
    }),
    null,
  );
});

test("failed crawl payloads expose every concrete cause in plain language", () => {
  const failure = apiFailureFrom(200, {
    run: {
      status: "failed",
      stage: "Artifact quality floor failed",
      findings: [
        {
          tone: "warning",
          code: "crawl_finished",
          title: "0 pages fetched",
          detail: "0 pages were fetched.",
        },
        {
          tone: "danger",
          code: "fetch_failed",
          title: "Could not fetch target",
          detail: "OpenAI semantic generation was incomplete: max_output_tokens.",
        },
        {
          tone: "danger",
          code: "quality_floor",
          title: "No durable artifact produced",
          detail: "All target fetches or rendered-DOM extractions failed.",
        },
      ],
      nodes: [
        {
          status: "review",
          title: "Target page",
          subtitle: "Fetch failed",
          notes: [
            "OpenAI semantic generation was incomplete: max_output_tokens.",
            "Screenshot capture was unavailable; crawl data is still preserved.",
          ],
        },
      ],
    },
  });

  assert.ok(failure);
  assert.equal(failure.status, 200);
  assert.equal(failure.code, "openai_output_limit");
  assert.deepEqual(
    failure.issues.map((issue) => issue.code),
    [
      "openai_output_limit",
      "quality_floor",
      "fetch_failed",
      "screenshot_unavailable",
    ],
  );
  assert.match(failure.issues[0].title, /AI script generation/i);
  assert.doesNotMatch(failure.issues[0].detail, /max_output_tokens/);
});

test("informational findings are excluded from interrupted crawl failures", () => {
  const failure = apiFailureFrom(200, {
    run: {
      status: "failed",
      stage: "Interrupted by local service restart",
      findings: [
        { tone: "info", code: "crawl_queued", detail: "Crawl queued." },
        {
          tone: "danger",
          code: "crawl_interrupted",
          detail: "The local API stopped before this crawl completed.",
        },
      ],
    },
  });

  assert.ok(failure);
  assert.deepEqual(failure.issues.map((issue) => issue.code), [
    "crawl_interrupted",
  ]);
});

test("browser capacity failures explain when a retry is safe", () => {
  const failure = apiFailureFrom(429, {
    code: "crawl_capacity_reached",
    error:
      "Another browser run is already in progress. Wait for it to finish before starting a new run.",
    limit: 1,
    activeRun: { id: "run_active", kind: "crawl" },
  });

  assert.ok(failure);
  assert.equal(failure.code, "crawl_capacity_reached");
  assert.equal(failure.issues[0].title, "Another browser run is already in progress");
  assert.match(failure.issues[0].detail, /wait for it to finish/i);
});

test("HTTP and execution failures include nested response issues", () => {
  const httpFailure = apiFailureFrom(422, {
    code: "validation_blocked",
    error: "The request data did not satisfy the form schema.",
    issues: [
      { code: "type_mismatch", detail: "Age must be a number." },
      { code: "required_field_not_actuated", detail: "Consent is required." },
    ],
  });
  assert.ok(httpFailure);
  assert.deepEqual(httpFailure.issues.map((issue) => issue.code), [
    "validation_blocked",
    "type_mismatch",
    "required_field_not_actuated",
  ]);

  const executionFailure = apiFailureFrom(200, {
    execution: {
      status: "failed",
      failureCode: "actuation_unverified",
      detail: "Exact readback did not match the requested value.",
      issues: [
        {
          failureCode: "locator_unresolved",
          detail: "No contract-scoped locator resolved uniquely.",
        },
      ],
    },
  });
  assert.ok(executionFailure);
  assert.deepEqual(executionFailure.issues.map((issue) => issue.code), [
    "actuation_unverified",
    "locator_unresolved",
  ]);
});
