const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_MODULE_PATH = /^(?:handlers|shared)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,191}\.mjs$/;

export const SEMANTIC_REPAIR_SCHEMA_VERSION = 1;
export const ACTUATOR_INTERFACE_VERSION = 1;
export const ACTUATOR_BUNDLE_SCHEMA_VERSION = 1;
export const ACTUATOR_PROTOCOL_VERSION = 1;

export const SEMANTIC_REPAIR_OPERATIONS = Object.freeze([
  "replace_source_fact_ids",
  "replace_field_mechanics",
  "rename_candidate_key",
  "replace_field",
  "add_field",
  "remove_field",
  "replace_progression",
  "replace_action",
  "add_action",
  "remove_action",
  "replace_sections",
  "replace_guidance",
]);

export const REPAIR_DIAGNOSES = Object.freeze([
  "semantic",
  "actuator",
  "both",
  "environment",
  "drift_suspicion",
]);

export const ACTUATOR_OPERATIONS = Object.freeze([
  "prepare_state",
  "set_field",
  "read_field",
  "execute_action",
  "observe_transition",
]);

export const ACTUATOR_CAPABILITIES = Object.freeze([
  "locator",
  "frame",
  "shadow",
  "keyboard",
  "pointer",
  "select",
  "file",
  "wait",
  "observe",
]);

export const ACTUATOR_FAILURE_CODES = Object.freeze([
  "locator_unresolved",
  "actuation_unverified",
  "readback_unverified",
  "handler_timeout",
  "handler_contract_violation",
  "capability_denied",
  "state_change_unverified",
  "validation_blocked",
  "protected_action_blocked",
  "environment_error",
]);

export class SemanticActuatorContractError extends TypeError {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "SemanticActuatorContractError";
    this.path = path;
  }
}

function fail(path, message) {
  throw new SemanticActuatorContractError(path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value;
}

function exactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown key");
  }
}

function requiredKeys(value, required, path) {
  for (const key of required) {
    if (!(key in value)) fail(`${path}.${key}`, "is required");
  }
}

function string(value, path, { empty = false, pattern = null, max = 20_000 } = {}) {
  if (typeof value !== "string" || (!empty && value.trim() === "")) {
    fail(path, empty ? "expected a string" : "expected a non-empty string");
  }
  if (value.length > max) fail(path, `must not exceed ${max} characters`);
  if (pattern && !pattern.test(value)) fail(path, "has an invalid format");
  return value;
}

function integer(value, path, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(path, `expected an integer >= ${minimum}`);
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function nullableString(value, path) {
  if (value === null) return value;
  return string(value, path);
}

function enumeration(value, allowed, path) {
  if (!allowed.includes(value)) {
    fail(path, `expected one of: ${allowed.join(", ")}`);
  }
  return value;
}

function array(value, path, { minimum = 0, maximum = 1_000 } = {}) {
  if (!Array.isArray(value)) fail(path, "expected an array");
  if (value.length < minimum) fail(path, `expected at least ${minimum} item(s)`);
  if (value.length > maximum) fail(path, `expected at most ${maximum} item(s)`);
  return value;
}

function uniqueStrings(value, path, options = {}) {
  const rows = array(value, path, options).map((item, index) =>
    string(item, `${path}[${index}]`, { max: 512 }),
  );
  if (new Set(rows).size !== rows.length) fail(path, "must contain unique strings");
  return rows;
}

function hash(value, path) {
  return string(value, path, { pattern: HASH, max: 64 });
}

function safeId(value, path) {
  return string(value, path, { pattern: SAFE_ID, max: 128 });
}

function safeModulePath(value, path) {
  const checked = string(value, path, {
    pattern: SAFE_MODULE_PATH,
    max: 200,
  });
  const segments = checked.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    fail(path, "must not contain relative path segments");
  }
  return checked;
}

