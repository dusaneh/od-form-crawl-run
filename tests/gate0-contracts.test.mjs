import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createArtifactVersion,
  generatedArtifactPaths,
  hashJson,
  loadGeneratedScriptVersion,
  sha256,
  writeGeneratedScriptVersion,
} from "../local/contracts/artifact-store.mjs";
import {
  applyContractDelta,
  validateContractDelta,
  validateGeneratedScriptManifest,
  validateProbeDirective,
  validateRawObservation,
  validateResultEnvelope,
  validateSemanticContract,
} from "../local/contracts/runtime-schemas.mjs";

function identity(route, visibleControlKeys, key, kind) {
  return {
    normalizedRoute: route,
    visibleControlKeys,
    progression: { key, kind },
  };
}

function contract() {
  return {
    schemaVersion: 1,
    artifactId: "fixture-artifact",
    artifactVersion: 1,
    contractVersion: 1,
    normalizedUrl: "https://example.test/intake",
    locale: "en-US",
    entryStateKey: "applicant",
    fields: [
      {
        key: "first_name",
        rawLabel: "First name",
        controlType: "text",
        required: { kind: "always" },
        options: [],
        sectionKey: "applicant_details",
        guidanceRefs: ["form_help"],
        testValue: "Test",
        sensitive: false,
        administrative: false,
      },
      {
        key: "monthly_income",
        rawLabel: "Monthly income",
        controlType: "number",
        required: { kind: "always" },
        options: [],
        sectionKey: "household",
        guidanceRefs: [],
        testValue: 1000,
        sensitive: true,
        administrative: false,
      },
    ],
    sections: [
      {
        key: "applicant_details",
        label: "Applicant details",
        parentKey: null,
        guidanceRefs: [],
        order: 0,
      },
      {
        key: "household",
        label: "Household",
        parentKey: null,
        guidanceRefs: [],
        order: 1,
      },
    ],
    guidance: [
      {
        key: "form_help",
        scope: { kind: "form", key: null },
        kind: "instruction",
        text: "Use synthetic values during Phase 1.",
        provenance: {
          source: "dom_text",
          selector: "#help",
          frameUrl: null,
        },
      },
    ],
    states: [
      {
        key: "applicant",
        kind: "form",
        order: 0,
        fieldKeys: ["first_name"],
        sectionKeys: ["applicant_details"],
        expectedIdentity: identity(
          "/intake",
          ["first_name"],
          "applicant.next",
          "advance"
        ),
        progression: {
          key: "applicant.next",
          kind: "advance",
        },
      },
      {
        key: "household",
        kind: "terminal",
        order: 1,
        fieldKeys: ["monthly_income"],
        sectionKeys: ["household"],
        expectedIdentity: identity(
          "/intake",
          ["monthly_income"],
          "household.submit",
          "terminal_submit"
        ),
        progression: {
          key: "household.submit",
          kind: "terminal_submit",
        },
      },
    ],
    transitions: [
      {
        key: "applicant_to_household",
        fromStateKey: "applicant",
        toStateKey: "household",
        trigger: {
          kind: "advance",
          fieldKey: null,
          value: null,
        },
      },
    ],
  };
}

function fingerprint() {
  return {
    algorithmVersion: "formweave-structural-v3",
    digest: sha256("typed-facts"),
    input: { normalizedUrl: "https://example.test/intake" },
  };
}

function manifest(contractValue, source) {
  return {
    schemaVersion: 1,
    kind: "generated_d1",
    artifactId: contractValue.artifactId,
    normalizedUrl: contractValue.normalizedUrl,
    versions: {
      artifact: contractValue.artifactVersion,
      contract: contractValue.contractVersion,
      fingerprintAlgorithm: "formweave-structural-v3",
      script: 1,
    },
    generatedAt: "2026-07-24T12:00:00.000Z",
    model: "test-model",
    promptVersion: "gate0-test-v1",
    sourceHash: sha256(source),
    parentScriptVersion: null,
    contractHash: hashJson(contractValue),
    certificationEligible: false,
  };
}

