import { randomUUID } from "node:crypto";

import { hashJson, sha256 } from "../contracts/artifact-store.mjs";
import {
  ACTUATOR_CAPABILITIES,
  ACTUATOR_OPERATIONS,
  REPAIR_DIAGNOSES,
  SEMANTIC_REPAIR_OPERATIONS,
  validateActuatorRepairDocument,
  validateSemanticRepairDocument,
} from "../contracts/semantic-actuator-schemas.mjs";
import { validateSemanticProposal, SEMANTIC_PROPOSAL_JSON_SCHEMA } from "../semantic/proposal-schema.mjs";
import {
  callStructuredModel,
  structuredModelConfiguration,
} from "../semantic/structured-model.mjs";
import {
  alignActuatorCapabilities,
  assertActuatorBundle,
  inspectActuatorModule,
} from "./actuator-source.mjs";
import { assignDiagnosisIdentity } from "./repair-transaction.mjs";

export const ACTUATOR_PROMPT_VERSION = "site-actuator-target-v12";
export const ACTUATOR_REPAIR_PROMPT_VERSION = "site-actuator-repair-v6";
export const REPAIR_DIAGNOSIS_PROMPT_VERSION = "semantic-actuator-diagnosis-v3";
export const SEMANTIC_REPAIR_PROMPT_VERSION = "semantic-domain-repair-v1";

const ACTUATOR_TARGET_MAX_OUTPUT_TOKENS = 8_000;

const stringArray = {
  type: "array",
  items: { type: "string" },
};

const handlerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "handlerId",
    "targetKind",
    "targetKey",
    "operations",
    "modulePath",
    "exportName",
    "capabilities",
    "sourceFactIds",
  ],
  properties: {
    handlerId: { type: "string", minLength: 1 },
    targetKind: { type: "string", enum: ["state", "field", "action"] },
    targetKey: { type: "string", minLength: 1 },
    operations: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: ACTUATOR_OPERATIONS },
    },
    modulePath: { type: "string", pattern: "^(handlers|shared)/.+\\.mjs$" },
    exportName: { type: "string", minLength: 1 },
    capabilities: {
      type: "array",
      items: { type: "string", enum: ACTUATOR_CAPABILITIES },
    },
    sourceFactIds: stringArray,
  },
};

export const ACTUATOR_BUNDLE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["handlers", "modules", "rationale"],
  properties: {
    handlers: { type: "array", minItems: 1, items: handlerSchema },
    modules: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["modulePath", "source"],
        properties: {
          modulePath: { type: "string", pattern: "^(handlers|shared)/.+\\.mjs$" },
          source: { type: "string", minLength: 1 },
        },
      },
    },
    rationale: { type: "string", minLength: 1 },
  },
};

export const ACTUATOR_TARGET_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["exportName", "capabilities", "source", "rationale"],
  properties: {
    exportName: {
      type: "string",
      pattern: "^[A-Za-z_$][A-Za-z0-9_$]{0,127}$",
    },
    capabilities: {
      type: "array",
      items: { type: "string", enum: ACTUATOR_CAPABILITIES },
    },
    source: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
  },
};

export const ACTUATOR_REPAIR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["repairId", "issueIds", "replacements", "rationale"],
  properties: {
    repairId: { type: "string", minLength: 1 },
    issueIds: stringArray,
    replacements: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "modulePath",
          "source",
          "handlerIds",
          "capabilities",
        ],
        properties: {
          modulePath: { type: "string", pattern: "^(handlers|shared)/.+\\.mjs$" },
          source: { type: "string", minLength: 1 },
          handlerIds: stringArray,
          capabilities: {
            type: "array",
            items: { type: "string", enum: ACTUATOR_CAPABILITIES },
          },
        },
      },
    },
    rationale: { type: "string", minLength: 1 },
  },
};

export const REPAIR_DIAGNOSIS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "classification",
    "issueIds",
    "evidenceRefs",
    "rationale",
    "confidence",
  ],
  properties: {
    classification: { type: "string", enum: REPAIR_DIAGNOSES },
    issueIds: stringArray,
    evidenceRefs: stringArray,
    rationale: { type: "string", minLength: 1 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const semanticFieldSchema = SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.fields.items;
const semanticActionSchema =
  SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.proposedActions.items;
const semanticSectionSchema = SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.sections.items;
const semanticGuidanceSchema = SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.guidance.items;
const progressionSchema = SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.state.properties.progression;
const progressionTargetSchema =
  SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.mechanics.properties.progressionTarget;
const mechanicsFieldTargetSchema =
  SEMANTIC_PROPOSAL_JSON_SCHEMA.properties.mechanics.properties.fieldTargets.items;

function repairOperationSchema(op, value) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["op", "targetKey", "value"],
    properties: {
      op: { const: op },
      targetKey: { type: "string", minLength: 1 },
      value,
    },
  };
}

