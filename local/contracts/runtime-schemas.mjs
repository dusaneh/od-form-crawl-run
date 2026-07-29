import {
  CONTROL_TYPES,
  FAULT_CLASSES,
  FIELD_FAILURE_CODES,
  FIELD_RESULT_STATES,
  GUIDANCE_KINDS,
  PROGRESSION_FAILURE_CODES,
  PROGRESSION_KINDS,
  PROGRESSION_OUTCOMES,
  PROPOSAL_REJECTION_CODES,
  STATE_OUTCOMES,
} from "./codes.mjs";

export const CONTRACT_SCHEMA_VERSION = 1;
export const RESULT_ENVELOPE_SCHEMA_VERSION = 1;
export const RAW_OBSERVATION_SCHEMA_VERSION = 1;
export const PROBE_DIRECTIVE_SCHEMA_VERSION = 1;
export const GENERATED_SCRIPT_MANIFEST_SCHEMA_VERSION = 1;

export class SchemaValidationError extends Error {
  constructor(schema, path, message) {
    super(`${schema} validation failed at ${path}: ${message}`);
    this.name = "SchemaValidationError";
    this.schema = schema;
    this.path = path;
  }
}

function fail(schema, path, message) {
  throw new SchemaValidationError(schema, path, message);
}

function object(value, schema, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(schema, path, "expected an object");
  }
  return value;
}

function array(value, schema, path) {
  if (!Array.isArray(value)) fail(schema, path, "expected an array");
  return value;
}

function string(value, schema, path, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    fail(schema, path, "expected a non-empty string");
  }
  return value;
}

function boolean(value, schema, path) {
  if (typeof value !== "boolean") fail(schema, path, "expected a boolean");
  return value;
}

function integer(value, schema, path, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    fail(schema, path, `expected an integer >= ${min}`);
  }
  return value;
}

function nullableString(value, schema, path) {
  if (value !== null && typeof value !== "string") {
    fail(schema, path, "expected a string or null");
  }
  return value;
}

function member(value, values, schema, path) {
  if (!values.includes(value)) {
    fail(schema, path, `expected one of: ${values.join(", ")}`);
  }
  return value;
}

function exactKeys(value, allowed, schema, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(schema, `${path}.${key}`, "unknown key");
  }
}

function uniqueKeys(items, keyName, schema, path) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const value = string(
      items[index]?.[keyName],
      schema,
      `${path}[${index}].${keyName}`
    );
    if (seen.has(value)) {
      fail(schema, `${path}[${index}].${keyName}`, `duplicate key "${value}"`);
    }
    seen.add(value);
  }
  return seen;
}

function assertSortedUniqueStrings(values, schema, path) {
  array(values, schema, path);
  values.forEach((value, index) => string(value, schema, `${path}[${index}]`));
  const canonical = [...new Set(values)].sort();
  if (
    canonical.length !== values.length ||
    canonical.some((value, index) => value !== values[index])
  ) {
    fail(schema, path, "must be canonically sorted with no duplicates");
  }
}

function validateNormalizedUrl(value, schema, path) {
  string(value, schema, path);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(schema, path, "expected an absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    fail(schema, path, "expected http or https");
  }
  return value;
}

function validateNormalizedRoute(value, schema, path) {
  string(value, schema, path);
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) {
    fail(schema, path, "must be a normalized path without query or fragment");
  }
  return value;
}

export function validateObservedStateIdentity(
  value,
  schema = "ObservedStateIdentity",
  path = "$"
) {
  object(value, schema, path);
  exactKeys(
    value,
    ["normalizedRoute", "visibleControlKeys", "progression"],
    schema,
    path
  );
  validateNormalizedRoute(
    value.normalizedRoute,
    schema,
    `${path}.normalizedRoute`
  );
  assertSortedUniqueStrings(
    value.visibleControlKeys,
    schema,
    `${path}.visibleControlKeys`
  );
  object(value.progression, schema, `${path}.progression`);
  exactKeys(value.progression, ["key", "kind"], schema, `${path}.progression`);
  string(value.progression.key, schema, `${path}.progression.key`);
  member(
    value.progression.kind,
    PROGRESSION_KINDS,
    schema,
    `${path}.progression.kind`
  );
  return value;
}