test("D2 accepts one typed progression per state and exactly one terminal", () => {
  assert.equal(validateSemanticContract(contract()).contractVersion, 1);
});

test("D2 rejects multiple terminal states", () => {
  const invalid = contract();
  invalid.states[0].kind = "terminal";
  invalid.states[0].expectedIdentity.progression.kind = "terminal_submit";
  invalid.states[0].progression.kind = "terminal_submit";
  invalid.transitions = [];
  assert.throws(
    () => validateSemanticContract(invalid),
    /expected exactly one terminal state/
  );
});

test("D2 rejects non-canonical visibility identities", () => {
  const invalid = contract();
  invalid.states[0].fieldKeys.push("monthly_income");
  invalid.states[0].expectedIdentity.visibleControlKeys = [
    "monthly_income",
    "first_name",
  ];
  assert.throws(
    () => validateSemanticContract(invalid),
    /canonically sorted/
  );
});

test("D2 rejects duplicate runtime identities", () => {
  const invalid = contract();
  invalid.states[1].expectedIdentity = structuredClone(
    invalid.states[0].expectedIdentity
  );
  invalid.states[1].progression = {
    key: "applicant.next",
    kind: "advance",
  };
  invalid.states[1].kind = "form";
  invalid.states.push({
    key: "terminal",
    kind: "terminal",
    order: 2,
    fieldKeys: ["monthly_income"],
    sectionKeys: ["household"],
    expectedIdentity: identity(
      "/intake",
      ["monthly_income"],
      "terminal.submit",
      "terminal_submit"
    ),
    progression: {
      key: "terminal.submit",
      kind: "terminal_submit",
    },
  });
  invalid.transitions = [
    {
      key: "applicant_to_household",
      fromStateKey: "applicant",
      toStateKey: "household",
      trigger: { kind: "advance", fieldKey: null, value: null },
    },
    {
      key: "household_to_terminal",
      fromStateKey: "household",
      toStateKey: "terminal",
      trigger: { kind: "advance", fieldKey: null, value: null },
    },
  ];
  assert.throws(
    () => validateSemanticContract(invalid),
    /duplicate expected runtime state identity|progression action keys must be unique/
  );
});

test("D2 deltas reject mutation keys", () => {
  assert.throws(
    () =>
      validateContractDelta({
        schemaVersion: 1,
        baseContractVersion: 1,
        additions: {
          fields: [],
          sections: [],
          guidance: [],
          states: [],
          transitions: [],
          updates: [{ key: "first_name" }],
        },
      }),
    /unknown key/
  );
});

test("D2 deltas reject key collisions and apply additions without mutation", () => {
  const base = contract();
  assert.throws(
    () =>
      validateContractDelta(
        {
          schemaVersion: 1,
          baseContractVersion: 1,
          additions: {
            fields: [structuredClone(base.fields[0])],
            sections: [],
            guidance: [],
            states: [],
            transitions: [],
          },
        },
        base
      ),
    /mutation is forbidden/
  );

  const delta = {
    schemaVersion: 1,
    baseContractVersion: 1,
    additions: {
      fields: [
        {
          key: "shelter_name",
          rawLabel: "Shelter name",
          controlType: "text",
          required: {
            kind: "conditional",
            when: {
              fieldKey: "first_name",
              operator: "not_equals",
              value: "",
            },
          },
          options: [],
          sectionKey: "applicant_details",
          guidanceRefs: [],
          testValue: "Test Shelter",
          sensitive: false,
          administrative: false,
        },
      ],
      sections: [],
      guidance: [],
      states: [
        {
          key: "shelter_branch",
          kind: "form",
          order: 1,
          fieldKeys: ["first_name", "shelter_name"],
          sectionKeys: ["applicant_details"],
          expectedIdentity: identity(
            "/intake",
            ["first_name", "shelter_name"],
            "shelter.next",
            "advance"
          ),
          progression: {
            key: "shelter.next",
            kind: "advance",
          },
        },
      ],
      transitions: [
        {
          key: "applicant_to_shelter",
          fromStateKey: "applicant",
          toStateKey: "shelter_branch",
          trigger: {
            kind: "choice",
            fieldKey: "first_name",
            value: "Test",
          },
        },
        {
          key: "shelter_to_household",
          fromStateKey: "shelter_branch",
          toStateKey: "household",
          trigger: {
            kind: "advance",
            fieldKey: null,
            value: null,
          },
        },
      ],
    },
  };
  const expanded = applyContractDelta(base, delta);
  assert.equal(expanded.contractVersion, 2);
  assert.equal(base.contractVersion, 1);
  assert.equal(expanded.fields.at(-1).key, "shelter_name");
  assert.equal(expanded.transitions.at(-1).key, "shelter_to_household");
});

