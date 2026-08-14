import { randomUUID } from "node:crypto";

import {
  ACTUATOR_PROTOCOL_VERSION,
  validateActuatorCommand,
  validateActuatorResult,
} from "../contracts/semantic-actuator-schemas.mjs";
import { PhysicsToolbox } from "../executor/physics-toolbox.mjs";
import { scalarReadbackEquivalent } from "../executor/value-equivalence.mjs";

const HANDLER_RESULT_KEYS = new Set([
  "attempted",
  "status",
  "resolved",
  "entered",
  "verified",
  "normalizedReadback",
  "stateChanged",
  "failureCode",
  "detail",
  "diagnostics",
]);

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function selectorArray(value, label) {
  if (typeof value === "string") value = [value];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some(
      (selector) =>
        typeof selector !== "string" ||
        selector.trim() === "" ||
        selector.length > 1_000,
    )
  ) {
    throw new TypeError(`${label} requires one to thirty-two selector strings.`);
  }
  return value;
}

function timeoutError(handlerId, timeoutMs) {
  const error = new Error(
    `Actuator handler ${handlerId} exceeded its ${timeoutMs} ms timeout.`,
  );
  error.code = "handler_timeout";
  return error;
}

function withTimeout(promise, handlerId, timeoutMs, onTimeout) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        onTimeout?.();
        reject(timeoutError(handlerId, timeoutMs));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function rawResult(value, handlerId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Actuator handler ${handlerId} must return an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!HANDLER_RESULT_KEYS.has(key)) {
      throw new TypeError(
        `Actuator handler ${handlerId} returned unknown key "${key}".`,
      );
    }
  }
  for (const key of HANDLER_RESULT_KEYS) {
    if (!(key in value)) {
      throw new TypeError(
        `Actuator handler ${handlerId} did not return required key "${key}".`,
      );
    }
  }
  if (value.status === "verified" && value.verified !== true) {
    throw new TypeError(
      `Actuator handler ${handlerId} returned verified status without verified: true.`,
    );
  }
  if (value.verified === true && value.status !== "verified") {
    throw new TypeError(
      `Actuator handler ${handlerId} returned verified: true without verified status.`,
    );
  }
  return value;
}

function handleRegistry() {
  const values = new Map();
  return {
    add(locator) {
      const id = `locator_${randomUUID().replaceAll("-", "")}`;
      values.set(id, locator);
      return Object.freeze({ handleId: id });
    },
    get(handle) {
      const locator = values.get(handle?.handleId);
      if (!locator) throw new TypeError("Unknown or expired actuator locator handle.");
      return locator;
    },
    clear() {
      values.clear();
    },
  };
}