export const SEMANTIC_REPAIR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["repairId", "issueIds", "operations", "rationale"],
  properties: {
    repairId: { type: "string", minLength: 1 },
    issueIds: stringArray,
    operations: {
      type: "array",
      minItems: 1,
      items: {
        anyOf: [
          repairOperationSchema("replace_source_fact_ids", stringArray),
          repairOperationSchema("replace_field_mechanics", mechanicsFieldTargetSchema),
          repairOperationSchema("rename_candidate_key", { type: "string", minLength: 1 }),
          repairOperationSchema("replace_field", semanticFieldSchema),
          repairOperationSchema("add_field", semanticFieldSchema),
          repairOperationSchema("remove_field", { type: "null" }),
          repairOperationSchema("replace_progression", {
            type: "object",
            additionalProperties: false,
            required: ["stateProgression", "mechanicsTarget"],
            properties: {
              stateProgression: progressionSchema,
              mechanicsTarget: progressionTargetSchema,
            },
          }),
          repairOperationSchema("replace_action", semanticActionSchema),
          repairOperationSchema("add_action", semanticActionSchema),
          repairOperationSchema("remove_action", { type: "null" }),
          repairOperationSchema("replace_sections", {
            type: "array",
            items: semanticSectionSchema,
          }),
          repairOperationSchema("replace_guidance", {
            type: "array",
            items: semanticGuidanceSchema,
          }),
        ],
      },
    },
    rationale: { type: "string", minLength: 1 },
  },
};

function actuatorTargets(semanticProposal) {
  const fieldMechanics = new Map(
    (semanticProposal.mechanics?.fieldTargets || []).map((target) => [
      target.fieldKey,
      target,
    ]),
  );
  const fieldActions = new Map(
    (semanticProposal.proposedActions || [])
      .filter((action) => action.kind === "field_actuation")
      .map((action) => [action.targetKey, action]),
  );
  const targets = semanticProposal.fields.map((field) => ({
    targetKind: "field",
    targetKey: field.key,
    operations: ["set_field", "read_field"],
    sourceFactIds: [...field.sourceFactIds],
    semantics: {
      field,
      mechanics: fieldMechanics.get(field.key) || null,
      proposedAction: fieldActions.get(field.key) || null,
    },
  }));
  const progression = semanticProposal.state.progression;
  const progressionMechanics = semanticProposal.mechanics?.progressionTarget || null;
  targets.push({
    targetKind: "action",
    targetKey: progression.key,
    operations: ["execute_action"],
    sourceFactIds: progressionMechanics?.sourceFactId
      ? [progressionMechanics.sourceFactId]
      : [],
    semantics: {
      progression,
      mechanics: progressionMechanics,
      proposedAction:
        (semanticProposal.proposedActions || []).find(
          (action) => action.targetKey === progression.key,
        ) || null,
    },
  });
  return targets;
}

function safeTargetSegment(value) {
  return (
    String(value || "target")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 96) || "target"
  );
}

function deterministicNativeResult({
  target,
  index,
  exportName,
  source,
  capabilities,
  controlDescription,
}) {
  const segment = safeTargetSegment(target.targetKey);
  const modulePath = `handlers/${String(index + 1).padStart(3, "0")}_${segment}.mjs`;
  return {
    target,
    responseId: null,
    model: "deterministic-native-compiler",
    rationale:
      `Compiled an ordinary visible native ${controlDescription} into a value-parametric shared actuator; page-specific generation remains available for gated, framed, disabled, read-only, or custom controls.`,
    handler: {
      handlerId: `${target.targetKind}_${segment}_${index + 1}`,
      targetKind: target.targetKind,
      targetKey: target.targetKey,
      operations: target.operations,
      modulePath,
      exportName,
      capabilities,
      sourceFactIds: target.sourceFactIds,
    },
    module: {
      modulePath,
      source,
      sourceHash: sha256(source),
    },
  };
}

function exactNativeSelector(fact) {
  const selectors = fact?.selectorCandidates || [];
  return (
    selectors.find((selector) => selector.startsWith("#")) ||
    selectors.find((selector) => selector.includes("[value=")) ||
    selectors.find((selector) => selector.includes(":nth-of-type(")) ||
    selectors[0] ||
    null
  );
}