function jsonValue(value, path, depth = 0) {
  if (depth > 12) fail(path, "exceeds the maximum JSON depth");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) fail(path, "contains too many array items");
    value.forEach((item, index) => jsonValue(item, `${path}[${index}]`, depth + 1));
    return value;
  }
  const row = object(value, path);
  if (Object.keys(row).length > 1_000) fail(path, "contains too many object keys");
  for (const [key, item] of Object.entries(row)) {
    string(key, `${path} key`, { max: 256 });
    jsonValue(item, `${path}.${key}`, depth + 1);
  }
  return value;
}

function validateRepairOperation(operation, path) {
  const row = object(operation, path);
  exactKeys(row, ["op", "targetKey", "value"], path);
  requiredKeys(row, ["op", "targetKey", "value"], path);
  enumeration(row.op, SEMANTIC_REPAIR_OPERATIONS, `${path}.op`);
  string(row.targetKey, `${path}.targetKey`, { max: 256 });
  jsonValue(row.value, `${path}.value`);
  if (row.op === "replace_source_fact_ids") {
    uniqueStrings(row.value, `${path}.value`, { minimum: 1, maximum: 32 });
  }
  if (row.op === "rename_candidate_key") {
    safeId(row.value, `${path}.value`);
  }
  if (
    [
      "replace_field_mechanics",
      "replace_field",
      "add_field",
      "replace_progression",
      "replace_action",
    ].includes(row.op)
  ) {
    object(row.value, `${path}.value`);
  }
  if (["replace_sections", "replace_guidance"].includes(row.op)) {
    array(row.value, `${path}.value`, { maximum: 1_000 });
  }
  if (["remove_field", "remove_action"].includes(row.op) && row.value !== null) {
    fail(`${path}.value`, "must be null for a remove operation");
  }
  return row;
}

export function validateSemanticRepairDocument(value) {
  const row = object(value, "$semanticRepair");
  exactKeys(
    row,
    [
      "schemaVersion",
      "repairId",
      "layer",
      "baseCandidateHash",
      "issueIds",
      "operations",
      "rationale",
    ],
    "$semanticRepair",
  );
  requiredKeys(
    row,
    [
      "schemaVersion",
      "repairId",
      "layer",
      "baseCandidateHash",
      "issueIds",
      "operations",
      "rationale",
    ],
    "$semanticRepair",
  );
  if (row.schemaVersion !== SEMANTIC_REPAIR_SCHEMA_VERSION) {
    fail("$semanticRepair.schemaVersion", "unsupported schema version");
  }
  safeId(row.repairId, "$semanticRepair.repairId");
  if (row.layer !== "semantic") fail("$semanticRepair.layer", "must equal semantic");
  hash(row.baseCandidateHash, "$semanticRepair.baseCandidateHash");
  uniqueStrings(row.issueIds, "$semanticRepair.issueIds", {
    minimum: 1,
    maximum: 100,
  });
  array(row.operations, "$semanticRepair.operations", {
    minimum: 1,
    maximum: 100,
  }).forEach((item, index) =>
    validateRepairOperation(item, `$semanticRepair.operations[${index}]`),
  );
  string(row.rationale, "$semanticRepair.rationale", { max: 10_000 });
  return row;
}

export function validateRepairDiagnosis(value) {
  const row = object(value, "$repairDiagnosis");
  exactKeys(
    row,
    [
      "schemaVersion",
      "diagnosisId",
      "classification",
      "issueIds",
      "evidenceRefs",
      "rationale",
      "confidence",
    ],
    "$repairDiagnosis",
  );
  requiredKeys(
    row,
    [
      "schemaVersion",
      "diagnosisId",
      "classification",
      "issueIds",
      "evidenceRefs",
      "rationale",
      "confidence",
    ],
    "$repairDiagnosis",
  );
  if (row.schemaVersion !== 1) fail("$repairDiagnosis.schemaVersion", "must equal 1");
  safeId(row.diagnosisId, "$repairDiagnosis.diagnosisId");
  enumeration(row.classification, REPAIR_DIAGNOSES, "$repairDiagnosis.classification");
  uniqueStrings(row.issueIds, "$repairDiagnosis.issueIds", {
    minimum: 1,
    maximum: 100,
  });
  uniqueStrings(row.evidenceRefs, "$repairDiagnosis.evidenceRefs", { maximum: 100 });
  string(row.rationale, "$repairDiagnosis.rationale", { max: 10_000 });
  enumeration(row.confidence, ["high", "medium", "low"], "$repairDiagnosis.confidence");
  return row;
}

