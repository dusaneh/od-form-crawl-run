import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dirname;

async function json(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function uniqueOrdinals(values, scope, label) {
  const groups = new Map();
  for (const value of values) {
    const key = scope(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value.ordinal);
  }
  for (const [key, ordinals] of groups) unique(ordinals, `${label} ordinals in ${key}`);
}

for (const schema of [
  "catalog.schema.json",
  "evaluation.schema.json",
  "ground-truth.schema.json",
  "submission.schema.json",
  "testforms-evaluation.openapi.json",
]) {
  const value = await json(schema);
  assert.ok(value.$schema || value.openapi, `${schema} must declare its dialect`);
}

const catalog = await json("examples/catalog.json");
assert.equal(catalog.schema_version, "1.0");
unique(catalog.sites.map((site) => site.site_id), "catalog site IDs");
for (const site of catalog.sites) {
  unique(site.scenarios.map((scenario) => scenario.scenario_id), `${site.site_id} scenario IDs`);
}

const truth = await json("examples/site_ai.primary.ground-truth.json");
assert.equal(truth.schema_version, "1.0");
const expected = truth.expected;
const collections = {
  page: expected.pages,
  form: expected.forms,
  section: expected.sections,
  field: expected.fields,
  interaction: expected.interactions,
  branch: expected.branches,
  frame: expected.frames,
  repeater: expected.repeaters,
  barrier: expected.barriers,
};
const idKey = (kind) => `${kind}_id`;
for (const [kind, values] of Object.entries(collections)) {
  unique(values.map((value) => value[idKey(kind)]), `${kind} IDs`);
}
uniqueOrdinals(expected.pages, () => "journey", "page");
uniqueOrdinals(expected.forms, (item) => item.page_id, "form");
uniqueOrdinals(expected.sections, (item) => item.form_id, "section");
uniqueOrdinals(expected.fields, (item) => `${item.page_id}:${item.form_id}`, "field");
uniqueOrdinals(expected.interactions, (item) => item.page_id, "interaction");
for (const field of expected.fields) {
  uniqueOrdinals(field.options, () => field.field_id, "option");
}

const ids = new Set(
  Object.entries(collections).flatMap(([kind, values]) =>
    values.map((value) => `${kind}:${value[idKey(kind)]}`),
  ),
);
const has = (kind, id) => ids.has(`${kind}:${id}`);
for (const form of expected.forms) assert.ok(has("page", form.page_id));
for (const section of expected.sections) {
  assert.ok(has("page", section.page_id));
  assert.ok(has("form", section.form_id));
}
for (const field of expected.fields) {
  assert.ok(has("page", field.page_id));
  assert.ok(has("form", field.form_id));
  if (field.section_id) assert.ok(has("section", field.section_id));
  if (field.frame_id) assert.ok(has("frame", field.frame_id));
}
for (const interaction of expected.interactions) {
  assert.ok(has("page", interaction.page_id));
  assert.ok(ids.has(interaction.target_ref), `missing ${interaction.target_ref}`);
  interaction.effects.forEach((effect) =>
    assert.ok(ids.has(effect.target_ref), `missing ${effect.target_ref}`),
  );
}
for (const branch of expected.branches) {
  assert.ok(has("field", branch.trigger_field_id));
  for (const branchCase of branch.cases) {
    branchCase.reveals_field_ids.forEach((id) => assert.ok(has("field", id)));
    if (branchCase.next_page_id) assert.ok(has("page", branchCase.next_page_id));
    branchCase.echoes_field_ids.forEach((id) => assert.ok(has("field", id)));
  }
}
for (const rule of expected.submission.field_rules) {
  assert.ok(has("field", rule.field_id));
}
for (const item of expected.privacy_assertions) {
  assert.ok(has("page", item.page_id));
  assert.ok(has("field", item.source_field_id));
}

const catalogScenario = catalog.sites
  .find((site) => site.site_id === truth.site_id)
  ?.scenarios.find((scenario) => scenario.scenario_id === truth.scenario_id);
assert.ok(catalogScenario, "ground-truth example must exist in catalog example");
assert.equal(catalogScenario.fixture_revision, truth.fixture_revision);

const submission = await json("examples/captured-submission.json");
assert.equal(submission.schema_version, "1.0");
for (const value of Object.values(submission.fields)) {
  assert.ok(
    typeof value === "string" ||
      (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")),
    "captured values must be strings or non-empty string arrays",
  );
}

console.log("Evaluation protocol schemas parse and all example graph invariants pass.");