export function compileDeterministicNativeTarget({ target, observation, index = 0 }) {
  if (target?.targetKind !== "field") return null;
  const controlType = target?.semantics?.field?.controlType;
  const factIds = new Set(target.sourceFactIds || []);
  const facts = (observation?.controls || []).filter((fact) =>
    factIds.has(fact.factId),
  );
  const selectors = target.semantics?.mechanics?.selectors || [];
  if (
    facts.length === 0 ||
    facts.some(
      (fact) =>
        fact.visible !== true ||
        fact.disabled === true ||
        fact.readOnly === true ||
        (fact.frameUrl && fact.frameUrl !== observation?.url),
    )
  ) {
    return null;
  }

  if (controlType === "select") {
    if (
      selectors.length === 0 ||
      facts.some((fact) => String(fact.tag || "").toLowerCase() !== "select")
    ) {
      return null;
    }
    const exportName = "nativeSelectHandler";
    const source = `export async function ${exportName}(api, command) {
  const target = await api.resolveUnique(${JSON.stringify(selectors)});
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The observed native select did not resolve uniquely.", diagnostics: [] };
  if (command.operation === "read_field") {
    const landed = await api.read(target);
    return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: landed === null || landed === undefined ? null : String(landed), stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
  }
  if (command.operation !== "set_field" || command.value === null || command.value === undefined || String(command.value) === "") return { attempted: true, status: "blocked", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "A non-empty declared select value is required.", diagnostics: [] };
  const requested = String(command.value);
  const before = await api.read(target);
  await api.select(target, requested);
  const landed = await api.read(target);
  const normalized = landed === null || landed === undefined ? null : String(landed);
  const verified = normalized === requested;
  return { attempted: true, status: verified ? "verified" : "failed", resolved: true, entered: true, verified, normalizedReadback: normalized, stateChanged: String(before) !== String(landed), failureCode: verified ? null : "readback_unverified", detail: verified ? null : "The native select did not retain the requested declared value.", diagnostics: [] };
}
`;
    return deterministicNativeResult({
      target,
      index,
      exportName,
      source,
      capabilities: ["locator", "observe", "select"],
      controlDescription: "select",
    });
  }

  const textTypes = new Set([
    "text",
    "password",
    "email",
    "tel",
    "url",
    "number",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
    "textarea",
  ]);
  if (textTypes.has(controlType)) {
    if (
      facts.length !== 1 ||
      selectors.length === 0 ||
      !["input", "textarea"].includes(String(facts[0].tag || "").toLowerCase())
    ) {
      return null;
    }
    const exportName = "nativeTextHandler";
    const source = `export async function ${exportName}(api, command) {
  const target = await api.resolveUnique(${JSON.stringify(selectors)});
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The observed native text control did not resolve uniquely.", diagnostics: [] };
  if (command.operation === "read_field") {
    const landed = await api.read(target);
    return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: landed === null || landed === undefined ? null : String(landed), stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
  }
  if (command.operation !== "set_field" || command.value === null || command.value === undefined) return { attempted: true, status: "blocked", resolved: true, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "A declared text value is required.", diagnostics: [] };
  const requested = String(command.value);
  const before = await api.read(target);
  await api.fill(target, requested);
  const landed = await api.read(target);
  const normalized = landed === null || landed === undefined ? null : String(landed);
  const verified = normalized === requested;
  return { attempted: true, status: verified ? "verified" : "failed", resolved: true, entered: true, verified, normalizedReadback: normalized, stateChanged: String(before) !== String(landed), failureCode: verified ? null : "readback_unverified", detail: verified ? null : "The native text control did not retain the requested value.", diagnostics: [] };
}
`;
    return deterministicNativeResult({
      target,
      index,
      exportName,
      source,
      capabilities: ["keyboard", "locator", "observe"],
      controlDescription: "text control",
    });
  }

  if (["checkbox", "switch"].includes(controlType)) {
    if (
      facts.length !== 1 ||
      selectors.length === 0 ||
      String(facts[0].tag || "").toLowerCase() !== "input" ||
      String(facts[0].rawType || "").toLowerCase() !== "checkbox"
    ) {
      return null;
    }
    const exportName = "nativeCheckboxHandler";
    const source = `export async function ${exportName}(api, command) {
  const target = await api.resolveUnique(${JSON.stringify(selectors)});
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The observed native checkbox did not resolve uniquely.", diagnostics: [] };
  const before = await api.isChecked(target);
  if (command.operation === "read_field") return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: before, stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
  if (command.operation !== "set_field" || command.value === null || command.value === undefined) return { attempted: true, status: "blocked", resolved: true, entered: false, verified: false, normalizedReadback: before, stateChanged: false, failureCode: "validation_blocked", detail: "A declared checkbox value is required.", diagnostics: [] };
  const requestedText = String(command.value).toLowerCase();
  const requested = command.value === true || command.value === 1 || requestedText === "true" || requestedText === "on" || requestedText === "yes";
  if (requested) await api.check(target);
  else await api.uncheck(target);
  const landed = await api.isChecked(target);
  const verified = landed === requested;
  return { attempted: true, status: verified ? "verified" : "failed", resolved: true, entered: true, verified, normalizedReadback: landed, stateChanged: before !== landed, failureCode: verified ? null : "readback_unverified", detail: verified ? null : "The native checkbox did not retain the requested state.", diagnostics: [] };
}
`;
    return deterministicNativeResult({
      target,
      index,
      exportName,
      source,
      capabilities: ["locator", "observe", "pointer"],
      controlDescription: "checkbox",
    });
  }

  if (controlType === "radio") {
    const declaredOptions = target.semantics?.field?.options || [];
    const groundedOptions = declaredOptions.map((option) => {
      const value = String(option.value ?? "");
      const fact = facts.find((candidate) =>
        (candidate.options || []).some(
          (candidateOption) => String(candidateOption.value ?? "") === value,
        ),
      );
      return { value, selector: exactNativeSelector(fact) };
    });
    if (
      declaredOptions.length === 0 ||
      groundedOptions.some((option) => !option.selector) ||
      facts.some(
        (fact) =>
          String(fact.tag || "").toLowerCase() !== "input" ||
          String(fact.rawType || "").toLowerCase() !== "radio",
      )
    ) {
      return null;
    }
    const selectorBranches = groundedOptions
      .map(
        (option, optionIndex) =>
          `${optionIndex === 0 ? "if" : "else if"} (requested === ${JSON.stringify(option.value)}) selectors = ${JSON.stringify([option.selector])};`,
      )
      .join("\n  ");
    const readBranches = groundedOptions
      .map(
        (option) => `const option_${groundedOptions.indexOf(option)} = await api.resolveUnique(${JSON.stringify([option.selector])});
  if (option_${groundedOptions.indexOf(option)} && await api.isChecked(option_${groundedOptions.indexOf(option)})) return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: ${JSON.stringify(option.value)}, stateChanged: false, failureCode: null, detail: null, diagnostics: [] };`,
      )
      .join("\n  ");
    const exportName = "nativeRadioHandler";
    const source = `export async function ${exportName}(api, command) {
  if (command.operation === "read_field") {
  ${readBranches}
    return { attempted: true, status: "verified", resolved: true, entered: false, verified: true, normalizedReadback: null, stateChanged: false, failureCode: null, detail: null, diagnostics: [] };
  }
  if (command.operation !== "set_field" || command.value === null || command.value === undefined) return { attempted: true, status: "blocked", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "A declared radio option is required.", diagnostics: [] };
  const requested = String(command.value);
  let selectors = null;
  ${selectorBranches}
  if (!selectors) return { attempted: true, status: "blocked", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "validation_blocked", detail: "The requested radio value is not a declared observed option.", diagnostics: [] };
  const target = await api.resolveUnique(selectors);
  if (!target) return { attempted: true, status: "failed", resolved: false, entered: false, verified: false, normalizedReadback: null, stateChanged: false, failureCode: "locator_unresolved", detail: "The exact observed native radio option did not resolve uniquely.", diagnostics: [] };
  const before = await api.isChecked(target);
  await api.check(target);
  const landed = await api.isChecked(target);
  return { attempted: true, status: landed ? "verified" : "failed", resolved: true, entered: true, verified: landed, normalizedReadback: landed ? requested : null, stateChanged: before !== landed, failureCode: landed ? null : "readback_unverified", detail: landed ? null : "The native radio option did not remain checked.", diagnostics: [] };
}
`;
    return deterministicNativeResult({
      target,
      index,
      exportName,
      source,
      capabilities: ["locator", "observe", "pointer"],
      controlDescription: "radio group",
    });
  }

  return null;
}