function validateActuatorHandler(value, path) {
  const row = object(value, path);
  exactKeys(
    row,
    [
      "handlerId",
      "targetKind",
      "targetKey",
      "operations",
      "modulePath",
      "exportName",
      "capabilities",
      "sourceFactIds",
    ],
    path,
  );
  requiredKeys(
    row,
    [
      "handlerId",
      "targetKind",
      "targetKey",
      "operations",
      "modulePath",
      "exportName",
      "capabilities",
      "sourceFactIds",
    ],
    path,
  );
  safeId(row.handlerId, `${path}.handlerId`);
  enumeration(row.targetKind, ["state", "field", "action"], `${path}.targetKind`);
  string(row.targetKey, `${path}.targetKey`, { max: 256 });
  const operations = uniqueStrings(row.operations, `${path}.operations`, {
    minimum: 1,
    maximum: ACTUATOR_OPERATIONS.length,
  });
  operations.forEach((item, index) =>
    enumeration(item, ACTUATOR_OPERATIONS, `${path}.operations[${index}]`),
  );
  safeModulePath(row.modulePath, `${path}.modulePath`);
  safeId(row.exportName, `${path}.exportName`);
  const capabilities = uniqueStrings(row.capabilities, `${path}.capabilities`, {
    maximum: ACTUATOR_CAPABILITIES.length,
  });
  capabilities.forEach((item, index) =>
    enumeration(item, ACTUATOR_CAPABILITIES, `${path}.capabilities[${index}]`),
  );
  uniqueStrings(row.sourceFactIds, `${path}.sourceFactIds`, { maximum: 64 });
  return row;
}

function validateActuatorModule(value, path) {
  const row = object(value, path);
  exactKeys(row, ["modulePath", "source", "sourceHash"], path);
  requiredKeys(row, ["modulePath", "source", "sourceHash"], path);
  safeModulePath(row.modulePath, `${path}.modulePath`);
  string(row.source, `${path}.source`, { max: 100_000 });
  hash(row.sourceHash, `${path}.sourceHash`);
  return row;
}