function stateIdentityKey(identity) {
  return JSON.stringify([
    identity.normalizedRoute,
    identity.visibleControlKeys,
    identity.progression.key,
    identity.progression.kind,
  ]);
}

function validateRequirementRule(value, schema, path, fieldKeys) {
  object(value, schema, path);
  exactKeys(value, ["kind", "when"], schema, path);
  member(value.kind, ["always", "never", "conditional"], schema, `${path}.kind`);
  if (value.kind === "conditional") {
    object(value.when, schema, `${path}.when`);
    exactKeys(value.when, ["fieldKey", "operator", "value"], schema, `${path}.when`);
    const dependency = string(
      value.when.fieldKey,
      schema,
      `${path}.when.fieldKey`
    );
    if (!fieldKeys.has(dependency)) {
      fail(schema, `${path}.when.fieldKey`, "unknown dependency field");
    }
    member(
      value.when.operator,
      ["equals", "not_equals", "includes"],
      schema,
      `${path}.when.operator`
    );
    if (
      !["string", "number", "boolean"].includes(typeof value.when.value) &&
      value.when.value !== null
    ) {
      fail(schema, `${path}.when.value`, "expected a scalar value");
    }
  } else if (value.when !== undefined) {
    fail(schema, `${path}.when`, "allowed only for a conditional rule");
  }
}

function validateField(field, schema, path, fieldKeys, sectionKeys, guidanceKeys) {
  object(field, schema, path);
  exactKeys(
    field,
    [
      "key",
      "rawLabel",
      "controlType",
      "required",
      "options",
      "sectionKey",
      "guidanceRefs",
      "testValue",
      "sensitive",
      "administrative",
    ],
    schema,
    path
  );
  string(field.key, schema, `${path}.key`);
  string(field.rawLabel, schema, `${path}.rawLabel`);
  member(field.controlType, CONTROL_TYPES, schema, `${path}.controlType`);
  validateRequirementRule(field.required, schema, `${path}.required`, fieldKeys);
  array(field.options, schema, `${path}.options`);
  const optionValues = new Set();
  field.options.forEach((option, index) => {
    object(option, schema, `${path}.options[${index}]`);
    exactKeys(option, ["value", "label"], schema, `${path}.options[${index}]`);
    const optionValue = string(
      option.value,
      schema,
      `${path}.options[${index}].value`,
      { allowEmpty: true }
    );
    string(option.label, schema, `${path}.options[${index}].label`);
    if (optionValues.has(optionValue)) {
      fail(schema, `${path}.options[${index}].value`, "duplicate option value");
    }
    optionValues.add(optionValue);
  });
  if (field.sectionKey !== null && !sectionKeys.has(field.sectionKey)) {
    fail(schema, `${path}.sectionKey`, "unknown section key");
  }
  array(field.guidanceRefs, schema, `${path}.guidanceRefs`);
  field.guidanceRefs.forEach((key, index) => {
    if (!guidanceKeys.has(key)) {
      fail(schema, `${path}.guidanceRefs[${index}]`, "unknown guidance key");
    }
  });
  if (
    !["string", "number", "boolean"].includes(typeof field.testValue) &&
    field.testValue !== null
  ) {
    fail(schema, `${path}.testValue`, "expected a scalar test value or null");
  }
  boolean(field.sensitive, schema, `${path}.sensitive`);
  boolean(field.administrative, schema, `${path}.administrative`);
}

function validateSection(section, schema, path, sectionKeys, guidanceKeys) {
  object(section, schema, path);
  exactKeys(
    section,
    ["key", "label", "parentKey", "guidanceRefs", "order"],
    schema,
    path
  );
  string(section.key, schema, `${path}.key`);
  string(section.label, schema, `${path}.label`);
  nullableString(section.parentKey, schema, `${path}.parentKey`);
  if (section.parentKey !== null && !sectionKeys.has(section.parentKey)) {
    fail(schema, `${path}.parentKey`, "unknown parent section");
  }
  if (section.parentKey === section.key) {
    fail(schema, `${path}.parentKey`, "a section cannot parent itself");
  }
  array(section.guidanceRefs, schema, `${path}.guidanceRefs`);
  section.guidanceRefs.forEach((key, index) => {
    if (!guidanceKeys.has(key)) {
      fail(schema, `${path}.guidanceRefs[${index}]`, "unknown guidance key");
    }
  });
  integer(section.order, schema, `${path}.order`);
}

