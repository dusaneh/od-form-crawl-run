import path from "node:path";

import { parse } from "acorn";

import { hashJson, sha256 } from "../contracts/artifact-store.mjs";
import {
  ACTUATOR_CAPABILITIES,
  validateActuatorBundle,
} from "../contracts/semantic-actuator-schemas.mjs";

const FORBIDDEN_IDENTIFIERS = new Set([
  "process",
  "global",
  "globalThis",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "require",
  "eval",
  "Function",
  "Deno",
  "Bun",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "Buffer",
  "Object",
  "Reflect",
  "Proxy",
  "WebAssembly",
  "console",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "constructor",
  "__proto__",
  "prototype",
]);

const FORBIDDEN_PROPERTIES = new Set([
  "constructor",
  "__proto__",
  "prototype",
]);

const API_CAPABILITIES = Object.freeze({
  resolveUnique: "locator",
  resolveInFrame: "frame",
  resolveInShadow: "shadow",
  fill: "keyboard",
  click: "pointer",
  check: "pointer",
  uncheck: "pointer",
  select: "select",
  press: "keyboard",
  dispatch: "locator",
  read: "observe",
  isChecked: "observe",
  setFiles: "file",
  wait: "wait",
  settle: "wait",
  movePointer: "pointer",
  scrollIntoView: "pointer",
  scrollToEnd: "pointer",
  isEnabled: "observe",
  isVisible: "observe",
  observe: "observe",
});

const COMMAND_PROPERTIES = new Set([
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
]);

const RESULT_STATUS_VALUES = new Set([
  "unattempted",
  "verified",
  "failed",
  "blocked",
]);

const RESULT_FAILURE_CODES = new Set([
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

const RESULT_BOOLEAN_PROPERTIES = new Set([
  "attempted",
  "resolved",
  "entered",
  "verified",
  "stateChanged",
]);

export class ActuatorSourceError extends TypeError {
  constructor(message, code = "ACTUATOR_SOURCE_INVALID", details = {}) {
    super(message);
    this.name = "ActuatorSourceError";
    this.code = code;
    this.details = details;
  }
}

function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node || {})) {
    if (["start", "end", "loc", "range"].includes(key)) continue;
    if (value && typeof value === "object" && typeof value.type === "string") {
      children.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof item.type === "string") {
          children.push(item);
        }
      }
    }
  }
  return children;
}

function propertyName(node) {
  if (!node) return "";
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  if (node.computed && node.property?.type === "Literal") {
    return String(node.property.value || "");
  }
  return "";
}

function literalLeaves(node) {
  if (!node) return [];
  if (node.type === "Literal") return [node.value];
  if (node.type === "ConditionalExpression") {
    return [
      ...literalLeaves(node.consequent),
      ...literalLeaves(node.alternate),
    ];
  }
  if (node.type === "LogicalExpression") {
    return [...literalLeaves(node.left), ...literalLeaves(node.right)];
  }
  return [];
}

function staticLiteralValues(node, bindings, seen = new Set()) {
  if (!node) return [];
  if (node.type === "Literal") return [node.value];
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return [node.quasis.map((item) => item.value.cooked || "").join("")];
  }
  if (node.type === "Identifier") {
    if (seen.has(node.name) || !bindings.has(node.name)) return [];
    return staticLiteralValues(
      bindings.get(node.name),
      bindings,
      new Set([...seen, node.name]),
    );
  }
  if (node.type === "ArrayExpression") {
    return node.elements.flatMap((item) =>
      staticLiteralValues(item, bindings, seen),
    );
  }
  if (node.type === "ObjectExpression") {
    return node.properties.flatMap((item) =>
      staticLiteralValues(item.value, bindings, seen),
    );
  }
  if (
    node.type === "ConditionalExpression" ||
    node.type === "LogicalExpression" ||
    node.type === "BinaryExpression"
  ) {
    return childNodes(node).flatMap((item) =>
      staticLiteralValues(item, bindings, seen),
    );
  }
  if (node.type === "AwaitExpression") {
    return staticLiteralValues(node.argument, bindings, seen);
  }
  if (node.type === "CallExpression") {
    return node.arguments.flatMap((item) =>
      staticLiteralValues(item, bindings, seen),
    );
  }
  return [];
}