test("D6 and D7 schemas accept fact-only observations and typed probes", () => {
  const before = identity("/intake", ["first_name"], "applicant.next", "advance");
  const after = identity(
    "/intake",
    ["first_name", "monthly_income"],
    "applicant.next",
    "advance"
  );
  const fact = {
    factId: "control-1",
    tag: "input",
    rawType: "text",
    name: "first_name",
    id: "first_name",
    required: true,
    visible: true,
    disabled: false,
    optionValues: [],
    frameUrl: null,
  };
  assert.equal(
    validateRawObservation({
      schemaVersion: 1,
      stateKey: "applicant",
      probe: { fieldKey: "housing_status", value: "at_risk" },
      before: { identity: before, controls: [fact] },
      after: {
        identity: after,
        controls: [
          fact,
          {
            ...fact,
            factId: "control-2",
            rawType: "number",
            name: "monthly_income",
            id: "monthly_income",
          },
        ],
      },
      delta: {
        addedFactIds: ["control-2"],
        removedFactIds: [],
        requiredChangedFactIds: [],
      },
      observedAt: "2026-07-24T12:00:00.000Z",
    }).stateKey,
    "applicant"
  );
  assert.equal(
    validateProbeDirective({
      schemaVersion: 1,
      stateKey: "applicant",
      fieldKey: "housing_status",
      value: "at_risk",
      progressionPermission: "forbidden",
    }).progressionPermission,
    "forbidden"
  );
});

test("F13.5 envelope enforces verified field and changed-state invariants", () => {
  const before = identity("/intake", ["first_name"], "applicant.next", "advance");
  const after = identity(
    "/intake",
    ["monthly_income"],
    "household.submit",
    "terminal_submit"
  );
  const envelope = {
    schemaVersion: 1,
    invocationId: "invocation-1",
    artifactId: "fixture-artifact",
    versions: {
      artifact: 1,
      contract: 1,
      fingerprintAlgorithm: "formweave-structural-v3",
      script: 1,
    },
    stateKey: "applicant",
    fieldResults: [
      {
        key: "first_name",
        status: "verified",
        attempted: true,
        resolved: true,
        entered: true,
        verified: true,
        failureCode: null,
        detail: null,
      },
    ],
    stateOutcome: "completed",
    progression: {
      kind: "advance",
      outcome: "confirmed",
      attempted: true,
      confirmed: true,
      failureCode: null,
      beforeIdentity: before,
      afterIdentity: after,
      matchedSuccessorStateKey: "household",
    },
    observedStateIdentity: after,
    evidenceRefs: ["evidence/state-1.png"],
    faultClass: null,
  };
  assert.equal(validateResultEnvelope(envelope).stateOutcome, "completed");
  envelope.progression.afterIdentity = structuredClone(before);
  assert.throws(
    () => validateResultEnvelope(envelope),
    /confirmed progression is inconsistent/
  );
});

test("F13.5 rejects failure codes outside the closed set", () => {
  const observed = identity(
    "/intake",
    ["first_name"],
    "applicant.next",
    "advance"
  );
  assert.throws(
    () =>
      validateResultEnvelope({
        schemaVersion: 1,
        invocationId: "invocation-closed-code",
        artifactId: "fixture-artifact",
        versions: {
          artifact: 1,
          contract: 1,
          fingerprintAlgorithm: "formweave-structural-v3",
          script: 1,
        },
        stateKey: "applicant",
        fieldResults: [
          {
            key: "first_name",
            status: "failed",
            attempted: true,
            resolved: false,
            entered: false,
            verified: false,
            failureCode: "invented_failure_code",
            detail: "This code is intentionally invalid.",
          },
        ],
        stateOutcome: "failed",
        progression: {
          kind: "advance",
          outcome: "not_attempted",
          attempted: false,
          confirmed: false,
          failureCode: null,
          beforeIdentity: observed,
          afterIdentity: null,
          matchedSuccessorStateKey: null,
        },
        observedStateIdentity: observed,
        evidenceRefs: [],
        faultClass: null,
      }),
    /expected one of/
  );
});