function validateGuidance(guidance, schema, path, fieldKeys, sectionKeys) {
  object(guidance, schema, path);
  exactKeys(
    guidance,
    ["key", "scope", "kind", "text", "provenance"],
    schema,
    path
  );
  string(guidance.key, schema, `${path}.key`);
  object(guidance.scope, schema, `${path}.scope`);
  exactKeys(guidance.scope, ["kind", "key"], schema, `${path}.scope`);
  member(
    guidance.scope.kind,
    ["form", "section", "question"],
    schema,
    `${path}.scope.kind`
  );
  nullableString(guidance.scope.key, schema, `${path}.scope.key`);
  if (guidance.scope.kind === "form" && guidance.scope.key !== null) {
    fail(schema, `${path}.scope.key`, "form guidance must use null");
  }
  if (
    guidance.scope.kind === "section" &&
    !sectionKeys.has(guidance.scope.key)
  ) {
    fail(schema, `${path}.scope.key`, "unknown section key");
  }
  if (
    guidance.scope.kind === "question" &&
    !fieldKeys.has(guidance.scope.key)
  ) {
    fail(schema, `${path}.scope.key`, "unknown field key");
  }
  member(guidance.kind, GUIDANCE_KINDS, schema, `${path}.kind`);
  string(guidance.text, schema, `${path}.text`);
  object(guidance.provenance, schema, `${path}.provenance`);
  exactKeys(
    guidance.provenance,
    ["source", "selector", "frameUrl"],
    schema,
    `${path}.provenance`
  );
  member(
    guidance.provenance.source,
    ["dom_text", "aria_description", "model_inference"],
    schema,
    `${path}.provenance.source`
  );
  nullableString(
    guidance.provenance.selector,
    schema,
    `${path}.provenance.selector`
  );
  nullableString(
    guidance.provenance.frameUrl,
    schema,
    `${path}.provenance.frameUrl`
  );
}

