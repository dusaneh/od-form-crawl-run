import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import {
  applyActuatorRepair,
  loadActuatorBundle,
  writeActuatorBundle,
} from "../local/actuator/bundle-store.mjs";
import {
  SEMANTIC_REPAIR_RESPONSE_SCHEMA,
  compileDeterministicNativeTarget,
  generateActuatorBundle,
  validateGeneratedActuatorTarget,
} from "../local/actuator/actuator-generator.mjs";
import { preflightActuator } from "../local/actuator/actuator-preflight.mjs";
import { createActuatorRuntime } from "../local/actuator/actuator-runtime.mjs";
import {
  ActuatorSourceError,
  alignActuatorCapabilities,
  assertActuatorBundle,
} from "../local/actuator/actuator-source.mjs";
import { routeRepair } from "../local/actuator/repair-router.mjs";
import {
  actuatorPrerequisiteObligation,
  actuatorRepairScope,
  actuatorRepairStrategy,
  assignDiagnosisIdentity,
  assertActuatorPrerequisiteObligation,
  assignRepairLineage,
  compareRepairStrategy,
  failurePredicates,
  repeatedFailurePredicates,
} from "../local/actuator/repair-transaction.mjs";
import {
  browserFailurePrecedence,
  generateValidateStateActuator,
  optionalTargetQuarantine,
} from "../local/actuator/state-actuator-pipeline.mjs";
import { hashJson, sha256 } from "../local/contracts/artifact-store.mjs";
import { installSubmissionGuards } from "../local/form-traversal.mjs";
import {
  validateActuatorCommand,
  validateActuatorResult,
  validateSemanticRepairDocument,
} from "../local/contracts/semantic-actuator-schemas.mjs";
import { applySemanticRepair } from "../local/semantic/semantic-repair.mjs";
import {
  assertProviderStructuredOutputSchema,
  callStructuredModel,
} from "../local/semantic/structured-model.mjs";

test("structured model schemas fail locally on unsupported provider keywords", async () => {
  let fetchCalled = false;
  await assert.rejects(
    callStructuredModel({
      name: "unsupported_schema_test",
      schema: {
        type: "object",
        properties: {
          result: {
            oneOf: [{ type: "string" }, { type: "null" }],
          },
        },
        required: ["result"],
        additionalProperties: false,
      },
      system: "Return a result.",
      prompt: "Return a result.",
      configuration: {
        configured: true,
        apiKey: "test-key",
        model: "test-model",
      },
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("Network should not be called.");
      },
    }),
    (error) =>
      error?.code === "STRUCTURED_OUTPUT_SCHEMA_UNSUPPORTED" &&
      error?.keyword === "oneOf",
  );
  assert.equal(fetchCalled, false);
});

test("semantic repair uses a provider-compatible typed response schema", () => {
  assert.doesNotThrow(() =>
    assertProviderStructuredOutputSchema(SEMANTIC_REPAIR_RESPONSE_SCHEMA),
  );
  assert.ok(SEMANTIC_REPAIR_RESPONSE_SCHEMA.properties.operations.items.anyOf);
  assert.equal(
    Object.hasOwn(
      SEMANTIC_REPAIR_RESPONSE_SCHEMA.properties.operations.items,
      "oneOf",
    ),
    false,
  );
});

test("only exhausted optional non-safety field targets may be quarantined", () => {
  const semanticProposal = {
    fields: [
      { key: "optional_upload", required: false },
      { key: "required_name", required: true },
    ],
    proposedActions: [
      {
        targetKey: "optional_upload",
        kind: "upload_interaction",
      },
      { targetKey: "required_name", kind: "field_actuation" },
    ],
  };
  assert.deepEqual(
    optionalTargetQuarantine({
      semanticProposal,
      issues: [
        {
          code: "readback_unverified",
          targetKey: "optional_upload",
        },
      ],
    }),
    {
      eligible: true,
      targetKeys: ["optional_upload"],
      reason: "optional_target_locally_exhausted",
    },
  );
  assert.equal(
    optionalTargetQuarantine({
      semanticProposal,
      issues: [
        {
          code: "readback_unverified",
          targetKey: "required_name",
        },
      ],
    }).eligible,
    false,
  );
  assert.equal(
    optionalTargetQuarantine({
      semanticProposal,
      issues: [
        { code: "environment_error", targetKey: "optional_upload" },
      ],
    }).eligible,
    false,
  );
});