test("immutable store writes the Gate 0 layout and refuses overwrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-gate0-"));
  const contractValue = contract();
  const created = await createArtifactVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    contract: contractValue,
    fingerprint: fingerprint(),
  });
  const paths = generatedArtifactPaths({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
  });
  assert.equal(created.path, paths.artifactPath);
  assert.equal(
    JSON.parse(await readFile(paths.contractPath, "utf8")).contractVersion,
    1
  );
  await assert.rejects(() =>
    createArtifactVersion({
      dataRoot: root,
      artifactId: contractValue.artifactId,
      artifactVersion: 1,
      contract: contractValue,
      fingerprint: fingerprint(),
    })
  );
});

test("generated D1 source is hash-linked, loadable, and immutable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-d1-store-"));
  const contractValue = contract();
  await createArtifactVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    contract: contractValue,
    fingerprint: fingerprint(),
  });
  const source =
    "export async function invoke() { return { kind: 'gate0-test' }; }\n";
  const scriptManifest = manifest(contractValue, source);
  const written = await writeGeneratedScriptVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    scriptVersion: 1,
    manifest: scriptManifest,
    source,
    generationInput: { promptVersion: "gate0-test-v1" },
  });
  const loaded = await loadGeneratedScriptVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    scriptVersion: 1,
  });
  assert.equal(loaded.source, source);
  assert.equal(loaded.manifest.sourceHash, written.sourceHash);
  await assert.rejects(() =>
    writeGeneratedScriptVersion({
      dataRoot: root,
      artifactId: contractValue.artifactId,
      artifactVersion: 1,
      scriptVersion: 1,
      manifest: scriptManifest,
      source,
      generationInput: { promptVersion: "gate0-test-v1" },
    })
  );
});

test("loader detects generated-source tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-tamper-"));
  const contractValue = contract();
  await createArtifactVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    contract: contractValue,
    fingerprint: fingerprint(),
  });
  const source = "export const version = 1;\n";
  await writeGeneratedScriptVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    scriptVersion: 1,
    manifest: manifest(contractValue, source),
    source,
    generationInput: { promptVersion: "gate0-test-v1" },
  });
  const paths = generatedArtifactPaths({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    scriptVersion: 1,
  });
  await writeFile(
    path.join(paths.scriptPath, "generated.mjs"),
    "export const version = 2;\n",
    "utf8"
  );
  await assert.rejects(
    () =>
      loadGeneratedScriptVersion({
        dataRoot: root,
        artifactId: contractValue.artifactId,
        artifactVersion: 1,
        scriptVersion: 1,
      }),
    /source hash mismatch/
  );
});

test("manual planner manifests cannot enter the generated-script store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-manual-plan-"));
  const contractValue = contract();
  await createArtifactVersion({
    dataRoot: root,
    artifactId: contractValue.artifactId,
    artifactVersion: 1,
    contract: contractValue,
    fingerprint: fingerprint(),
  });
  const source = "export const plan = {};\n";
  const invalid = {
    ...manifest(contractValue, source),
    kind: "hand_authored_planner",
  };
  assert.throws(() => validateGeneratedScriptManifest(invalid), /manual or legacy/);
  await assert.rejects(
    () =>
      writeGeneratedScriptVersion({
        dataRoot: root,
        artifactId: contractValue.artifactId,
        artifactVersion: 1,
        scriptVersion: 1,
        manifest: invalid,
        source,
        generationInput: { plannerVersion: 99 },
      }),
    /manual or legacy planners cannot enter the D1 store/
  );
});