export function validateGeneratedActuatorTarget(generated) {
  const candidate = structuredClone(generated);
  const handler = candidate.handler;
  const actuatorModule = candidate.module;
  handler.operations = [...new Set(handler.operations || [])];
  handler.capabilities = [...new Set(handler.capabilities || [])].sort();
  handler.sourceFactIds = [...new Set(handler.sourceFactIds || [])];
  const inspection = inspectActuatorModule({
    modulePath: actuatorModule.modulePath,
    source: actuatorModule.source,
    availableModules: new Set([actuatorModule.modulePath]),
  });
  const exported = inspection.exports.get(handler.exportName);
  if (!exported || exported.kind !== "function" || exported.async !== true) {
    const error = new Error(
      `Actuator target ${handler.targetKey} must name an exported async function.`,
    );
    error.code = "ACTUATOR_HANDLER_EXPORT_INVALID";
    throw error;
  }
  handler.capabilities = [
    ...new Set([
      ...handler.capabilities,
      ...inspection.usedCapabilities,
    ]),
  ].sort();
  actuatorModule.sourceHash = sha256(actuatorModule.source);
  return {
    ...candidate,
    targetValidation: {
      outcome: "passed",
      usedCapabilities: inspection.usedCapabilities,
      usedMethods: inspection.usedMethods,
    },
  };
}

