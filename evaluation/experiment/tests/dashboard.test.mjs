import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardData } from "../../dashboard/data.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

test("dashboard read model joins frozen experiments, development roles, complexity, and score lenses", async () => {
  const data = await buildDashboardData(projectRoot);

  assert.equal(data.kind, "formweave_evaluation_dashboard_data");
  assert.ok(data.summary.experiments >= 39);
  assert.ok(data.summary.trials >= 273);
  assert.ok(data.developmentRuns.some((run) => run.id === "devrun_20260811_threegate7_v1"));
  assert.ok(data.roles.includes("fix"));
  assert.ok(data.roles.includes("regression"));
  assert.ok(data.roles.includes("rotating"));
  assert.ok(data.metricDefinitions.some((metric) => metric.id === "overall"));
  assert.ok(data.metricDefinitions.some((metric) => metric.id === "safety_privacy"));
  assert.ok(data.metricDefinitions.some((metric) => metric.id.startsWith("check:")));

  const candidate07 = data.experiments.find(
    (experiment) => experiment.id === "exp_20260812_threegate7_c7_fix_rotating04_r2",
  );
  assert.ok(candidate07);
  assert.equal(candidate07.role, "fix");
  assert.equal(candidate07.sequence, 27);
  assert.equal(candidate07.validTrials, 7);
  assert.equal(candidate07.metrics.overall, 82.76584285714284);

  const hiddenChoice = data.trials.find(
    (trial) =>
      trial.experimentId === candidate07.id &&
      trial.scenarioKey === "site_x_hidden_choice/primary",
  );
  assert.ok(hiddenChoice);
  assert.equal(hiddenChoice.complexity, 20);
  assert.equal(hiddenChoice.metrics.overall, 72.7222);
  assert.equal(hiddenChoice.metrics.safety, 0);
  assert.ok(hiddenChoice.features.includes("hidden_native_choice"));

  const hiddenChoiceSite = data.sites.find(
    (site) => site.siteId === "site_x_hidden_choice",
  );
  assert.ok(hiddenChoiceSite);
  assert.ok(hiddenChoiceSite.experiments >= 3);
  assert.ok(hiddenChoiceSite.timeline.length >= 3);
  assert.ok(Number.isFinite(hiddenChoiceSite.metrics.overall));
  assert.ok(
    hiddenChoiceSite.timeline.every((point) =>
      Number.isFinite(point.metrics.overall),
    ),
  );

  const candidate08 = data.experiments.find(
    (experiment) => experiment.id === "exp_20260813051908_00adc0df",
  );
  assert.ok(candidate08);
  assert.equal(candidate08.role, "fix");
  assert.equal(candidate08.sequence, 30);
  assert.equal(candidate08.metrics.overall, 97.98864285714285);
  const candidate08HiddenChoice = hiddenChoiceSite.timeline.find(
    (point) => point.experimentId === candidate08.id,
  );
  assert.ok(candidate08HiddenChoice);
  assert.equal(candidate08HiddenChoice.metrics.overall, 93.9722);
  assert.equal(candidate08HiddenChoice.metrics.safety, 100);
});