function commandPropertyReference(node, bindings, seen = new Set()) {
  if (!node) return "";
  if (node.type === "Identifier") {
    if (seen.has(node.name) || !bindings.has(node.name)) return "";
    return commandPropertyReference(
      bindings.get(node.name),
      bindings,
      new Set([...seen, node.name]),
    );
  }
  if (
    node.type === "MemberExpression" &&
    node.object?.type === "Identifier" &&
    node.object.name === "command"
  ) {
    return propertyName(node);
  }
  return "";
}

function staticTypes(node, bindings, seen = new Set()) {
  if (!node) return new Set();
  if (node.type === "Literal") {
    return new Set([node.value === null ? "null" : typeof node.value]);
  }
  if (node.type === "TemplateLiteral") return new Set(["string"]);
  if (node.type === "Identifier") {
    if (seen.has(node.name) || !bindings.has(node.name)) return new Set();
    return staticTypes(
      bindings.get(node.name),
      bindings,
      new Set([...seen, node.name]),
    );
  }
  if (node.type === "ConditionalExpression") {
    return new Set([
      ...staticTypes(node.consequent, bindings, seen),
      ...staticTypes(node.alternate, bindings, seen),
    ]);
  }
  if (node.type === "LogicalExpression") {
    return new Set([
      ...staticTypes(node.left, bindings, seen),
      ...staticTypes(node.right, bindings, seen),
    ]);
  }
  if (node.type === "UnaryExpression") {
    if (node.operator === "!" || node.operator === "delete") {
      return new Set(["boolean"]);
    }
    if (node.operator === "typeof") return new Set(["string"]);
    if (["+", "-", "~"].includes(node.operator)) return new Set(["number"]);
  }
  if (node.type === "BinaryExpression") {
    if (["==", "!=", "===", "!==", "<", "<=", ">", ">=", "in", "instanceof"].includes(node.operator)) {
      return new Set(["boolean"]);
    }
    if (node.operator !== "+") return new Set(["number"]);
  }
  if (
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    ["Boolean", "String", "Number"].includes(node.callee.name)
  ) {
    return new Set([node.callee.name.toLowerCase()]);
  }
  if (node.type === "AwaitExpression") {
    return staticTypes(node.argument, bindings, seen);
  }
  return new Set();
}

function referenceIdentifier(node, parent) {
  if (node.type !== "Identifier") return false;
  if (
    parent?.type === "MemberExpression" &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    parent?.type === "Property" &&
    parent.key === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(
      parent?.type,
    ) &&
    (parent.id === node || parent.params.includes(node))
  ) {
    return true;
  }
  return true;
}

function relativeImportTarget(modulePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.dirname(modulePath);
  const resolved = path.posix.normalize(path.posix.join(base, specifier));
  if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return null;
  return resolved;
}

