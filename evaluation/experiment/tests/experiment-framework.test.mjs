import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildEvaluationPlan } from "../core.mjs";
import { appendRegistryEvent, rebuildRegistry } from "../registry.mjs";
import { launchFormweaveRun, validateFrozenPlanCatalog } from "../run-experiment.mjs";
import {
  aggregateExperimentScores,
  draftLearnings,
  orderedExpectedFields,
  scoreV1Trial,
} from "../score-v1.mjs";

test("frozen plans tolerate additive catalog metadata changes when execution boundaries are unchanged", () => {
  const plan = {
    catalogRevision: "sha256:old",
    scenarios: {
      "site_a/primary": {
        fixtureRevision: "sha256:fixture",
        entryUrl: "https://example.test/site_a/intake",
        groundTruthUrl: "https://example.test/api/v1/sites/site_a/scenarios/primary/ground-truth",
      },
    },
  };
  const catalog = {
    catalog_revision: "sha256:new",
    scenarios: [{
      site_id: "site_a",
      scenario_id: "primary",
      enabled: true,
      fixture_revision: "sha256:fixture",
      entry_url: "https://example.test/site_a/intake",
      ground_truth_url: "https://example.test/api/v1/sites/site_a/scenarios/primary/ground-truth",
      complexity: 42,
    }],
  };
  assert.deepEqual(validateFrozenPlanCatalog(plan, catalog), {
    revisionChanged: true,
    liveCatalogRevision: "sha256:new",
  });
  catalog.scenarios[0].fixture_revision = "sha256:changed";
  assert.throws(
    () => validateFrozenPlanCatalog(plan, catalog),
    /fixture revision changed/,
  );
});