export function validateSemanticContract(value) {
  const schema = "D2SemanticContract";
  const path = "$";
  object(value, schema, path);
  exactKeys(
    value,
    [
      "schemaVersion",
      "artifactId",
      "artifactVersion",
      "contractVersion",
      "normalizedUrl",
      "locale",
      "entryStateKey",
      "fields",
      "sections",
      "guidance",
      "states",
      "transitions",
    ],
    schema,
    path
  );
  integer(value.schemaVersion, schema, "$.schemaVersion", { min: 1 });
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", `unsupported version ${value.schemaVersion}`);
  }
  string(value.artifactId, schema, "$.artifactId");
  integer(value.artifactVersion, schema, "$.artifactVersion", { min: 1 });
  integer(value.contractVersion, schema, "$.contractVersion", { min: 1 });
  validateNormalizedUrl(value.normalizedUrl, schema, "$.normalizedUrl");
  string(value.locale, schema, "$.locale");
  string(value.entryStateKey, schema, "$.entryStateKey");
  const fields = array(value.fields, schema, "$.fields");
  const sections = array(value.sections, schema, "$.sections");
  const guidance = array(value.guidance, schema, "$.guidance");
  const states = array(value.states, schema, "$.states");
  const transitions = array(value.transitions, schema, "$.transitions");
  if (states.length === 0) fail(schema, "$.states", "at least one state is required");

  const fieldKeys = uniqueKeys(fields, "key", schema, "$.fields");
  const sectionKeys = uniqueKeys(sections, "key", schema, "$.sections");
  const guidanceKeys = uniqueKeys(guidance, "key", schema, "$.guidance");
  const stateKeys = uniqueKeys(states, "key", schema, "$.states");
  uniqueKeys(transitions, "key", schema, "$.transitions");
  if (!stateKeys.has(value.entryStateKey)) {
    fail(schema, "$.entryStateKey", "unknown state key");
  }

  sections.forEach((section, index) =>
    validateSection(
      section,
      schema,
      `$.sections[${index}]`,
      sectionKeys,
      guidanceKeys
    )
  );
  guidance.forEach((item, index) =>
    validateGuidance(
      item,
      schema,
      `$.guidance[${index}]`,
      fieldKeys,
      sectionKeys
    )
  );
  fields.forEach((field, index) =>
    validateField(
      field,
      schema,
      `$.fields[${index}]`,
      fieldKeys,
      sectionKeys,
      guidanceKeys
    )
  );

  const identityKeys = new Set();
  const progressionKeys = new Set();
  let terminalCount = 0;
  states.forEach((state, index) => {
    const statePath = `$.states[${index}]`;
    object(state, schema, statePath);
    exactKeys(
      state,
      [
        "key",
        "kind",
        "order",
        "fieldKeys",
        "sectionKeys",
        "expectedIdentity",
        "progression",
      ],
      schema,
      statePath
    );
    string(state.key, schema, `${statePath}.key`);
    member(
      state.kind,
      ["form", "review", "terminal"],
      schema,
      `${statePath}.kind`
    );
    integer(state.order, schema, `${statePath}.order`);
    assertSortedUniqueStrings(state.fieldKeys, schema, `${statePath}.fieldKeys`);
    state.fieldKeys.forEach((key, fieldIndex) => {
      if (!fieldKeys.has(key)) {
        fail(
          schema,
          `${statePath}.fieldKeys[${fieldIndex}]`,
          "unknown field key"
        );
      }
    });
    assertSortedUniqueStrings(
      state.sectionKeys,
      schema,
      `${statePath}.sectionKeys`
    );
    state.sectionKeys.forEach((key, sectionIndex) => {
      if (!sectionKeys.has(key)) {
        fail(
          schema,
          `${statePath}.sectionKeys[${sectionIndex}]`,
          "unknown section key"
        );
      }
    });
    validateObservedStateIdentity(
      state.expectedIdentity,
      schema,
      `${statePath}.expectedIdentity`
    );
    for (const controlKey of state.expectedIdentity.visibleControlKeys) {
      if (!fieldKeys.has(controlKey)) {
        fail(
          schema,
          `${statePath}.expectedIdentity.visibleControlKeys`,
          `unknown field key "${controlKey}"`
        );
      }
    }
    object(state.progression, schema, `${statePath}.progression`);
    exactKeys(
      state.progression,
      ["key", "kind"],
      schema,
      `${statePath}.progression`
    );
    string(state.progression.key, schema, `${statePath}.progression.key`);
    member(
      state.progression.kind,
      PROGRESSION_KINDS,
      schema,
      `${statePath}.progression.kind`
    );
    if (progressionKeys.has(state.progression.key)) {
      fail(
        schema,
        `${statePath}.progression.key`,
        "progression action keys must be unique"
      );
    }
    progressionKeys.add(state.progression.key);
    if (
      state.expectedIdentity.progression.key !== state.progression.key ||
      state.expectedIdentity.progression.kind !== state.progression.kind
    ) {
      fail(
        schema,
        `${statePath}.expectedIdentity.progression`,
        "must match the declared progression action"
      );
    }
    if (state.progression.kind === "terminal_submit") {
      terminalCount += 1;
      if (state.kind !== "terminal") {
        fail(schema, `${statePath}.kind`, "terminal submit requires terminal kind");
      }
    }
    const identityKey = stateIdentityKey(state.expectedIdentity);
    if (identityKeys.has(identityKey)) {
      fail(
        schema,
        `${statePath}.expectedIdentity`,
        "duplicate expected runtime state identity"
      );
    }
    identityKeys.add(identityKey);
  });
  if (terminalCount !== 1) {
    fail(schema, "$.states", `expected exactly one terminal state; got ${terminalCount}`);
  }
  const outgoing = new Map(states.map((state) => [state.key, 0]));
  transitions.forEach((transition, index) => {
    const transitionPath = `$.transitions[${index}]`;
    object(transition, schema, transitionPath);
    exactKeys(
      transition,
      ["key", "fromStateKey", "toStateKey", "trigger"],
      schema,
      transitionPath
    );
    string(transition.key, schema, `${transitionPath}.key`);
    string(transition.fromStateKey, schema, `${transitionPath}.fromStateKey`);
    string(transition.toStateKey, schema, `${transitionPath}.toStateKey`);
    if (!stateKeys.has(transition.fromStateKey)) {
      fail(schema, `${transitionPath}.fromStateKey`, "unknown source state");
    }
    if (!stateKeys.has(transition.toStateKey)) {
      fail(schema, `${transitionPath}.toStateKey`, "unknown destination state");
    }
    if (transition.fromStateKey === transition.toStateKey) {
      fail(schema, transitionPath, "a transition must change D2 state");
    }
    const fromState = states.find(
      (state) => state.key === transition.fromStateKey
    );
    if (fromState.progression.kind !== "advance") {
      fail(
        schema,
        `${transitionPath}.fromStateKey`,
        "terminal state cannot have outgoing transitions"
      );
    }
    object(transition.trigger, schema, `${transitionPath}.trigger`);
    exactKeys(
      transition.trigger,
      ["kind", "fieldKey", "value"],
      schema,
      `${transitionPath}.trigger`
    );
    member(
      transition.trigger.kind,
      ["advance", "choice"],
      schema,
      `${transitionPath}.trigger.kind`
    );
    nullableString(
      transition.trigger.fieldKey,
      schema,
      `${transitionPath}.trigger.fieldKey`
    );
    if (transition.trigger.kind === "advance") {
      if (
        transition.trigger.fieldKey !== null ||
        transition.trigger.value !== null
      ) {
        fail(
          schema,
          `${transitionPath}.trigger`,
          "advance trigger uses null fieldKey and value"
        );
      }
    } else {
      if (!fieldKeys.has(transition.trigger.fieldKey)) {
        fail(
          schema,
          `${transitionPath}.trigger.fieldKey`,
          "unknown trigger field"
        );
      }
      if (
        !["string", "number", "boolean"].includes(
          typeof transition.trigger.value
        ) &&
        transition.trigger.value !== null
      ) {
        fail(
          schema,
          `${transitionPath}.trigger.value`,
          "expected a scalar trigger value"
        );
      }
    }
    outgoing.set(
      transition.fromStateKey,
      outgoing.get(transition.fromStateKey) + 1
    );
  });
  states.forEach((state, index) => {
    const count = outgoing.get(state.key);
    if (state.progression.kind === "advance" && count === 0) {
      fail(
        schema,
        `$.states[${index}].progression`,
        "advance state requires at least one transition addition"
      );
    }
    if (state.progression.kind === "terminal_submit" && count !== 0) {
      fail(
        schema,
        `$.states[${index}].progression`,
        "terminal state cannot have outgoing transitions"
      );
    }
  });
  return value;
}