function targetPrompt({
  semanticProposal,
  observation,
  target,
  repairContext = null,
}) {
  return [
    `Prompt version: ${ACTUATOR_PROMPT_VERSION}`,
    "Generate exactly one page-specific Playwright actuator module for the supplied semantic target. A deterministic compiler will bind this source to the target and combine it with independently generated modules for the other targets.",
    "The shared executor will sequence semantic commands. Your code decides how this declared field/action is resolved, actuated, and read back on this rendered application.",
    "Do not invent, rename, merge, split, or reinterpret semantic targets. If the semantics appear wrong, do not compensate in code; return handlers for the supplied plan and let preflight route the mismatch back to semantic repair.",
    "Return one named exported async function in source. It must implement every operation listed on the exact target below and no other semantic target. A field handler implements both set_field and read_field; an action handler implements execute_action. A handler may own a composite control or prerequisite sequence.",
    "A handler receives only (api, command). It must return exactly: attempted, status, resolved, entered, verified, normalizedReadback, stateChanged, failureCode, detail, diagnostics.",
    "diagnostics is only for structured issue records. Keep it empty for verified results and ordinary telemetry; do not put selector arrays, booleans, or state snapshots in diagnostics. An issue diagnostic must include issueId or code plus a human-readable detail.",
    "The handler protocol is exact: dispatch on command.operation, never command.kind. Resolver arguments may be a non-empty selector string or an array of selector strings; the runtime validates and normalizes both forms. attempted, resolved, entered, verified, and stateChanged are booleans. status is exactly unattempted, verified, failed, or blocked. failureCode is null or one of locator_unresolved, actuation_unverified, readback_unverified, handler_timeout, handler_contract_violation, capability_denied, state_change_unverified, validation_blocked, protected_action_blocked, or environment_error. normalizedReadback is a JSON-safe typed value or null: preserve booleans for checked state, strings/numbers for scalar controls, arrays for multi-value controls, and { value, label } only when the selected-option record is needed. detail is a string or null; diagnostics is an array.",
    "attempted means the requested handler operation ran, including read_field. Every verified result must have attempted true, resolved true, verified true, and status verified. Never return attempted false with verified true or verified status.",
    "Allowed api methods are resolveUnique, resolveInFrame, resolveInShadow, fill, click, check, uncheck, select, press, dispatch, read, isChecked, setFiles, wait, settle, movePointer, scrollIntoView, scrollToEnd, isEnabled, isVisible, and observe.",
    "Element operations accept either the opaque handle returned by a resolver, one selector string, or a selector array that the runtime will resolve uniquely. For example, `await api.resolveUnique(\"#terms\")`, `await api.resolveUnique([\"#terms\"])`, and `await api.scrollToEnd(\"#terms\")` are valid.",
    "A resolver returns an opaque handle or null. Always test `if (!handle)` before using it and return locator_unresolved when it did not resolve exactly one element. For radio fields, use command.value to resolve the exact option selector from the observed option values and call check or click; never call select on a radio group. Never pass the whole repeated radio-group selector (for example input[name=choice][type=radio]) to resolveUnique because it intentionally rejects multiple matches. Use the exact command.value option handle for before/after readback; for read_field without a requested value, a grounded :checked selector may be used and an absent checked option may read as null. When a styled label or card covers a native radio/checkbox, resolve and click its grounded label (for example label[for=observed-id]) and verify the native control readback. Use select only for a native select control, check/uncheck for checkbox or radio controls, fill for text-like controls, and setFiles only for file controls.",
    "For select and radio fields, set_field must accept every value in the target's declared options when it arrives through command.value. Never guard command.value against only the proposal testValue, never hard-code the selected option, and compare readback to the current command.value. Browser preflight will exercise alternate declared choices before certification.",
    "api.observe() takes no arguments and returns exactly page-level `{ url, controls, accessibilitySnapshot }`; it does not return per-element visible, disabled, status, verified, or stateChanged fields. Use isVisible(handle) and isEnabled(handle) for element state. scrollToEnd(handleOrSelectors) returns `{ scrollTop, clientHeight, scrollHeight, atEnd }`.",
    "api.read(handle) returns a boolean for a checkbox, inputValue for input/textarea/select, and text for other elements. For radio controls, do not use api.read: call api.isChecked on the exact option handle, then report the matching declared option value as normalizedReadback. api.isChecked returns a boolean and is valid only for radio or checkbox controls. Static validation enforces this unambiguous radio contract.",
    "Every api method is asynchronous. Directly await every api call, including all resolver, observation, and predicate calls; never treat an unresolved Promise as a locator handle or result.",
    "Declare capabilities using this exact method-to-capability map: resolveUnique and dispatch => locator; resolveInFrame => frame; resolveInShadow => shadow; fill and press => keyboard; click, check, uncheck, movePointer, scrollIntoView, and scrollToEnd => pointer; select => select; read, isChecked, isEnabled, isVisible, and observe => observe; setFiles => file; wait and settle => wait.",
    "For a file field, set_field receives { fileToken } and the handler must pass only that opaque token to api.setFiles; read_field must verify the rendered file selection without reading a local path.",
    "Use selectors and frame/shadow strategies grounded in the supplied observation. Site-specific mechanics belong inside these generated modules.",
    "The observation may contain scrollRegions. Shared page-onset physics deliberately does not scroll nested regions because a terms or policy panel may gate a later control. When a declared field/action requires such a sequence, resolve that observed region in the owning generated handler, call scrollToEnd, wait or settle, verify the dependent control is enabled/visible, and only then actuate it. A frame-owned region includes frameSelectorCandidates and inner selectorCandidates; resolve it with api.resolveInFrame(frameSelectorCandidates, selectorCandidates), then pass the returned handle to scrollToEnd.",
    "If the target control is observed as disabled, do not call fill, click, check, or select immediately. Inspect its description, nearby guidance, scrollRegions, disclosures, and screenshot for the enabling prerequisite; implement that prerequisite in this module and verify isEnabled/isVisible before actuation. If no grounded prerequisite exists, return actuation_unverified instead of guessing.",
    "For execute_action, call api.observe() before the click, actuate, settle, then call api.observe() after. Compare before.url with after.url and/or before.accessibilitySnapshot with after.accessibilitySnapshot. Return verified status and stateChanged true only when that page-level state actually changed as intended; never use continued visibility of the old target as proof of progression.",
    "Modules may contain only relative imports and named exported functions. They may not contain top-level executable statements, external or dynamic imports, filesystem/process/global/network access, eval, Function, constructor/prototype access, classes, this, or dynamic computed properties. Use direct dot properties and for-of iteration.",
    "Do not submit a terminal action, provide credentials or payment data, solve a CAPTCHA, read local paths, or bypass executor authorization.",
    "Use full replacement modules, not line-number patches.",
    repairContext
      ? `Repair context for this target generation: ${JSON.stringify(repairContext)}`
      : "No prior actuator module exists for this target.",
    "Exact target for this call:",
    JSON.stringify(target),
    "Validated semantic plan:",
    JSON.stringify(semanticProposal),
    "Rendered observation:",
    JSON.stringify(observation),
  ].join("\n");
}