test("experiment runner waits for the managed API browser slot to become idle", async () => {
  let createAttempts = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/api/runs") {
      createAttempts += 1;
      if (createAttempts < 3) {
        response.statusCode = 429;
        response.end(JSON.stringify({
          error: "Another browser run is already in progress.",
          code: "crawl_capacity_reached",
        }));
        return;
      }
      response.end(JSON.stringify({ run: { id: "run_capacity_test" } }));
      return;
    }
    if (request.url === "/api/runs/run_capacity_test/report") {
      response.end(JSON.stringify({ id: "report_capacity_test" }));
      return;
    }
    if (request.url === "/api/runs/run_capacity_test") {
      response.end(JSON.stringify({ run: { id: "run_capacity_test", status: "completed" } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const result = await launchFormweaveRun({
      apiOrigin: `http://127.0.0.1:${address.port}`,
      entryUrl: "https://fixtures.test/intake",
      label: "capacity retry test",
      configuration: {
        appExecutionMode: "fixture_submit",
        browserMode: "headless",
        timeoutMs: 10_000,
      },
    });
    assert.equal(createAttempts, 3);
    assert.equal(result.run.status, "completed");
    assert.equal(result.report.id, "report_capacity_test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function catalog(count = 12) {
  return {
    schema_version: "1.0",
    catalog_revision: "sha256:test-catalog",
    scenario_count: count,
    scenarios: Array.from({ length: count }, (_, index) => ({
      site_id: `site_${String(index).padStart(2, "0")}`,
      scenario_id: "primary",
      enabled: true,
      entry_url: `https://fixtures.test/site_${String(index).padStart(2, "0")}/intake`,
      ground_truth_url: `https://fixtures.test/api/v1/sites/site_${String(index).padStart(2, "0")}/scenarios/primary/ground-truth`,
      fixture_revision: `sha256:fixture-${index}`,
      feature_tags: [`family_${index % 4}`, ...(index % 5 === 0 ? ["rare_gate"] : [])],
      complexity: Math.round((index * 100) / Math.max(1, count - 1)),
    })),
  };
}

function completeFixture() {
  const oracle = {
    schema_version: "1.0",
    site_id: "site_fixture",
    scenario_id: "primary",
    fixture_revision: "sha256:fixture",
    expected: {
      outcome: { kind: "complete", reason_codes: [], terminal_submission: "allowed" },
      pages: [
        {
          page_id: "intake",
          ordinal: 0,
          url: { kind: "exact", value: "/site_fixture/intake" },
          role: "form_step",
          terminal: true,
        },
      ],
      forms: [
        { form_id: "application", page_id: "intake", ordinal: 0, role: "target", container_kind: "form", name: null },
      ],
      sections: [],
      frames: [],
      repeaters: [],
      barriers: [],
      signals: [],
      privacy_assertions: [],
      branches: [],
      interactions: [
        {
          interaction_id: "submit",
          page_id: "intake",
          ordinal: 0,
          kind: "terminal_submit",
          phase: "submission",
          target_ref: "form:application",
          required: true,
          effects: [],
        },
      ],
      fields: [
        {
          field_id: "email",
          page_id: "intake",
          form_id: "application",
          ordinal: 0,
          name: "email",
          label: "Email",
          control_type: "email",
          requiredness: { mode: "always", condition_id: null },
          sensitive: false,
          administrative: false,
          consent: false,
          canonical_key: "email",
          initial_state: "visible",
          options: [],
        },
      ],
      submission: {
        enabled: true,
        capture_scope: "final_page_only",
        allow_unlisted_keys: false,
        ignored_keys: [],
        field_rules: [
          {
            field_id: "email",
            key: "email",
            cardinality: "scalar",
            presence: "always",
            encoding: "raw",
            normalization: "exact",
          },
        ],
        success_marker: { selector: "[data-success]", attribute: "data-success", value: "verified" },
      },
    },
  };
  const report = {
    executionMode: "fixture_submit",
    pages: [
      {
        finalUrl: "https://fixtures.test/site_fixture/intake",
        forms: 1,
        frameCount: 0,
        submissionsAttempted: 1,
        submissionsSucceeded: 1,
        branchStates: 0,
      },
    ],
    contract: [
      {
        name: "email",
        id: "email",
        label: "Email",
        control: "email",
        required: true,
        sensitive: false,
        canonicalProfileKey: "email",
        hidden: false,
        optionSet: [],
        entryStatus: "entered",
        testValue: "person@example.test",
      },
    ],
    findings: [{ code: "crawl_finished" }],
    nodes: [],
  };
  const submission = {
    evaluation_id: "eval_0123456789abcdef",
    fixture_revision: "sha256:fixture",
    success_marker: "implied_by_capture_200",
    fields: { email: "person@example.test" },
  };
  return { oracle, report, submission };
}

test("field-order scoring respects page and form scope when ordinals restart", () => {
  const { oracle, report } = completeFixture();
  oracle.expected.pages = [
    {
      page_id: "step_one",
      ordinal: 0,
      url: { kind: "exact", value: "/site_fixture/step-one" },
      role: "form_step",
      terminal: false,
    },
    {
      page_id: "step_two",
      ordinal: 1,
      url: { kind: "exact", value: "/site_fixture/step-two" },
      role: "form_step",
      terminal: true,
    },
  ];
  oracle.expected.forms = [
    { form_id: "form_one", page_id: "step_one", ordinal: 0, role: "target", container_kind: "form", name: null },
    { form_id: "form_two", page_id: "step_two", ordinal: 0, role: "target", container_kind: "form", name: null },
  ];
  const makeField = (fieldId, pageId, formId, ordinal) => ({
    field_id: fieldId,
    page_id: pageId,
    form_id: formId,
    ordinal,
    name: fieldId,
    label: fieldId,
    control_type: "text",
    requiredness: { mode: "never", condition_id: null },
    sensitive: false,
    administrative: false,
    consent: false,
    canonical_key: null,
    initial_state: "visible",
    options: [],
  });
  oracle.expected.fields = [
    makeField("first_0", "step_one", "form_one", 0),
    makeField("first_1", "step_one", "form_one", 1),
    makeField("second_0", "step_two", "form_two", 0),
    makeField("second_1", "step_two", "form_two", 1),
  ];
  oracle.expected.submission.enabled = false;
  oracle.expected.submission.field_rules = [];
  report.pages = [
    { finalUrl: "https://fixtures.test/site_fixture/step-one", forms: 1, frameCount: 0, submissionsAttempted: 0, submissionsSucceeded: 0, branchStates: 0 },
    { finalUrl: "https://fixtures.test/site_fixture/step-two", forms: 1, frameCount: 0, submissionsAttempted: 0, submissionsSucceeded: 0, branchStates: 0 },
  ];
  report.contract = oracle.expected.fields.map((field) => ({
    name: field.name,
    id: field.name,
    label: field.label,
    control: "text",
    required: false,
    sensitive: false,
    canonicalProfileKey: "unmappable",
    hidden: false,
    optionSet: [],
    entryStatus: "not_attempted",
  }));

  assert.deepEqual(
    orderedExpectedFields(oracle.expected).map((field) => field.name),
    ["first_0", "first_1", "second_0", "second_1"],
  );
  const score = scoreV1Trial({
    oracle,
    report,
    run: { id: "run_order" },
    submission: null,
    rawArtifactHash: "sha256:raw",
    rawArtifactRoot: "raw",
  });
  assert.equal(
    score.checks.find((check) => check.id === "structure.field_order").score,
    1,
  );
});

test("v1 plans produce deterministic feature-balanced multi-batch configurations", () => {
  const input = {
    seed: "repeatable",
    batchSize: 5,
    batchCount: 3,
    trials: 2,
  };
  const first = buildEvaluationPlan(catalog(), input);
  const second = buildEvaluationPlan(catalog(), input);
  assert.equal(first.configurationId, second.configurationId);
  assert.equal(first.planId, second.planId);
  assert.deepEqual(first.batches, second.batches);
  assert.equal(first.batches.length, 3);
  assert.ok(first.batches.every((batch) => batch.scenarioKeys.length === 5));
  assert.ok(first.batches.every((batch) => new Set(batch.scenarioKeys).size === 5));
  const usage = new Map();
  first.batches.flatMap((batch) => batch.scenarioKeys).forEach((key) => usage.set(key, (usage.get(key) || 0) + 1));
  assert.ok(Math.max(...usage.values()) - Math.min(...usage.values()) <= 1);
  assert.equal(first.oracleIsolation.groundTruthFetchedAfterRawFreeze, true);
});

test("complexity-stratified plans distribute a 49-scenario catalog across seven balanced batches", () => {
  const plan = buildEvaluationPlan(catalog(49), {
    seed: "complexity-repeatable",
    batchSize: 7,
    batchCount: 7,
    trials: 1,
    selectionAlgorithm: "complexity-stratified-v1",
  });
  assert.equal(plan.configuration.selectionAlgorithm, "complexity-stratified-v1");
  assert.equal(plan.batches.length, 7);
  assert.ok(plan.batches.every((batch) => batch.scenarioKeys.length === 7));
  const selected = plan.batches.flatMap((batch) => batch.scenarioKeys);
  assert.equal(new Set(selected).size, 49);
  const means = plan.batches.map((batch) => batch.complexity.mean);
  assert.ok(Math.max(...means) - Math.min(...means) <= 5);
  assert.ok(
    plan.batches.every(
      (batch) =>
        batch.complexity.minimum <= 15 && batch.complexity.maximum >= 85,
    ),
  );
});

test("the v1 scorer produces a single comprehensive 100 score for a correct capture", () => {
  const fixture = completeFixture();
  const score = scoreV1Trial({
    ...fixture,
    run: { id: "run_test" },
    rawArtifactHash: "abc123",
    rawArtifactRoot: "batches/batch-01/site_fixture/primary/trial-01/raw",
  });
  assert.equal(score.overallScore, 100);
  assert.equal(score.status, "pass");
  assert.equal(score.strictPass, true);
  assert.equal(score.safetyPass, true);
  assert.ok(score.checks.length >= 12);
  const aggregate = aggregateExperimentScores([score]);
  assert.equal(aggregate.overallScore, 100);
  assert.equal(aggregate.status, "pass");
  const learnings = draftLearnings({ experimentId: "exp_test", trials: [score] });
  assert.ok(learnings.tests[0].worked.length > 0);
  assert.equal(learnings.tests[0].failed.length, 0);
});

test("scoring deductions identify the exact field attribute and captured value", () => {
  const fixture = completeFixture();
  fixture.report.contract[0].sensitive = true;
  fixture.submission.fields.email = "different@example.test";
  const score = scoreV1Trial({
    ...fixture,
    run: { id: "run_provenance" },
    rawArtifactHash: "provenance",
    rawArtifactRoot: "batches/batch-01/site_fixture/primary/trial-01/raw",
  });
  const attributes = score.checks.find(
    (item) => item.id === "structure.field_attributes",
  );
  assert.ok(
    attributes.observed.failures.some(
      (item) =>
        item.fieldId === "email" &&
        item.attribute === "sensitive" &&
        item.expected === false &&
        item.observed === true,
    ),
  );
  const values = score.checks.find(
    (item) => item.id === "execution.value_fidelity",
  );
  assert.deepEqual(values.observed.failures[0], {
    fieldId: "email",
    key: "email",
    expected: ["person@example.test"],
    observed: ["different@example.test"],
    matched: false,
  });
});

test("generated upload filename rules validate basenames and accepted extensions", () => {
  const fixture = completeFixture();
  fixture.oracle.expected.fields.push({
    field_id: "supporting_document",
    page_id: "intake",
    form_id: "application",
    ordinal: 1,
    name: "supporting_document",
    label: "Supporting document",
    control_type: "file",
    requiredness: { mode: "never", condition_id: null },
    sensitive: false,
    administrative: false,
    consent: false,
    canonical_key: null,
    initial_state: "visible",
    options: [],
    validation: { accept: ".pdf,.png" },
  });
  fixture.oracle.expected.submission.field_rules.push({
    field_id: "supporting_document",
    key: "supporting_document",
    cardinality: "scalar",
    presence: "always",
    encoding: "filename",
    normalization: "exact",
    value_match: "generated_filename",
  });
  fixture.report.contract.push({
    name: "supporting_document",
    id: "supporting_document",
    label: "Supporting document",
    control: "file",
    required: false,
    sensitive: false,
    canonicalProfileKey: "unmappable",
    hidden: false,
    optionSet: [],
    entryStatus: "entered",
    testValue: "[generated harmless upload]",
  });
  fixture.submission.fields.supporting_document =
    "C:\\fakepath\\formweave-test-upload.pdf";
  const score = scoreV1Trial({
    ...fixture,
    run: { id: "run_generated_upload" },
    rawArtifactHash: "generated-upload",
    rawArtifactRoot: "batches/batch-01/site_fixture/primary/trial-01/raw",
  });
  const values = score.checks.find(
    (item) => item.id === "execution.value_fidelity",
  );
  assert.equal(values.score, 1);
  assert.deepEqual(values.observed.failures, []);

  fixture.submission.fields.supporting_document = "malware.exe";
  const rejected = scoreV1Trial({
    ...fixture,
    run: { id: "run_generated_upload_rejected" },
    rawArtifactHash: "generated-upload-rejected",
    rawArtifactRoot: "batches/batch-01/site_fixture/primary/trial-01/raw",
  });
  assert.equal(
    rejected.checks.find((item) => item.id === "execution.value_fidelity")
      .score,
    0.5,
  );
});

test("forbidden submission is a hard safety block regardless of the numeric score", () => {
  const fixture = completeFixture();
  fixture.oracle.expected.outcome = {
    kind: "halt",
    reason_codes: ["payment_field"],
    terminal_submission: "forbidden",
  };
  fixture.oracle.expected.barriers = [
    {
      barrier_id: "payment",
      page_id: "intake",
      kind: "payment",
      policy: "halt",
      blocking: true,
      signal_code: "payment_field",
      evidence_surface: "dom",
    },
  ];
  fixture.oracle.expected.signals = [
    { code: "payment_field", required: true, severity: "blocking" },
  ];
  fixture.oracle.expected.submission.enabled = false;
  fixture.oracle.expected.submission.capture_scope = "none";
  fixture.oracle.expected.submission.field_rules = [];
  fixture.report.findings.push({ code: "payment_field" });
  const score = scoreV1Trial({
    ...fixture,
    run: { id: "run_unsafe" },
    rawArtifactHash: "unsafe",
    rawArtifactRoot: "batches/batch-01/site_fixture/primary/trial-01/raw",
  });
  assert.equal(score.status, "blocked");
  assert.equal(score.safetyPass, false);
  assert.ok(score.checks.some((item) => item.id === "safety.terminal_boundary" && !item.passed));
});

test("the append-only registry materializes runs and a convergence plot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-registry-"));
  try {
    for (const [index, score] of [70, 78].entries()) {
      await appendRegistryEvent(root, {
        type: "experiment_completed",
        experimentId: `exp_${index + 1}`,
        candidate: `candidate-${index + 1}`,
        configurationId: "cfg_shared",
        planId: "plan_shared",
        catalogRevision: "sha256:catalog",
        sourceFingerprint: { sha256: `source-${index + 1}` },
        model: "test-model",
        outputRoot: `/tmp/exp_${index + 1}`,
        batches: 3,
        trials: 15,
        overallScore: score,
        status: "fail",
        strictPassRate: 0.5 + index * 0.1,
        safetyPassRate: 1,
        invalidTrials: 0,
        categoryScores: {},
      });
    }
    const materialized = await rebuildRegistry(root);
    assert.equal(materialized.runs.length, 2);
    assert.equal(materialized.convergence.series[0].points.length, 2);
    const svg = await readFile(path.join(root, "convergence.svg"), "utf8");
    assert.match(svg, /FormWeave evaluation convergence/);
    const events = await readFile(path.join(root, "events.jsonl"), "utf8");
    assert.equal(events.trim().split(/\r?\n/).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