export function inspectActuatorModule({ modulePath, source, availableModules }) {
  let program;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowHashBang: false,
    });
  } catch (error) {
    throw new ActuatorSourceError(
      `Actuator module ${modulePath} has invalid JavaScript: ${error.message}`,
      "ACTUATOR_SYNTAX_INVALID",
      { modulePath },
    );
  }

  const imports = [];
  const exports = new Map();
  const usedCapabilities = new Set();
  const usedMethods = new Set();
  const strategySignals = new Set();
  const bindings = new Map();
  let nodeCount = 0;

  const visit = (node, parent = null) => {
    nodeCount += 1;
    if (nodeCount > 6_000) {
      throw new ActuatorSourceError(
        `Actuator module ${modulePath} exceeds the static complexity budget.`,
        "ACTUATOR_COMPLEXITY_EXCEEDED",
        { modulePath },
      );
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.init
    ) {
      bindings.set(node.id.name, node.init);
    }
    if (node.type === "ImportExpression") {
      throw new ActuatorSourceError(
        `Actuator module ${modulePath} uses dynamic import.`,
        "ACTUATOR_FORBIDDEN_PRIMITIVE",
        { modulePath },
      );
    }
    if (
      node.type === "MetaProperty" ||
      node.type === "WithStatement" ||
      node.type === "DebuggerStatement" ||
      node.type === "ThisExpression" ||
      node.type === "Super" ||
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    ) {
      throw new ActuatorSourceError(
        `Actuator module ${modulePath} uses a forbidden runtime primitive.`,
        "ACTUATOR_FORBIDDEN_PRIMITIVE",
        { modulePath, nodeType: node.type },
      );
    }
    if (
      node.type === "Identifier" &&
      referenceIdentifier(node, parent) &&
      FORBIDDEN_IDENTIFIERS.has(node.name)
    ) {
      throw new ActuatorSourceError(
        `Actuator module ${modulePath} references forbidden global "${node.name}".`,
        "ACTUATOR_FORBIDDEN_PRIMITIVE",
        { modulePath, identifier: node.name },
      );
    }
    if (node.type === "MemberExpression") {
      if (node.computed && node.property?.type !== "Literal") {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} uses a dynamic computed property.`,
          "ACTUATOR_FORBIDDEN_PRIMITIVE",
          { modulePath },
        );
      }
      const property = propertyName(node);
      if (FORBIDDEN_PROPERTIES.has(property)) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} accesses forbidden property "${property}".`,
          "ACTUATOR_FORBIDDEN_PRIMITIVE",
          { modulePath, property },
        );
      }
      if (node.object?.type === "Identifier" && node.object.name === "api") {
        const capability = API_CAPABILITIES[property];
        if (!capability) {
          throw new ActuatorSourceError(
            `Actuator module ${modulePath} calls unknown capability method api.${property}.`,
            "ACTUATOR_CAPABILITY_UNKNOWN",
            { modulePath, method: property },
          );
        }
        usedCapabilities.add(capability);
      }
      if (
        node.object?.type === "Identifier" &&
        node.object.name === "command" &&
        !COMMAND_PROPERTIES.has(property)
      ) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} reads unknown command property command.${property}. Use command.operation for set_field, read_field, prepare_state, or execute_action dispatch.`,
          "ACTUATOR_HANDLER_CONTRACT_INVALID",
          { modulePath, property },
        );
      }
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.type === "Identifier" &&
      node.callee.object.name === "api"
    ) {
      const method = propertyName(node.callee);
      usedMethods.add(method);
      const literals = node.arguments
        .flatMap((argument) => staticLiteralValues(argument, bindings))
        .filter(
          (value) =>
            value === null ||
            ["string", "number", "boolean"].includes(typeof value),
        );
      strategySignals.add(
        `api:${method}:${JSON.stringify(literals)}`,
      );
      if (parent?.type !== "AwaitExpression") {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} must directly await async capability call api.${method}(...).`,
          "ACTUATOR_HANDLER_CONTRACT_INVALID",
          { modulePath, method },
        );
      }
      if (method === "observe" && node.arguments.length !== 0) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} must call api.observe() without arguments; it returns page-level state, not an element observation.`,
          "ACTUATOR_HANDLER_CONTRACT_INVALID",
          { modulePath, method, arguments: node.arguments.length },
        );
      }
      const arrayArguments =
        method === "resolveUnique"
          ? [0]
          : ["resolveInFrame", "resolveInShadow"].includes(method)
            ? [0, 1]
            : [];
      for (const index of arrayArguments) {
        const argument = node.arguments[index];
        if (
          !argument ||
          argument.type === "ObjectExpression" ||
          (argument.type === "Literal" &&
            (typeof argument.value !== "string" || argument.value.trim() === ""))
        ) {
          throw new ActuatorSourceError(
            `Actuator module ${modulePath} must call api.${method} with a non-empty selector string or selector-array expression.`,
            "ACTUATOR_HANDLER_CONTRACT_INVALID",
            { modulePath, method, argument: index },
          );
        }
      }
    }
    if (node.type === "BinaryExpression") {
      const leftProperty = commandPropertyReference(node.left, bindings);
      const rightProperty = commandPropertyReference(node.right, bindings);
      if (leftProperty || rightProperty) {
        const literalNode = leftProperty ? node.right : node.left;
        const literals = staticLiteralValues(literalNode, bindings).filter(
          (value) =>
            value === null ||
            ["string", "number", "boolean"].includes(typeof value),
        );
        strategySignals.add(
          `command:${leftProperty || rightProperty}:${node.operator}:${JSON.stringify(literals)}`,
        );
      }
    }
    if (node.type === "Property") {
      const key =
        node.key?.type === "Identifier"
          ? node.key.name
          : node.key?.type === "Literal"
            ? String(node.key.value || "")
            : "";
      if (FORBIDDEN_PROPERTIES.has(key)) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} declares or destructures forbidden property "${key}".`,
          "ACTUATOR_FORBIDDEN_PRIMITIVE",
          { modulePath, property: key },
        );
      }
      if (key === "status") {
        const invalid = literalLeaves(node.value).find(
          (value) =>
            typeof value === "string" && !RESULT_STATUS_VALUES.has(value),
        );
        if (invalid) {
          throw new ActuatorSourceError(
            `Actuator module ${modulePath} returns invalid status "${invalid}".`,
            "ACTUATOR_HANDLER_CONTRACT_INVALID",
            { modulePath, property: key, value: invalid },
          );
        }
      }
      if (key === "failureCode") {
        const invalid = literalLeaves(node.value).find(
          (value) =>
            typeof value === "string" && !RESULT_FAILURE_CODES.has(value),
        );
        if (invalid) {
          throw new ActuatorSourceError(
            `Actuator module ${modulePath} returns invalid failureCode "${invalid}".`,
            "ACTUATOR_HANDLER_CONTRACT_INVALID",
            { modulePath, property: key, value: invalid },
          );
        }
      }
      if (RESULT_BOOLEAN_PROPERTIES.has(key)) {
        const types = staticTypes(node.value, bindings);
        const invalid = [...types].filter((type) => type !== "boolean");
        if (invalid.length > 0) {
          throw new ActuatorSourceError(
            `Actuator module ${modulePath} can return non-boolean ${key} (${invalid.join(", ")}).`,
            "ACTUATOR_HANDLER_CONTRACT_INVALID",
            { modulePath, property: key, types: [...types].sort() },
          );
        }
      }
    }
    for (const child of childNodes(node)) visit(child, node);
  };

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      if (statement.specifiers.length === 0) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} uses a side-effect-only import.`,
          "ACTUATOR_IMPORT_FORBIDDEN",
          { modulePath },
        );
      }
      const specifier = String(statement.source.value || "");
      const resolved = relativeImportTarget(modulePath, specifier);
      if (!resolved || !availableModules.has(resolved)) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} imports outside its bundle: ${specifier}.`,
          "ACTUATOR_IMPORT_FORBIDDEN",
          { modulePath, specifier },
        );
      }
      imports.push(resolved);
    } else if (statement.type === "ExportNamedDeclaration") {
      if (statement.source) {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} cannot re-export another module.`,
          "ACTUATOR_EXPORT_INVALID",
          { modulePath },
        );
      }
      const declaration = statement.declaration;
      if (declaration?.type === "FunctionDeclaration") {
        exports.set(declaration.id?.name || "", {
          async: declaration.async,
          kind: "function",
        });
      } else if (declaration?.type === "VariableDeclaration") {
        for (const item of declaration.declarations) {
          const init = item.init;
          if (
            item.id?.type !== "Identifier" ||
            !["ArrowFunctionExpression", "FunctionExpression"].includes(init?.type)
          ) {
            throw new ActuatorSourceError(
              `Actuator module ${modulePath} exports a non-function value.`,
              "ACTUATOR_EXPORT_INVALID",
              { modulePath },
            );
          }
          exports.set(item.id.name, { async: init.async, kind: "function" });
        }
      } else if (statement.specifiers.length > 0) {
        for (const specifier of statement.specifiers) {
          exports.set(specifier.exported.name, {
            async: null,
            kind: "reference",
          });
        }
      } else {
        throw new ActuatorSourceError(
          `Actuator module ${modulePath} has an unsupported export.`,
          "ACTUATOR_EXPORT_INVALID",
          { modulePath },
        );
      }
    } else {
      throw new ActuatorSourceError(
        `Actuator module ${modulePath} has top-level executable code.`,
        "ACTUATOR_TOP_LEVEL_EXECUTION",
        { modulePath, nodeType: statement.type },
      );
    }
    visit(statement);
  }

  return {
    modulePath,
    imports,
    exports,
    usedCapabilities: [...usedCapabilities].sort(),
    usedMethods: [...usedMethods].sort(),
    strategySignals: [...strategySignals].sort(),
    nodeCount,
  };
}

export function alignActuatorCapabilities(bundle) {
  const aligned = structuredClone(bundle);
  const normalizations = [];
  for (const handler of aligned.handlers || []) {
    for (const key of ["operations", "capabilities", "sourceFactIds"]) {
      if (!Array.isArray(handler[key])) continue;
      const before = handler[key];
      const after = [...new Set(before)];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      handler[key] = after;
      normalizations.push({
        path: `$.handlers.${handler.handlerId}.${key}`,
        kind: "canonicalize_handler_string_set",
        before,
        after,
      });
    }
  }
  validateActuatorBundle(aligned);
  const availableModules = new Set(
    aligned.modules.map((module) => module.modulePath),
  );
  const inspections = new Map(
    aligned.modules.map((module) => [
      module.modulePath,
      inspectActuatorModule({
        modulePath: module.modulePath,
        source: module.source,
        availableModules,
      }),
    ]),
  );
  for (const handler of aligned.handlers) {
    const used = inspections.get(handler.modulePath)?.usedCapabilities || [];
    const after = [...new Set([...handler.capabilities, ...used])].sort();
    if (JSON.stringify(after) === JSON.stringify(handler.capabilities)) {
      continue;
    }
    const before = handler.capabilities;
    handler.capabilities = after;
    normalizations.push({
      path: `$.handlers.${handler.handlerId}.capabilities`,
      kind: "declare_statically_used_capabilities",
      before,
      after,
    });
  }
  return { bundle: aligned, normalizations };
}

function proposalFieldMap(semanticProposal) {
  return new Map(
    (semanticProposal?.fields || []).map((field) => [field.key, field]),
  );
}

export function validateActuatorCoverage(bundle, semanticProposal) {
  const issues = [];
  const handlers = bundle.handlers || [];
  const fields = proposalFieldMap(semanticProposal);
  for (const field of fields.values()) {
    for (const operation of ["set_field", "read_field"]) {
      if (
        !handlers.some(
          (handler) =>
            handler.targetKind === "field" &&
            handler.targetKey === field.key &&
            handler.operations.includes(operation),
        )
      ) {
        issues.push({
          code: "actuator_handler_missing",
          targetKey: field.key,
          detail: `No actuator handler declares ${operation} for this semantic field.`,
        });
      }
    }
  }
  const progressionKey = semanticProposal?.state?.progression?.key;
  if (
    progressionKey &&
    !handlers.some(
      (handler) =>
        handler.targetKind === "action" &&
        handler.targetKey === progressionKey &&
        handler.operations.includes("execute_action"),
    )
  ) {
    issues.push({
      code: "actuator_handler_missing",
      targetKey: progressionKey,
      detail: "No actuator handler declares execute_action for progression.",
    });
  }

  for (const [index, handler] of handlers.entries()) {
    if (handler.targetKind === "field") {
      const field = fields.get(handler.targetKey);
      if (!field) {
        issues.push({
          code: "actuator_target_outside_semantics",
          targetKey: handler.targetKey,
          detail: "The actuator handler targets a field absent from the semantic plan.",
        });
      } else if (
        JSON.stringify([...handler.sourceFactIds].sort()) !==
        JSON.stringify([...field.sourceFactIds].sort())
      ) {
        issues.push({
          code: "semantic_binding_mismatch",
          targetKey: handler.targetKey,
          detail:
            "The actuator handler source-fact bindings do not match the semantic plan.",
          handlerIndex: index,
        });
      }
    }
    if (
      handler.targetKind === "action" &&
      handler.targetKey !== progressionKey
    ) {
      issues.push({
        code: "actuator_target_outside_semantics",
        targetKey: handler.targetKey,
        detail: "The actuator handler targets an undeclared semantic action.",
      });
    }
  }
  return issues;
}

export function assertActuatorBundle({ bundle, semanticProposal }) {
  validateActuatorBundle(bundle);
  const modules = new Map(bundle.modules.map((module) => [module.modulePath, module]));
  const availableModules = new Set(modules.keys());
  const inspections = new Map();

  for (const actuatorModule of modules.values()) {
    const computed = sha256(actuatorModule.source);
    if (computed !== actuatorModule.sourceHash) {
      throw new ActuatorSourceError(
        `Actuator module ${actuatorModule.modulePath} failed its source hash check.`,
        "ACTUATOR_SOURCE_HASH_MISMATCH",
        { modulePath: actuatorModule.modulePath },
      );
    }
    inspections.set(
      actuatorModule.modulePath,
      inspectActuatorModule({
        modulePath: actuatorModule.modulePath,
        source: actuatorModule.source,
        availableModules,
      }),
    );
  }

  for (const handler of bundle.handlers) {
    const inspection = inspections.get(handler.modulePath);
    const exported = inspection.exports.get(handler.exportName);
    if (!exported || exported.kind !== "function" || exported.async !== true) {
      throw new ActuatorSourceError(
        `Actuator handler ${handler.handlerId} must name an exported async function.`,
        "ACTUATOR_HANDLER_EXPORT_INVALID",
        { handlerId: handler.handlerId, modulePath: handler.modulePath },
      );
    }
    for (const capability of inspection.usedCapabilities) {
      if (!handler.capabilities.includes(capability)) {
        throw new ActuatorSourceError(
          `Actuator handler ${handler.handlerId} uses undeclared capability "${capability}".`,
          "ACTUATOR_CAPABILITY_UNDECLARED",
          { handlerId: handler.handlerId, capability },
        );
      }
    }
    if (handler.targetKind === "field") {
      const field = proposalFieldMap(semanticProposal).get(handler.targetKey);
      const methods = new Set(inspection.usedMethods);
      const incompatible = [];
      if (field?.controlType !== "select" && methods.has("select")) {
        incompatible.push("select");
      }
      if (field?.controlType !== "file" && methods.has("setFiles")) {
        incompatible.push("setFiles");
      }
      if (
        ["radio", "checkbox", "select", "file"].includes(field?.controlType) &&
        methods.has("fill")
      ) {
        incompatible.push("fill");
      }
      if (
        !["radio", "checkbox"].includes(field?.controlType) &&
        (methods.has("check") || methods.has("uncheck") || methods.has("isChecked"))
      ) {
        if (methods.has("check")) incompatible.push("check");
        if (methods.has("uncheck")) incompatible.push("uncheck");
        if (methods.has("isChecked")) incompatible.push("isChecked");
      }
      if (field?.controlType === "radio" && methods.has("read")) {
        incompatible.push("read");
      }
      if (field?.controlType === "radio" && !methods.has("isChecked")) {
        incompatible.push("missing isChecked");
      }
      if (incompatible.length > 0) {
        throw new ActuatorSourceError(
          `Actuator handler ${handler.handlerId} uses ${[...new Set(incompatible)].join(", ")} for semantic control type ${field?.controlType || "unknown"}.`,
          "ACTUATOR_HANDLER_CONTROL_MISMATCH",
          {
            handlerId: handler.handlerId,
            targetKey: handler.targetKey,
            controlType: field?.controlType || null,
            methods: [...new Set(incompatible)].sort(),
          },
        );
      }
    }
  }

  const coverageIssues = validateActuatorCoverage(bundle, semanticProposal);
  if (coverageIssues.length > 0) {
    const error = new ActuatorSourceError(
      `Actuator bundle has ${coverageIssues.length} semantic coverage issue(s).`,
      "ACTUATOR_COVERAGE_INVALID",
    );
    error.issues = coverageIssues;
    throw error;
  }

  const bundleHash = hashJson({
    schemaVersion: bundle.schemaVersion,
    interfaceVersion: bundle.interfaceVersion,
    bundleId: bundle.bundleId,
    artifactId: bundle.artifactId,
    bundleVersion: bundle.bundleVersion,
    semanticCandidateHash: bundle.semanticCandidateHash,
    observationHash: bundle.observationHash,
    handlers: bundle.handlers,
    modules: bundle.modules.map(({ modulePath, sourceHash }) => ({
      modulePath,
      sourceHash,
    })),
  });
  return {
    bundle,
    bundleHash,
    inspections,
    capabilities: [
      ...new Set(bundle.handlers.flatMap((handler) => handler.capabilities)),
    ].filter((capability) => ACTUATOR_CAPABILITIES.includes(capability)).sort(),
  };
}
