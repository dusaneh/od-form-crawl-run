import { CONTROL_TYPES, GUIDANCE_KINDS, PROGRESSION_KINDS } from "../contracts/codes.mjs";

export const SEMANTIC_PROPOSAL_SCHEMA_VERSION = 1;
export const SEMANTIC_PROMPT_VERSION = "gate2-semantic-state-v11";

export const ACTION_KINDS = Object.freeze([
  "field_actuation",
  "choice_probe",
  "advance",
  "terminal_submit",
  "captcha_interaction",
  "login_interaction",
  "payment_interaction",
  "credential_interaction",
  "upload_interaction",
  "legal_acceptance_interaction",
]);

export class SemanticProposalError extends Error {
  constructor(path, message) {
    super(`Semantic proposal validation failed at ${path}: ${message}`);
    this.name = "SemanticProposalError";
    this.path = path;
  }
}

function fail(path, message) {
  throw new SemanticProposalError(path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function string(value, path, { nullable = false, empty = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || (!empty && value.trim() === "")) {
    fail(path, nullable ? "expected a string or null" : "expected a string");
  }
  return value;
}

function member(value, values, path) {
  if (!values.includes(value)) {
    fail(path, `expected one of: ${values.join(", ")}`);
  }
  return value;
}

function exactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown key");
  }
}

function scalar(value, path) {
  if (
    value !== null &&
    !["string", "number", "boolean"].includes(typeof value)
  ) {
    fail(path, "expected a scalar value");
  }
  return value;
}

function unique(items, key, path) {
  const seen = new Set();
  items.forEach((item, index) => {
    const value = string(item?.[key], `${path}[${index}].${key}`);
    if (seen.has(value)) fail(`${path}[${index}].${key}`, "duplicate key");
    seen.add(value);
  });
  return seen;
}

function sortedUniqueStrings(values, path) {
  array(values, path);
  values.forEach((value, index) => string(value, `${path}[${index}]`));
  const canonical = [...new Set(values)].sort();
  if (
    canonical.length !== values.length ||
    canonical.some((value, index) => value !== values[index])
  ) {
    fail(path, "must be sorted and unique");
  }
}

