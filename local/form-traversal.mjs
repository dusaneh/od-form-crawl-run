import { createHash } from "node:crypto";
import { planFormTraversal } from "./form-agent.mjs";
import { branchTestValues, classifyFieldSafety } from "./test-values.mjs";
import { waitForStableState } from "./traversal-automation.mjs";

const FINAL_ACTION =
  /\b(?:submit|send application|send request|apply now|complete application|finish application|place order|make payment|pay now|sign and submit|confirm submission)\b/i;
const INTERMEDIATE_ACTION =
  /\b(?:next|continue|review|proceed|save and continue|get started|start|begin)\b/i;

function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticKey(descriptor, index) {
  const normalized = humanize(
    descriptor.name || descriptor.id || descriptor.label
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || `field_${index + 1}`;
}

function descriptorIdentity(descriptor) {
  return `${descriptor.frameUrl}|${
    descriptor.name ||
    descriptor.id ||
    descriptor.selector ||
    descriptor.label ||
    descriptor.controlId
  }|${descriptor.type}`;
}

async function frameSignature(frame) {
  return frame
    .evaluate(() => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const controls = roots.flatMap((root) =>
        Array.from(
          root.querySelectorAll(
            'input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]'
          )
        )
      );
      return {
        url: location.href,
        text: String(document.body?.innerText || "").slice(0, 20_000),
        controls: controls.slice(0, 500).map((element) => ({
          id:
            element.getAttribute("data-formweave-control-id") ||
            element.id ||
            element.getAttribute("name") ||
            "",
          value:
            "value" in element
              ? String(element.value || "")
              : String(element.textContent || ""),
          checked: "checked" in element ? Boolean(element.checked) : undefined,
          hidden:
            element.hidden ||
            getComputedStyle(element).display === "none" ||
            element.getClientRects().length === 0,
        })),
        shadows: roots
          .slice(1)
          .map((root) => String(root.innerHTML || "").slice(0, 10_000)),
      };
    })
    .catch(() => ({ url: frame.url(), text: "", controls: [], shadows: [] }));
}

async function stateFingerprint(page) {
  const signatures = [];
  for (const frame of page.frames()) {
    signatures.push(await frameSignature(frame));
  }
  return createHash("sha256")
    .update(JSON.stringify(signatures))
    .digest("hex")
    .slice(0, 16);
}