export function validateActuatorBundle(value) {
  const row = object(value, "$actuatorBundle");
  exactKeys(
    row,
    [
      "schemaVersion",
      "interfaceVersion",
      "bundleId",
      "artifactId",
      "bundleVersion",
      "semanticCandidateHash",
      "observationHash",
      "handlers",
      "modules",
      "rationale",
    ],
    "$actuatorBundle",
  );
  requiredKeys(
    row,
    [
      "schemaVersion",
      "interfaceVersion",
      "bundleId",
      "artifactId",
      "bundleVersion",
      "semanticCandidateHash",
      "observationHash",
      "handlers",
      "modules",
      "rationale",
    ],
    "$actuatorBundle",
  );
  if (row.schemaVersion !== ACTUATOR_BUNDLE_SCHEMA_VERSION) {
    fail("$actuatorBundle.schemaVersion", "unsupported schema version");
  }
  if (row.interfaceVersion !== ACTUATOR_INTERFACE_VERSION) {
    fail("$actuatorBundle.interfaceVersion", "unsupported actuator interface");
  }
  safeId(row.bundleId, "$actuatorBundle.bundleId");
  safeId(row.artifactId, "$actuatorBundle.artifactId");
  integer(row.bundleVersion, "$actuatorBundle.bundleVersion");
  hash(row.semanticCandidateHash, "$actuatorBundle.semanticCandidateHash");
  hash(row.observationHash, "$actuatorBundle.observationHash");
  const handlers = array(row.handlers, "$actuatorBundle.handlers", {
    minimum: 1,
    maximum: 1_000,
  }).map((item, index) =>
    validateActuatorHandler(item, `$actuatorBundle.handlers[${index}]`),
  );
  const modules = array(row.modules, "$actuatorBundle.modules", {
    minimum: 1,
    maximum: 1_000,
  }).map((item, index) =>
    validateActuatorModule(item, `$actuatorBundle.modules[${index}]`),
  );
  string(row.rationale, "$actuatorBundle.rationale", { max: 20_000 });

  const handlerIds = handlers.map((item) => item.handlerId);
  if (new Set(handlerIds).size !== handlerIds.length) {
    fail("$actuatorBundle.handlers", "handlerId values must be unique");
  }
  const handlerTargets = handlers.flatMap((handler) =>
    handler.operations.map(
      (operation) => `${handler.targetKind}:${handler.targetKey}:${operation}`,
    ),
  );
  if (new Set(handlerTargets).size !== handlerTargets.length) {
    fail("$actuatorBundle.handlers", "target operation mappings must be unique");
  }
  const modulePaths = modules.map((item) => item.modulePath);
  if (new Set(modulePaths).size !== modulePaths.length) {
    fail("$actuatorBundle.modules", "modulePath values must be unique");
  }
  const moduleSet = new Set(modulePaths);
  handlers.forEach((handler, index) => {
    if (!moduleSet.has(handler.modulePath)) {
      fail(
        `$actuatorBundle.handlers[${index}].modulePath`,
        "does not name a supplied module",
      );
    }
  });
  return row;
}

export function validateActuatorCommand(value) {
  const row = object(value, "$actuatorCommand");
  exactKeys(
    row,
    [
      "protocolVersion",
      "invocationId",
      "releaseId",
      "semanticVersion",
      "actuatorVersion",
      "stateKey",
      "targetKind",
      "targetKey",
      "operation",
      "value",
      "mode",
      "directive",
    ],
    "$actuatorCommand",
  );
  requiredKeys(
    row,
    [
      "protocolVersion",
      "invocationId",
      "releaseId",
      "semanticVersion",
      "actuatorVersion",
      "stateKey",
      "targetKind",
      "targetKey",
      "operation",
      "value",
      "mode",
      "directive",
    ],
    "$actuatorCommand",
  );
  if (row.protocolVersion !== ACTUATOR_PROTOCOL_VERSION) {
    fail("$actuatorCommand.protocolVersion", "unsupported protocol version");
  }
  safeId(row.invocationId, "$actuatorCommand.invocationId");
  safeId(row.releaseId, "$actuatorCommand.releaseId");
  integer(row.semanticVersion, "$actuatorCommand.semanticVersion");
  integer(row.actuatorVersion, "$actuatorCommand.actuatorVersion");
  string(row.stateKey, "$actuatorCommand.stateKey", { max: 256 });
  enumeration(row.targetKind, ["state", "field", "action"], "$actuatorCommand.targetKind");
  string(row.targetKey, "$actuatorCommand.targetKey", { max: 256 });
  enumeration(row.operation, ACTUATOR_OPERATIONS, "$actuatorCommand.operation");
  jsonValue(row.value, "$actuatorCommand.value");
  enumeration(
    row.mode,
    ["probe", "validation_replay", "fixture", "real_data"],
    "$actuatorCommand.mode",
  );
  const directive = object(row.directive, "$actuatorCommand.directive");
  exactKeys(directive, ["progressionPermission"], "$actuatorCommand.directive");
  requiredKeys(directive, ["progressionPermission"], "$actuatorCommand.directive");
  enumeration(
    directive.progressionPermission,
    ["allowed", "forbidden"],
    "$actuatorCommand.directive.progressionPermission",
  );
  return row;
}