export function validateSemanticProposal(value, existingContract = null) {
  object(value, "$");
  exactKeys(
    value,
    [
      "schemaVersion",
      "proposalId",
      "state",
      "fields",
      "sections",
      "guidance",
      "mechanics",
      "proposedActions",
      "rationale",
    ],
    "$",
  );
  if (value.schemaVersion !== SEMANTIC_PROPOSAL_SCHEMA_VERSION) {
    fail("$.schemaVersion", "unsupported version");
  }
  string(value.proposalId, "$.proposalId");

  object(value.state, "$.state");
  exactKeys(
    value.state,
    [
      "key",
      "description",
      "kind",
      "normalizedRoute",
      "visibleControlKeys",
      "sectionKeys",
      "progression",
    ],
    "$.state",
  );
  string(value.state.key, "$.state.key");
  string(value.state.description, "$.state.description");
  member(value.state.kind, ["form", "review", "terminal"], "$.state.kind");
  string(value.state.normalizedRoute, "$.state.normalizedRoute");
  if (
    !value.state.normalizedRoute.startsWith("/") ||
    /[?#]/.test(value.state.normalizedRoute)
  ) {
    fail("$.state.normalizedRoute", "expected a normalized route");
  }
  sortedUniqueStrings(
    value.state.visibleControlKeys,
    "$.state.visibleControlKeys",
  );
  sortedUniqueStrings(value.state.sectionKeys, "$.state.sectionKeys");
  object(value.state.progression, "$.state.progression");
  exactKeys(
    value.state.progression,
    ["key", "kind", "rationale"],
    "$.state.progression",
  );
  string(value.state.progression.key, "$.state.progression.key");
  member(
    value.state.progression.kind,
    PROGRESSION_KINDS,
    "$.state.progression.kind",
  );
  string(value.state.progression.rationale, "$.state.progression.rationale");
  if (
    value.state.kind === "terminal" !==
    (value.state.progression.kind === "terminal_submit")
  ) {
    fail(
      "$.state",
      "terminal state and terminal_submit progression must agree",
    );
  }

  const fields = array(value.fields, "$.fields");
  const fieldKeys = unique(fields, "key", "$.fields");
  fields.forEach((field, index) => {
    const path = `$.fields[${index}]`;
    object(field, path);
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
        "resolutionHints",
        "sourceFactIds",
      ],
      path,
    );
    string(field.rawLabel, `${path}.rawLabel`);
    member(field.controlType, CONTROL_TYPES, `${path}.controlType`);
    if (typeof field.required !== "boolean") {
      fail(`${path}.required`, "expected a boolean");
    }
    array(field.options, `${path}.options`);
    const optionValues = new Set();
    field.options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      object(option, optionPath);
      exactKeys(option, ["value", "label"], optionPath);
      const optionValue = string(option.value, `${optionPath}.value`, {
        empty: true,
      });
      string(option.label, `${optionPath}.label`);
      if (optionValues.has(optionValue)) {
        fail(`${optionPath}.value`, "duplicate option value");
      }
      optionValues.add(optionValue);
    });
    string(field.sectionKey, `${path}.sectionKey`, { nullable: true });
    sortedUniqueStrings(field.guidanceRefs, `${path}.guidanceRefs`);
    scalar(field.testValue, `${path}.testValue`);
    if (typeof field.sensitive !== "boolean") {
      fail(`${path}.sensitive`, "expected a boolean");
    }
    if (typeof field.administrative !== "boolean") {
      fail(`${path}.administrative`, "expected a boolean");
    }
    sortedUniqueStrings(field.resolutionHints, `${path}.resolutionHints`);
    sortedUniqueStrings(field.sourceFactIds, `${path}.sourceFactIds`);
  });

  const sections = array(value.sections, "$.sections");
  const sectionKeys = unique(sections, "key", "$.sections");
  sections.forEach((section, index) => {
    const path = `$.sections[${index}]`;
    object(section, path);
    exactKeys(
      section,
      ["key", "label", "parentKey", "order", "guidanceRefs", "fieldKeys"],
      path,
    );
    string(section.label, `${path}.label`);
    string(section.parentKey, `${path}.parentKey`, { nullable: true });
    if (!Number.isInteger(section.order) || section.order < 0) {
      fail(`${path}.order`, "expected a non-negative integer");
    }
    sortedUniqueStrings(section.guidanceRefs, `${path}.guidanceRefs`);
    sortedUniqueStrings(section.fieldKeys, `${path}.fieldKeys`);
  });

  const guidance = array(value.guidance, "$.guidance");
  const guidanceKeys = unique(guidance, "key", "$.guidance");
  guidance.forEach((item, index) => {
    const path = `$.guidance[${index}]`;
    object(item, path);
    exactKeys(
      item,
      ["key", "scopeKind", "scopeKey", "kind", "text", "sourceFactIds"],
      path,
    );
    member(item.scopeKind, ["form", "section", "question"], `${path}.scopeKind`);
    string(item.scopeKey, `${path}.scopeKey`, { nullable: true });
    member(item.kind, GUIDANCE_KINDS, `${path}.kind`);
    string(item.text, `${path}.text`);
    sortedUniqueStrings(item.sourceFactIds, `${path}.sourceFactIds`);
  });

  for (const key of value.state.visibleControlKeys) {
    if (!fieldKeys.has(key) && !existingContract?.fields?.some((f) => f.key === key)) {
      fail("$.state.visibleControlKeys", `unknown field "${key}"`);
    }
  }
  for (const key of value.state.sectionKeys) {
    if (!sectionKeys.has(key) && !existingContract?.sections?.some((s) => s.key === key)) {
      fail("$.state.sectionKeys", `unknown section "${key}"`);
    }
  }
  fields.forEach((field, index) => {
    if (
      field.sectionKey !== null &&
      !sectionKeys.has(field.sectionKey) &&
      !existingContract?.sections?.some((s) => s.key === field.sectionKey)
    ) {
      fail(`$.fields[${index}].sectionKey`, "unknown section");
    }
    field.guidanceRefs.forEach((key) => {
      if (
        !guidanceKeys.has(key) &&
        !existingContract?.guidance?.some((item) => item.key === key)
      ) {
        fail(`$.fields[${index}].guidanceRefs`, `unknown guidance "${key}"`);
      }
    });
  });

  object(value.mechanics, "$.mechanics");
  exactKeys(
    value.mechanics,
    ["fieldTargets", "progressionTarget"],
    "$.mechanics",
  );
  array(value.mechanics.fieldTargets, "$.mechanics.fieldTargets");
  unique(value.mechanics.fieldTargets, "fieldKey", "$.mechanics.fieldTargets");
  value.mechanics.fieldTargets.forEach((target, index) => {
    const path = `$.mechanics.fieldTargets[${index}]`;
    object(target, path);
    exactKeys(target, ["fieldKey", "selectors"], path);
    sortedUniqueStrings(target.selectors, `${path}.selectors`);
    if (
      !fieldKeys.has(target.fieldKey) &&
      !existingContract?.fields?.some((field) => field.key === target.fieldKey)
    ) {
      fail(`${path}.fieldKey`, "unknown field");
    }
  });
  object(value.mechanics.progressionTarget, "$.mechanics.progressionTarget");
  exactKeys(
    value.mechanics.progressionTarget,
    ["key", "kind", "sourceFactId", "selectors"],
    "$.mechanics.progressionTarget",
  );
  if (
    value.mechanics.progressionTarget.key !== value.state.progression.key ||
    value.mechanics.progressionTarget.kind !== value.state.progression.kind
  ) {
    fail("$.mechanics.progressionTarget", "must match state progression");
  }
  sortedUniqueStrings(
    value.mechanics.progressionTarget.selectors,
    "$.mechanics.progressionTarget.selectors",
  );
  string(
    value.mechanics.progressionTarget.sourceFactId,
    "$.mechanics.progressionTarget.sourceFactId",
  );

  const actions = array(value.proposedActions, "$.proposedActions");
  unique(actions, "proposalId", "$.proposedActions");
  actions.forEach((action, index) => {
    const path = `$.proposedActions[${index}]`;
    object(action, path);
    exactKeys(action, ["proposalId", "kind", "targetKey", "value", "rationale"], path);
    member(action.kind, ACTION_KINDS, `${path}.kind`);
    string(action.targetKey, `${path}.targetKey`);
    scalar(action.value, `${path}.value`);
    string(action.rationale, `${path}.rationale`);
  });

  array(value.rationale, "$.rationale");
  value.rationale.forEach((item, index) => {
    const path = `$.rationale[${index}]`;
    object(item, path);
    exactKeys(item, ["subjectKey", "evidence", "confidence"], path);
    string(item.subjectKey, `${path}.subjectKey`);
    string(item.evidence, `${path}.evidence`);
    member(item.confidence, ["high", "medium", "low"], `${path}.confidence`);
  });

  if (existingContract) {
    for (const collection of ["fields", "sections", "guidance"]) {
      const existing = new Set(
        (existingContract[collection] || []).map((item) => item.key),
      );
      value[collection].forEach((item, index) => {
        if (existing.has(item.key)) {
          fail(
            `$.${collection}[${index}].key`,
            "existing contract keys cannot be modified or replaced",
          );
        }
      });
    }
    if (existingContract.states?.some((state) => state.key === value.state.key)) {
      fail("$.state.key", "existing states cannot be modified or replaced");
    }
  }
  return value;
}