async function inspectFrame(frame, frameIndex, epoch) {
  return frame.evaluate(
    ({ evaluatedFrameIndex, evaluatedEpoch }) => {
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const all = (selector) =>
        roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
      const visible = (element) => {
        const style = getComputedStyle(element);
        return (
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          element.getClientRects().length > 0
        );
      };
      const text = (element) =>
        String(element?.innerText || element?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      const escapeAttribute = (value) =>
        String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      const selectorFor = (element, index) => {
        if (element.id) return `#${escapeAttribute(element.id)}`;
        if (element.getAttribute("name")) {
          return `${element.tagName.toLowerCase()}[name="${escapeAttribute(
            element.getAttribute("name")
          )}"]`;
        }
        const role = element.getAttribute("role");
        if (role) return `[role="${escapeAttribute(role)}"]`;
        return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
      };
      const labelFor = (element) => {
        const fieldset = element.closest("fieldset");
        const legend = fieldset?.querySelector(":scope > legend");
        const labels = Array.from(element.labels || [])
          .map(text)
          .filter(Boolean);
        const labelledBy = String(element.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .map(text)
          .filter(Boolean);
        return (
          text(legend) ||
          labels.join(" / ") ||
          labelledBy.join(" / ") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.getAttribute("title") ||
          text(element.closest("label")) ||
          ""
        );
      };
      const controlType = (element) => {
        const tag = element.tagName.toLowerCase();
        if (tag === "input") {
          return (element.getAttribute("type") || "text").toLowerCase();
        }
        if (tag === "select") return "select";
        if (tag === "textarea") return "textarea";
        return (
          element.getAttribute("role") ||
          (element.isContentEditable ? "textbox" : tag)
        );
      };
      const controlElements = all(
        'input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]'
      ).filter(
        (element) =>
          visible(element) &&
          !["hidden", "submit", "button", "reset", "image"].includes(
            controlType(element)
          )
      );
      const controls = controlElements.map((element, index) => {
        const controlId = `fw-${evaluatedEpoch}-${evaluatedFrameIndex}-control-${index}`;
        element.setAttribute("data-formweave-control-id", controlId);
        const name = element.getAttribute("name") || "";
        const type = controlType(element);
        const groupElements =
          type === "radio" && name
            ? all(
                `input[type="radio"][name="${CSS.escape(name)}"],[role="radio"][name="${CSS.escape(name)}"]`
              )
            : [];
        const radioGroupIndex = groupElements.length
          ? controlElements.indexOf(groupElements[0])
          : index;
        return {
          controlId,
          frameIndex: evaluatedFrameIndex,
          frameUrl: location.href,
          selector: selectorFor(element, index),
          tag: element.tagName.toLowerCase(),
          type,
          name,
          id: element.id || "",
          label: labelFor(element),
          required:
            element.matches(":required") ||
            element.getAttribute("aria-required") === "true",
          disabled:
            Boolean(element.disabled) ||
            element.getAttribute("aria-disabled") === "true",
          readOnly: Boolean(element.readOnly),
          hidden: !visible(element),
          autocomplete: element.getAttribute("autocomplete") || "",
          inputMode: element.getAttribute("inputmode") || "",
          pattern: element.getAttribute("pattern") || "",
          min: element.getAttribute("min") || "",
          max: element.getAttribute("max") || "",
          minLength: element.getAttribute("minlength") || "",
          maxLength: element.getAttribute("maxlength") || "",
          value:
            "value" in element
              ? String(element.value || "")
              : String(element.textContent || ""),
          checked: "checked" in element ? Boolean(element.checked) : false,
          options:
            element.tagName.toLowerCase() === "select"
              ? Array.from(element.options).map((option) => ({
                  value: option.value,
                  label: text(option),
                  disabled: option.disabled,
                  selected: option.selected,
                }))
              : [],
          groupOptions: groupElements.map((option, optionIndex) => {
            const optionControlId = `fw-${evaluatedEpoch}-${evaluatedFrameIndex}-radio-${radioGroupIndex}-${optionIndex}`;
            option.setAttribute("data-formweave-control-id", optionControlId);
            return {
              controlId: optionControlId,
              value: String(option.value || option.getAttribute("aria-label") || ""),
              label: labelFor(option),
              disabled:
                Boolean(option.disabled) ||
                option.getAttribute("aria-disabled") === "true",
              checked: Boolean(option.checked),
            };
          }),
        };
      });

      const actionElements = all(
        'button,input[type="submit"],input[type="button"],[role="button"]'
      ).filter(
        (element) =>
          visible(element) &&
          !element.disabled &&
          element.getAttribute("aria-disabled") !== "true" &&
          !element.closest("#onetrust-consent-sdk")
      );
      const advances = actionElements.map((element, index) => {
        const controlId = `fw-${evaluatedEpoch}-${evaluatedFrameIndex}-action-${index}`;
        element.setAttribute("data-formweave-action-id", controlId);
        const label = String(
          text(element) ||
            element.value ||
            element.getAttribute("aria-label") ||
            element.title ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        const form = element.closest("form");
        return {
          controlId,
          frameIndex: evaluatedFrameIndex,
          frameUrl: location.href,
          label,
          type: String(element.getAttribute("type") || "button").toLowerCase(),
          submitLike:
            element.tagName.toLowerCase() === "input" &&
            element.getAttribute("type") === "submit"
              ? true
              : element.tagName.toLowerCase() === "button"
                ? String(element.getAttribute("type") || "submit").toLowerCase() ===
                  "submit"
                : false,
          formAction: form
            ? new URL(form.getAttribute("action") || location.href, location.href)
                .href
            : "",
        };
      });
      return { controls, advances };
    },
    { evaluatedFrameIndex: frameIndex, evaluatedEpoch: epoch }
  );
}

async function inspectPage(page, epoch) {
  const mainOrigin = new URL(page.url()).origin;
  const controls = [];
  const advances = [];
  for (const [frameIndex, frame] of page.frames().entries()) {
    try {
      if (new URL(frame.url() || page.url()).origin !== mainOrigin) continue;
      const result = await inspectFrame(frame, frameIndex, epoch);
      controls.push(...result.controls);
      advances.push(...result.advances);
    } catch {
      // Detached and cross-origin frames are ignored.
    }
  }
  const seenRadioGroups = new Set();
  return {
    controls: controls.filter((control) => {
      if (control.type !== "radio" || !control.name) return true;
      const identity = `${control.frameIndex}|${control.name}`;
      if (seenRadioGroups.has(identity)) return false;
      seenRadioGroups.add(identity);
      return true;
    }),
    advances,
  };
}

function frameFor(page, descriptor) {
  return (
    page.frames()[descriptor.frameIndex] ||
    page.frames().find((frame) => frame.url() === descriptor.frameUrl) ||
    page.mainFrame()
  );
}

function controlLocator(page, descriptor, controlId = descriptor.controlId) {
  return frameFor(page, descriptor).locator(
    `[data-formweave-control-id="${controlId}"]`
  );
}

function actionLocator(page, descriptor) {
  return frameFor(page, descriptor).locator(
    `[data-formweave-action-id="${descriptor.controlId}"]`
  );
}

async function permitSubmit(frame, durationMs) {
  await frame
    .evaluate((duration) => {
      if (!window.__formweaveControl) return;
      window.__formweaveControl.permitSubmitUntil = Date.now() + duration;
    }, durationMs)
    .catch(() => {});
}

async function applyValue(page, descriptor, value, authorizeWrites) {
  const locator = controlLocator(page, descriptor);
  let actedLocator = locator;
  const authorization = {
    scope: "same-origin",
    durationMs: 2_500,
    reason: `test value entry for ${descriptor.label || descriptor.controlId}`,
  };
  authorizeWrites(authorization);
  const type = descriptor.type;
  if (type === "select") {
    await locator.selectOption(String(value));
  } else if (type === "radio") {
    const option =
      descriptor.groupOptions.find(
        (candidate) => String(candidate.value) === String(value)
      ) || descriptor.groupOptions[0];
    actedLocator = controlLocator(
      page,
      descriptor,
      option?.controlId || descriptor.controlId
    );
    await actedLocator.check();
  } else if (type === "checkbox") {
    if (String(value) === "true") await locator.check();
    else await locator.uncheck();
  } else if (type === "switch") {
    const checked = await locator
      .getAttribute("aria-checked")
      .then((current) => current === "true")
      .catch(() => descriptor.checked);
    const desired = String(value) === "true";
    if (checked !== desired) await locator.click();
  } else if (
    descriptor.tag === "input" ||
    descriptor.tag === "textarea" ||
    descriptor.tag === "select" ||
    type === "textbox"
  ) {
    await locator.fill(String(value));
  } else if (type === "combobox") {
    const editable = await locator
      .evaluate(
        (element) =>
          element.isContentEditable ||
          ["input", "textarea"].includes(element.tagName.toLowerCase())
      )
      .catch(() => false);
    if (editable) {
      await locator.fill(String(value));
    } else {
      const beforeText = await locator
        .evaluate((element) =>
          String(
            "value" in element ? element.value || "" : element.textContent || ""
          ).trim()
        )
        .catch(() => descriptor.value || "");
      await locator.click();
      await locator.press("ArrowDown");
      await locator.press("Enter");
      const afterText = await locator.evaluate((element) =>
        String(
          "value" in element ? element.value || "" : element.textContent || ""
        ).trim()
      );
      if (!afterText || afterText === beforeText) {
        throw new Error(
          "The custom combobox did not expose a changed value after keyboard selection."
        );
      }
    }
  } else {
    await locator.fill(String(value));
  }
  await actedLocator
    .evaluate((element) => {
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    })
    .catch(() => {});
  const observed = await actedLocator.evaluate((element) => ({
    value:
      "value" in element
        ? String(element.value || "")
        : String(element.textContent || "").trim(),
    checked: "checked" in element ? Boolean(element.checked) : undefined,
    ariaChecked: element.getAttribute("aria-checked"),
  }));
  if (type === "radio" && observed.checked !== true) {
    throw new Error("The selected radio option did not remain checked.");
  }
  if (
    type === "checkbox" &&
    observed.checked !== (String(value) === "true")
  ) {
    throw new Error("The checkbox did not retain the requested checked state.");
  }
  if (type === "switch") {
    const actualChecked =
      observed.ariaChecked === "true"
        ? true
        : observed.ariaChecked === "false"
          ? false
          : observed.checked;
    if (
      actualChecked === undefined ||
      actualChecked !== (String(value) === "true")
    ) {
      throw new Error(
        "The switch did not expose the requested checked state."
      );
    }
    return String(actualChecked);
  }
  if (
    ["input", "textarea"].includes(descriptor.tag) ||
    type === "textbox" ||
    (type === "combobox" && observed.value)
  ) {
    if (!observed.value) {
      throw new Error("The control remained empty after synthetic entry.");
    }
  }
  return type === "radio"
    ? String(value)
    : type === "checkbox"
      ? String(observed.checked)
      : observed.value || String(value);
}

function descriptorAsField(descriptor, index, planField, entry) {
  return {
    name: descriptor.name,
    id: descriptor.id,
    key: semanticKey(descriptor, index),
    label: descriptor.label || humanize(descriptor.name || descriptor.id),
    control: descriptor.type,
    required: descriptor.required,
    sensitive:
      ["password", "email", "tel", "date"].includes(descriptor.type) ||
      /\b(?:name|email|phone|mobile|address|birth|dob|ssn|income|password|medical|health)\b/i.test(
        `${descriptor.label} ${descriptor.name} ${descriptor.autocomplete}`
      ),
    hidden: false,
    options:
      descriptor.type === "radio"
        ? descriptor.groupOptions.length
        : descriptor.options.length ||
          (["checkbox", "switch"].includes(descriptor.type) ? 1 : 0),
    optionValues:
      descriptor.type === "radio"
        ? descriptor.groupOptions.map((option) => option.value)
        : descriptor.options.map((option) => option.value),
    selector: descriptor.selector,
    frameUrl: descriptor.frameUrl,
    rendered: true,
    testValue: entry?.actualValue || planField?.testValue || "",
    testValues: branchTestValues(descriptor, 8),
    testValueSource: planField ? entry?.source || "deterministic" : "unavailable",
    entryStatus: entry?.status || "skipped",
    ...(entry?.error ? { entryError: entry.error } : {}),
  };
}

function mergeObservedField(map, field) {
  const identity = `${field.frameUrl}|${field.selector || field.name || field.id || field.key}|${
    field.control
  }`;
  const current = map.get(identity);
  if (!current) {
    map.set(identity, field);
    return;
  }
  map.set(identity, {
    ...current,
    ...field,
    required: current.required || field.required,
    sensitive: current.sensitive || field.sensitive,
    options: Math.max(current.options, field.options),
    testValues: [...new Set([...(current.testValues || []), ...(field.testValues || [])])],
    entryStatus:
      current.entryStatus === "entered" || field.entryStatus === "entered"
        ? "entered"
        : field.entryStatus,
  });
}

function hardAdvanceClassification(advance, proposed) {
  if (!advance) return "none";
  if (FINAL_ACTION.test(advance.label)) return "final";
  if (INTERMEDIATE_ACTION.test(advance.label)) return "intermediate";
  if (proposed === "final" || proposed === "intermediate") return proposed;
  return advance.submitLike ? "final" : "intermediate";
}

async function captureState(
  page,
  evidence,
  settings,
  browserMode,
  kind,
  label,
  values,
  onEvent
) {
  if (evidence.length >= settings.maxFormStates) return null;
  const sequence = evidence.length + 1;
  const id = `state_${String(sequence).padStart(2, "0")}`;
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: true,
    type: "png",
  });
  let fieldsVisible = 0;
  for (const frame of page.frames()) {
    fieldsVisible += await frame
      .evaluate(() => {
        const roots = [document];
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot) roots.push(element.shadowRoot);
          }
        }
        return roots
          .flatMap((root) =>
            Array.from(
              root.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]'
              )
            )
          )
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              !element.hidden &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              element.getClientRects().length > 0
            );
          }).length;
      })
      .catch(() => 0);
  }
  const state = {
    id,
    sequence,
    kind,
    label,
    url: page.url(),
    title: await page.title().catch(() => ""),
    fingerprint: await stateFingerprint(page),
    capturedAt: new Date().toISOString(),
    fieldsVisible,
    values: [...values.values()].map((entry) => ({
      fieldKey: entry.fieldKey,
      label: entry.label,
      value: String(entry.value),
      source: entry.source,
    })),
    screenshot: new Uint8Array(screenshot),
    screenshotContentType: "image/png",
    screenshotProvider: `playwright-local-${browserMode}`,
  };
  evidence.push(state);
  await onEvent?.(
    "state_evidence_captured",
    `Captured ${kind.replaceAll("_", " ")} evidence: ${label}.`,
    {
      stateId: id,
      sequence,
      kind,
      fingerprint: state.fingerprint,
      fieldsVisible: state.fieldsVisible,
      values: state.values.length,
    }
  );
  return state;
}