export function validateContractDelta(value, baseContract = null) {
  const schema = "D2ContractDelta";
  object(value, schema, "$");
  exactKeys(
    value,
    ["schemaVersion", "baseContractVersion", "additions"],
    schema,
    "$"
  );
  integer(value.schemaVersion, schema, "$.schemaVersion", { min: 1 });
  if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", "unsupported schema version");
  }
  integer(value.baseContractVersion, schema, "$.baseContractVersion", { min: 1 });
  object(value.additions, schema, "$.additions");
  exactKeys(
    value.additions,
    ["fields", "sections", "guidance", "states", "transitions"],
    schema,
    "$.additions"
  );
  for (const key of [
    "fields",
    "sections",
    "guidance",
    "states",
    "transitions",
  ]) {
    array(value.additions[key], schema, `$.additions.${key}`);
    uniqueKeys(value.additions[key], "key", schema, `$.additions.${key}`);
  }
  if (baseContract !== null) {
    validateSemanticContract(baseContract);
    if (value.baseContractVersion !== baseContract.contractVersion) {
      fail(
        schema,
        "$.baseContractVersion",
        "does not match the base contract"
      );
    }
    for (const key of [
      "fields",
      "sections",
      "guidance",
      "states",
      "transitions",
    ]) {
      const existing = new Set(baseContract[key].map((item) => item.key));
      value.additions[key].forEach((item, index) => {
        if (existing.has(item.key)) {
          fail(
            schema,
            `$.additions.${key}[${index}].key`,
            "addition collides with an existing key; mutation is forbidden"
          );
        }
      });
    }
  }
  return value;
}

export function applyContractDelta(baseContract, delta) {
  validateContractDelta(delta, baseContract);
  const next = structuredClone(baseContract);
  next.contractVersion += 1;
  for (const key of [
    "fields",
    "sections",
    "guidance",
    "states",
    "transitions",
  ]) {
    next[key].push(...structuredClone(delta.additions[key]));
  }
  validateSemanticContract(next);
  return next;
}

