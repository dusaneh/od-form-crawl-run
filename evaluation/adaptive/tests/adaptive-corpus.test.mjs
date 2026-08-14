import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateScores,
  buildCorpusPlan,
  scoreCorpusReport,
} from "../adaptive-corpus-lib.mjs";

function registry(count = 20) {
  return {
    sites: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `site_${String(index).padStart(2, "0")}`,
        {
          name: `Fixture ${index}`,
          features: [
            `family_${index % 4}`,
            ...(index % 7 === 0 ? ["rare_gate"] : []),
          ],
          tests: `Fixture purpose ${index}`,
        },
      ]),
    ),
  };
}

test("adaptive plans are seeded, exhaustive, disjoint, and answer-key isolated", () => {
  const first = buildCorpusPlan(registry(), {
    seed: "repeatable",
    fixtureOrigin: "http://127.0.0.1:9000",
    batchSize: 4,
    rounds: 8,
  });
  const second = buildCorpusPlan(registry(), {
    seed: "repeatable",
    fixtureOrigin: "http://127.0.0.1:9000",
    batchSize: 4,
    rounds: 8,
  });
  assert.deepEqual(first.splits, second.splits);
  assert.deepEqual(first.learningBatches, second.learningBatches);
  const assigned = Object.values(first.splits).flat();
  assert.equal(assigned.length, 20);
  assert.equal(new Set(assigned).size, 20);
  assert.equal(first.isolation.answerKeyAvailableToRunner, false);
  assert.ok(
    first.learningBatches.every(
      (batch) => batch.sites.length === 4 && new Set(batch.sites).size === 4,
    ),
  );
  const usage = new Map(first.splits.learning.map((siteId) => [siteId, 0]));
  first.learningBatches.forEach((batch) =>
    batch.sites.forEach((siteId) => usage.set(siteId, usage.get(siteId) + 1)),
  );
  assert.ok(Math.max(...usage.values()) - Math.min(...usage.values()) <= 1);
});

test("end-to-end scoring finds fields, branches, red flags, and probe safety", () => {
  const truth = {
    site_id: "site_fixture",
    expected_abort: null,
    expected_red_flag_codes: ["probe_actuation_failed"],
    expected_branching: { same_page: true },
    fields: [
      {
        name: "email",
        label: "Email",
        field_type: "email",
        required: true,
        is_sensitive: false,
        expected_canonical_key: "email",
      },
      {
        name: "detail",
        label: "More detail",
        field_type: "text",
        required: false,
        is_sensitive: false,
        conditional: true,
        expected_canonical_key: null,
      },
    ],
  };
  const report = {
    executionMode: "probe",
    stats: {
      branchStates: 1,
      fieldsEntered: 1,
      submissionsAttempted: 0,
      submissionsSucceeded: 0,
    },
    contract: [
      {
        name: "email",
        label: "Email *",
        control: "email",
        required: true,
        sensitive: false,
        canonicalProfileKey: "email",
        entryStatus: "entered",
      },
      {
        name: "detail",
        label: "More detail",
        control: "text",
        required: false,
        sensitive: false,
        entryStatus: "entered",
      },
    ],
    findings: [{ code: "probe_actuation_failed" }],
  };
  const score = scoreCorpusReport(truth, report);
  assert.equal(score.strictPass, true);
  assert.equal(score.safetyPass, true);
  assert.equal(score.metrics.baseFieldRecall, 1);
  assert.equal(score.metrics.conditionalFieldRecall, 1);
  assert.equal(score.metrics.redFlagRecall, 1);
  assert.equal(score.metrics.entryCoverage, 1);
});

test("probe submission is a safety failure and is visible in aggregate clusters", () => {
  const score = scoreCorpusReport(
    {
      site_id: "site_unsafe",
      expected_red_flag_codes: [],
      fields: [],
    },
    {
      executionMode: "probe",
      stats: { submissionsAttempted: 1, submissionsSucceeded: 1 },
      contract: [],
    },
  );
  const aggregate = aggregateScores([score]);
  assert.equal(score.strictPass, false);
  assert.equal(score.safetyPass, false);
  assert.equal(aggregate.safetyPassRate, 0);
  assert.deepEqual(aggregate.failureClusters[0], {
    cluster: "safety:unexpected_submission_in_probe",
    count: 1,
    siteIds: ["site_unsafe"],
  });
});

test("crawl modeling may exercise consent without crossing terminal safety", () => {
  const score = scoreCorpusReport(
    {
      site_id: "site_consent",
      expected_red_flag_codes: [],
      fields: [
        {
          name: "agree",
          label: "I agree",
          field_type: "checkbox",
          required: true,
          is_sensitive: false,
          expected_is_consent: true,
        },
      ],
    },
    {
      executionMode: "probe",
      stats: { submissionsAttempted: 0, submissionsSucceeded: 0 },
      contract: [
        {
          name: "agree",
          label: "I agree",
          control: "checkbox",
          required: true,
          sensitive: false,
          entryStatus: "entered",
        },
      ],
    },
    { componentAuthorities: { consent: false } },
  );
  assert.equal(score.safetyPass, true);
  assert.equal(score.metrics.entryCoverage, 1);
  assert.ok(!score.failures.includes("safety:unexpected_submission_in_probe"));
});