function createCapabilityFacade({
  page,
  toolbox,
  capabilities,
  fileProvider,
  operation,
  isActive,
}) {
  const allowed = new Set(capabilities);
  const handles = handleRegistry();
  const requireActive = () => {
    if (!isActive()) throw new Error("Actuator invocation is no longer active.");
  };
  const requireCapability = (capability) => {
    requireActive();
    if (!allowed.has(capability)) {
      const error = new Error(`Actuator capability "${capability}" was not declared.`);
      error.code = "capability_denied";
      throw error;
    }
  };
  const writeKind = operation === "execute_action" ? "advance" : "field";
  const withWrite = async (action) => {
    if (writeKind === "advance") {
      // Submission guards intentionally block unapproved form events. Open the
      // narrow browser-side window immediately before the trusted progression
      // primitive so native GET/POST form advances are testable in preflight;
      // terminal authorization is still enforced before this facade exists.
      await page
        .evaluate(() => {
          if (!window.__formweaveControl) return;
          window.__formweaveControl.permitSubmitUntil = Math.max(
            Number(window.__formweaveControl.permitSubmitUntil || 0),
            Date.now() + 10_000,
          );
        })
        .catch(() => {});
    }
    return toolbox.withAuthorizedWrites(writeKind, action);
  };
  const interceptedPointer = (error) =>
    /intercepts pointer events|another element.*receives pointer events/i.test(
      String(error?.message || error || ""),
    );
  const clickAssociatedLabel = async (locator, checked = null) => {
    const id = await locator.getAttribute("id").catch(() => null);
    if (!id) return false;
    const label = page.locator(`label[for=${JSON.stringify(id)}]`);
    if ((await label.count().catch(() => 0)) !== 1) return false;
    await label.click({ timeout: 5_000 });
    if (checked === null) return true;
    return (await locator.isChecked().catch(() => !checked)) === checked;
  };
  const resolveUniqueLocator = async (selectors, label) => {
    const normalized = selectorArray(selectors, label);
    const mainLocator = await toolbox.resolveUnique({ selectors: normalized });
    if (mainLocator || !allowed.has("frame")) return mainLocator;

    // A generated handler that has explicitly declared frame capability may use
    // the simpler global resolver. Fall back only when a selector has no match
    // in the main document and exactly one match across all child frames.
    // Ambiguous selectors remain unresolved and therefore fail closed.
    const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
    for (const selector of normalized) {
      if ((await page.locator(selector).count().catch(() => 0)) !== 0) continue;
      let resolved = null;
      let matches = 0;
      for (const frame of childFrames) {
        const locator = frame.locator(selector);
        const count = await locator.count().catch(() => 0);
        matches += count;
        if (count === 1) resolved = locator;
        if (matches > 1) break;
      }
      if (matches === 1) return resolved;
    }
    return null;
  };
  const locatorFor = async (handleOrSelectors, label) => {
    if (Array.isArray(handleOrSelectors)) {
      const locator = await resolveUniqueLocator(handleOrSelectors, label);
      if (!locator) {
        throw new TypeError(`${label} selector array did not resolve uniquely.`);
      }
      return locator;
    }
    return handles.get(handleOrSelectors);
  };

  const api = {
    async resolveUnique(selectors) {
      requireCapability("locator");
      const locator = await resolveUniqueLocator(selectors, "resolveUnique");
      return locator ? handles.add(locator) : null;
    },
    async resolveInFrame(frameSelectors, selectors) {
      requireCapability("frame");
      frameSelectors = selectorArray(frameSelectors, "resolveInFrame frameSelectors");
      selectors = selectorArray(selectors, "resolveInFrame selectors");
      for (const frameSelector of frameSelectors) {
        for (const selector of selectors) {
          if (typeof frameSelector !== "string" || typeof selector !== "string") continue;
          const locator = page.frameLocator(frameSelector).locator(selector);
          if ((await locator.count().catch(() => 0)) === 1) {
            return handles.add(locator);
          }
        }
      }
      return null;
    },
    async resolveInShadow(hostSelectors, innerSelectors) {
      requireCapability("shadow");
      hostSelectors = selectorArray(hostSelectors, "resolveInShadow hostSelectors");
      innerSelectors = selectorArray(innerSelectors, "resolveInShadow innerSelectors");
      for (const hostSelector of hostSelectors) {
        const host = page.locator(hostSelector);
        if ((await host.count().catch(() => 0)) !== 1) continue;
        for (const innerSelector of innerSelectors) {
          const locator = host.locator(innerSelector);
          if ((await locator.count().catch(() => 0)) === 1) {
            return handles.add(locator);
          }
        }
      }
      return null;
    },
    async fill(handle, value) {
      requireCapability("keyboard");
      if (!scalar(value)) throw new TypeError("fill requires a scalar value.");
      const locator = await locatorFor(handle, "fill");
      await withWrite(async () => {
        await locator.fill(String(value), { timeout: 5_000 });
        await locator.dispatchEvent("input").catch(() => {});
        await locator.dispatchEvent("change").catch(() => {});
        await locator.blur().catch(() => {});
      });
      return true;
    },
    async click(handle, options = {}) {
      requireCapability("pointer");
      const locator = await locatorFor(handle, "click");
      const safeOptions = {
        force: options?.force === true,
        timeout: Math.min(Math.max(Number(options?.timeout) || 5_000, 250), 8_000),
      };
      await withWrite(async () => {
        try {
          await locator.click(safeOptions);
        } catch (error) {
          if (!interceptedPointer(error) || !(await clickAssociatedLabel(locator))) {
            throw error;
          }
        }
      });
      return true;
    },
    async check(handle) {
      requireCapability("pointer");
      const locator = await locatorFor(handle, "check");
      await withWrite(async () => {
        try {
          await locator.check({ timeout: 5_000 });
        } catch (error) {
          if (
            !interceptedPointer(error) ||
            !(await clickAssociatedLabel(locator, true))
          ) {
            throw error;
          }
        }
      });
      return true;
    },
    async uncheck(handle) {
      requireCapability("pointer");
      const locator = await locatorFor(handle, "uncheck");
      await withWrite(async () => {
        try {
          await locator.uncheck({ timeout: 5_000 });
        } catch (error) {
          if (
            !interceptedPointer(error) ||
            !(await clickAssociatedLabel(locator, false))
          ) {
            throw error;
          }
        }
      });
      return true;
    },
    async select(handle, value) {
      requireCapability("select");
      if (!scalar(value)) throw new TypeError("select requires a scalar value.");
      const locator = await locatorFor(handle, "select");
      const selected = await withWrite(() =>
        locator.selectOption(String(value), { timeout: 5_000 }),
      );
      return selected;
    },
    async press(handle, key) {
      requireCapability("keyboard");
      const allowedKeys = new Set([
        "Enter",
        "Space",
        "Tab",
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Escape",
        "Home",
        "End",
      ]);
      if (!allowedKeys.has(key)) throw new TypeError(`Key "${key}" is not allowed.`);
      const locator = await locatorFor(handle, "press");
      await withWrite(() => locator.press(key, { timeout: 5_000 }));
      return true;
    },
    async dispatch(handle, eventName) {
      requireCapability("locator");
      const allowedEvents = new Set([
        "input",
        "change",
        "blur",
        "focus",
        "mousedown",
        "mouseup",
      ]);
      if (!allowedEvents.has(eventName)) {
        throw new TypeError(`Event "${eventName}" is not allowed.`);
      }
      const locator = await locatorFor(handle, "dispatch");
      await withWrite(() => locator.dispatchEvent(eventName));
      return true;
    },
    async read(handle) {
      requireCapability("observe");
      const locator = await locatorFor(handle, "read");
      const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
      const inputType = String((await locator.getAttribute("type")) || "").toLowerCase();
      if (inputType === "checkbox") {
        return locator.isChecked().catch(() => false);
      }
      if (inputType === "radio") {
        const checked = await locator.isChecked().catch(() => false);
        if (!checked) return null;
        return (await locator.getAttribute("value").catch(() => null)) || "on";
      }
      if (["input", "textarea", "select"].includes(tagName)) {
        return locator.inputValue().catch(() => "");
      }
      return locator.textContent().then((value) => value || "").catch(() => "");
    },
    async isChecked(handle) {
      requireCapability("observe");
      const locator = await locatorFor(handle, "isChecked");
      const inputType = String((await locator.getAttribute("type")) || "").toLowerCase();
      if (!['checkbox', 'radio'].includes(inputType)) {
        throw new TypeError("isChecked requires a checkbox or radio control.");
      }
      return locator.isChecked().catch(() => false);
    },
    async setFiles(handle, fileToken) {
      requireCapability("file");
      if (!fileProvider) throw new Error("No authorized file provider is configured.");
      const payload = await fileProvider(fileToken);
      if (
        !payload ||
        typeof payload.name !== "string" ||
        typeof payload.mimeType !== "string" ||
        !Buffer.isBuffer(payload.buffer)
      ) {
        throw new TypeError("The authorized file provider returned an invalid payload.");
      }
      const locator = await locatorFor(handle, "setFiles");
      await withWrite(() =>
        locator.setInputFiles({
          name: payload.name,
          mimeType: payload.mimeType,
          buffer: payload.buffer,
        }),
      );
      return true;
    },
    async wait(milliseconds) {
      requireCapability("wait");
      const bounded = Math.min(Math.max(Number(milliseconds) || 0, 0), 2_000);
      await page.waitForTimeout(bounded);
      return true;
    },
    async settle() {
      requireCapability("wait");
      await toolbox.settle();
      return true;
    },
    async movePointer(points) {
      requireCapability("pointer");
      if (!Array.isArray(points) || points.length > 12) {
        throw new TypeError("movePointer accepts at most twelve points.");
      }
      for (const point of points) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        const steps = Math.min(Math.max(Number(point?.steps) || 1, 1), 12);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new TypeError("Pointer points require finite x and y values.");
        }
        await page.mouse.move(x, y, { steps });
      }
      return true;
    },
    async scrollIntoView(handle) {
      requireCapability("pointer");
      const locator = await locatorFor(handle, "scrollIntoView");
      await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
      return true;
    },
    async scrollToEnd(handle) {
      requireCapability("pointer");
      const locator = await locatorFor(handle, "scrollToEnd");
      return withWrite(() =>
        locator.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          element.dispatchEvent(new Event("scroll", { bubbles: true }));
          return {
            scrollTop: Math.round(element.scrollTop),
            clientHeight: Math.round(element.clientHeight),
            scrollHeight: Math.round(element.scrollHeight),
            atEnd:
              element.scrollTop + element.clientHeight >=
              element.scrollHeight - 2,
          };
        }),
      );
    },
    async isEnabled(handle) {
      requireCapability("observe");
      const locator = await locatorFor(handle, "isEnabled");
      return locator.isEnabled().catch(() => false);
    },
    async isVisible(handle) {
      requireCapability("observe");
      const locator = await locatorFor(handle, "isVisible");
      return locator.isVisible().catch(() => false);
    },
    async observe() {
      requireCapability("observe");
      return {
        url: page.url(),
        controls: await toolbox.senseControls(),
        accessibilitySnapshot: await toolbox.senseAccessibility(),
      };
    },
  };
  return {
    api: Object.freeze(api),
    close: () => handles.clear(),
  };
}