function validateRawControlFact(value, schema, path) {
  object(value, schema, path);
  exactKeys(
    value,
    [
      "factId",
      "tag",
      "rawType",
      "name",
      "id",
      "required",
      "visible",
      "disabled",
      "optionValues",
      "frameUrl",
    ],
    schema,
    path
  );
  string(value.factId, schema, `${path}.factId`);
  string(value.tag, schema, `${path}.tag`);
  nullableString(value.rawType, schema, `${path}.rawType`);
  nullableString(value.name, schema, `${path}.name`);
  nullableString(value.id, schema, `${path}.id`);
  boolean(value.required, schema, `${path}.required`);
  boolean(value.visible, schema, `${path}.visible`);
  boolean(value.disabled, schema, `${path}.disabled`);
  array(value.optionValues, schema, `${path}.optionValues`);
  value.optionValues.forEach((option, index) =>
    string(option, schema, `${path}.optionValues[${index}]`, { allowEmpty: true })
  );
  nullableString(value.frameUrl, schema, `${path}.frameUrl`);
}

export function validateRawObservation(value) {
  const schema = "D6RawObservation";
  object(value, schema, "$");
  exactKeys(
    value,
    [
      "schemaVersion",
      "stateKey",
      "probe",
      "before",
      "after",
      "delta",
      "observedAt",
    ],
    schema,
    "$"
  );
  if (value.schemaVersion !== RAW_OBSERVATION_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", "unsupported schema version");
  }
  string(value.stateKey, schema, "$.stateKey");
  object(value.probe, schema, "$.probe");
  exactKeys(value.probe, ["fieldKey", "value"], schema, "$.probe");
  string(value.probe.fieldKey, schema, "$.probe.fieldKey");
  for (const side of ["before", "after"]) {
    object(value[side], schema, `$.${side}`);
    exactKeys(value[side], ["identity", "controls"], schema, `$.${side}`);
    validateObservedStateIdentity(
      value[side].identity,
      schema,
      `$.${side}.identity`
    );
    array(value[side].controls, schema, `$.${side}.controls`);
    value[side].controls.forEach((fact, index) =>
      validateRawControlFact(fact, schema, `$.${side}.controls[${index}]`)
    );
  }
  object(value.delta, schema, "$.delta");
  exactKeys(
    value.delta,
    ["addedFactIds", "removedFactIds", "requiredChangedFactIds"],
    schema,
    "$.delta"
  );
  for (const key of [
    "addedFactIds",
    "removedFactIds",
    "requiredChangedFactIds",
  ]) {
    assertSortedUniqueStrings(value.delta[key], schema, `$.delta.${key}`);
  }
  string(value.observedAt, schema, "$.observedAt");
  return value;
}

export function validateProbeDirective(value) {
  const schema = "D7ProbeDirective";
  object(value, schema, "$");
  exactKeys(
    value,
    [
      "schemaVersion",
      "stateKey",
      "fieldKey",
      "value",
      "progressionPermission",
    ],
    schema,
    "$"
  );
  if (value.schemaVersion !== PROBE_DIRECTIVE_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", "unsupported schema version");
  }
  string(value.stateKey, schema, "$.stateKey");
  string(value.fieldKey, schema, "$.fieldKey");
  if (
    !["string", "number", "boolean"].includes(typeof value.value) &&
    value.value !== null
  ) {
    fail(schema, "$.value", "expected a scalar probe value");
  }
  member(
    value.progressionPermission,
    ["forbidden", "allowed"],
    schema,
    "$.progressionPermission"
  );
  return value;
}