async function recordFieldEntry(
  page,
  descriptor,
  planField,
  enteredValues,
  actions,
  authorizeWrites,
  onEvent,
  source
) {
  const fieldKey = semanticKey(descriptor, enteredValues.size);
  const beforeFingerprint = await stateFingerprint(page);
  let error = "";
  let actualValue = String(planField.testValue);
  try {
    actualValue = await applyValue(
      page,
      descriptor,
      planField.testValue,
      authorizeWrites
    );
    enteredValues.set(
      descriptorIdentity(descriptor),
      {
        fieldKey,
        label: descriptor.label || humanize(fieldKey),
        value: actualValue,
        source,
      }
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Value entry failed.";
  }
  const afterFingerprint = await stateFingerprint(page);
  const action = {
    category: "field_entry",
    label: descriptor.label || humanize(fieldKey),
    strategy: `${source} synthetic ${descriptor.type} value`,
    beforeFingerprint,
    afterFingerprint,
    changed: beforeFingerprint !== afterFingerprint,
    timestamp: new Date().toISOString(),
    fieldKey,
    testValue: actualValue,
    classification: planField.classification,
    rationale: planField.rationale,
    ...(error ? { error } : {}),
  };
  actions.push(action);
  await onEvent?.(
    error ? "field_entry_failed" : "field_entry_completed",
    error
      ? `Failed to enter synthetic value for ${action.label}.`
      : `Entered synthetic value for ${action.label}.`,
    {
      fieldKey,
      label: action.label,
      control: descriptor.type,
      source,
      testValue: action.testValue,
      beforeFingerprint,
      afterFingerprint,
      ...(error ? { error } : {}),
    }
  );
  return {
    status: error ? "failed" : "entered",
    source,
    actualValue,
    ...(error ? { error } : {}),
  };
}

export async function installSubmissionGuards(page, executionMode) {
  await page.addInitScript((mode) => {
    window.__formweaveControl = {
      mode,
      permitSubmitUntil: 0,
    };
    const permitted = () =>
      Date.now() <= Number(window.__formweaveControl?.permitSubmitUntil || 0);
    window.addEventListener(
      "submit",
      (event) => {
        if (permitted()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    const originalSubmit = HTMLFormElement.prototype.submit;
    Object.defineProperty(HTMLFormElement.prototype, "submit", {
      configurable: false,
      value(...args) {
        if (permitted()) return originalSubmit.apply(this, args);
      },
    });
    const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (originalRequestSubmit) {
      Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
        configurable: false,
        value(...args) {
          if (permitted()) return originalRequestSubmit.apply(this, args);
        },
      });
    }
  }, executionMode);
}

export async function traverseFormStates(
  page,
  {
    executionMode,
    browserMode,
    settings,
    authorizeWrites,
    onEvent,
  }
) {
  const actions = [];
  const evidence = [];
  const enteredValues = new Map();
  const observedFields = new Map();
  const reviewedFieldIdentities = new Set();
  const exercisedBranches = new Set();
  let epoch = 0;
  let fieldsEntered = 0;
  let entryFailures = 0;
  let branchStates = 0;
  let submissionsAttempted = 0;
  let submissionsSucceeded = 0;
  let finalSubmission = "not_found";
  let previousAdvanceFingerprint = "";

  const initial = await inspectPage(page, `initial-${epoch}`);
  if (!initial.controls.length || !settings.enterTestValues) {
    return {
      actions,
      evidence,
      observedFields: [],
      fieldsEntered,
      entryFailures,
      branchStates,
      submissionsAttempted,
      submissionsSucceeded,
      finalSubmission: settings.enterTestValues ? "not_found" : "not_requested",
    };
  }
  await captureState(
    page,
    evidence,
    settings,
    browserMode,
    "initial",
    "Initial form state before synthetic entry",
    enteredValues,
    onEvent
  );

  for (
    let step = 0;
    step < settings.maxFormStates && evidence.length < settings.maxFormStates;
    step += 1
  ) {
    epoch += 1;
    const inspection = await inspectPage(page, `step-${epoch}`);
    if (!inspection.controls.length && !inspection.advances.length) break;
    const plan = await planFormTraversal(
      inspection.controls,
      inspection.advances,
      settings,
      onEvent
    );
    const planByControl = new Map(
      plan.fields.map((field) => [field.controlId, field])
    );
    const entryByControl = new Map();

    for (const [index, descriptor] of inspection.controls.entries()) {
      const planField = planByControl.get(descriptor.controlId);
      if (!planField) continue;
      const safety = classifyFieldSafety(descriptor);
      if (
        planField.action === "skip" ||
        planField.action === "review" ||
        planField.classification === "human_review" ||
        safety.classification === "human_review"
      ) {
        reviewedFieldIdentities.add(
          descriptorIdentity(descriptor)
        );
        entryByControl.set(descriptor.controlId, {
          status: "skipped",
          source: plan.source,
        });
        mergeObservedField(
          observedFields,
          descriptorAsField(
            descriptor,
            index,
            planField,
            entryByControl.get(descriptor.controlId)
          )
        );
        continue;
      }
      const result = await recordFieldEntry(
        page,
        descriptor,
        planField,
        enteredValues,
        actions,
        authorizeWrites,
        onEvent,
        plan.source
      );
      entryByControl.set(descriptor.controlId, result);
      if (result.status === "entered") fieldsEntered += 1;
      else entryFailures += 1;
      mergeObservedField(
        observedFields,
        descriptorAsField(descriptor, index, planField, result)
      );
    }

    await waitForStableState(
      page,
      settings,
      onEvent,
      `populated form state ${step + 1}`
    );
    await captureState(
      page,
      evidence,
      settings,
      browserMode,
      "populated",
      `Populated form state ${step + 1}`,
      enteredValues,
      onEvent
    );

    if (settings.exerciseBranches) {
      for (const controlId of plan.branchControlIds) {
        if (evidence.length >= settings.maxFormStates) break;
        const descriptor = inspection.controls.find(
          (control) => control.controlId === controlId
        );
        if (!descriptor) continue;
        const branchIdentity = `${page.url()}|${descriptor.name || descriptor.label}|${
          descriptor.type
        }`;
        if (exercisedBranches.has(branchIdentity)) continue;
        exercisedBranches.add(branchIdentity);
        const values = branchTestValues(
          descriptor,
          settings.maxBranchOptionsPerControl
        );
        const baseValue = planByControl.get(controlId)?.testValue || values[0];
        for (const branchValue of values) {
          if (evidence.length >= settings.maxFormStates) break;
          const beforeFingerprint = await stateFingerprint(page);
          let error = "";
          try {
            const actualBranchValue = await applyValue(
              page,
              descriptor,
              branchValue,
              authorizeWrites
            );
            enteredValues.set(
              descriptorIdentity(descriptor),
              {
                fieldKey: semanticKey(descriptor, enteredValues.size),
                label: descriptor.label || descriptor.name || descriptor.controlId,
                value: actualBranchValue,
                source: plan.source,
              }
            );
            await waitForStableState(
              page,
              settings,
              onEvent,
              `branch ${descriptor.label || descriptor.name} = ${branchValue}`
            );
          } catch (caught) {
            error =
              caught instanceof Error ? caught.message : "Branch actuation failed.";
          }
          const afterFingerprint = await stateFingerprint(page);
          const state = await captureState(
            page,
            evidence,
            settings,
            browserMode,
            "branch",
            `${descriptor.label || descriptor.name}: ${branchValue}`,
            enteredValues,
            onEvent
          );
          actions.push({
            category: "branch_probe",
            label: descriptor.label || descriptor.name || descriptor.controlId,
            strategy: `${plan.source} branch option`,
            beforeFingerprint,
            afterFingerprint,
            changed: beforeFingerprint !== afterFingerprint,
            timestamp: new Date().toISOString(),
            fieldKey: semanticKey(descriptor, 0),
            testValue: String(branchValue),
            stateId: state?.id,
            classification: "conditional",
            rationale: "Exercised a safe option to reveal validation or conditional fields.",
            ...(error ? { error } : {}),
          });
          if (!error) branchStates += 1;
          else entryFailures += 1;
        }
        if (baseValue !== undefined && baseValue !== "") {
          await applyValue(page, descriptor, baseValue, authorizeWrites).catch(
            () => {}
          );
        }
      }
    }

    let refreshed = await inspectPage(page, `conditional-${epoch}`);
    const conditionalControls = refreshed.controls.filter((descriptor) => {
      const identity = descriptorIdentity(descriptor);
      return (
        !enteredValues.has(identity) &&
        !reviewedFieldIdentities.has(identity)
      );
    });
    if (conditionalControls.length) {
      const conditionalPlan = await planFormTraversal(
        conditionalControls,
        refreshed.advances,
        settings,
        onEvent
      );
      const conditionalPlanByControl = new Map(
        conditionalPlan.fields.map((field) => [field.controlId, field])
      );
      let conditionalEntries = 0;
      for (const [index, descriptor] of conditionalControls.entries()) {
        const planField = conditionalPlanByControl.get(descriptor.controlId);
        if (!planField) continue;
        const identity = descriptorIdentity(descriptor);
        const safety = classifyFieldSafety(descriptor);
        if (
          planField.action === "skip" ||
          planField.action === "review" ||
          planField.classification === "human_review" ||
          safety.classification === "human_review"
        ) {
          reviewedFieldIdentities.add(identity);
          mergeObservedField(
            observedFields,
            descriptorAsField(descriptor, index, planField, {
              status: "skipped",
              source: conditionalPlan.source,
            })
          );
          continue;
        }
        const result = await recordFieldEntry(
          page,
          descriptor,
          planField,
          enteredValues,
          actions,
          authorizeWrites,
          onEvent,
          conditionalPlan.source
        );
        if (result.status === "entered") {
          fieldsEntered += 1;
          conditionalEntries += 1;
        } else {
          entryFailures += 1;
        }
        mergeObservedField(
          observedFields,
          descriptorAsField(descriptor, index, planField, result)
        );
      }
      if (conditionalEntries) {
        await waitForStableState(
          page,
          settings,
          onEvent,
          `new conditional fields in state ${step + 1}`
        );
        await captureState(
          page,
          evidence,
          settings,
          browserMode,
          "populated",
          `Populated conditional fields in state ${step + 1}`,
          enteredValues,
          onEvent
        );
      }
      refreshed = await inspectPage(page, `advance-${epoch}`);
    }

    if (!settings.advanceFormSteps || evidence.length >= settings.maxFormStates) {
      finalSubmission = "not_requested";
      break;
    }
    const proposedId = plan.advance.controlId;
    const advance =
      refreshed.advances.find((item) => item.controlId === proposedId) ||
      refreshed.advances.find((item) => {
        const proposed = inspection.advances.find(
          (candidate) => candidate.controlId === proposedId
        );
        return (
          proposed &&
          item.frameUrl === proposed.frameUrl &&
          item.label === proposed.label
        );
      }) ||
      refreshed.advances.find((item) => INTERMEDIATE_ACTION.test(item.label)) ||
      refreshed.advances.find((item) => FINAL_ACTION.test(item.label)) ||
      refreshed.advances.find((item) => item.submitLike);
    if (!advance) break;
    const classification = hardAdvanceClassification(
      advance,
      plan.advance.classification
    );
    const preAdvance = await captureState(
      page,
      evidence,
      settings,
      browserMode,
      classification === "final" && executionMode === "dry_run"
        ? "blocked_final"
        : "pre_advance",
      classification === "final"
        ? "Completed values before final submission"
        : `Completed values before ${advance.label}`,
      enteredValues,
      onEvent
    );
    const beforeFingerprint = await stateFingerprint(page);
    if (classification === "final" && executionMode === "dry_run") {
      finalSubmission = "blocked";
      actions.push({
        category: "final_submit_blocked",
        label: advance.label,
        strategy: "dry-run final-submit boundary",
        beforeFingerprint,
        afterFingerprint: beforeFingerprint,
        changed: false,
        timestamp: new Date().toISOString(),
        stateId: preAdvance?.id,
        classification: "human_review",
        rationale:
          "Dry-run mode traverses and populates the form but never activates the final submit control.",
      });
      await onEvent?.(
        "final_submission_blocked",
        `Dry-run stopped before final action: ${advance.label}.`,
        { label: advance.label, stateId: preAdvance?.id || "" }
      );
      break;
    }

    const frame = frameFor(page, advance);
    await permitSubmit(frame, classification === "final" ? 12_000 : 8_000);
    let finalActionOrigin = "";
    if (classification === "final") {
      try {
        finalActionOrigin = new URL(
          advance.formAction || page.url(),
          page.url()
        ).origin;
      } catch {
        finalActionOrigin = new URL(page.url()).origin;
      }
    }
    authorizeWrites({
      scope: classification === "final" ? "final-action" : "same-origin",
      durationMs: classification === "final" ? 12_000 : 8_000,
      reason: `${classification} form action ${advance.label}`,
      ...(finalActionOrigin ? { origin: finalActionOrigin } : {}),
    });
    submissionsAttempted += classification === "final" ? 1 : 0;
    let error = "";
    try {
      await actionLocator(page, advance).click({ timeout: 8_000 });
      await waitForStableState(
        page,
        settings,
        onEvent,
        `${classification} action ${advance.label}`
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Advance action failed.";
    }
    const afterFingerprint = await stateFingerprint(page);
    const category =
      classification === "final" ? "final_submit" : "form_advance";
    const postState = await captureState(
      page,
      evidence,
      settings,
      browserMode,
      classification === "final" ? "submitted" : "post_advance",
      classification === "final"
        ? `Result after ${advance.label}`
        : `State after ${advance.label}`,
      enteredValues,
      onEvent
    );
    actions.push({
      category,
      label: advance.label,
      strategy: `${executionMode} ${classification} action`,
      beforeFingerprint,
      afterFingerprint,
      changed: beforeFingerprint !== afterFingerprint,
      timestamp: new Date().toISOString(),
      stateId: postState?.id,
      classification:
        classification === "final" ? "human_review" : "deterministic",
      rationale: plan.advance.rationale,
      ...(error ? { error } : {}),
    });
    if (classification === "final") {
      finalSubmission = error ? "not_found" : "submitted";
      if (!error && beforeFingerprint !== afterFingerprint) {
        submissionsSucceeded += 1;
      }
      break;
    }
    if (
      error ||
      afterFingerprint === beforeFingerprint ||
      afterFingerprint === previousAdvanceFingerprint
    ) {
      break;
    }
    previousAdvanceFingerprint = afterFingerprint;
  }

  return {
    actions,
    evidence,
    observedFields: [...observedFields.values()],
    fieldsEntered,
    entryFailures,
    branchStates,
    submissionsAttempted,
    submissionsSucceeded,
    finalSubmission,
  };
}