test("repeated browser evidence outranks a later target-local compiler failure", () => {
  const browserIssue = {
    issueId: "issue_income_handler_contract",
    code: "handler_contract_violation",
    targetKey: "income_band",
    controlType: "radio",
    detail: "The checked state did not change.",
  };
  const subordinateIssue = {
    issueId: "issue_repair_capability",
    code: "ACTUATOR_CAPABILITY_UNKNOWN",
    targetKey: "income_band",
    detail: "The repair called an unsupported capability.",
  };
  const result = browserFailurePrecedence({
    browserIssues: [browserIssue],
    repeatedPredicates: [
      {
        targetKey: "income_band",
        code: "handler_contract_violation",
        fingerprint: "income_band|handler_contract_violation",
      },
    ],
    subordinateIssues: [subordinateIssue],
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.winningIssues, [browserIssue]);
  assert.deepEqual(result.subordinateIssues, [subordinateIssue]);
  assert.deepEqual(result.targetKeys, ["income_band"]);
  assert.deepEqual(result.predicateFingerprints, [
    "income_band|handler_contract_violation",
  ]);
});

test("static, unrelated, and environment failures do not gain browser precedence", () => {
  const staticOnly = browserFailurePrecedence({
    browserIssues: [],
    repeatedPredicates: [],
    subordinateIssues: [
      {
        code: "ACTUATOR_CAPABILITY_UNKNOWN",
        targetKey: "income_band",
      },
    ],
  });
  assert.equal(staticOnly.applied, false);

  const unrelated = browserFailurePrecedence({
    browserIssues: [
      { code: "readback_unverified", targetKey: "field_a" },
    ],
    repeatedPredicates: [
      { code: "readback_unverified", targetKey: "field_b" },
    ],
  });
  assert.equal(unrelated.applied, false);

  const environment = browserFailurePrecedence({
    browserIssues: [
      { code: "environment_error", targetKey: "income_band" },
    ],
    repeatedPredicates: [
      { code: "environment_error", targetKey: "income_band" },
    ],
  });
  assert.equal(environment.applied, false);
});

function observation(origin = "https://example.invalid/") {
  return {
    schemaVersion: 1,
    observedAt: "2026-08-03T20:00:00.000Z",
    url: `${origin}start`,
    normalizedRoute: "/start",
    locale: "en-US",
    title: "Synthetic form",
    heading: "Synthetic form",
    controls: [
      {
        factId: "control_fact_01",
        tag: "input",
        rawType: "text",
        name: "value_a",
        id: "value_a",
        rawLabel: "Value A",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "",
        selectorCandidates: ["#value_a"],
      },
      {
        factId: "control_fact_02",
        tag: "input",
        rawType: "text",
        name: "value_b",
        id: "value_b",
        rawLabel: "Value B",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "",
        selectorCandidates: ["#value_b"],
      },
    ],
    actions: [
      {
        factId: "action_fact_01",
        tag: "button",
        rawType: "button",
        rawText: "Continue",
        visible: true,
        disabled: false,
        href: null,
        selectorCandidates: ["#continue"],
        formMethod: null,
        formAction: null,
      },
    ],
    sections: [],
    guidance: [],
    challengeSignals: [],
    accessibilitySnapshot: "textbox Value A; button Continue",
    screenshot: {
      sha256: "a".repeat(64),
      byteLength: 1,
      mediaType: "image/png",
    },
    priorStates: [],
    existingContract: null,
  };
}

function semanticProposal() {
  return {
    schemaVersion: 1,
    proposalId: "proposal_semantic_actuator",
    state: {
      key: "state_01",
      description: "Synthetic state.",
      kind: "form",
      normalizedRoute: "/start",
      visibleControlKeys: ["field_01"],
      sectionKeys: [],
      progression: {
        key: "action_01",
        kind: "advance",
        rationale: "The observed control advances to the next state.",
      },
    },
    fields: [
      {
        key: "field_01",
        rawLabel: "Value A",
        controlType: "text",
        required: true,
        options: [],
        sectionKey: null,
        guidanceRefs: [],
        testValue: "INTAKECR TEST",
        sensitive: false,
        administrative: false,
        resolutionHints: ["#value_a"],
        sourceFactIds: ["control_fact_01"],
      },
    ],
    sections: [],
    guidance: [],
    mechanics: {
      fieldTargets: [{ fieldKey: "field_01", selectors: ["#value_a"] }],
      progressionTarget: {
        key: "action_01",
        kind: "advance",
        sourceFactId: "action_fact_01",
        selectors: ["#continue"],
      },
    },
    proposedActions: [
      {
        proposalId: "set_field_01",
        kind: "field_actuation",
        targetKey: "field_01",
        value: "INTAKECR TEST",
        rationale: "Exercise the required observed field.",
      },
      {
        proposalId: "advance_state_01",
        kind: "advance",
        targetKey: "action_01",
        value: null,
        rationale: "Exercise the observed nonterminal progression.",
      },
    ],
    rationale: [
      {
        subjectKey: "state_01",
        evidence: "The rendered state contains one field and one advance action.",
        confidence: "high",
      },
    ],
  };
}

const fieldSource = `export async function fieldHandler(api, command) {
  const target = await api.resolveUnique(["#value_a"]);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The field did not resolve.", diagnostics: [] };
  if (command.operation === "set_field") await api.fill(target, command.value);
  const landed = await api.read(target);
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const verified = normalize(landed) === normalize(command.value);
  return { attempted: true, status: verified ? "verified" : "failed", resolved: true, entered: command.operation === "set_field", verified, normalizedReadback: String(landed), stateChanged: false, failureCode: verified ? null : "readback_unverified", detail: verified ? null : "Readback did not match.", diagnostics: [] };
}
`;

const actionSource = `export async function actionHandler(api, command) {
  const before = await api.observe();
  const target = await api.resolveUnique(["#continue"]);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The action did not resolve.", diagnostics: [] };
  await api.click(target);
  await api.settle();
  const after = await api.observe();
  const changed = before.url !== after.url;
  return { attempted: true, status: changed ? "verified" : "failed", resolved: true, entered: false, verified: changed, normalizedReadback: null, stateChanged: changed, failureCode: changed ? null : "state_change_unverified", detail: changed ? null : "The state did not change.", diagnostics: [] };
}
`;

function bundle(proposal = semanticProposal(), observed = observation()) {
  return {
    schemaVersion: 1,
    interfaceVersion: 1,
    bundleId: "actuator_test_bundle",
    artifactId: "form_0123456789abcdef01234567",
    bundleVersion: 1,
    semanticCandidateHash: hashJson(proposal),
    observationHash: hashJson(observed),
    handlers: [
      {
        handlerId: "field_01_handler",
        targetKind: "field",
        targetKey: "field_01",
        operations: ["set_field", "read_field"],
        modulePath: "handlers/field_01.mjs",
        exportName: "fieldHandler",
        capabilities: ["keyboard", "locator", "observe"],
        sourceFactIds: ["control_fact_01"],
      },
      {
        handlerId: "action_01_handler",
        targetKind: "action",
        targetKey: "action_01",
        operations: ["execute_action"],
        modulePath: "handlers/action_01.mjs",
        exportName: "actionHandler",
        capabilities: ["locator", "observe", "pointer", "wait"],
        sourceFactIds: ["action_fact_01"],
      },
    ],
    modules: [
      {
        modulePath: "handlers/field_01.mjs",
        source: fieldSource,
        sourceHash: sha256(fieldSource),
      },
      {
        modulePath: "handlers/action_01.mjs",
        source: actionSource,
        sourceHash: sha256(actionSource),
      },
    ],
    rationale: "Each semantic target has an independently addressable handler.",
  };
}

test("ordinary native selects compile to deterministic value-parametric handlers", async () => {
  const target = {
    targetKind: "field",
    targetKey: "program",
    operations: ["set_field", "read_field"],
    sourceFactIds: ["program_fact"],
    semantics: {
      field: {
        key: "program",
        controlType: "select",
        options: [
          { value: "housing", label: "Housing" },
          { value: "energy", label: "Energy" },
        ],
      },
      mechanics: { fieldKey: "program", selectors: ["#program"] },
      proposedAction: { value: "housing" },
    },
  };
  const compiled = compileDeterministicNativeTarget({
    target,
    index: 2,
    observation: {
      controls: [
        {
          factId: "program_fact",
          tag: "select",
          rawType: "select-one",
          visible: true,
          disabled: false,
          frameUrl: "https://example.invalid/start",
        },
      ],
      url: "https://example.invalid/start",
    },
  });
  assert.ok(compiled);
  assert.equal(compiled.model, "deterministic-native-compiler");
  assert.match(compiled.module.source, /api\.select\(target, requested\)/);
  assert.doesNotMatch(compiled.module.source, /requested === "housing"/);
  const imported = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.module.source).toString("base64")}`
  );
  let selected = "";
  const api = {
    resolveUnique: async () => ({}),
    read: async () => selected,
    select: async (_target, value) => {
      selected = value;
    },
  };
  for (const value of ["housing", "energy"]) {
    const result = await imported.nativeSelectHandler(api, {
      operation: "set_field",
      value,
    });
    assert.equal(result.verified, true);
    assert.equal(result.normalizedReadback, value);
  }
});

test("ordinary native text, checkbox, and radio controls compile without model generation", async () => {
  const baseObservation = {
    url: "https://example.invalid/start",
    controls: [],
  };
  const compile = (field, controls, selectors) =>
    compileDeterministicNativeTarget({
      target: {
        targetKind: "field",
        targetKey: field.key,
        operations: ["set_field", "read_field"],
        sourceFactIds: controls.map((control) => control.factId),
        semantics: {
          field,
          mechanics: { fieldKey: field.key, selectors },
          proposedAction: { value: field.testValue },
        },
      },
      observation: { ...baseObservation, controls },
    });
  const nativeFact = (factId, rawType, selector, options = []) => ({
    factId,
    tag: "input",
    rawType,
    visible: true,
    disabled: false,
    readOnly: false,
    frameUrl: baseObservation.url,
    selectorCandidates: [selector],
    options,
  });

  const textCompiled = compile(
    { key: "email", controlType: "email", testValue: "test@example.invalid" },
    [nativeFact("email_fact", "email", "#email")],
    ["#email"],
  );
  assert.ok(textCompiled);
  assert.doesNotThrow(() => validateGeneratedActuatorTarget(textCompiled));
  const textModule = await import(
    `data:text/javascript;base64,${Buffer.from(textCompiled.module.source).toString("base64")}`
  );
  let textValue = "";
  assert.equal(
    (
      await textModule.nativeTextHandler(
        {
          resolveUnique: async () => ({}),
          read: async () => textValue,
          fill: async (_target, value) => {
            textValue = value;
          },
        },
        { operation: "set_field", value: "test@example.invalid" },
      )
    ).verified,
    true,
  );

  const checkboxCompiled = compile(
    { key: "consent", controlType: "checkbox", testValue: true },
    [nativeFact("consent_fact", "checkbox", "#consent")],
    ["#consent"],
  );
  assert.ok(checkboxCompiled);
  assert.doesNotThrow(() => validateGeneratedActuatorTarget(checkboxCompiled));
  const checkboxModule = await import(
    `data:text/javascript;base64,${Buffer.from(checkboxCompiled.module.source).toString("base64")}`
  );
  let checked = false;
  const checkboxResult = await checkboxModule.nativeCheckboxHandler(
    {
      resolveUnique: async () => ({}),
      isChecked: async () => checked,
      check: async () => {
        checked = true;
      },
      uncheck: async () => {
        checked = false;
      },
    },
    { operation: "set_field", value: true },
  );
  assert.equal(checkboxResult.verified, true);
  assert.equal(checkboxResult.normalizedReadback, true);

  const radioCompiled = compile(
    {
      key: "housing",
      controlType: "radio",
      testValue: "rent",
      options: [
        { value: "rent", label: "Rent" },
        { value: "own", label: "Own" },
      ],
    },
    [
      nativeFact("rent_fact", "radio", "#housing-rent", [
        { value: "rent", label: "Rent" },
      ]),
      nativeFact("own_fact", "radio", "#housing-own", [
        { value: "own", label: "Own" },
      ]),
    ],
    ['input[name="housing"][type="radio"]'],
  );
  assert.ok(radioCompiled);
  assert.doesNotThrow(() => validateGeneratedActuatorTarget(radioCompiled));
  assert.doesNotMatch(radioCompiled.module.source, /\[[a-zA-Z_$][\w$]*\]/);
  const radioModule = await import(
    `data:text/javascript;base64,${Buffer.from(radioCompiled.module.source).toString("base64")}`
  );
  const selected = new Map([
    ["#housing-rent", false],
    ["#housing-own", false],
  ]);
  const radioResult = await radioModule.nativeRadioHandler(
    {
      resolveUnique: async (selectors) => selectors[0],
      isChecked: async (target) => selected.get(target),
      check: async (target) => {
        for (const key of selected.keys()) selected.set(key, key === target);
      },
    },
    { operation: "set_field", value: "own" },
  );
  assert.equal(radioResult.verified, true);
  assert.equal(radioResult.normalizedReadback, "own");
});

async function fixtureServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/next") {
      response.end("<!doctype html><h1>Next state</h1>");
      return;
    }
    if (request.url === "/form-start") {
      response.end(`<!doctype html>
        <form method="get" action="/next">
          <label for="value_a">Value A</label>
          <input id="value_a" name="value_a" required>
          <button id="continue" type="submit">Continue</button>
        </form>`);
      return;
    }
    if (request.url === "/scroll-gate") {
      response.end(`<!doctype html>
        <div id="terms" style="height:40px;overflow-y:auto" onscroll="
          window.termScrolls = (window.termScrolls || 0) + 1;
          if (this.scrollTop + this.clientHeight >= this.scrollHeight - 2) {
            document.getElementById('accept').disabled = false;
          }
        ">
          <div style="height:400px">Synthetic terms of use</div>
        </div>
        <label for="accept">I agree</label>
        <input id="accept" name="accept" type="checkbox" disabled>
        <button id="continue" type="button" onclick="location.href='/next'">Continue</button>`);
      return;
    }
    if (request.url === "/frame-terms") {
      response.end(`<!doctype html>
        <div id="terms" style="height:40px;overflow-y:auto" onscroll="
          if (this.scrollTop + this.clientHeight >= this.scrollHeight - 2) {
            parent.document.getElementById('accept').disabled = false;
          }
        ">
          <div style="height:400px">Synthetic framed terms of use</div>
        </div>`);
      return;
    }
    if (request.url === "/frame-scroll-gate") {
      response.end(`<!doctype html>
        <iframe title="Terms" src="/frame-terms"></iframe>
        <label for="accept">I agree</label>
        <input id="accept" name="accept" type="checkbox" disabled>`);
      return;
    }
    if (request.url === "/label-overlay") {
      response.end(`<!doctype html>
        <style>
          .card { position:relative; width:180px; height:48px; }
          .card input { position:absolute; inset:0; width:100%; height:100%; }
          .card label { position:absolute; inset:0; z-index:2; background:white; }
        </style>
        <div class="card"><input id="choice-a" name="choice" type="radio" value="a"><label for="choice-a">Choice A</label></div>`);
      return;
    }
    response.end(`<!doctype html>
      <label for="value_a">Value A</label>
      <input id="value_a" name="value_a" required>
      <button id="continue" type="button" onclick="location.href='/next'">Continue</button>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("semantic repair can correct the field/source binding and its mechanics", () => {
  const proposal = semanticProposal();
  const repair = {
    schemaVersion: 1,
    repairId: "repair_semantic_binding_01",
    layer: "semantic",
    baseCandidateHash: hashJson(proposal),
    issueIds: ["issue_wrong_field_id"],
    operations: [
      {
        op: "replace_source_fact_ids",
        targetKey: "field_01",
        value: ["control_fact_02"],
      },
      {
        op: "replace_field_mechanics",
        targetKey: "field_01",
        value: { fieldKey: "field_01", selectors: ["#value_b"] },
      },
    ],
    rationale: "The prior semantic field was bound to a different observed control.",
  };
  validateSemanticRepairDocument(repair);
  const repaired = applySemanticRepair({
    proposal,
    repair,
    observation: observation(),
  });
  assert.deepEqual(repaired.proposal.fields[0].sourceFactIds, ["control_fact_02"]);
  assert.deepEqual(repaired.proposal.mechanics.fieldTargets[0].selectors, [
    "#value_b",
  ]);
  assert.equal(proposal.fields[0].sourceFactIds[0], "control_fact_01");
  assert.notEqual(repaired.candidateHash, repair.baseCandidateHash);
});

test("repair routing can return from actuator preflight to semantic repair", () => {
  const semantic = routeRepair({
    stage: "actuator_preflight_failed",
    issues: [
      {
        issueId: "issue_binding",
        code: "semantic_binding_mismatch",
      },
    ],
  });
  assert.equal(semantic.nextState, "semantic_repair");
  assert.equal(semantic.invalidateActuatorHandlers, true);

  const actuator = routeRepair({
    stage: "actuator_preflight_failed",
    issues: [
      { issueId: "issue_locator", code: "locator_unresolved" },
    ],
  });
  assert.equal(actuator.nextState, "actuator_repair");

  const both = routeRepair({
    issues: [
      { issueId: "issue_binding", code: "semantic_binding_mismatch" },
      { issueId: "issue_readback", code: "readback_unverified" },
    ],
  });
  assert.deepEqual(both.repairLayers, ["semantic", "actuator"]);
});

test("repeated deterministic actuator failures can be diagnosis-routed across layers", () => {
  const route = routeRepair({
    stage: "actuator_preflight_failed",
    issues: [
      {
        issueId: "issue_action_state_change",
        code: "state_change_unverified",
        targetKey: "action_01",
      },
    ],
    diagnosis: {
      schemaVersion: 1,
      diagnosisId: "diagnosis_repeated_progression",
      classification: "semantic",
      issueIds: ["issue_action_state_change"],
      evidenceRefs: [],
      rationale:
        "The declared progression target is not an observed progression action.",
      confidence: "high",
    },
    preferDiagnosis: true,
  });
  assert.equal(route.classification, "semantic");
  assert.equal(route.nextState, "semantic_repair");
});

test("repair transactions assign immutable lineage, isolate targets, and compare strategy", () => {
  const proposal = semanticProposal();
  const value = bundle(proposal, observation());
  const replacementSource = `${fieldSource}\n`;
  const modelRepair = {
    schemaVersion: 1,
    repairId: "repair_model_reused_id",
    layer: "actuator",
    baseBundleHash: assertActuatorBundle({
      bundle: value,
      semanticProposal: proposal,
    }).bundleHash,
    issueIds: ["issue_field_readback"],
    replacements: [
      {
        modulePath: "handlers/field_01.mjs",
        source: replacementSource,
        sourceHash: sha256(replacementSource),
        handlerIds: ["field_01_handler"],
        capabilities: ["keyboard", "locator", "observe"],
      },
    ],
    rationale: "Repair only the failed field handler.",
  };
  const first = assignRepairLineage({
    repair: modelRepair,
    artifactId: value.artifactId,
    stateIdentity: proposal.state,
    attemptOrdinal: 1,
  });
  const second = assignRepairLineage({
    repair: modelRepair,
    artifactId: value.artifactId,
    stateIdentity: proposal.state,
    attemptOrdinal: 2,
  });
  assert.notEqual(first.repair.repairId, second.repair.repairId);
  assert.equal(first.provenance.requestedRepairId, "repair_model_reused_id");

  const issues = [
    {
      issueId: "issue_field_readback",
      code: "readback_unverified",
      targetKey: "field_01",
    },
  ];
  const scope = actuatorRepairScope({
    bundle: value,
    repair: first.repair,
    issues,
  });
  assert.deepEqual(scope.affectedTargetKeys, ["field_01"]);
  assert.deepEqual(scope.retainedSiblingTargetKeys, []);
  assert.ok(scope.retainedSiblingHandlerIds.includes("action_01_handler"));

  const strategy = actuatorRepairStrategy({
    bundle: value,
    repair: first.repair,
    scope,
  });
  const comparison = compareRepairStrategy({
    priorStrategies: [
      {
        repairId: "repair_prior",
        predicateFingerprints: ["field_01|readback_unverified"],
        affectedTargetKeys: ["field_01"],
        strategyHash: strategy.strategyHash,
        contentHash: "different-content",
      },
    ],
    predicates: failurePredicates(issues),
    scope,
    strategy,
  });
  assert.equal(comparison.semanticallyRepeated, true);
  assert.equal(comparison.contentChanged, true);

  const changedMechanicsSource = replacementSource.replaceAll(
    "#value_a",
    "#value_b",
  );
  const changedMechanicsRepair = {
    ...first.repair,
    repairId: "repair_changed_grounded_mechanics",
    replacements: first.repair.replacements.map((replacement) => ({
      ...replacement,
      source: changedMechanicsSource,
      sourceHash: sha256(changedMechanicsSource),
    })),
  };
  const changedStrategy = actuatorRepairStrategy({
    bundle: value,
    repair: changedMechanicsRepair,
    scope,
  });
  assert.notEqual(changedStrategy.strategyHash, strategy.strategyHash);
  assert.equal(
    compareRepairStrategy({
      priorStrategies: [
        {
          repairId: first.repair.repairId,
          predicateFingerprints: ["field_01|readback_unverified"],
          affectedTargetKeys: ["field_01"],
          strategyHash: strategy.strategyHash,
          contentHash: strategy.contentHash,
        },
      ],
      predicates: failurePredicates(issues),
      scope,
      strategy: changedStrategy,
    }).strategyChanged,
    true,
  );
  assert.deepEqual(
    repeatedFailurePredicates([{ issues }], issues).map(
      (item) => item.fingerprint,
    ),
    ["field_01|readback_unverified"],
  );

  assert.throws(
    () =>
      actuatorRepairScope({
        bundle: value,
        repair: first.repair,
        issues: [
          {
            issueId: "issue_action_state_change",
            code: "state_change_unverified",
            targetKey: "action_01",
          },
        ],
      }),
    (error) => error.code === "ACTUATOR_REPAIR_TARGET_SCOPE_INVALID",
  );
});

test("diagnosis identity is assigned by trusted code and model identity is provenance only", () => {
  const assigned = assignDiagnosisIdentity({
    diagnosis: {
      schemaVersion: 1,
      diagnosisId: "diagnosis id with spaces from model",
      classification: "actuator",
      issueIds: ["issue_terms_gate"],
      evidenceRefs: [],
      rationale: "The semantic target is correct and needs grounded mechanics.",
      confidence: "high",
    },
    context: {
      responseId: "response_01",
      repeatedPredicates: ["agree_terms|validation_blocked"],
    },
  });
  assert.match(assigned.diagnosis.diagnosisId, /^diagnosis_[a-f0-9]{40}$/);
  assert.equal(
    assigned.provenance.requestedDiagnosisId,
    "diagnosis id with spaces from model",
  );
  assert.equal(
    assigned.provenance.assignedDiagnosisId,
    assigned.diagnosis.diagnosisId,
  );
});

test("a generated handler blocked on rendered prerequisites routes to actuator repair", () => {
  const route = routeRepair({
    stage: "actuator_preflight_failed",
    issues: [
      {
        issueId: "issue_terms_validation_blocked",
        code: "validation_blocked",
        targetKey: "terms_agree",
        detail: "The observed disabled terms control prerequisite was not completed.",
      },
    ],
  });
  assert.equal(route.classification, "actuator");
  assert.equal(route.nextState, "actuator_repair");
  assert.deepEqual(route.repairLayers, ["actuator"]);
});

test("gated target repairs must implement an observed prerequisite before replay", () => {
  const proposal = semanticProposal();
  const observed = observation();
  observed.controls[0] = {
    ...observed.controls[0],
    disabled: true,
    selectorCandidates: ["#value_a"],
  };
  observed.scrollRegions = [
    {
      factId: "scroll_region_terms",
      selectorCandidates: ["#terms"],
      atEnd: false,
    },
  ];
  const currentBundle = bundle(proposal, observed);
  const issues = [
    {
      issueId: "issue_field_disabled",
      code: "validation_blocked",
      targetKey: "field_01",
      detail: "The dependent field is not enabled until its prerequisite is complete.",
    },
  ];
  const obligation = actuatorPrerequisiteObligation({
    bundle: currentBundle,
    issues,
    observation: observed,
  });
  assert.equal(obligation.kind, "rendered_target_prerequisite");
  assert.deepEqual(obligation.targetKeys, ["field_01"]);
  assert.deepEqual(
    obligation.candidates.map((candidate) => candidate.factId),
    ["scroll_region_terms"],
  );

  const bundleHash = assertActuatorBundle({
    bundle: currentBundle,
    semanticProposal: proposal,
  }).bundleHash;
  const repairFor = (source) => ({
    schemaVersion: 1,
    repairId: "repair_gated_field",
    layer: "actuator",
    baseBundleHash: bundleHash,
    issueIds: issues.map((issue) => issue.issueId),
    replacements: [
      {
        modulePath: "handlers/field_01.mjs",
        source,
        sourceHash: sha256(source),
        handlerIds: ["field_01_handler"],
        capabilities: ["keyboard", "locator", "observe", "pointer", "wait"],
      },
    ],
    rationale: "Repair only the unavailable field mechanics.",
  });
  const assertSource = (source) => {
    const repair = repairFor(source);
    const scope = actuatorRepairScope({
      bundle: currentBundle,
      repair,
      issues,
    });
    const strategy = actuatorRepairStrategy({
      bundle: currentBundle,
      repair,
      scope,
    });
    return assertActuatorPrerequisiteObligation({ obligation, strategy });
  };

  assert.throws(
    () => assertSource(fieldSource),
    (error) =>
      error.code === "ACTUATOR_REPAIR_PREREQUISITE_UNSATISFIED",
  );

  const groundedSource = fieldSource.replace(
    '  const target = await api.resolveUnique(["#value_a"]);',
    '  const prerequisite = await api.resolveUnique(["#terms"]);\n  if (prerequisite) { await api.scrollToEnd(prerequisite); await api.settle(); }\n  const target = await api.resolveUnique(["#value_a"]);\n  if (target) await api.isEnabled(target);',
  );
  assert.deepEqual(assertSource(groundedSource).matchedCandidates, [
    "scroll_region_terms",
  ]);
});

test("actuator preflight rejects handlers hard-coded to one declared choice", async () => {
  const proposal = semanticProposal();
  proposal.fields[0] = {
    ...proposal.fields[0],
    controlType: "select",
    testValue: "wheelchair",
    options: [
      { value: "none", label: "None" },
      { value: "wheelchair", label: "Wheelchair" },
    ],
  };
  proposal.proposedActions[0] = {
    ...proposal.proposedActions[0],
    value: "wheelchair",
  };
  proposal.state.kind = "terminal";
  proposal.state.progression.kind = "terminal_submit";
  proposal.mechanics.progressionTarget.kind = "terminal_submit";
  proposal.proposedActions = proposal.proposedActions.filter(
    (action) => action.kind !== "advance",
  );
  const value = bundle(proposal, observation());
  const runtime = {
    prepare: async () => {},
    invoke: async (command) => ({
      attempted: true,
      status: command.value === "wheelchair" ? "verified" : "blocked",
      resolved: true,
      entered: command.operation === "set_field",
      verified: command.value === "wheelchair",
      normalizedReadback: command.value === "wheelchair" ? "wheelchair" : null,
      stateChanged: false,
      failureCode:
        command.value === "wheelchair" ? null : "validation_blocked",
      detail:
        command.value === "wheelchair"
          ? null
          : "This actuator only implements the supplied semantic target value.",
      diagnostics: [],
    }),
  };

  const validation = await preflightActuator({
    runtime,
    semanticProposal: proposal,
    bundle: value,
    releaseId: "release_choice_contract",
    allowProgression: false,
  });

  assert.equal(validation.outcome, "failed");
  assert.ok(
    validation.issues.some(
      (issue) => issue.code === "handler_contract_violation",
    ),
  );
  assert.ok(
    validation.issues
      .filter((issue) => issue.targetKey === "field_01")
      .every((issue) => issue.controlType === "select"),
  );
});

test("actuator result envelopes preserve typed JSON-safe readbacks", () => {
  const base = {
    protocolVersion: 1,
    invocationId: "invoke_typed_readback",
    handlerId: "field_01_handler",
    attempted: true,
    status: "verified",
    resolved: true,
    entered: false,
    verified: true,
    stateChanged: false,
    failureCode: null,
    detail: null,
    diagnostics: [],
    beforeObservationRef: null,
    afterObservationRef: null,
  };
  assert.equal(
    validateActuatorResult({ ...base, normalizedReadback: false })
      .normalizedReadback,
    false,
  );
  assert.deepEqual(
    validateActuatorResult({
      ...base,
      normalizedReadback: { value: "housing", label: "Housing" },
    }).normalizedReadback,
    { value: "housing", label: "Housing" },
  );
});

test("actuator preflight reuses immutable field checkpoints without replay", async () => {
  const currentProposal = semanticProposal();
  currentProposal.state.kind = "terminal";
  currentProposal.state.progression.kind = "terminal_submit";
  currentProposal.mechanics.progressionTarget.kind = "terminal_submit";
  currentProposal.proposedActions = currentProposal.proposedActions.filter(
    (action) => action.kind !== "advance",
  );
  let invokeCount = 0;
  const validation = await preflightActuator({
    runtime: {
      prepare: async () => {},
      invoke: async () => {
        invokeCount += 1;
        throw new Error("A retained checkpoint must not replay its handler.");
      },
    },
    semanticProposal: currentProposal,
    bundle: bundle(currentProposal, observation()),
    releaseId: "release_checkpoint_reuse",
    allowProgression: false,
    prevalidatedTargetKeys: ["field_01"],
  });

  assert.equal(invokeCount, 0);
  assert.equal(validation.outcome, "passed");
  assert.deepEqual(validation.prevalidatedTargetKeys, ["field_01"]);
  assert.equal(validation.results[0].operation, "checkpoint_reused");
});

test("actuator source is readable, hash-linked, capability-checked, and closed", () => {
  const checked = assertActuatorBundle({
    bundle: bundle(),
    semanticProposal: semanticProposal(),
  });
  assert.equal(checked.bundleHash.length, 64);
  assert.deepEqual(checked.capabilities, [
    "keyboard",
    "locator",
    "observe",
    "pointer",
    "wait",
  ]);

  const unsafe = bundle();
  unsafe.modules[0].source =
    "export async function fieldHandler(api, command) { return fetch(command.value); }\n";
  unsafe.modules[0].sourceHash = sha256(unsafe.modules[0].source);
  assert.throws(
    () =>
      assertActuatorBundle({
        bundle: unsafe,
        semanticProposal: semanticProposal(),
      }),
    (error) =>
      error instanceof ActuatorSourceError &&
      error.code === "ACTUATOR_FORBIDDEN_PRIMITIVE",
  );

  for (const escapeSource of [
    `export async function fieldHandler(api, command) {
      const name = "con" + "structor";
      const escape = api.resolveUnique[name];
      return escape("return process")();
    }\n`,
    `export async function fieldHandler(api, command) {
      const { constructor: escape } = api.resolveUnique;
      return escape("return process")();
    }\n`,
  ]) {
    const escaped = bundle();
    escaped.modules[0].source = escapeSource;
    escaped.modules[0].sourceHash = sha256(escapeSource);
    assert.throws(
      () =>
        assertActuatorBundle({
          bundle: escaped,
          semanticProposal: semanticProposal(),
        }),
      (error) =>
        error instanceof ActuatorSourceError &&
      error.code === "ACTUATOR_FORBIDDEN_PRIMITIVE",
    );
  }

  for (const invalidContractSource of [
    `export async function fieldHandler(api, command) {
      const target = await api.resolveUnique("#value_a");
      if (command.kind === "set_field") await api.fill(target, command.value);
      return { attempted: "field_01", status: "ok", resolved: {}, entered: null, verified: true, normalizedReadback: "x", stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
    }\n`,
    `export async function fieldHandler(api, command) {
      const target = await api.resolveUnique(["#value_a"]);
      return { attempted: true, status: "failed", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "not_found", detail: "missing", diagnostics: [] };
    }\n`,
    `export async function fieldHandler(api, command) {
      const target = api.resolveUnique(["#value_a"]);
      const landed = await api.read(target);
      return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: String(landed), stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
    }\n`,
    `export async function fieldHandler(api, command) {
      const target = await api.resolveUnique(["#value_a"]);
      const state = await api.observe(target);
      return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: state.url, stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
    }\n`,
    `export async function fieldHandler(api, command) {
      const target = await api.resolveUnique(["#value_a"]);
      const entered = typeof command.value === "boolean" ? command.value : String(command.value);
      return { attempted: true, status: "verified", resolved: true, entered, verified: true, normalizedReadback: String(command.value), stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
    }\n`,
  ]) {
    const invalid = bundle();
    invalid.modules[0].source = invalidContractSource;
    invalid.modules[0].sourceHash = sha256(invalidContractSource);
    assert.throws(
      () =>
        assertActuatorBundle({
          bundle: invalid,
          semanticProposal: semanticProposal(),
        }),
      (error) =>
        error instanceof ActuatorSourceError &&
        error.code === "ACTUATOR_HANDLER_CONTRACT_INVALID",
    );
  }

  const variableSelectors = bundle();
  variableSelectors.modules[0].source = fieldSource.replace(
    'const target = await api.resolveUnique(["#value_a"]);',
    'const selectors = ["#value_a"];\n  const target = await api.resolveUnique(selectors);',
  );
  variableSelectors.modules[0].sourceHash = sha256(
    variableSelectors.modules[0].source,
  );
  assert.doesNotThrow(() =>
    assertActuatorBundle({
      bundle: variableSelectors,
      semanticProposal: semanticProposal(),
    }),
  );
});

test("statically inspected actuator capabilities repair incomplete model declarations", () => {
  const incomplete = bundle();
  incomplete.handlers[0].capabilities = ["locator", "observe"];
  incomplete.handlers[1].capabilities = ["locator", "observe", "wait"];

  assert.throws(
    () =>
      assertActuatorBundle({
        bundle: incomplete,
        semanticProposal: semanticProposal(),
      }),
    (error) =>
      error instanceof ActuatorSourceError &&
      error.code === "ACTUATOR_CAPABILITY_UNDECLARED",
  );

  const aligned = alignActuatorCapabilities(incomplete);
  assert.equal(aligned.normalizations.length, 2);
  assert.deepEqual(aligned.bundle.handlers[0].capabilities, [
    "keyboard",
    "locator",
    "observe",
  ]);
  assert.deepEqual(aligned.bundle.handlers[1].capabilities, [
    "locator",
    "observe",
    "pointer",
    "wait",
  ]);
  assert.doesNotThrow(() =>
    assertActuatorBundle({
      bundle: aligned.bundle,
      semanticProposal: semanticProposal(),
    }),
  );
});

test("duplicate target capabilities are canonicalized before bundle validation", () => {
  const duplicated = bundle();
  duplicated.handlers[0].operations.push("read_field");
  duplicated.handlers[0].capabilities.push("observe", "keyboard");
  duplicated.handlers[0].sourceFactIds.push("control_fact_01");

  const aligned = alignActuatorCapabilities(duplicated);
  assert.deepEqual(aligned.bundle.handlers[0].operations, [
    "set_field",
    "read_field",
  ]);
  assert.deepEqual(aligned.bundle.handlers[0].capabilities, [
    "keyboard",
    "locator",
    "observe",
  ]);
  assert.deepEqual(aligned.bundle.handlers[0].sourceFactIds, [
    "control_fact_01",
  ]);
  assert.doesNotThrow(() =>
    assertActuatorBundle({
      bundle: aligned.bundle,
      semanticProposal: semanticProposal(),
    }),
  );
});

test("generated actuator targets receive isolated static validation", () => {
  const value = bundle();
  const validated = validateGeneratedActuatorTarget({
    target: { targetKey: "field_01" },
    responseId: "response_1",
    model: "test-model",
    rationale: "Test target.",
    handler: {
      ...value.handlers[0],
      capabilities: ["locator", "observe", "observe"],
    },
    module: value.modules[0],
  });
  assert.equal(validated.targetValidation.outcome, "passed");
  assert.deepEqual(validated.handler.capabilities, [
    "keyboard",
    "locator",
    "observe",
  ]);
});

test("static actuator validation rejects control-type-incompatible operations", () => {
  const proposal = semanticProposal();
  proposal.fields[0] = {
    ...proposal.fields[0],
    controlType: "radio",
    options: [
      { label: "Rent", value: "Rent" },
      { label: "Own", value: "Own" },
    ],
    testValue: "Rent",
  };
  const value = bundle(proposal, observation());
  const invalidSource = `export async function fieldHandler(api, command) {
  const target = await api.resolveUnique(["input[name=housing]"]);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "Missing radio group.", diagnostics: [] };
  await api.select(target, command.value);
  return { attempted: true, status: "verified", resolved: true, entered: true, verified: true, normalizedReadback: String(command.value), stateChanged: true, failureCode: null, detail: null, diagnostics: [] };
}
`;
  value.modules[0] = {
    ...value.modules[0],
    source: invalidSource,
    sourceHash: sha256(invalidSource),
  };
  value.handlers[0].capabilities = ["locator", "select"];
  assert.throws(
    () => assertActuatorBundle({ bundle: value, semanticProposal: proposal }),
    (error) => error?.code === "ACTUATOR_HANDLER_CONTROL_MISMATCH",
  );

  const validRadioSource = `export async function fieldHandler(api, command) {
  const selector = command.value === "Rent" ? "#housing-rent" : "#housing-own";
  const target = await api.resolveUnique(selector);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "Missing radio option.", diagnostics: [] };
  if (command.operation === "set_field") await api.check(target);
  const checked = await api.isChecked(target);
  return { attempted: true, status: checked ? "verified" : "failed", resolved: true, entered: command.operation === "set_field", verified: checked, normalizedReadback: checked ? String(command.value) : null, stateChanged: checked, failureCode: checked ? null : "readback_unverified", detail: checked ? null : "Radio option was not checked.", diagnostics: [] };
}
`;
  value.modules[0] = {
    ...value.modules[0],
    source: validRadioSource,
    sourceHash: sha256(validRadioSource),
  };
  value.handlers[0].capabilities = ["locator", "observe", "pointer"];
  assert.doesNotThrow(() =>
    assertActuatorBundle({ bundle: value, semanticProposal: proposal }),
  );
});

test("actuator resolvers accept validated scalar selector strings", () => {
  const proposal = semanticProposal();
  const value = bundle(proposal, observation());
  const scalarSource = fieldSource.replace(
    'api.resolveUnique(["#value_a"])',
    'api.resolveUnique("#value_a")',
  );
  value.modules[0] = {
    ...value.modules[0],
    source: scalarSource,
    sourceHash: sha256(scalarSource),
  };
  assert.doesNotThrow(() =>
    assertActuatorBundle({ bundle: value, semanticProposal: proposal }),
  );
});

test("actuator repairs replace complete named handlers and preserve other modules", () => {
  const proposal = semanticProposal();
  const current = bundle(proposal);
  const currentHash = assertActuatorBundle({
    bundle: current,
    semanticProposal: proposal,
  }).bundleHash;
  const replacementSource = fieldSource.replace(
    "The field did not resolve.",
    "The generated field handler did not resolve its target.",
  );
  const repaired = applyActuatorRepair({
    bundle: current,
    semanticProposal: proposal,
    nextBundleId: "actuator_test_bundle_v2",
    repair: {
      schemaVersion: 1,
      repairId: "repair_actuator_01",
      layer: "actuator",
      baseBundleHash: currentHash,
      issueIds: ["issue_locator"],
      replacements: [
        {
          modulePath: "handlers/field_01.mjs",
          source: replacementSource,
          sourceHash: sha256(replacementSource),
          handlerIds: ["field_01_handler"],
          capabilities: ["keyboard", "locator", "observe"],
        },
      ],
      rationale: "Replace the one failing field handler.",
    },
  });
  assert.deepEqual(repaired.replacedHandlerIds, ["field_01_handler"]);
  assert.notEqual(repaired.bundleHash, currentHash);
  assert.equal(
    repaired.bundle.modules.find(
      (module) => module.modulePath === "handlers/action_01.mjs",
    ).sourceHash,
    current.modules[1].sourceHash,
  );
});

test(
  "modular actuator stores, loads, and preflights through the typed protocol",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-actuator-"));
    const proposal = semanticProposal();
    const observed = observation(fixture.origin);
    const value = bundle(proposal, observed);
    try {
      await writeActuatorBundle({ root, bundle: value, semanticProposal: proposal });
      const loaded = await loadActuatorBundle({
        root,
        artifactId: value.artifactId,
        bundleVersion: 1,
      });
      assert.match(
        loaded.bundle.modules[0].source,
        /export async function fieldHandler/,
      );
      const nextValue = structuredClone(value);
      nextValue.bundleId = "actuator_test_bundle_v2";
      nextValue.bundleVersion = 2;
      await writeActuatorBundle({
        root,
        bundle: nextValue,
        semanticProposal: proposal,
      });

      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: loaded.bundle,
        handlers: loaded.handlers,
        releaseId: "release_test_01",
        evidenceSink: async ({ kind }) => `evidence://${kind}`,
      });
      const preflight = await preflightActuator({
        runtime,
        semanticProposal: proposal,
        bundle: loaded.bundle,
        releaseId: "release_test_01",
      });
      assert.equal(preflight.outcome, "passed");
      assert.equal(preflight.issues.length, 0);
      assert.ok(preflight.results.some((item) => item.operation === "set_field"));
      assert.ok(
        preflight.results.some((item) => item.operation === "execute_action"),
      );
      assert.equal(page.url(), `${fixture.origin}next`);

      assert.doesNotThrow(() =>
        validateActuatorCommand({
          protocolVersion: 1,
          invocationId: "invoke_test_01",
          releaseId: "release_test_01",
          semanticVersion: 1,
          actuatorVersion: 1,
          stateKey: "state_01",
          targetKind: "field",
          targetKey: "field_01",
          operation: "read_field",
          value: "INTAKECR TEST",
          mode: "validation_replay",
          directive: { progressionPermission: "forbidden" },
        }),
      );
      assert.doesNotThrow(() =>
        validateActuatorResult(
          preflight.results.find((item) => item.operation === "read_field").result,
        ),
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "invalid generated result envelopes route to actuator repair instead of escaping preflight",
  { timeout: 30_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const proposal = semanticProposal();
    const value = bundle(proposal, observation(fixture.origin));
    const fieldDescriptor = value.handlers.find(
      (handler) => handler.targetKind === "field" && handler.targetKey === "field_01",
    );
    const handlers = new Map([
      [
        fieldDescriptor.handlerId,
        async () => ({
          attempted: false,
          status: "verified",
          resolved: true,
          entered: false,
          verified: true,
          normalizedReadback: "INTAKECR TEST",
          stateChanged: false,
          failureCode: null,
          detail: null,
          diagnostics: [],
        }),
      ],
    ]);
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: value,
        handlers,
        releaseId: "release_invalid_result",
      });
      const result = await runtime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_invalid_result",
        releaseId: "release_invalid_result",
        semanticVersion: 1,
        actuatorVersion: value.bundleVersion,
        stateKey: proposal.state.key,
        targetKind: "field",
        targetKey: "field_01",
        operation: "read_field",
        value: proposal.fields[0].testValue,
        mode: "validation_replay",
        directive: { progressionPermission: "forbidden" },
      });
      assert.equal(result.status, "failed");
      assert.equal(result.failureCode, "handler_contract_violation");
      assert.match(result.detail, /verified result must be attempted/i);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "trusted runtime accepts an exact independent readback despite a generated comparison defect",
  { timeout: 30_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const proposal = semanticProposal();
    const value = bundle(proposal, observation(fixture.origin));
    const fieldDescriptor = value.handlers.find(
      (handler) => handler.targetKind === "field" && handler.targetKey === "field_01",
    );
    const handlers = new Map([
      [
        fieldDescriptor.handlerId,
        async (_api, command) => ({
          attempted: true,
          status: "failed",
          resolved: true,
          entered: false,
          verified: false,
          normalizedReadback: String(command.value),
          stateChanged: false,
          failureCode: "readback_unverified",
          detail: "Generated comparison used the wrong expected value.",
          diagnostics: [],
        }),
      ],
    ]);
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: value,
        handlers,
        releaseId: "release_runtime_readback",
      });
      const result = await runtime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_runtime_readback",
        releaseId: "release_runtime_readback",
        semanticVersion: 1,
        actuatorVersion: value.bundleVersion,
        stateKey: proposal.state.key,
        targetKind: "field",
        targetKey: "field_01",
        operation: "read_field",
        value: proposal.fields[0].testValue,
        mode: "validation_replay",
        directive: { progressionPermission: "forbidden" },
      });
      assert.equal(result.status, "verified");
      assert.equal(result.verified, true);
      assert.equal(result.failureCode, null);
      assert.equal(result.normalizedReadback, proposal.fields[0].testValue);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "trusted runtime recognizes progression that lands after the generated handler returns",
  { timeout: 30_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const proposal = semanticProposal();
    const value = bundle(proposal, observation(fixture.origin));
    const actionDescriptor = value.handlers.find(
      (handler) => handler.targetKind === "action",
    );
    let page;
    const handlers = new Map([
      [
        actionDescriptor.handlerId,
        async () => {
          setTimeout(() => {
            void page.goto(`${fixture.origin}next`).catch(() => {});
          }, 25);
          return {
            attempted: true,
            status: "failed",
            resolved: true,
            entered: false,
            verified: false,
            normalizedReadback: null,
            stateChanged: false,
            failureCode: "state_change_unverified",
            detail: "The handler observed the page before navigation landed.",
            diagnostics: [],
          };
        },
      ],
    ]);
    try {
      page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: value,
        handlers,
        releaseId: "release_late_progression",
      });
      const result = await runtime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_late_progression",
        releaseId: "release_late_progression",
        semanticVersion: 1,
        actuatorVersion: value.bundleVersion,
        stateKey: proposal.state.key,
        targetKind: "action",
        targetKey: proposal.state.progression.key,
        operation: "execute_action",
        value: null,
        mode: "validation_replay",
        directive: { progressionPermission: "allowed" },
      });
      assert.equal(page.url(), `${fixture.origin}next`);
      assert.equal(result.status, "verified");
      assert.equal(result.verified, true);
      assert.equal(result.stateChanged, true);
      assert.equal(result.failureCode, null);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "mechanics evidence in generated diagnostics routes environment wrappers to actuator repair",
  { timeout: 30_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const proposal = semanticProposal();
    const value = bundle(proposal, observation(fixture.origin));
    const fieldDescriptor = value.handlers.find(
      (handler) => handler.targetKind === "field" && handler.targetKey === "field_01",
    );
    const handlers = new Map([
      [
        fieldDescriptor.handlerId,
        async () => ({
          attempted: true,
          status: "failed",
          resolved: true,
          entered: false,
          verified: false,
          normalizedReadback: null,
          stateChanged: false,
          failureCode: "environment_error",
          detail: "Unexpected environment error while handling the field.",
          diagnostics: [
            {
              code: "environment_error",
              detail: "locator.click: label intercepts pointer events",
            },
          ],
        }),
      ],
    ]);
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: value,
        handlers,
        releaseId: "release_mechanics_diagnostic",
      });
      const result = await runtime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_mechanics_diagnostic",
        releaseId: "release_mechanics_diagnostic",
        semanticVersion: 1,
        actuatorVersion: value.bundleVersion,
        stateKey: proposal.state.key,
        targetKind: "field",
        targetKey: "field_01",
        operation: "set_field",
        value: proposal.fields[0].testValue,
        mode: "validation_replay",
        directive: { progressionPermission: "forbidden" },
      });
      assert.equal(result.failureCode, "actuation_unverified");
      assert.equal(result.diagnostics[0].code, "actuation_unverified");
      assert.match(result.detail, /intercepts pointer events/i);
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "generated handlers own and verify scroll-gated acceptance mechanics",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-scroll-actuator-"));
    const proposal = semanticProposal();
    proposal.fields[0] = {
      ...proposal.fields[0],
      rawLabel: "I agree",
      controlType: "checkbox",
      testValue: true,
      resolutionHints: ["#accept"],
    };
    proposal.mechanics.fieldTargets[0] = {
      fieldKey: "field_01",
      selectors: ["#accept"],
    };
    proposal.proposedActions[0] = {
      ...proposal.proposedActions[0],
      value: true,
    };
    const observed = observation(fixture.origin);
    observed.url = `${fixture.origin}scroll-gate`;
    observed.controls[0] = {
      ...observed.controls[0],
      rawType: "checkbox",
      id: "accept",
      name: "accept",
      rawLabel: "I agree",
      disabled: true,
      selectorCandidates: ["#accept"],
    };
    observed.scrollRegions = [
      {
        factId: "scroll_region_0",
        tag: "div",
        role: null,
        rawLabel: "Synthetic terms of use",
        textExcerpt: "Synthetic terms of use",
        selectorCandidates: ["#terms"],
        scrollTop: 0,
        clientHeight: 40,
        scrollHeight: 400,
        atEnd: false,
        containedControlFactIds: [],
      },
    ];
    const scrollFieldSource = `export async function fieldHandler(api, command) {
  const terms = await api.resolveUnique(["#terms"]);
  const target = await api.resolveUnique(["#accept"]);
  if (!terms || !target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The terms gate did not resolve.", diagnostics: [] };
  if (command.operation === "set_field") {
    const scroll = await api.scrollToEnd(["#terms"]);
    await api.wait(25);
    if (!scroll.atEnd || !(await api.isEnabled(target))) return { attempted: true, status: "failed", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "actuation_unverified", detail: "The acceptance control did not become enabled.", diagnostics: [] };
    await api.check(target);
  }
  const landed = await api.read(target);
  const verified = landed === true;
  return { attempted: true, status: verified ? "verified" : "failed", resolved: true, entered: command.operation === "set_field", verified, normalizedReadback: String(landed), stateChanged: false, failureCode: verified ? null : "readback_unverified", detail: verified ? null : "Acceptance readback did not match.", diagnostics: [{ telemetry: "scroll-gate" }] };
}
`;
    const value = bundle(proposal, observed);
    value.modules[0] = {
      modulePath: "handlers/field_01.mjs",
      source: scrollFieldSource,
      sourceHash: sha256(scrollFieldSource),
    };
    value.handlers[0].capabilities = ["locator", "observe", "pointer", "wait"];
    try {
      await writeActuatorBundle({ root, bundle: value, semanticProposal: proposal });
      const loaded = await loadActuatorBundle({
        root,
        artifactId: value.artifactId,
        bundleVersion: 1,
      });
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}scroll-gate`);
      const runtime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: loaded.bundle,
        handlers: loaded.handlers,
        releaseId: "release_scroll_gate",
      });
      await runtime.prepare();
      const result = await runtime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_scroll_gate",
        releaseId: "release_scroll_gate",
        semanticVersion: 1,
        actuatorVersion: 1,
        stateKey: "state_01",
        targetKind: "field",
        targetKey: "field_01",
        operation: "set_field",
        value: true,
        mode: "validation_replay",
        directive: { progressionPermission: "forbidden" },
      });
      assert.equal(result.status, "verified");
      assert.equal(await page.locator("#accept").isChecked(), true);
      assert.ok(await page.evaluate(() => window.termScrolls > 0));
      const telemetryValidation = await preflightActuator({
        runtime,
        semanticProposal: proposal,
        bundle: loaded.bundle,
        releaseId: "release_scroll_gate",
        allowProgression: false,
      });
      assert.equal(telemetryValidation.outcome, "passed");
      assert.equal(telemetryValidation.issues.length, 0);

      await page.goto(`${fixture.origin}scroll-gate`);
      const brokenRuntime = createActuatorRuntime({
        page,
        semanticProposal: proposal,
        bundle: value,
        handlers: new Map([
          [
            "field_01_handler",
            async (api) => {
              const target = await api.resolveUnique(["#accept"]);
              try {
                await api.check(target);
                return { attempted: true, status: "verified", resolved: true, entered: true, verified: true, normalizedReadback: "true", stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
              } catch (error) {
                return { attempted: true, status: "failed", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "environment_error", detail: error.message, diagnostics: [] };
              }
            },
          ],
        ]),
        releaseId: "release_scroll_gate_broken",
        handlerTimeoutMs: 7_000,
      });
      await brokenRuntime.prepare();
      const normalizedFailure = await brokenRuntime.invoke({
        protocolVersion: 1,
        invocationId: "invoke_scroll_gate_broken",
        releaseId: "release_scroll_gate_broken",
        semanticVersion: 1,
        actuatorVersion: 1,
        stateKey: "state_01",
        targetKind: "field",
        targetKey: "field_01",
        operation: "set_field",
        value: true,
        mode: "validation_replay",
        directive: { progressionPermission: "forbidden" },
      });
      assert.equal(normalizedFailure.failureCode, "actuation_unverified");
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "state actuator repair enforces and activates a grounded prerequisite splice",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-prerequisite-repair-"));
    const proposal = semanticProposal();
    proposal.fields[0] = {
      ...proposal.fields[0],
      rawLabel: "I agree",
      controlType: "checkbox",
      testValue: true,
      resolutionHints: ["#accept"],
    };
    proposal.mechanics.fieldTargets[0] = {
      fieldKey: "field_01",
      selectors: ["#accept"],
    };
    proposal.proposedActions[0] = {
      ...proposal.proposedActions[0],
      value: true,
    };
    proposal.state.kind = "terminal";
    proposal.state.progression.kind = "terminal_submit";
    proposal.mechanics.progressionTarget.kind = "terminal_submit";
    proposal.proposedActions = proposal.proposedActions.filter(
      (action) => action.kind !== "advance",
    );
    const observed = observation(fixture.origin);
    observed.url = `${fixture.origin}scroll-gate`;
    observed.controls[0] = {
      ...observed.controls[0],
      rawType: "checkbox",
      id: "accept",
      name: "accept",
      rawLabel: "I agree",
      disabled: true,
      selectorCandidates: ["#accept"],
    };
    observed.scrollRegions = [
      {
        factId: "scroll_region_0",
        selectorCandidates: ["#terms"],
        scrollTop: 0,
        clientHeight: 40,
        scrollHeight: 400,
        atEnd: false,
      },
    ];
    const blockedSource = `export async function fieldHandler(api, command) {
  const target = await api.resolveUnique(["#accept"]);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The field did not resolve.", diagnostics: [] };
  if (command.operation === "read_field") { const landed = await api.isChecked(target); return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: landed, stateChanged: false, failureCode: null, detail: null, diagnostics: [] }; }
  const enabled = await api.isEnabled(target);
  if (!enabled) return { attempted: true, status: "blocked", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "The agreement field is not enabled until its prerequisite is complete.", diagnostics: [] };
  await api.check(target);
  const landed = await api.isChecked(target);
  return { attempted: true, status: landed ? "verified" : "failed", resolved: true, entered: true, verified: landed, normalizedReadback: landed, stateChanged: landed, failureCode: landed ? null : "readback_unverified", detail: landed ? null : "Readback did not match.", diagnostics: [] };
}
`;
    const repairedSource = `export async function fieldHandler(api, command) {
  const terms = await api.resolveUnique(["#terms"]);
  const target = await api.resolveUnique(["#accept"]);
  if (!terms || !target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The terms gate did not resolve.", diagnostics: [] };
  if (command.operation === "set_field") { await api.scrollToEnd(["#terms"]); await api.wait(25); if (!(await api.isEnabled(target))) return { attempted: true, status: "failed", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "actuation_unverified", detail: "The acceptance control did not become enabled.", diagnostics: [] }; await api.check(target); }
  const landed = await api.isChecked(target);
  return { attempted: true, status: landed ? "verified" : "failed", resolved: true, entered: command.operation === "set_field", verified: landed, normalizedReadback: landed, stateChanged: false, failureCode: landed ? null : "readback_unverified", detail: landed ? null : "Acceptance readback did not match.", diagnostics: [] };
}
`;
    const initialBundle = bundle(proposal, observed);
    initialBundle.modules[0] = {
      modulePath: "handlers/field_01.mjs",
      source: blockedSource,
      sourceHash: sha256(blockedSource),
    };
    initialBundle.handlers[0].capabilities = ["locator", "observe", "pointer"];
    const checked = assertActuatorBundle({
      bundle: initialBundle,
      semanticProposal: proposal,
    });
    const events = [];
    let suppliedObligation = null;
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}scroll-gate`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: initialBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        restoreAfterPreflight: false,
        onEvent: async (kind, message, metadata) =>
          events.push({ kind, message, metadata }),
        generators: {
          generateActuatorBundle: async () => ({
            bundle: initialBundle,
            bundleHash: checked.bundleHash,
            provenance: { source: "test" },
          }),
          generateActuatorRepair: async ({
            bundleHash,
            issues,
            prerequisiteObligation,
          }) => {
            suppliedObligation = prerequisiteObligation;
            return {
              repair: {
                schemaVersion: 1,
                repairId: "repair_grounded_prerequisite",
                layer: "actuator",
                baseBundleHash: bundleHash,
                issueIds: issues.map((issue) => issue.issueId),
                replacements: [
                  {
                    modulePath: "handlers/field_01.mjs",
                    source: repairedSource,
                    sourceHash: sha256(repairedSource),
                    handlerIds: ["field_01_handler"],
                    capabilities: ["locator", "observe", "pointer", "wait"],
                  },
                ],
                rationale: "Use the observed scroll prerequisite before the agreement field.",
              },
              provenance: { source: "test" },
            };
          },
        },
      });
      assert.equal(result.validation.outcome, "passed");
      assert.equal(suppliedObligation.kind, "rendered_target_prerequisite");
      assert.ok(
        events.some(
          (event) => event.kind === "repair_prerequisite_obligation_declared",
        ),
      );
      assert.ok(
        events.some(
          (event) => event.kind === "repair_prerequisite_obligation_satisfied",
        ),
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("frame-capable global resolution finds one unique child-frame prerequisite", async () => {
  const fixture = await fixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const proposal = semanticProposal();
    proposal.fields[0] = {
      ...proposal.fields[0],
      rawLabel: "I agree",
      controlType: "checkbox",
      testValue: true,
      resolutionHints: ["#accept"],
    };
    proposal.mechanics.fieldTargets[0] = {
      fieldKey: "field_01",
      selectors: ["#accept"],
    };
    proposal.proposedActions[0] = {
      ...proposal.proposedActions[0],
      value: true,
    };
    const observed = observation(fixture.origin);
    const value = bundle(proposal, observed);
    value.handlers[0].capabilities = ["frame", "locator", "observe", "pointer"];
    const handlerId = value.handlers[0].handlerId;
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}frame-scroll-gate`);
    const runtime = createActuatorRuntime({
      page,
      semanticProposal: proposal,
      bundle: value,
      handlers: new Map([
        [
          handlerId,
          async (api) => {
            const terms = await api.resolveUnique("#terms");
            const target = await api.resolveUnique("#accept");
            if (!terms || !target) {
              return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "Framed terms did not resolve.", diagnostics: [] };
            }
            await api.scrollToEnd(terms);
            if (!(await api.isEnabled(target))) {
              return { attempted: true, status: "blocked", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "Agreement stayed disabled.", diagnostics: [] };
            }
            await api.check(target);
            const checked = await api.read(target);
            return { attempted: true, status: checked ? "verified" : "failed", resolved: true, entered: true, verified: checked === true, normalizedReadback: String(checked), stateChanged: false, failureCode: checked ? null : "readback_unverified", detail: null, diagnostics: [] };
          },
        ],
      ]),
      releaseId: "release_frame_scroll_gate",
    });
    await runtime.prepare();
    const result = await runtime.invoke({
      protocolVersion: 1,
      invocationId: "invoke_frame_scroll_gate",
      releaseId: "release_frame_scroll_gate",
      semanticVersion: 1,
      actuatorVersion: value.bundleVersion,
      stateKey: proposal.state.key,
      targetKind: "field",
      targetKey: "field_01",
      operation: "set_field",
      value: true,
      mode: "validation_replay",
      directive: { progressionPermission: "forbidden" },
    });
    assert.equal(result.status, "verified", JSON.stringify(result));
    assert.equal(await page.locator("#accept").isChecked(), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("pointer primitives cross a unique associated-label overlay", async () => {
  const fixture = await fixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const proposal = semanticProposal();
    proposal.fields[0] = {
      ...proposal.fields[0],
      controlType: "radio",
      testValue: "a",
      options: [{ value: "a", label: "Choice A" }],
    };
    proposal.proposedActions[0] = {
      ...proposal.proposedActions[0],
      value: "a",
    };
    const observed = observation(fixture.origin);
    const value = bundle(proposal, observed);
    value.handlers[0].capabilities = ["locator", "observe", "pointer"];
    const handlerId = value.handlers[0].handlerId;
    const page = await browser.newPage();
    await page.goto(`${fixture.origin}label-overlay`);
    const runtime = createActuatorRuntime({
      page,
      semanticProposal: proposal,
      bundle: value,
      handlers: new Map([
        [
          handlerId,
          async (api) => {
            const target = await api.resolveUnique("#choice-a");
            await api.click(target);
            const checked = await api.isChecked(target);
            return { attempted: true, status: checked ? "verified" : "failed", resolved: true, entered: true, verified: checked, normalizedReadback: checked ? "a" : null, stateChanged: false, failureCode: checked ? null : "readback_unverified", detail: null, diagnostics: [] };
          },
        ],
      ]),
      releaseId: "release_label_overlay",
    });
    await runtime.prepare();
    const result = await runtime.invoke({
      protocolVersion: 1,
      invocationId: "invoke_label_overlay",
      releaseId: "release_label_overlay",
      semanticVersion: 1,
      actuatorVersion: value.bundleVersion,
      stateKey: proposal.state.key,
      targetKind: "field",
      targetKey: "field_01",
      operation: "set_field",
      value: "a",
      mode: "validation_replay",
      directive: { progressionPermission: "forbidden" },
    });
    assert.equal(result.status, "verified", JSON.stringify(result));
    assert.equal(await page.locator("#choice-a").isChecked(), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("typed native compilation and model output become one validated readable bundle", async () => {
  const proposal = semanticProposal();
  const observed = observation();
  proposal.fields[0].guidanceRefs = ["inherited_guidance"];
  observed.existingContract = {
    fields: [],
    sections: [],
    guidance: [{ key: "inherited_guidance" }],
    states: [],
  };
  const requests = [];
  const result = await generateActuatorBundle(
    {
      artifactId: "form_0123456789abcdef01234567",
      bundleVersion: 1,
      bundleId: "actuator_generated_test",
      semanticProposal: proposal,
      observation: observed,
    },
    {
      configuration: {
        configured: true,
        apiKey: "test-key",
        model: "test-model",
      },
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        const prompt = request.input[1].content[0].text;
        const generatedBundle = bundle(proposal, observed);
        const targetIndex = /"targetKind":"field"/.test(prompt) ? 0 : 1;
        const handler = generatedBundle.handlers[targetIndex];
        const actuatorModule = generatedBundle.modules[targetIndex];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "response_test",
            status: "completed",
            output_text: JSON.stringify({
              exportName: handler.exportName,
              capabilities: handler.capabilities,
              source: actuatorModule.source,
              rationale: `Generated ${handler.targetKey} module.`,
            }),
          }),
        };
      },
    },
  );
  assert.equal(result.bundleHash.length, 64);
  assert.match(result.bundle.modules[0].source, /nativeTextHandler/);
  assert.equal(requests.length, 1);
  assert.ok(requests.every((request) => request.store === false));
  assert.ok(requests.every((request) => request.max_output_tokens === 8_000));
  const request = requests[0];
  assert.match(
    request.input[1].content[0].text,
    /declared field\/action is resolved, actuated, and read back/i,
  );
  assert.match(
    request.input[1].content[0].text,
    /Allowed api methods[^\n]+scrollToEnd[^\n]+isEnabled/i,
  );
  assert.match(request.input[1].content[0].text, /Directly await every api call/i);
});

test(
  "browser actuator preflight verifies progression and rebaselines before full execution",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-actuator-rebaseline-"));
    const proposal = semanticProposal();
    const observed = observation(fixture.origin);
    const generatedBundle = bundle(proposal, observed);
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    let checkpointRestored = false;
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: generatedBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        restoreAfterPreflight: async ({ runtime, validation }) => {
          checkpointRestored = true;
          assert.equal(validation.outcome, "passed");
          await runtime.rebaseline(`${fixture.origin}start`);
        },
        generators: {
          generateActuatorBundle: async () => ({
            bundle: generatedBundle,
            bundleHash: checked.bundleHash,
            provenance: { source: "test" },
          }),
        },
      });
      assert.equal(result.validation.outcome, "passed");
      assert.equal(checkpointRestored, true);
      assert.ok(
        result.validation.results.some(
          (entry) => entry.operation === "execute_action",
        ),
      );
      assert.equal(page.url(), `${fixture.origin}start`);
      assert.equal(await page.locator("#value_a").inputValue(), "");
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "branch-variant actuator preflight validates only delta fields and delegates parent progression",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(
      path.join(os.tmpdir(), "intakecr-actuator-branch-scope-"),
    );
    const proposal = semanticProposal();
    const observed = observation(fixture.origin);
    const generatedBundle = bundle(proposal, observed);
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    const events = [];
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: generatedBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
          variantOnly: true,
          branchTrigger: { fieldKey: "parent_choice", value: "yes" },
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        restoreAfterPreflight: false,
        onEvent: async (kind, message, metadata) =>
          events.push({ kind, message, metadata }),
        generators: {
          generateActuatorBundle: async () => ({
            bundle: generatedBundle,
            bundleHash: checked.bundleHash,
            provenance: { source: "test" },
          }),
        },
      });
      assert.equal(result.validation.outcome, "passed");
      assert.equal(result.plan.actuator.certificationScope.progressionOwned, false);
      assert.equal(
        result.plan.actuator.certificationScope.progressionDelegatedTo,
        "parent_state",
      );
      assert.equal(
        result.validation.results.some(
          (entry) => entry.operation === "execute_action",
        ),
        false,
      );
      assert.equal(page.url(), `${fixture.origin}start`);
      assert.ok(
        events.some(
          (event) => event.kind === "actuator_preflight_scope_declared",
        ),
      );
      assert.ok(
        events.some(
          (event) => event.kind === "actuator_progression_delegated",
        ),
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "browser actuator preflight permits an authorized native form advance through submission guards",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-actuator-native-advance-"));
    const proposal = semanticProposal();
    proposal.state.normalizedRoute = "/form-start";
    const observed = {
      ...observation(fixture.origin),
      url: `${fixture.origin}form-start`,
      normalizedRoute: "/form-start",
    };
    const generatedBundle = bundle(proposal, observed);
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    try {
      const page = await browser.newPage();
      await installSubmissionGuards(page, "fixture_submit");
      await page.goto(`${fixture.origin}form-start`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: generatedBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        restoreAfterPreflight: false,
        generators: {
          generateActuatorBundle: async () => ({
            bundle: generatedBundle,
            bundleHash: checked.bundleHash,
            provenance: { source: "test" },
          }),
        },
      });
      assert.equal(result.validation.outcome, "passed");
      assert.equal(page.url(), `${fixture.origin}next?value_a=INTAKECR+TEST`);
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "an invalid model-authored repair receives one compiler-guided retry before replay",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-actuator-repair-compile-"));
    const proposal = semanticProposal();
    const observed = observation(fixture.origin);
    const generatedBundle = bundle(proposal, observed);
    const unresolvedSource = fieldSource.replaceAll("#value_a", "#missing");
    generatedBundle.modules[0] = {
      ...generatedBundle.modules[0],
      source: unresolvedSource,
      sourceHash: sha256(unresolvedSource),
    };
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    const invalidRepairSource = fieldSource.replace(
      'const target = await api.resolveUnique(["#value_a"]);',
      'const selectorByOperation = { set_field: "#value_a", read_field: "#value_a" };\n  const target = await api.resolveUnique([selectorByOperation[command.operation]]);',
    );
    let generationCalls = 0;
    let repairCalls = 0;
    const events = [];
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: generatedBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        onEvent: async (kind, message, metadata) =>
          events.push({ kind, message, metadata }),
        generators: {
          generateActuatorBundle: async () => {
            generationCalls += 1;
            if (generationCalls <= 2) {
              const error = new Error("Synthetic source failed static validation.");
              error.code = "ACTUATOR_SOURCE_INVALID";
              throw error;
            }
            return {
              bundle: generatedBundle,
              bundleHash: checked.bundleHash,
              provenance: { source: "test" },
            };
          },
          generateActuatorRepair: async ({ bundleHash, issues }) => {
            repairCalls += 1;
            const source = repairCalls === 1 ? invalidRepairSource : fieldSource;
            return {
              repair: {
                schemaVersion: 1,
                repairId: `repair_actuator_retry_${repairCalls}`,
                layer: "actuator",
                baseBundleHash: bundleHash,
                issueIds: issues.map((issue) => issue.issueId),
                replacements: [
                  {
                    modulePath: "handlers/field_01.mjs",
                    source,
                    sourceHash: sha256(source),
                    handlerIds: ["field_01_handler"],
                    capabilities: ["keyboard", "locator", "observe"],
                  },
                ],
                rationale: "Repair the unresolved synthetic field handler.",
              },
              provenance: { source: "test" },
            };
          },
        },
      });
      assert.equal(result.validation.outcome, "passed");
      assert.equal(generationCalls, 3);
      assert.equal(repairCalls, 2);
      assert.ok(
        events.some((event) => event.kind === "actuator_repair_validation_retry"),
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "repeated browser failure remains terminal when a later compiler repair fails",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(
      path.join(os.tmpdir(), "intakecr-browser-failure-precedence-"),
    );
    const proposal = semanticProposal();
    const observed = observation(fixture.origin);
    const generatedBundle = bundle(proposal, observed);
    const firstUnresolvedSource = fieldSource.replaceAll(
      "#value_a",
      "#missing_a",
    );
    generatedBundle.modules[0] = {
      ...generatedBundle.modules[0],
      source: firstUnresolvedSource,
      sourceHash: sha256(firstUnresolvedSource),
    };
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    const secondUnresolvedSource = fieldSource.replaceAll(
      "#value_a",
      "#missing_b",
    );
    const unsupportedCapabilitySource = fieldSource.replace(
      'const target = await api.resolveUnique(["#value_a"]);',
      'await api.pointer();\n  const target = await api.resolveUnique(["#missing_c"]);',
    );
    let repairCalls = 0;
    const events = [];
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      await assert.rejects(
        generateValidateStateActuator({
          page,
          artifactId: generatedBundle.artifactId,
          sequence: 1,
          semanticProposal: proposal,
          plan: {
            state: proposal.state,
            fields: proposal.fields.map((field) => ({
              ...field,
              actuate: true,
            })),
          },
          observation: observed,
          screenshot: null,
          storeRoot: root,
          preflightMode: "browser",
          restoreAfterPreflight: false,
          onEvent: async (kind, message, metadata) =>
            events.push({ kind, message, metadata }),
          generators: {
            generateActuatorBundle: async () => ({
              bundle: generatedBundle,
              bundleHash: checked.bundleHash,
              provenance: { source: "test" },
            }),
            generateActuatorRepair: async ({ bundleHash, issues }) => {
              repairCalls += 1;
              const source =
                repairCalls < 3
                  ? secondUnresolvedSource
                  : unsupportedCapabilitySource;
              return {
                repair: {
                  schemaVersion: 1,
                  repairId: `repair_failure_precedence_${repairCalls}`,
                  layer: "actuator",
                  baseBundleHash: bundleHash,
                  issueIds: issues.map((issue) => issue.issueId),
                  replacements: [
                    {
                      modulePath: "handlers/field_01.mjs",
                      source,
                      sourceHash: sha256(source),
                      handlerIds: ["field_01_handler"],
                      capabilities: ["keyboard", "locator", "observe"],
                    },
                  ],
                  rationale:
                    "Exercise browser-failure precedence after bounded target repair.",
                },
                provenance: { source: "test" },
              };
            },
            generateRepairDiagnosis: async ({ issues }) => ({
              diagnosis: {
                schemaVersion: 1,
                diagnosisId: "diagnosis_browser_failure_precedence",
                classification: "actuator",
                issueIds: issues.map((issue) => issue.issueId),
                evidenceRefs: [],
                rationale:
                  "The same browser-resolved target predicate survived repair.",
                confidence: "high",
              },
            }),
          },
        }),
        (error) => {
          assert.equal(error.failureStage, "actuator_preflight_failed");
          assert.equal(error.issues[0].code, "locator_unresolved");
          assert.equal(error.issues[0].targetKey, "field_01");
          assert.deepEqual(
            error.partial.subordinateRepairIssues.map((issue) => issue.code),
            ["ACTUATOR_CAPABILITY_UNKNOWN"],
          );
          return true;
        },
      );
      assert.equal(repairCalls, 3);
      const precedence = events.find(
        (event) =>
          event.kind === "repair_browser_failure_precedence_applied",
      );
      assert.ok(precedence);
      assert.deepEqual(precedence.metadata.winningIssueCodes, [
        "locator_unresolved",
      ]);
      assert.deepEqual(precedence.metadata.subordinateIssueCodes, [
        "ACTUATOR_CAPABILITY_UNKNOWN",
      ]);
      assert.deepEqual(precedence.metadata.targetKeys, ["field_01"]);
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "an exhausted optional target is quarantined without discarding certified state execution",
  { timeout: 60_000 },
  async () => {
    const fixture = await fixtureServer();
    const browser = await chromium.launch({ headless: true });
    const root = await mkdtemp(
      path.join(os.tmpdir(), "intakecr-actuator-optional-quarantine-"),
    );
    const proposal = semanticProposal();
    proposal.fields[0].required = false;
    const observed = observation(fixture.origin);
    observed.controls[0].required = false;
    const generatedBundle = bundle(proposal, observed);
    const unresolvedSource = fieldSource.replaceAll("#value_a", "#missing_a");
    generatedBundle.modules[0] = {
      ...generatedBundle.modules[0],
      source: unresolvedSource,
      sourceHash: sha256(unresolvedSource),
    };
    const checked = assertActuatorBundle({
      bundle: generatedBundle,
      semanticProposal: proposal,
    });
    const repairedUnresolvedSource = fieldSource.replaceAll(
      "#value_a",
      "#missing_b",
    );
    const events = [];
    try {
      const page = await browser.newPage();
      await page.goto(`${fixture.origin}start`);
      const result = await generateValidateStateActuator({
        page,
        artifactId: generatedBundle.artifactId,
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: proposal.state,
          fields: proposal.fields.map((field) => ({ ...field, actuate: true })),
        },
        observation: observed,
        screenshot: null,
        storeRoot: root,
        preflightMode: "browser",
        restoreAfterPreflight: false,
        onEvent: async (kind, message, metadata) =>
          events.push({ kind, message, metadata }),
        generators: {
          generateActuatorBundle: async () => ({
            bundle: generatedBundle,
            bundleHash: checked.bundleHash,
            provenance: { source: "test" },
          }),
          generateActuatorRepair: async ({ bundleHash, issues }) => ({
            repair: {
              schemaVersion: 1,
              repairId: "repair_optional_unresolved",
              layer: "actuator",
              baseBundleHash: bundleHash,
              issueIds: issues.map((issue) => issue.issueId),
              replacements: [
                {
                  modulePath: "handlers/field_01.mjs",
                  source: repairedUnresolvedSource,
                  sourceHash: sha256(repairedUnresolvedSource),
                  handlerIds: ["field_01_handler"],
                  capabilities: ["keyboard", "locator", "observe"],
                },
              ],
              rationale:
                "Try one distinct locator strategy for the optional target.",
            },
            provenance: { source: "test" },
          }),
          generateRepairDiagnosis: async ({ issues }) => ({
            diagnosis: {
              schemaVersion: 1,
              diagnosisId: "diagnosis_optional_unresolved",
              classification: "actuator",
              issueIds: issues.map((issue) => issue.issueId),
              evidenceRefs: [],
              rationale:
                "The optional target remained unresolved after one local repair.",
              confidence: "high",
            },
          }),
        },
      });

      assert.equal(
        result.plan.actuator.certificationStatus,
        "preflight_validated_with_quarantine",
      );
      assert.deepEqual(result.plan.actuator.quarantinedTargetKeys, [
        "field_01",
      ]);
      assert.equal(result.validation.outcome, "passed");
      assert.ok(
        events.some(
          (event) => event.kind === "actuator_optional_target_quarantined",
        ),
      );
    } finally {
      await browser.close();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("state actuator pipeline persists a static shadow candidate without touching a page", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-shadow-actuator-"));
  const proposal = semanticProposal();
  const observed = observation();
  observed.existingContract = {
    fields: [{ key: "prior_field" }],
    sections: [],
    guidance: [],
    states: [],
  };
  const generatedBundle = bundle(proposal, observed);
  const checked = assertActuatorBundle({
    bundle: generatedBundle,
    semanticProposal: proposal,
  });
  const stored = { semantics: [], bundles: [], validations: [] };
  const events = [];
  const repository = {
    nextSemanticCandidateVersion: async () => 1,
    nextActuatorBundleVersion: async () => 1,
    putSemanticCandidate: async (value) => stored.semantics.push(value),
    putActuatorBundle: async (value) => stored.bundles.push(value),
    putValidationRun: async (value) => stored.validations.push(value),
  };
  try {
    const result = await generateValidateStateActuator({
      page: null,
      artifactId: generatedBundle.artifactId,
      sequence: 1,
      semanticProposal: proposal,
      plan: {
        state: { key: proposal.state.key },
        fields: [
          {
            key: "field_01",
            controlType: "text",
            actuate: true,
            upload: {},
          },
        ],
        progression: {
          key: proposal.state.progression.key,
          kind: "advance",
        },
      },
      observation: observed,
      screenshot: null,
      storeRoot: root,
      repository,
      preflightMode: "static",
      onEvent: async (kind, message, metadata) =>
        events.push({ kind, message, metadata }),
      generators: {
        generateActuatorBundle: async () => ({
          bundle: generatedBundle,
          bundleHash: checked.bundleHash,
          provenance: { model: "test", promptVersion: "test" },
        }),
      },
    });

    assert.equal(result.plan.actuator.certificationStatus, "static_validated");
    assert.equal(result.plan.actuator.bundle.modules[0].source, fieldSource);
    assert.equal(stored.semantics.length, 1);
    assert.deepEqual(
      stored.semantics[0].existingContract,
      observed.existingContract,
    );
    assert.equal(stored.bundles.length, 1);
    assert.equal(stored.bundles[0].status, "draft");
    assert.equal(stored.validations[0].validation.phase, "actuator_static");
    assert.ok(
      events.findIndex((event) => event.kind === "actuator_candidate_staged") <
        events.findIndex(
          (event) => event.kind === "actuator_static_validation_passed",
        ),
    );
    assert.match(
      events.find((event) => event.kind === "actuator_candidate_staged").message,
      /before any browser preflight or execution/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shadow actuator transport failures open a run-level circuit after one request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-shadow-circuit-"));
  const proposal = semanticProposal();
  const observed = observation();
  const shadowCircuit = { open: false, issues: [] };
  let generationCalls = 0;
  const invoke = () =>
    generateValidateStateActuator({
      page: null,
      artifactId: "form_0123456789abcdef01234567",
      sequence: 1,
      semanticProposal: proposal,
      plan: {
        state: { key: proposal.state.key },
        fields: [{ key: "field_01", controlType: "text", actuate: true, upload: {} }],
        progression: { key: proposal.state.progression.key, kind: "advance" },
      },
      observation: observed,
      screenshot: null,
      storeRoot: root,
      preflightMode: "static",
      shadowCircuit,
      actuatorGenerationTimeoutMs: 5_000,
      generators: {
        generateActuatorBundle: async () => {
          generationCalls += 1;
          throw new TypeError("fetch failed");
        },
      },
    });

  try {
    await assert.rejects(invoke, (error) => {
      assert.equal(error.failureStage, "actuator_generation_failed");
      return true;
    });
    assert.equal(generationCalls, 1);
    assert.equal(shadowCircuit.open, true);

    await assert.rejects(invoke, (error) => {
      assert.equal(error.failureStage, "actuator_shadow_circuit_open");
      return true;
    });
    assert.equal(generationCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actuator repair budget exhaustion fails closed before an unstaged browser action", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "intakecr-actuator-budget-"));
  const proposal = semanticProposal();
  try {
    await assert.rejects(
      generateValidateStateActuator({
        page: null,
        artifactId: "form_0123456789abcdef01234567",
        sequence: 1,
        semanticProposal: proposal,
        plan: {
          state: { key: proposal.state.key },
          fields: [
            { key: "field_01", controlType: "text", actuate: true, upload: {} },
          ],
          progression: { key: proposal.state.progression.key, kind: "advance" },
        },
        observation: observation(),
        screenshot: null,
        storeRoot: root,
        preflightMode: "static",
        actuatorRepairBudgetMs: 1,
        generators: {
          generateActuatorBundle: async () => {
            throw new Error("The model should not be called after budget exhaustion.");
          },
        },
      }),
      (error) => {
        assert.equal(error.failureStage, "actuator_generation_failed");
        assert.equal(
          error.issues[0].code,
          "actuator_repair_budget_exhausted",
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