function failedRawResult(error, attempted = true) {
  const code = [
    "handler_timeout",
    "capability_denied",
  ].includes(error?.code)
    ? error.code
    : "handler_contract_violation";
  return {
    attempted,
    status: attempted ? "failed" : "blocked",
    resolved: false,
    entered: false,
    verified: false,
    normalizedReadback: null,
    stateChanged: false,
    failureCode: code,
    detail: error instanceof Error ? error.message : String(error),
    diagnostics: [],
  };
}

function classifyGeneratedFailureDetail(detail) {
  if (/unknown or expired actuator locator handle/i.test(detail)) {
    return {
      failureCode: "handler_contract_violation",
      prefix: "Generated handler violated the locator-handle contract.",
    };
  }
  if (
    /locator\.(?:fill|click|check|uncheck|selectOption|press)|element is not (?:enabled|editable|visible)|element .*disabled|intercepts pointer events|timeout .*waiting for locator/i.test(
      detail,
    )
  ) {
    return {
      failureCode: "actuation_unverified",
      prefix: "Rendered control mechanics prevented actuation.",
    };
  }
  return null;
}

function normalizeGeneratedFailure(raw) {
  const diagnostics = (raw?.diagnostics || []).map((diagnostic) => {
    if (diagnostic?.code !== "environment_error") return diagnostic;
    const classified = classifyGeneratedFailureDetail(String(diagnostic.detail || ""));
    return classified
      ? { ...diagnostic, code: classified.failureCode }
      : diagnostic;
  });
  if (raw?.failureCode !== "environment_error") {
    return diagnostics === raw?.diagnostics ? raw : { ...raw, diagnostics };
  }
  const detail = [
    String(raw.detail || ""),
    ...diagnostics.map((diagnostic) => String(diagnostic?.detail || "")),
  ].join("\n");
  const classified = classifyGeneratedFailureDetail(detail);
  if (!classified) return { ...raw, diagnostics };
  return {
    ...raw,
    failureCode: classified.failureCode,
    detail: `${classified.prefix} ${detail}`.trim(),
    diagnostics,
  };
}