const nullableString = { type: ["string", "null"] };
const scalarSchema = { type: ["string", "number", "boolean", "null"] };
const stringArray = { type: "array", items: { type: "string" } };

export const SEMANTIC_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    proposalId: { type: "string" },
    state: {
      type: "object",
      properties: {
        key: { type: "string" },
        description: { type: "string" },
        kind: { type: "string", enum: ["form", "review", "terminal"] },
        normalizedRoute: { type: "string" },
        visibleControlKeys: stringArray,
        sectionKeys: stringArray,
        progression: {
          type: "object",
          properties: {
            key: { type: "string" },
            kind: { type: "string", enum: [...PROGRESSION_KINDS] },
            rationale: { type: "string" },
          },
          required: ["key", "kind", "rationale"],
          additionalProperties: false,
        },
      },
      required: [
        "key",
        "description",
        "kind",
        "normalizedRoute",
        "visibleControlKeys",
        "sectionKeys",
        "progression",
      ],
      additionalProperties: false,
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          rawLabel: { type: "string", minLength: 1 },
          controlType: { type: "string", enum: [...CONTROL_TYPES] },
          required: { type: "boolean" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                label: { type: "string" },
              },
              required: ["value", "label"],
              additionalProperties: false,
            },
          },
          sectionKey: nullableString,
          guidanceRefs: stringArray,
          testValue: scalarSchema,
          sensitive: { type: "boolean" },
          administrative: { type: "boolean" },
          resolutionHints: stringArray,
          sourceFactIds: stringArray,
        },
        required: [
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
          "resolutionHints",
          "sourceFactIds",
        ],
        additionalProperties: false,
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          parentKey: nullableString,
          order: { type: "integer" },
          guidanceRefs: stringArray,
          fieldKeys: stringArray,
        },
        required: [
          "key",
          "label",
          "parentKey",
          "order",
          "guidanceRefs",
          "fieldKeys",
        ],
        additionalProperties: false,
      },
    },
    guidance: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          scopeKind: {
            type: "string",
            enum: ["form", "section", "question"],
          },
          scopeKey: nullableString,
          kind: { type: "string", enum: [...GUIDANCE_KINDS] },
          text: { type: "string" },
          sourceFactIds: stringArray,
        },
        required: [
          "key",
          "scopeKind",
          "scopeKey",
          "kind",
          "text",
          "sourceFactIds",
        ],
        additionalProperties: false,
      },
    },
    mechanics: {
      type: "object",
      properties: {
        fieldTargets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              fieldKey: { type: "string" },
              selectors: stringArray,
            },
            required: ["fieldKey", "selectors"],
            additionalProperties: false,
          },
        },
        progressionTarget: {
          type: "object",
          properties: {
            key: { type: "string" },
            kind: { type: "string", enum: [...PROGRESSION_KINDS] },
            sourceFactId: { type: "string" },
            selectors: stringArray,
          },
          required: ["key", "kind", "sourceFactId", "selectors"],
          additionalProperties: false,
        },
      },
      required: ["fieldTargets", "progressionTarget"],
      additionalProperties: false,
    },
    proposedActions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          proposalId: { type: "string" },
          kind: { type: "string", enum: [...ACTION_KINDS] },
          targetKey: { type: "string" },
          value: scalarSchema,
          rationale: { type: "string" },
        },
        required: ["proposalId", "kind", "targetKey", "value", "rationale"],
        additionalProperties: false,
      },
    },
    rationale: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subjectKey: { type: "string" },
          evidence: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
        required: ["subjectKey", "evidence", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "schemaVersion",
    "proposalId",
    "state",
    "fields",
    "sections",
    "guidance",
    "mechanics",
    "proposedActions",
    "rationale",
  ],
  additionalProperties: false,
};