export function validateActuatorResult(value) {
  const row = object(value, "$actuatorResult");
  exactKeys(
    row,
    [
      "protocolVersion",
      "invocationId",
      "handlerId",
      "attempted",
      "status",
      "resolved",
      "entered",
      "verified",
      "normalizedReadback",
      "stateChanged",
      "failureCode",
      "detail",
      "beforeObservationRef",
      "afterObservationRef",
      "diagnostics",
    ],
    "$actuatorResult",
  );
  requiredKeys(row, [
    "protocolVersion",
    "invocationId",
    "handlerId",
    "attempted",
    "status",
    "resolved",
    "entered",
    "verified",
    "normalizedReadback",
    "stateChanged",
    "failureCode",
    "detail",
    "beforeObservationRef",
    "afterObservationRef",
    "diagnostics",
  ], "$actuatorResult");
  if (row.protocolVersion !== ACTUATOR_PROTOCOL_VERSION) {
    fail("$actuatorResult.protocolVersion", "unsupported protocol version");
  }
  safeId(row.invocationId, "$actuatorResult.invocationId");
  safeId(row.handlerId, "$actuatorResult.handlerId");
  boolean(row.attempted, "$actuatorResult.attempted");
  enumeration(row.status, ["unattempted", "verified", "failed", "blocked"], "$actuatorResult.status");
  boolean(row.resolved, "$actuatorResult.resolved");
  boolean(row.entered, "$actuatorResult.entered");
  boolean(row.verified, "$actuatorResult.verified");
  if (row.normalizedReadback !== null) {
    jsonValue(row.normalizedReadback, "$actuatorResult.normalizedReadback");
  }
  boolean(row.stateChanged, "$actuatorResult.stateChanged");
  if (row.failureCode !== null) {
    enumeration(row.failureCode, ACTUATOR_FAILURE_CODES, "$actuatorResult.failureCode");
  }
  nullableString(row.detail, "$actuatorResult.detail");
  nullableString(row.beforeObservationRef, "$actuatorResult.beforeObservationRef");
  nullableString(row.afterObservationRef, "$actuatorResult.afterObservationRef");
  array(row.diagnostics, "$actuatorResult.diagnostics", { maximum: 100 }).forEach(
    (item, index) => jsonValue(item, `$actuatorResult.diagnostics[${index}]`),
  );

  if (row.verified) {
    if (!row.attempted || row.status !== "verified" || !row.resolved) {
      fail("$actuatorResult", "a verified result must be attempted, resolved, and verified status");
    }
    if (row.failureCode !== null) {
      fail("$actuatorResult.failureCode", "must be null for a verified result");
    }
  }
  if (row.status === "verified" && !row.verified) {
    fail("$actuatorResult.verified", "must be true for verified status");
  }
  if (!row.attempted && (row.entered || row.verified || row.status === "verified")) {
    fail("$actuatorResult", "an unattempted result cannot be entered or verified");
  }
  if (["failed", "blocked"].includes(row.status) && row.failureCode === null) {
    fail("$actuatorResult.failureCode", "is required for a failed or blocked result");
  }
  return row;
}