function reconcileIndependentReadback(command, raw) {
  if (
    command.operation !== "read_field" ||
    raw?.verified === true ||
    raw?.attempted !== true ||
    raw?.resolved !== true ||
    raw?.normalizedReadback === null ||
    !scalar(command.value) ||
    (raw?.diagnostics || []).length > 0 ||
    !["readback_unverified", "actuation_unverified"].includes(raw?.failureCode) ||
    !scalarReadbackEquivalent(command.value, raw.normalizedReadback)
  ) {
    return raw;
  }
  return {
    ...raw,
    status: "verified",
    verified: true,
    stateChanged: false,
    failureCode: null,
    detail: null,
  };
}

function reconcileLateProgression(command, raw, urlChanged) {
  if (
    command.operation !== "execute_action" ||
    raw?.verified === true ||
    raw?.attempted !== true ||
    raw?.resolved !== true ||
    raw?.failureCode !== "state_change_unverified" ||
    (raw?.diagnostics || []).length > 0 ||
    !urlChanged
  ) {
    return raw;
  }
  return {
    ...raw,
    status: "verified",
    verified: true,
    stateChanged: true,
    failureCode: null,
    detail: null,
  };
}

export function createActuatorRuntime({
  page,
  semanticProposal,
  bundle,
  handlers,
  releaseId,
  semanticVersion = 1,
  evidenceSink = null,
  allowReadLikePost = () => false,
  protectedTargetKeys = [],
  fileProvider = null,
  handlerTimeoutMs = 12_000,
  terminalSubmissionAuthorized = false,
}) {
  if (!page) throw new TypeError("Actuator runtime requires a Playwright page.");
  if (!(handlers instanceof Map)) {
    throw new TypeError("Actuator runtime requires a loaded handler map.");
  }
  const toolbox = new PhysicsToolbox(page, {
    evidenceSink,
    allowReadLikePost,
  });
  const protectedTargets = new Set(protectedTargetKeys);
  const handlerByTarget = new Map();
  for (const descriptor of bundle.handlers) {
    for (const operation of descriptor.operations) {
      handlerByTarget.set(
        `${descriptor.targetKind}:${descriptor.targetKey}:${operation}`,
        descriptor,
      );
    }
  }

  const blockedResult = async (command, handlerId, failureCode, detail) => {
    const observationRef = await toolbox.capture("actuator_blocked", {
      stateKey: command.stateKey,
      targetKey: command.targetKey,
      failureCode,
    });
    const result = {
      protocolVersion: ACTUATOR_PROTOCOL_VERSION,
      invocationId: command.invocationId,
      handlerId,
      attempted: false,
      status: "blocked",
      resolved: false,
      entered: false,
      verified: false,
      normalizedReadback: null,
      stateChanged: false,
      failureCode,
      detail,
      beforeObservationRef: observationRef,
      afterObservationRef: null,
      diagnostics: [],
    };
    validateActuatorResult(result);
    return result;
  };

  return Object.freeze({
    releaseId,
    semanticVersion,
    actuatorVersion: bundle.bundleVersion,
    async prepare() {
      await toolbox.installRequestGuard();
      return toolbox.prepare();
    },
    defaultInputs(stateKey) {
      if (stateKey !== semanticProposal.state.key) {
        throw new TypeError(`Unknown semantic state "${stateKey}".`);
      }
      return Object.fromEntries(
        semanticProposal.fields
          .filter((field) => !protectedTargets.has(field.key))
          .filter((field) => field.testValue !== null && field.testValue !== undefined)
          .map((field) => [field.key, field.testValue]),
      );
    },
    async invoke(commandValue) {
      const command = validateActuatorCommand(commandValue);
      if (
        command.releaseId !== releaseId ||
        command.semanticVersion !== semanticVersion ||
        command.actuatorVersion !== bundle.bundleVersion
      ) {
        throw new TypeError("Actuator command version pins do not match the loaded release.");
      }
      const descriptor = handlerByTarget.get(
        `${command.targetKind}:${command.targetKey}:${command.operation}`,
      );
      if (!descriptor) {
        return blockedResult(
          command,
          "unmapped_handler",
          "handler_contract_violation",
          "No generated handler is mapped to this semantic command.",
        );
      }
      if (protectedTargets.has(command.targetKey)) {
        return blockedResult(
          command,
          descriptor.handlerId,
          "protected_action_blocked",
          "The executor did not authorize this protected target.",
        );
      }
      if (
        command.operation === "execute_action" &&
        semanticProposal.state.progression.kind === "terminal_submit" &&
        (command.directive.progressionPermission !== "allowed" ||
          terminalSubmissionAuthorized !== true)
      ) {
        return blockedResult(
          command,
          descriptor.handlerId,
          "protected_action_blocked",
          "Terminal progression is not authorized for this invocation.",
        );
      }
      const handler = handlers.get(descriptor.handlerId);
      if (typeof handler !== "function") {
        return blockedResult(
          command,
          descriptor.handlerId,
          "handler_contract_violation",
          "The generated handler export is unavailable.",
        );
      }

      const beforeObservationRef = await toolbox.capture("actuator_before", {
        stateKey: command.stateKey,
        targetKey: command.targetKey,
        operation: command.operation,
      });
      const beforeUrl = page.url();
      let active = true;
      const facade = createCapabilityFacade({
        page,
        toolbox,
        capabilities: descriptor.capabilities,
        fileProvider,
        operation: command.operation,
        isActive: () => active,
      });
      let raw;
      try {
        raw = await withTimeout(
          Promise.resolve(handler(facade.api, Object.freeze(structuredClone(command)))),
          descriptor.handlerId,
          Math.min(Math.max(handlerTimeoutMs, 1_000), 30_000),
          () => {
            active = false;
          },
        );
        raw = rawResult(raw, descriptor.handlerId);
        raw = normalizeGeneratedFailure(raw);
        raw = reconcileIndependentReadback(command, raw);
      } catch (error) {
        raw = normalizeGeneratedFailure(failedRawResult(error));
      } finally {
        active = false;
        facade.close();
      }
      await toolbox.settle().catch(() => {});
      raw = reconcileLateProgression(command, raw, page.url() !== beforeUrl);
      if (
        command.operation !== "execute_action" &&
        page.url() !== beforeUrl
      ) {
        raw = {
          attempted: true,
          status: "failed",
          resolved: false,
          entered: false,
          verified: false,
          normalizedReadback: null,
          stateChanged: true,
          failureCode: "handler_contract_violation",
          detail:
            "A non-progression actuator handler changed the page URL; execution stopped.",
          diagnostics: [],
        };
      }
      const afterObservationRef = await toolbox.capture("actuator_after", {
        stateKey: command.stateKey,
        targetKey: command.targetKey,
        operation: command.operation,
        status: raw.status,
      });
      let result = {
        protocolVersion: ACTUATOR_PROTOCOL_VERSION,
        invocationId: command.invocationId,
        handlerId: descriptor.handlerId,
        ...raw,
        beforeObservationRef,
        afterObservationRef,
      };
      try {
        validateActuatorResult(result);
      } catch (error) {
        // A malformed generated result is an actuator defect, not a pipeline
        // exception. Return a valid typed failure so preflight can persist the
        // evidence, route the exact handler to repair, and rebaseline safely.
        result = {
          protocolVersion: ACTUATOR_PROTOCOL_VERSION,
          invocationId: command.invocationId,
          handlerId: descriptor.handlerId,
          ...failedRawResult(error),
          stateChanged: page.url() !== beforeUrl || raw?.stateChanged === true,
          beforeObservationRef,
          afterObservationRef,
        };
        validateActuatorResult(result);
      }
      return result;
    },
    rebaseline: (url) => toolbox.rebaseline(url),
  });
}