export function validateResultEnvelope(value) {
  const schema = "F13.5ResultEnvelope";
  object(value, schema, "$");
  exactKeys(
    value,
    [
      "schemaVersion",
      "invocationId",
      "artifactId",
      "versions",
      "stateKey",
      "fieldResults",
      "stateOutcome",
      "progression",
      "observedStateIdentity",
      "evidenceRefs",
      "faultClass",
    ],
    schema,
    "$"
  );
  if (value.schemaVersion !== RESULT_ENVELOPE_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", "unsupported schema version");
  }
  string(value.invocationId, schema, "$.invocationId");
  string(value.artifactId, schema, "$.artifactId");
  object(value.versions, schema, "$.versions");
  exactKeys(
    value.versions,
    ["artifact", "contract", "fingerprintAlgorithm", "script"],
    schema,
    "$.versions"
  );
  integer(value.versions.artifact, schema, "$.versions.artifact", { min: 1 });
  integer(value.versions.contract, schema, "$.versions.contract", { min: 1 });
  string(
    value.versions.fingerprintAlgorithm,
    schema,
    "$.versions.fingerprintAlgorithm"
  );
  integer(value.versions.script, schema, "$.versions.script", { min: 1 });
  string(value.stateKey, schema, "$.stateKey");
  array(value.fieldResults, schema, "$.fieldResults");
  uniqueKeys(value.fieldResults, "key", schema, "$.fieldResults");
  value.fieldResults.forEach((result, index) => {
    const resultPath = `$.fieldResults[${index}]`;
    object(result, schema, resultPath);
    exactKeys(
      result,
      [
        "key",
        "status",
        "attempted",
        "resolved",
        "entered",
        "verified",
        "failureCode",
        "detail",
      ],
      schema,
      resultPath
    );
    string(result.key, schema, `${resultPath}.key`);
    member(result.status, FIELD_RESULT_STATES, schema, `${resultPath}.status`);
    for (const key of ["attempted", "resolved", "entered", "verified"]) {
      boolean(result[key], schema, `${resultPath}.${key}`);
    }
    if (result.failureCode !== null) {
      member(
        result.failureCode,
        FIELD_FAILURE_CODES,
        schema,
        `${resultPath}.failureCode`
      );
    }
    nullableString(result.detail, schema, `${resultPath}.detail`);
    if (result.status === "unattempted") {
      if (
        result.attempted ||
        result.resolved ||
        result.entered ||
        result.verified ||
        result.failureCode !== null
      ) {
        fail(schema, resultPath, "unattempted result has inconsistent flags");
      }
    }
    if (result.status === "verified") {
      if (
        !result.attempted ||
        !result.resolved ||
        !result.entered ||
        !result.verified ||
        result.failureCode !== null
      ) {
        fail(schema, resultPath, "verified result has inconsistent flags");
      }
    }
    if (result.status === "failed" && result.failureCode === null) {
      fail(schema, `${resultPath}.failureCode`, "failed result requires a code");
    }
  });
  member(value.stateOutcome, STATE_OUTCOMES, schema, "$.stateOutcome");
  object(value.progression, schema, "$.progression");
  exactKeys(
    value.progression,
    [
      "kind",
      "outcome",
      "attempted",
      "confirmed",
      "failureCode",
      "beforeIdentity",
      "afterIdentity",
      "matchedSuccessorStateKey",
    ],
    schema,
    "$.progression"
  );
  member(value.progression.kind, PROGRESSION_KINDS, schema, "$.progression.kind");
  member(
    value.progression.outcome,
    PROGRESSION_OUTCOMES,
    schema,
    "$.progression.outcome"
  );
  boolean(value.progression.attempted, schema, "$.progression.attempted");
  boolean(value.progression.confirmed, schema, "$.progression.confirmed");
  if (value.progression.failureCode !== null) {
    member(
      value.progression.failureCode,
      PROGRESSION_FAILURE_CODES,
      schema,
      "$.progression.failureCode"
    );
  }
  if (value.progression.beforeIdentity !== null) {
    validateObservedStateIdentity(
      value.progression.beforeIdentity,
      schema,
      "$.progression.beforeIdentity"
    );
  }
  if (value.progression.afterIdentity !== null) {
    validateObservedStateIdentity(
      value.progression.afterIdentity,
      schema,
      "$.progression.afterIdentity"
    );
  }
  nullableString(
    value.progression.matchedSuccessorStateKey,
    schema,
    "$.progression.matchedSuccessorStateKey"
  );
  if (value.progression.confirmed) {
    if (
      value.progression.outcome !== "confirmed" ||
      !value.progression.attempted ||
      value.progression.failureCode !== null ||
      value.progression.beforeIdentity === null ||
      value.progression.afterIdentity === null ||
      value.progression.matchedSuccessorStateKey === null ||
      stateIdentityKey(value.progression.beforeIdentity) ===
        stateIdentityKey(value.progression.afterIdentity)
    ) {
      fail(schema, "$.progression", "confirmed progression is inconsistent");
    }
  }
  validateObservedStateIdentity(
    value.observedStateIdentity,
    schema,
    "$.observedStateIdentity"
  );
  array(value.evidenceRefs, schema, "$.evidenceRefs");
  value.evidenceRefs.forEach((ref, index) =>
    string(ref, schema, `$.evidenceRefs[${index}]`)
  );
  if (value.faultClass !== null) {
    member(value.faultClass, FAULT_CLASSES, schema, "$.faultClass");
  }
  return value;
}