export function validateActuatorRepairDocument(value) {
  const row = object(value, "$actuatorRepair");
  exactKeys(
    row,
    [
      "schemaVersion",
      "repairId",
      "layer",
      "baseBundleHash",
      "issueIds",
      "replacements",
      "rationale",
    ],
    "$actuatorRepair",
  );
  requiredKeys(row, [
    "schemaVersion",
    "repairId",
    "layer",
    "baseBundleHash",
    "issueIds",
    "replacements",
    "rationale",
  ], "$actuatorRepair");
  if (row.schemaVersion !== 1) fail("$actuatorRepair.schemaVersion", "must equal 1");
  safeId(row.repairId, "$actuatorRepair.repairId");
  if (row.layer !== "actuator") fail("$actuatorRepair.layer", "must equal actuator");
  hash(row.baseBundleHash, "$actuatorRepair.baseBundleHash");
  uniqueStrings(row.issueIds, "$actuatorRepair.issueIds", {
    minimum: 1,
    maximum: 100,
  });
  const replacements = array(row.replacements, "$actuatorRepair.replacements", {
    minimum: 1,
    maximum: 100,
  });
  replacements.forEach((item, index) => {
    const replacement = object(item, `$actuatorRepair.replacements[${index}]`);
    exactKeys(
      replacement,
      ["modulePath", "source", "sourceHash", "handlerIds", "capabilities"],
      `$actuatorRepair.replacements[${index}]`,
    );
    requiredKeys(
      replacement,
      ["modulePath", "source", "sourceHash", "handlerIds", "capabilities"],
      `$actuatorRepair.replacements[${index}]`,
    );
    validateActuatorModule(
      {
        modulePath: replacement.modulePath,
        source: replacement.source,
        sourceHash: replacement.sourceHash,
      },
      `$actuatorRepair.replacements[${index}]`,
    );
    uniqueStrings(replacement.handlerIds, `$actuatorRepair.replacements[${index}].handlerIds`, {
      minimum: 1,
      maximum: 100,
    });
    const capabilities = uniqueStrings(
      replacement.capabilities,
      `$actuatorRepair.replacements[${index}].capabilities`,
      { maximum: ACTUATOR_CAPABILITIES.length },
    );
    capabilities.forEach((capability, capabilityIndex) =>
      enumeration(
        capability,
        ACTUATOR_CAPABILITIES,
        `$actuatorRepair.replacements[${index}].capabilities[${capabilityIndex}]`,
      ),
    );
  });
  string(row.rationale, "$actuatorRepair.rationale", { max: 10_000 });
  return row;
}

export function validateArtifactRelease(value) {
  const row = object(value, "$artifactRelease");
  exactKeys(
    row,
    [
      "schemaVersion",
      "releaseId",
      "artifactId",
      "releaseVersion",
      "semanticCandidateId",
      "semanticVersion",
      "semanticHash",
      "actuatorBundleId",
      "actuatorVersion",
      "actuatorHash",
      "validationIds",
      "supersedesReleaseId",
      "certificationStatus",
    ],
    "$artifactRelease",
  );
  requiredKeys(row, [
    "schemaVersion",
    "releaseId",
    "artifactId",
    "releaseVersion",
    "semanticCandidateId",
    "semanticVersion",
    "semanticHash",
    "actuatorBundleId",
    "actuatorVersion",
    "actuatorHash",
    "validationIds",
    "supersedesReleaseId",
    "certificationStatus",
  ], "$artifactRelease");
  if (row.schemaVersion !== 1) fail("$artifactRelease.schemaVersion", "must equal 1");
  safeId(row.releaseId, "$artifactRelease.releaseId");
  safeId(row.artifactId, "$artifactRelease.artifactId");
  integer(row.releaseVersion, "$artifactRelease.releaseVersion");
  safeId(row.semanticCandidateId, "$artifactRelease.semanticCandidateId");
  integer(row.semanticVersion, "$artifactRelease.semanticVersion");
  hash(row.semanticHash, "$artifactRelease.semanticHash");
  safeId(row.actuatorBundleId, "$artifactRelease.actuatorBundleId");
  integer(row.actuatorVersion, "$artifactRelease.actuatorVersion");
  hash(row.actuatorHash, "$artifactRelease.actuatorHash");
  uniqueStrings(row.validationIds, "$artifactRelease.validationIds", {
    minimum: 1,
    maximum: 100,
  });
  if (row.supersedesReleaseId !== null) {
    safeId(row.supersedesReleaseId, "$artifactRelease.supersedesReleaseId");
  }
  enumeration(
    row.certificationStatus,
    ["observed", "certified", "revoked", "superseded"],
    "$artifactRelease.certificationStatus",
  );
  return row;
}