async function mapWithConcurrency(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), values.length) },
    async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await task(values[index], index);
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}

export async function generateActuatorBundle(
  {
    artifactId,
    bundleVersion,
    semanticProposal,
    observation,
    screenshot = null,
    bundleId = `actuator_${randomUUID().replaceAll("-", "")}`,
    repairContext = null,
  },
  {
    fetchImpl = fetch,
    configuration = structuredModelConfiguration("OPENAI_ACTUATOR_MODEL"),
    log = async () => {},
    timeoutMs = 360_000,
  } = {},
) {
  validateSemanticProposal(semanticProposal, observation?.existingContract);
  const startedAt = Date.now();
  await log("actuator_generation_started", {
    artifactId,
    bundleId,
    bundleVersion,
    promptVersion: ACTUATOR_PROMPT_VERSION,
    model: configuration.model,
  });
  try {
    const targets = actuatorTargets(semanticProposal);
    const generatedTargets = await mapWithConcurrency(
      targets,
      3,
      async (target, index) => {
        const deterministic = compileDeterministicNativeTarget({
          target,
          observation,
          index,
        });
        if (deterministic) {
          const validated = validateGeneratedActuatorTarget(deterministic);
          await log("actuator_target_compiled_deterministically", {
            artifactId,
            bundleId,
            bundleVersion,
            targetKey: target.targetKey,
            targetKind: target.targetKind,
            controlType: target.semantics?.field?.controlType || null,
            sourceFactIds: [...(target.sourceFactIds || [])],
            compiler: deterministic.model,
          });
          return validated;
        }
        let targetRepairContext = repairContext;
        let lastError = null;
        for (let targetAttempt = 1; targetAttempt <= 2; targetAttempt += 1) {
          try {
            const generated = await callStructuredModel({
              name: "intakecr_site_actuator_target",
              schema: ACTUATOR_TARGET_RESPONSE_SCHEMA,
              system:
                "You generate one auditable, capability-limited per-site Playwright actuator module for an exact semantic target. You do not change semantics or safety policy.",
              prompt: targetPrompt({
                semanticProposal,
                observation,
                target,
                repairContext: targetRepairContext,
              }),
              screenshot,
              fetchImpl,
              configuration,
              timeoutMs,
              maxOutputTokens: ACTUATOR_TARGET_MAX_OUTPUT_TOKENS,
            });
            const segment = safeTargetSegment(target.targetKey);
            const modulePath = `handlers/${String(index + 1).padStart(3, "0")}_${segment}.mjs`;
            return validateGeneratedActuatorTarget({
              target,
              responseId: generated.responseId,
              model: generated.model,
              rationale: generated.value.rationale,
              handler: {
                handlerId: `${target.targetKind}_${segment}_${index + 1}`,
                targetKind: target.targetKind,
                targetKey: target.targetKey,
                operations: target.operations,
                modulePath,
                exportName: generated.value.exportName,
                capabilities: generated.value.capabilities,
                sourceFactIds: target.sourceFactIds,
              },
              module: {
                modulePath,
                source: generated.value.source,
                sourceHash: sha256(generated.value.source),
              },
            });
          } catch (error) {
            lastError = error;
            if (targetAttempt === 2) break;
            const issue = {
              targetKey: target.targetKey,
              code: String(error?.code || "actuator_target_validation_failed"),
              detail: error instanceof Error ? error.message : String(error),
            };
            await log("actuator_target_validation_retry", {
              artifactId,
              bundleId,
              bundleVersion,
              targetKey: target.targetKey,
              targetAttempt,
              issue,
            });
            targetRepairContext = {
              ...(repairContext || {}),
              targetValidationFailure: issue,
              instruction:
                "Repair only this target module. Preserve its semantic target and operations, return one exported async handler, and correct the cited static validation failure.",
            };
          }
        }
        if (lastError && typeof lastError === "object") {
          lastError.targetKey = target.targetKey;
        }
        throw lastError;
      },
    );
    let bundle = {
      schemaVersion: 1,
      interfaceVersion: 1,
      bundleId,
      artifactId,
      bundleVersion,
      semanticCandidateHash: hashJson(semanticProposal),
      observationHash: hashJson(observation),
      handlers: generatedTargets.map((generated) => generated.handler),
      modules: generatedTargets.map((generated) => generated.module),
      rationale: generatedTargets
        .map(
          (generated) =>
            `${generated.target.targetKind}:${generated.target.targetKey}: ${generated.rationale}`,
        )
        .join("\n"),
    };
    const aligned = alignActuatorCapabilities(bundle);
    bundle = aligned.bundle;
    if (aligned.normalizations.length > 0) {
      await log("actuator_bundle_canonicalized", {
        artifactId,
        bundleId,
        bundleVersion,
        normalizations: aligned.normalizations,
      });
    }
    const checked = assertActuatorBundle({ bundle, semanticProposal });
    const provenance = {
      generatedAt: new Date().toISOString(),
      model: generatedTargets[0]?.model || configuration.model,
      promptVersion: ACTUATOR_PROMPT_VERSION,
      responseId: generatedTargets[0]?.responseId || null,
      responseIds: generatedTargets.map((generated) => generated.responseId),
      durationMs: Date.now() - startedAt,
      semanticCandidateHash: bundle.semanticCandidateHash,
      observationHash: bundle.observationHash,
      bundleHash: checked.bundleHash,
      normalizations: aligned.normalizations,
    };
    await log("actuator_generation_completed", {
      artifactId,
      bundleId,
      bundleVersion,
      handlers: bundle.handlers.length,
      modules: bundle.modules.length,
      bundleHash: checked.bundleHash,
      durationMs: provenance.durationMs,
    });
    return { bundle, bundleHash: checked.bundleHash, provenance };
  } catch (error) {
    await log("actuator_generation_failed", {
      artifactId,
      bundleId,
      bundleVersion,
      promptVersion: ACTUATOR_PROMPT_VERSION,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function generateActuatorRepair(
  {
    bundle,
    bundleHash,
    issues,
    evidence = [],
    failureHistory = [],
    repairComparisons = [],
    repeatedPredicates = [],
    prerequisiteObligation = null,
    observation = null,
    screenshot = null,
  },
  {
    fetchImpl = fetch,
    configuration = structuredModelConfiguration("OPENAI_ACTUATOR_MODEL"),
    timeoutMs = 360_000,
  } = {},
) {
  const generated = await callStructuredModel({
    name: "intakecr_actuator_repair",
    schema: ACTUATOR_REPAIR_RESPONSE_SCHEMA,
    system:
      "You repair only the named per-site actuator modules. Return complete replacement modules, never source-line diffs, and never change semantic meaning.",
    prompt: [
      `Prompt version: ${ACTUATOR_REPAIR_PROMPT_VERSION}`,
      "Repair only modules necessary for the listed actuator issues. Preserve all unaffected modules byte-for-byte by omitting them from replacements.",
      "If the evidence indicates wrong semantics or binding, do not hide it with locator code; the diagnosis layer must route it back to semantic repair.",
      "Every api method is asynchronous and every api call must be directly awaited. Resolver arguments must evaluate to selector arrays.",
      "A rendered-control timeout because a target is disabled, not editable, not visible, or gated is actuator mechanics, not infrastructure. Inspect the observation's guidance, disabled state, disclosures, and scrollRegions. Implement only the observed prerequisite sequence, such as scrollToEnd followed by isEnabled/isVisible verification, before retrying actuation.",
      "When a prerequisite obligation is supplied, it is a compiler-enforced target-local plan splice. The replacement must use at least one listed grounded candidate and then re-check the dependent target. Merely repeating the old availability check, changing variable names, or rephrasing result text is invalid.",
      "When prior strategy comparisons show that the same mechanics already failed, choose a structurally different candidate or grounded operation. Never return the same target-level strategy with cosmetic source changes.",
      "For select and radio handlers, repairs must accept and verify every declared safe option supplied through command.value, not only the semantic proposal's testValue. Preflight intentionally exercises alternate options.",
      "For radio handlers, resolve exactly one option derived from command.value and use that same option handle for actuation and readback. Never resolve the repeated whole-group selector with resolveUnique; it rejects multiple matches. Avoid dynamic computed-property lookup tables: use direct conditionals to map declared values to grounded selectors.",
      "For radio readback, call api.isChecked on exact option handles. Do not call api.read on radios and do not compare radio readback to true; normalize the checked option to its declared semantic value string.",
      "For execute_action, verify progression by comparing api.observe() before and after actuation. A verified result must have status verified, verified true, and stateChanged true.",
      "api.observe() takes no arguments and returns only page-level url, controls, and accessibilitySnapshot. Do not read element fields or result-envelope fields from its return value; use before.url !== after.url or before.accessibilitySnapshot !== after.accessibilitySnapshot.",
      `Base bundle hash: ${bundleHash}`,
      `Issues: ${JSON.stringify(issues)}`,
      `Evidence: ${JSON.stringify(evidence)}`,
      `Immutable failure history: ${JSON.stringify(failureHistory)}`,
      `Repeated target/failure predicates: ${JSON.stringify(repeatedPredicates)}`,
      `Prior repair strategy comparisons: ${JSON.stringify(repairComparisons)}`,
      `Compiler-enforced prerequisite obligation: ${JSON.stringify(prerequisiteObligation)}`,
      `Rendered observation: ${JSON.stringify(observation)}`,
      `Bundle: ${JSON.stringify(bundle)}`,
    ].join("\n"),
    screenshot,
    fetchImpl,
    configuration,
    timeoutMs,
    maxOutputTokens: 12_000,
  });
  const repair = {
    schemaVersion: 1,
    repairId: generated.value.repairId,
    layer: "actuator",
    baseBundleHash: bundleHash,
    issueIds: generated.value.issueIds,
    replacements: generated.value.replacements.map((replacement) => ({
      ...replacement,
      sourceHash: sha256(replacement.source),
    })),
    rationale: generated.value.rationale,
  };
  validateActuatorRepairDocument(repair);
  return {
    repair,
    provenance: {
      generatedAt: new Date().toISOString(),
      model: generated.model,
      promptVersion: ACTUATOR_REPAIR_PROMPT_VERSION,
      responseId: generated.responseId,
    },
  };
}

export async function generateRepairDiagnosis(
  {
    issues,
    observation,
    semanticProposal,
    bundle,
    handlerSources,
    resultEnvelope,
    evidenceRefs = [],
    failureHistory = [],
    repairComparisons = [],
    repeatedPredicates = [],
  },
  {
    fetchImpl = fetch,
    configuration = structuredModelConfiguration("OPENAI_ACTUATOR_MODEL"),
    timeoutMs = 180_000,
  } = {},
) {
  const generated = await callStructuredModel({
    name: "intakecr_repair_diagnosis",
    schema: REPAIR_DIAGNOSIS_RESPONSE_SCHEMA,
    system:
      "You diagnose whether observed automation failure belongs to semantic meaning/binding, actuator mechanics, both, environment, or form drift. You return diagnosis content only, never code or persistence identifiers.",
    prompt: [
      `Prompt version: ${REPAIR_DIAGNOSIS_PROMPT_VERSION}`,
      "Classify from supplied evidence. A wrong field/source-fact identity is semantic even when the handler faithfully actuates it. Locator/event/readback implementation against correct semantics is actuator mechanics.",
      "When the same target and failure predicate survives a mechanics repair, reconsider whether the declared semantic action or source-fact binding is wrong. Do not classify a text or data-entry control as a progression action merely because generated code can observe it.",
      `Issues: ${JSON.stringify(issues)}`,
      `Observation: ${JSON.stringify(observation)}`,
      `Semantic plan: ${JSON.stringify(semanticProposal)}`,
      `Actuator manifest: ${JSON.stringify(bundle?.handlers || [])}`,
      `Relevant handler source: ${JSON.stringify(handlerSources)}`,
      `Result envelope: ${JSON.stringify(resultEnvelope)}`,
      `Evidence references: ${JSON.stringify(evidenceRefs)}`,
      `Repeated target/failure predicates: ${JSON.stringify(repeatedPredicates)}`,
      `Immutable failure history: ${JSON.stringify(failureHistory)}`,
      `Prior repair strategy comparisons: ${JSON.stringify(repairComparisons)}`,
    ].join("\n"),
    fetchImpl,
    configuration,
    timeoutMs,
    maxOutputTokens: 4_000,
  });
  const assigned = assignDiagnosisIdentity({
    diagnosis: { schemaVersion: 1, ...generated.value },
    context: {
      responseId: generated.responseId,
      promptVersion: REPAIR_DIAGNOSIS_PROMPT_VERSION,
      repeatedPredicates,
    },
  });
  const diagnosis = assigned.diagnosis;
  return {
    diagnosis,
    provenance: {
      generatedAt: new Date().toISOString(),
      model: generated.model,
      promptVersion: REPAIR_DIAGNOSIS_PROMPT_VERSION,
      responseId: generated.responseId,
      ...assigned.provenance,
    },
  };
}

export async function generateSemanticRepair(
  { proposal, candidateHash, issues, observation, failureHistory = [] },
  {
    fetchImpl = fetch,
    configuration = structuredModelConfiguration("OPENAI_SEMANTIC_MODEL"),
    timeoutMs = 180_000,
  } = {},
) {
  validateSemanticProposal(proposal, observation?.existingContract);
  const generated = await callStructuredModel({
    name: "intakecr_semantic_repair",
    schema: SEMANTIC_REPAIR_RESPONSE_SCHEMA,
    system:
      "You repair semantic meaning and observation bindings using typed domain operations. You do not write Playwright code.",
    prompt: [
      `Prompt version: ${SEMANTIC_REPAIR_PROMPT_VERSION}`,
      `Allowed operations: ${SEMANTIC_REPAIR_OPERATIONS.join(", ")}.`,
      "Correct only the listed semantic issues and references that necessarily depend on them. A wrong field key or source-fact ID must be repaired here, not hidden in actuator code.",
      "Return typed operations, not line-number patches and not a complete free-form replacement document.",
      `Base candidate hash: ${candidateHash}`,
      `Issues: ${JSON.stringify(issues)}`,
      `Immutable failure history: ${JSON.stringify(failureHistory)}`,
      `Current semantic candidate: ${JSON.stringify(proposal)}`,
      `Rendered observation: ${JSON.stringify(observation)}`,
    ].join("\n"),
    fetchImpl,
    configuration,
    timeoutMs,
    maxOutputTokens: 20_000,
  });
  const repair = {
    schemaVersion: 1,
    repairId: generated.value.repairId,
    layer: "semantic",
    baseCandidateHash: candidateHash,
    issueIds: generated.value.issueIds,
    operations: generated.value.operations,
    rationale: generated.value.rationale,
  };
  validateSemanticRepairDocument(repair);
  return {
    repair,
    provenance: {
      generatedAt: new Date().toISOString(),
      model: generated.model,
      promptVersion: SEMANTIC_REPAIR_PROMPT_VERSION,
      responseId: generated.responseId,
    },
  };
}