export function validateProposalRejection(value) {
  const schema = "ProposalRejection";
  object(value, schema, "$");
  exactKeys(
    value,
    ["proposalId", "code", "detail", "observedAt"],
    schema,
    "$"
  );
  string(value.proposalId, schema, "$.proposalId");
  member(value.code, PROPOSAL_REJECTION_CODES, schema, "$.code");
  string(value.detail, schema, "$.detail");
  string(value.observedAt, schema, "$.observedAt");
  return value;
}

export function validateGeneratedScriptManifest(value) {
  const schema = "GeneratedScriptManifest";
  object(value, schema, "$");
  exactKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "artifactId",
      "normalizedUrl",
      "versions",
      "generatedAt",
      "model",
      "promptVersion",
      "sourceHash",
      "parentScriptVersion",
      "contractHash",
      "certificationEligible",
    ],
    schema,
    "$"
  );
  if (value.schemaVersion !== GENERATED_SCRIPT_MANIFEST_SCHEMA_VERSION) {
    fail(schema, "$.schemaVersion", "unsupported schema version");
  }
  if (value.kind !== "generated_d1") {
    fail(schema, "$.kind", "manual or legacy planners cannot enter the D1 store");
  }
  string(value.artifactId, schema, "$.artifactId");
  validateNormalizedUrl(value.normalizedUrl, schema, "$.normalizedUrl");
  object(value.versions, schema, "$.versions");
  exactKeys(
    value.versions,
    ["artifact", "contract", "fingerprintAlgorithm", "script"],
    schema,
    "$.versions"
  );
  integer(value.versions.artifact, schema, "$.versions.artifact", { min: 1 });
  integer(value.versions.contract, schema, "$.versions.contract", { min: 1 });
  string(
    value.versions.fingerprintAlgorithm,
    schema,
    "$.versions.fingerprintAlgorithm"
  );
  integer(value.versions.script, schema, "$.versions.script", { min: 1 });
  string(value.generatedAt, schema, "$.generatedAt");
  string(value.model, schema, "$.model");
  string(value.promptVersion, schema, "$.promptVersion");
  if (!/^[a-f0-9]{64}$/i.test(value.sourceHash)) {
    fail(schema, "$.sourceHash", "expected a SHA-256 hex digest");
  }
  if (
    value.parentScriptVersion !== null &&
    (!Number.isInteger(value.parentScriptVersion) ||
      value.parentScriptVersion < 1 ||
      value.parentScriptVersion >= value.versions.script)
  ) {
    fail(schema, "$.parentScriptVersion", "must precede the script version");
  }
  if (!/^[a-f0-9]{64}$/i.test(value.contractHash)) {
    fail(schema, "$.contractHash", "expected a SHA-256 hex digest");
  }
  boolean(
    value.certificationEligible,
    schema,
    "$.certificationEligible"
  );
  return value;
}

export const RUNTIME_SCHEMA_IDS = Object.freeze({
  semanticContract: `formweave://schemas/d2-contract/v${CONTRACT_SCHEMA_VERSION}`,
  contractDelta: `formweave://schemas/d2-delta/v${CONTRACT_SCHEMA_VERSION}`,
  rawObservation: `formweave://schemas/d6-observation/v${RAW_OBSERVATION_SCHEMA_VERSION}`,
  probeDirective: `formweave://schemas/d7-directive/v${PROBE_DIRECTIVE_SCHEMA_VERSION}`,
  resultEnvelope: `formweave://schemas/f13.5-envelope/v${RESULT_ENVELOPE_SCHEMA_VERSION}`,
  generatedScriptManifest: `formweave://schemas/d1-manifest/v${GENERATED_SCRIPT_MANIFEST_SCHEMA_VERSION}`,
});
