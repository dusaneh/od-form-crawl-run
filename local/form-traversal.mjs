import { createHash } from "node:crypto";
import { branchTestValues } from "./test-values.mjs";
import { waitForStableState } from "./traversal-automation.mjs";
import { captureFullPageAndTiles } from "./browser-evidence.mjs";

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
      const normalizedUrl = (() => {
        const url = new URL(location.href);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
          if (
            /(?:session|token|nonce|state|code|signature|timestamp|cache|consent)/i.test(
              key
            )
          ) {
            url.searchParams.delete(key);
          }
        }
        url.searchParams.sort();
        return url.href;
      })();
      const roots = [document];
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const consentRoot = (element) =>
        element.closest(
          '#onetrust-consent-sdk,[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]'
        );
      const controls = roots.flatMap((root) =>
        Array.from(
          root.querySelectorAll(
            'input,select,textarea,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"]'
          )
        ).filter((element) => !consentRoot(element))
      );
      const cleanText = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1_000);
      const fieldFacts = controls.slice(0, 500).map((element) => {
        const type =
          element.tagName.toLowerCase() === "input"
            ? String(element.getAttribute("type") || "text").toLowerCase()
            : element.tagName.toLowerCase();
        const options =
          element.tagName.toLowerCase() === "select"
            ? Array.from(element.options).map((option) => String(option.value))
            : type === "radio"
              ? Array.from(
                  document.querySelectorAll(
                    `input[type="radio"][name="${CSS.escape(
                      element.getAttribute("name") || ""
                    )}"]`
                  )
                ).map((option) => String(option.value))
              : [];
        const section = element.closest(
          "fieldset,section,[role='group'],form,article"
        );
        return {
          nameOrId:
            element.getAttribute("name") || element.getAttribute("id") || "",
          type,
          required: element.hasAttribute("required"),
          options: options.length >= 2 ? [...new Set(options)].sort() : [],
          sectionText: cleanText(section?.textContent),
          upload: type === "file",
        };
      });
      return {
        url: normalizedUrl,
        fields: fieldFacts,
        uploadPresence: fieldFacts.some((field) => field.upload),
      };
    })
    .catch(() => ({ url: frame.url(), fields: [], uploadPresence: false }));
}

async function stateFingerprint(page, stateCount = 0) {
  const mainOrigin = new URL(page.url()).origin;
  const signatures = [];
  for (const frame of page.frames()) {
    try {
      if (new URL(frame.url() || page.url()).origin !== mainOrigin) continue;
    } catch {
      continue;
    }
    signatures.push(await frameSignature(frame));
  }
  return createHash("sha256")
    .update(JSON.stringify({ signatures, stateCount }))
    .digest("hex")
    .slice(0, 16);
}

function branchBaselineFingerprint(inspection, descriptor) {
  const formControls = inspection.controls
    .filter(
      (control) =>
        control.frameUrl === descriptor.frameUrl &&
        control.formId === descriptor.formId
    )
    .map((control) => ({
      name: control.name || "",
      id: control.id || "",
      type: control.type || "",
      required: Boolean(control.requiredAttribute),
      optionValues: [
        ...(control.options || []),
        ...(control.groupOptions || []),
      ]
        .map((option) => String(option.value || "").trim())
        .filter(Boolean)
        .slice(0, 2),
      sectionText: String(control.sectionText || "")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .sort((left, right) =>
      `${left.name}|${left.id}|${left.type}`.localeCompare(
        `${right.name}|${right.id}|${right.type}`
      )
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        frameUrl: descriptor.frameUrl,
        formId: descriptor.formId,
        controls: formControls,
      })
    )
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
          labels.join(" / ") ||
          labelledBy.join(" / ") ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.getAttribute("title") ||
          text(element.closest("label")) ||
          text(legend) ||
          ""
        );
      };
      const groupLabelFor = (element) => {
        const fieldset = element.closest("fieldset");
        const group = element.closest('[role="group"],[role="radiogroup"]');
        const labelledBy = String(group?.getAttribute("aria-labelledby") || "")
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .map(text)
          .filter(Boolean);
        return (
          text(fieldset?.querySelector(":scope > legend")) ||
          labelledBy.join(" / ") ||
          group?.getAttribute("aria-label") ||
          ""
        );
      };
      const contextText = (element, selector, maximum = 800) =>
        text(element.closest(selector)).slice(0, maximum);
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
        (element) => {
          const type = controlType(element);
          const visuallyBackedChoice =
            ["radio", "checkbox"].includes(type) &&
            !element.hidden &&
            element.getAttribute("aria-hidden") !== "true" &&
            getComputedStyle(element).display !== "none" &&
            getComputedStyle(element).visibility !== "hidden" &&
            element.getClientRects().length > 0 &&
            Array.from(element.labels || []).some(visible);
          return (
            (visible(element) || visuallyBackedChoice) &&
            !["hidden", "submit", "button", "reset", "image"].includes(type)
          );
        }
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
        const groupLabel = groupLabelFor(element);
        const sectionElement = element.closest(
          "fieldset,section,[role='group'],[role='radiogroup'],form"
        );
        const sectionCandidates = all(
          "form,fieldset,section,[role='group'],[role='radiogroup']"
        );
        const sectionIndex = sectionElement
          ? sectionCandidates.indexOf(sectionElement)
          : -1;
        const describedGuidance = String(
          element.getAttribute("aria-describedby") || ""
        )
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((item) => ({
            text: text(item).slice(0, 2_000),
            source: "aria-describedby",
          }));
        const labelledGuidance = String(
          element.getAttribute("aria-labelledby") || ""
        )
          .split(/\s+/)
          .map((id, labelledIndex) => ({
            id,
            labelledIndex,
            element: document.getElementById(id),
          }))
          .filter(
            (item) =>
              item.element &&
              (item.labelledIndex > 0 ||
                /(?:help|hint|description|instruction|note)/i.test(item.id))
          )
          .map((item) => ({
            text: text(item.element).slice(0, 2_000),
            source: "aria-labelledby",
          }));
        return {
          controlId,
          frameIndex: evaluatedFrameIndex,
          frameUrl: location.href,
          selector: selectorFor(element, index),
          tag: element.tagName.toLowerCase(),
          type,
          name,
          id: element.id || "",
          label:
            type === "radio" && groupLabel
              ? groupLabel
              : labelFor(element),
          groupLabel,
          guidance: [...describedGuidance, ...labelledGuidance],
          section:
            sectionIndex >= 0
              ? {
                  id: `section_${evaluatedFrameIndex}_${sectionIndex}`,
                  label:
                    text(
                      sectionElement.querySelector(
                        ":scope > legend,:scope > h1,:scope > h2,:scope > h3,:scope > h4"
                      )
                    ) ||
                    sectionElement.getAttribute("aria-label") ||
                    sectionElement.id ||
                    `Section ${sectionIndex + 1}`,
                  guidance: Array.from(
                    sectionElement.querySelectorAll(
                      ":scope > .instructions,:scope > .instruction,:scope > .help,:scope > .hint,:scope > .description,:scope > [role='note'],:scope > p"
                    )
                  )
                    .filter((item) => !item.closest("label"))
                    .map((item) => ({
                      text: text(item).slice(0, 2_000),
                      source: "section-dom",
                    })),
                }
              : {
                  id: `section_${evaluatedFrameIndex}_unsectioned`,
                  label: "Unsectioned questions",
                },
          formId: element.closest("form")?.id || "",
          formText: contextText(element, "form", 1_200),
          sectionText: contextText(
            element,
            "fieldset,section,[role='group'],form",
            800
          ),
          required:
            element.matches(":required") ||
            element.getAttribute("aria-required") === "true",
          requiredAttribute: element.hasAttribute("required"),
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
          accept: element.getAttribute("accept") || "",
          maxFileSize:
            element.getAttribute("data-max-file-size") ||
            element.getAttribute("data-maxsize") ||
            "",
          maxFiles:
            element.getAttribute("data-max-files") ||
            (element.hasAttribute("multiple") ? "" : "1"),
          consent: /\b(?:consent|agree|authorize|terms|privacy)\b/i.test(
            `${labelFor(element)} ${name} ${element.id || ""}`
          ),
          adminAssisted: /\b(?:admin|administrator|staff|case worker|assisted)\b/i.test(
            `${labelFor(element)} ${name} ${element.id || ""}`
          ),
          canonicalProfileKey: "unmappable",
          repeatableSection:
            element.closest(
              '[data-repeatable],.repeater,.repeatable,[class*="repeater" i]'
            )?.getAttribute("data-repeatable") || "",
          addRowControl:
            text(
              element
                .closest(
                  '[data-repeatable],.repeater,.repeatable,[class*="repeater" i]'
                )
                ?.querySelector(
                  'button,[role="button"],input[type="button"]'
                )
            ) || "",
          otherSpecifyFor: /\bother\b/i.test(labelFor(element))
            ? name || element.id || labelFor(element)
            : "",
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
          formId: form?.id || "",
          formText: text(form).slice(0, 1_200),
          type: String(element.getAttribute("type") || "button").toLowerCase(),
          disabled:
            Boolean(element.disabled) ||
            element.getAttribute("aria-disabled") === "true",
          submitLike:
            element.tagName.toLowerCase() === "input" &&
            element.getAttribute("type") === "submit"
              ? true
              : element.tagName.toLowerCase() === "button"
                ? Boolean(form) &&
                  String(
                    element.getAttribute("type") || "submit"
                  ).toLowerCase() === "submit"
                : false,
          formAction: form
            ? new URL(form.getAttribute("action") || location.href, location.href)
                .href
            : "",
        };
      });
      const progressText = all(
        'progress,[role="progressbar"],[aria-current="step"],.progress,.steps,.step,.gf_step_active,.slds-progress'
      )
        .filter(visible)
        .map(text)
        .filter(Boolean)
        .join(" ")
        .slice(0, 1_000);
      return { controls, advances, progressText };
    },
    { evaluatedFrameIndex: frameIndex, evaluatedEpoch: epoch }
  );
}

async function inspectPage(page, epoch) {
  const mainOrigin = new URL(page.url()).origin;
  const controls = [];
  const advances = [];
  const progress = [];
  for (const [frameIndex, frame] of page.frames().entries()) {
    try {
      if (new URL(frame.url() || page.url()).origin !== mainOrigin) continue;
      const result = await inspectFrame(frame, frameIndex, epoch);
      controls.push(...result.controls);
      advances.push(...result.advances);
      if (result.progressText) progress.push(result.progressText);
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
    progressText: progress.join(" ").slice(0, 2_000),
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

async function submitEventCount(frame) {
  return frame
    .evaluate(() =>
      Number.parseInt(
        sessionStorage.getItem("__formweaveSubmitEvents") || "0",
        10
      )
    )
    .catch(() => 0);
}

async function applyValue(page, descriptor, value, authorizeWrites) {
  const locator = controlLocator(page, descriptor);
  let actedLocator = locator;
  const authorization = {
    scope: "same-origin",
    durationMs: 2_500,
    reason: `test value entry for ${descriptor.label || descriptor.controlId}`,
  };
  const closeWriteWindow = authorizeWrites(authorization) || (() => {});
  try {
  const type = descriptor.type;
  if (type !== "radio" && (await locator.count()) !== 1) {
    throw new Error(
      `The control locator resolved ${await locator.count()} elements instead of exactly one.`
    );
  }
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
    if ((await actedLocator.count()) !== 1) {
      throw new Error(
        `The radio option locator resolved ${await actedLocator.count()} elements instead of exactly one.`
      );
    }
    try {
      await actedLocator.check({ timeout: 3_000 });
    } catch {
      const wrappingLabel = actedLocator.locator("xpath=ancestor::label[1]");
      const associatedLabel = option?.id
        ? frameFor(page, descriptor).locator(
            `label[for="${String(option.id).replaceAll('"', '\\"')}"]`
          )
        : wrappingLabel;
      const label =
        (await wrappingLabel.count()) === 1 ? wrappingLabel : associatedLabel;
      if ((await label.count()) === 1) {
        await label.click({ timeout: 3_000 });
      } else {
        await actedLocator
          .click({ force: true, timeout: 3_000 })
          .catch(() =>
            actedLocator.evaluate((element) => HTMLElement.prototype.click.call(element))
          );
      }
    }
  } else if (type === "checkbox") {
    try {
      if (String(value) === "true") await locator.check({ timeout: 3_000 });
      else await locator.uncheck({ timeout: 3_000 });
    } catch {
      const wrappingLabel = locator.locator("xpath=ancestor::label[1]");
      const associatedLabel = descriptor.id
        ? frameFor(page, descriptor).locator(
            `label[for="${String(descriptor.id).replaceAll('"', '\\"')}"]`
          )
        : wrappingLabel;
      const label =
        (await wrappingLabel.count()) === 1 ? wrappingLabel : associatedLabel;
      if ((await label.count()) === 1) {
        await label.click({ timeout: 3_000 });
      } else {
        await locator
          .click({ force: true, timeout: 3_000 })
          .catch(() =>
            locator.evaluate((element) => HTMLElement.prototype.click.call(element))
          );
      }
    }
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
    !["checkbox", "radio", "switch"].includes(type) &&
    (["input", "textarea"].includes(descriptor.tag) ||
      type === "textbox" ||
      (type === "combobox" && observed.value))
  ) {
    if (!observed.value) {
      throw new Error("The control remained empty after synthetic entry.");
    }
    const phoneLike =
      type === "tel" ||
      /\b(?:phone|mobile|telephone)\b/i.test(
        `${descriptor.label || ""} ${descriptor.name || ""}`
      );
    const observedComparable =
      phoneLike
        ? String(observed.value).replace(/\D/g, "")
        : String(observed.value).trim();
    const requestedComparable =
      phoneLike
        ? String(value).replace(/\D/g, "")
        : String(value).trim();
    if (type !== "combobox" && observedComparable !== requestedComparable) {
      throw new Error(
        `The control read back "${observed.value}" instead of the requested synthetic value.`
      );
    }
  }
  if (type === "select" && String(observed.value) !== String(value)) {
    throw new Error("The select did not retain the requested option.");
  }
  return type === "radio"
    ? String(value)
    : type === "checkbox"
      ? String(observed.checked)
      : observed.value || String(value);
  } finally {
    closeWriteWindow();
  }
}

function descriptorAsField(descriptor, index, planField, entry) {
  const optionSet =
    descriptor.type === "radio"
      ? descriptor.groupOptions.map((option) => ({
          value: String(option.value || ""),
          label: String(option.label || option.value || ""),
        }))
      : descriptor.options.map((option) => ({
          value: String(option.value || ""),
          label: String(option.label || option.value || ""),
        }));
  return {
    name: descriptor.name || "",
    id: descriptor.id || "",
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
    optionSet,
    groupLabel: descriptor.groupLabel || "",
    optionValues:
      descriptor.type === "radio"
        ? descriptor.groupOptions.map((option) => option.value)
        : descriptor.options.map((option) => option.value),
    selector: descriptor.selector,
    selectorCandidates: [
      descriptor.selector,
      descriptor.id ? `#${descriptor.id}` : "",
      descriptor.name
        ? `${descriptor.tag}[name="${descriptor.name}"]`
        : "",
    ].filter(Boolean),
    frameUrl: descriptor.frameUrl,
    requiredSource: descriptor.requiredAttribute
      ? "required_attribute"
      : descriptor.required
        ? "aria_or_runtime"
        : "not_observed",
    validation: {
      pattern: descriptor.pattern || "",
      min: descriptor.min || "",
      max: descriptor.max || "",
      minLength: descriptor.minLength || "",
      maxLength: descriptor.maxLength || "",
    },
    upload: {
      accept: descriptor.accept || "",
      maxSize: descriptor.maxFileSize || "",
      maxFiles: descriptor.maxFiles || "",
    },
    consent: Boolean(descriptor.consent),
    adminAssisted: Boolean(descriptor.adminAssisted),
    canonicalProfileKey: descriptor.canonicalProfileKey || "unmappable",
    repeatableSection: descriptor.repeatableSection || "",
    addRowControl: descriptor.addRowControl || "",
    otherSpecifyFor: descriptor.otherSpecifyFor || "",
    sectionText: descriptor.sectionText || "",
    sectionId: descriptor.section?.id || "",
    formId: descriptor.formId || "",
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
  const capture = await captureFullPageAndTiles(page);
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
    fingerprint: await stateFingerprint(page, evidence.length),
    capturedAt: new Date().toISOString(),
    fieldsVisible,
    values: [...values.values()].map((entry) => ({
      fieldKey: entry.fieldKey,
      label: entry.label,
      value: String(entry.value),
      source: entry.source,
      control: entry.control || "",
      required: Boolean(entry.required),
      sensitive: Boolean(entry.sensitive),
      consent: Boolean(entry.consent),
      adminAssisted: Boolean(entry.adminAssisted),
      upload: Boolean(entry.upload),
      sectionText: entry.sectionText || "",
      formId: entry.formId || "",
      classification: entry.classification || "deterministic",
    })),
    screenshot: capture.full,
    sensingScreenshots: capture.sensing,
    screenshotTiled: capture.tiled,
    screenshotDimensions: capture.dimensions,
    screenshotTilesTruncated: Boolean(capture.truncated),
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
      values: state.values,
      screenshotRole: "sensing_and_evidence",
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
        control: descriptor.type,
        required: Boolean(descriptor.required),
        sensitive:
          ["password", "email", "tel", "date"].includes(descriptor.type) ||
          /\b(?:name|email|phone|mobile|address|birth|dob|ssn|income|password|medical|health)\b/i.test(
            `${descriptor.label} ${descriptor.name} ${descriptor.autocomplete}`
          ),
        consent: Boolean(descriptor.consent),
        adminAssisted: Boolean(descriptor.adminAssisted),
        upload: descriptor.type === "file",
        sectionText: descriptor.sectionText || "",
        formId: descriptor.formId || "",
        classification: planField.classification,
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
    outcome: error ? "could_not_test" : "landed",
    ...(error
      ? {
          failureCode: /locator|resolve|not found|detached/i.test(error)
            ? "locator_unresolved"
            : "actuation_unverified",
        }
      : {}),
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
      required: Boolean(descriptor.required),
      sensitive:
        ["password", "email", "tel", "date"].includes(descriptor.type) ||
        /\b(?:name|email|phone|mobile|address|birth|dob|ssn|income|password|medical|health)\b/i.test(
          `${descriptor.label} ${descriptor.name} ${descriptor.autocomplete}`
        ),
      consent: Boolean(descriptor.consent),
      adminAssisted: Boolean(descriptor.adminAssisted),
      upload: descriptor.type === "file",
      sectionText: descriptor.sectionText || "",
      formId: descriptor.formId || "",
      classification: planField.classification,
      rationale: planField.rationale,
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
    const submitEventCount = () =>
      Number.parseInt(
        sessionStorage.getItem("__formweaveSubmitEvents") || "0",
        10
      );
    const recordSubmitEvent = () => {
      const next = submitEventCount() + 1;
      sessionStorage.setItem("__formweaveSubmitEvents", String(next));
      return next;
    };
    window.__formweaveControl = {
      mode,
      permitSubmitUntil: 0,
    };
    const permitted = () =>
      Date.now() <= Number(window.__formweaveControl?.permitSubmitUntil || 0);
    window.addEventListener(
      "submit",
      (event) => {
        recordSubmitEvent();
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
        if (permitted()) {
          recordSubmitEvent();
          return originalSubmit.apply(this, args);
        }
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
    browserMode,
    settings,
    authorizeWrites,
    onEvent,
    reconScript,
    rebaseline,
    executionMode = "probe",
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
  let branchProbeFailures = 0;
  let scriptHaltReason = "";
  let submissionsAttempted = 0;
  let submissionsSucceeded = 0;
  let finalSubmission = "not_found";
  let previousAdvanceFingerprint = "";

  const initial = await inspectPage(page, `initial-${epoch}`);
  const initialUrl = page.url();
  if (!initial.controls.length || !settings.enterTestValues || !reconScript) {
    return {
      actions,
      evidence,
      observedFields: [],
      fieldsEntered,
      entryFailures,
      branchStates,
      submissionsAttempted,
      submissionsSucceeded,
      finalSubmission: "not_requested",
      certificationStatus: reconScript ? "no_form" : "script_missing",
      reconScriptId: reconScript?.id || "",
      reconScriptVersion: reconScript?.version || 0,
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
    const baselineUrl = page.url();
    const baselineFingerprint = await stateFingerprint(page, 0);
    const plan = await reconScript.planState({
      controls: inspection.controls,
      advances: inspection.advances,
      progressText: inspection.progressText,
      stateIndex: step,
      settings,
    });
    const planByControl = new Map(
      plan.fields.map((field) => [field.controlId, field])
    );
    const entryByControl = new Map();

    for (const [index, descriptor] of inspection.controls.entries()) {
      const planField = planByControl.get(descriptor.controlId);
      if (!planField) continue;
      if (
        planField.action === "skip" ||
        planField.action === "review" ||
        planField.classification === "human_review"
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
        const branchBaseline = branchBaselineFingerprint(
          inspection,
          descriptor
        );
        const baseValue = planByControl.get(controlId)?.testValue || values[0];
        if (step > 0 && baselineUrl === initialUrl) {
          for (const branchValue of values) {
            if (evidence.length >= settings.maxFormStates) break;
            const fingerprint = await stateFingerprint(page, evidence.length);
            const state = await captureState(
              page,
              evidence,
              settings,
              browserMode,
              "branch",
              `${descriptor.label || descriptor.name}: could not re-baseline`,
              enteredValues,
              onEvent
            );
            actions.push({
              category: "branch_probe",
              label: descriptor.label || descriptor.name || descriptor.controlId,
              strategy: `${plan.source} re-baselined branch option`,
              beforeFingerprint: fingerprint,
              afterFingerprint: fingerprint,
              changed: false,
              timestamp: new Date().toISOString(),
              fieldKey: semanticKey(descriptor, 0),
              testValue: String(branchValue),
              stateId: state?.id,
              classification: "conditional",
              rationale:
                "A same-URL dynamic later state cannot be independently restored by navigation.",
              outcome: "could_not_test",
              failureCode: "could_not_test",
              error:
                "The later same-URL form state could not be re-baselined without destroying the main progression path.",
            });
            entryFailures += 1;
            branchProbeFailures += 1;
          }
          continue;
        }
        for (const branchValue of values) {
          if (evidence.length >= settings.maxFormStates) break;
          let branchDescriptor = descriptor;
          let branchPlanSource = plan.source;
          let beforeFingerprint = await stateFingerprint(page, evidence.length);
          let error = "";
          let failureCode = "";
          try {
            if (typeof rebaseline !== "function") {
              throw new Error(
                "No page re-baseline operation is available for branch probing."
              );
            }
            await rebaseline(baselineUrl, {
              expectedFingerprint: baselineFingerprint,
              expectedBranchBaseline: branchBaseline,
              stateIndex: step,
              field:
                descriptor.name || descriptor.id || descriptor.label || controlId,
              value: String(branchValue),
            });
            const restoredFingerprint = await stateFingerprint(page, 0);
            const restored = await inspectPage(
              page,
              `branch-${epoch}-${branchStates + 1}`
            );
            branchDescriptor =
              restored.controls.find(
                (candidate) =>
                  descriptorIdentity(candidate) === descriptorIdentity(descriptor)
              ) ||
              restored.controls.find(
                (candidate) =>
                  candidate.type === descriptor.type &&
                  candidate.name === descriptor.name &&
                  candidate.label === descriptor.label
              );
            if (!branchDescriptor) {
              failureCode = "locator_unresolved";
              throw new Error(
                "The branch control locator did not resolve after re-baselining."
              );
            }
            if (
              branchBaselineFingerprint(restored, branchDescriptor) !==
              branchBaseline
            ) {
              failureCode = "could_not_test";
              throw new Error(
                "The relevant form could not be restored to the choice control's structural baseline."
              );
            }
            const restoredPlan = await reconScript.planState({
              controls: restored.controls,
              advances: restored.advances,
              progressText: restored.progressText,
              stateIndex: step,
              branchBaseline: true,
              settings,
            });
            branchPlanSource = restoredPlan.source;
            const restoredPlanByControl = new Map(
              restoredPlan.fields.map((field) => [field.controlId, field])
            );
            for (const restoredControl of restored.controls) {
              const restoredField = restoredPlanByControl.get(
                restoredControl.controlId
              );
              if (
                !restoredField ||
                restoredField.action === "skip" ||
                restoredField.action === "review" ||
                restoredField.classification === "human_review" ||
                descriptorIdentity(restoredControl) ===
                  descriptorIdentity(branchDescriptor)
              ) {
                continue;
              }
              await applyValue(
                page,
                restoredControl,
                restoredField.testValue,
                authorizeWrites
              );
            }
            beforeFingerprint = restoredFingerprint;
            const actualBranchValue = await applyValue(
              page,
              branchDescriptor,
              branchValue,
              authorizeWrites
            );
            enteredValues.set(
              descriptorIdentity(branchDescriptor),
              {
                fieldKey: semanticKey(branchDescriptor, enteredValues.size),
                label:
                  branchDescriptor.label ||
                  branchDescriptor.name ||
                  branchDescriptor.controlId,
                value: actualBranchValue,
                source: branchPlanSource,
                control: branchDescriptor.type,
                required: Boolean(branchDescriptor.required),
                sensitive: false,
                consent: Boolean(branchDescriptor.consent),
                adminAssisted: Boolean(branchDescriptor.adminAssisted),
                upload: branchDescriptor.type === "file",
                sectionText: branchDescriptor.sectionText || "",
                formId: branchDescriptor.formId || "",
                classification: "conditional",
              }
            );
            await waitForStableState(
              page,
              settings,
              onEvent,
              `branch ${descriptor.label || descriptor.name} = ${branchValue}`
            );
            const revealedInspection = await inspectPage(
              page,
              `branch-revealed-${epoch}-${branchStates + 1}`
            );
            const revealedPlan = await reconScript.planState({
              controls: revealedInspection.controls,
              advances: revealedInspection.advances,
              progressText: revealedInspection.progressText,
              stateIndex: step,
              branchReveal: true,
              settings,
            });
            const revealedPlanByControl = new Map(
              revealedPlan.fields.map((field) => [field.controlId, field])
            );
            const baselineIdentities = new Set(
              inspection.controls.map(descriptorIdentity)
            );
            for (const [revealedIndex, revealedControl] of revealedInspection.controls.entries()) {
              if (baselineIdentities.has(descriptorIdentity(revealedControl))) {
                continue;
              }
              const revealedField = revealedPlanByControl.get(
                revealedControl.controlId
              );
              if (
                !revealedField ||
                revealedField.action === "skip" ||
                revealedField.action === "review" ||
                revealedField.classification === "human_review"
              ) {
                continue;
              }
              const result = await recordFieldEntry(
                page,
                revealedControl,
                revealedField,
                enteredValues,
                actions,
                authorizeWrites,
                onEvent,
                revealedPlan.source
              );
              if (result.status === "entered") fieldsEntered += 1;
              else entryFailures += 1;
              mergeObservedField(
                observedFields,
                descriptorAsField(
                  revealedControl,
                  revealedIndex,
                  revealedField,
                  result
                )
              );
            }
          } catch (caught) {
            error =
              caught instanceof Error ? caught.message : "Branch actuation failed.";
            failureCode ||= /locator|resolve|not found|detached/i.test(error)
              ? "locator_unresolved"
              : /baseline|re-baseline/i.test(error)
                ? "could_not_test"
                : "actuation_unverified";
          }
          const afterFingerprint = await stateFingerprint(page, evidence.length);
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
            strategy: `${branchPlanSource} re-baselined branch option`,
            beforeFingerprint,
            afterFingerprint,
            changed: beforeFingerprint !== afterFingerprint,
            timestamp: new Date().toISOString(),
            fieldKey: semanticKey(descriptor, 0),
            testValue: String(branchValue),
            stateId: state?.id,
            classification: "conditional",
            rationale: "Exercised a safe option to reveal validation or conditional fields.",
            outcome: error ? "could_not_test" : "landed",
            ...(error ? { error, failureCode } : {}),
          });
          if (!error) branchStates += 1;
          else {
            entryFailures += 1;
            branchProbeFailures += 1;
          }
        }
        if (typeof rebaseline === "function") {
          await rebaseline(baselineUrl, {
            expectedFingerprint: baselineFingerprint,
            stateIndex: step,
            restoreMainPath: true,
          }).catch(() => {});
          const restored = await inspectPage(page, `restore-${epoch}`);
          const restoredPlan = await reconScript.planState({
            controls: restored.controls,
            advances: restored.advances,
            progressText: restored.progressText,
            stateIndex: step,
            restoreMainPath: true,
            settings,
          });
          const restoredPlanByControl = new Map(
            restoredPlan.fields.map((field) => [field.controlId, field])
          );
          enteredValues.clear();
          for (const restoredControl of restored.controls) {
            const restoredField = restoredPlanByControl.get(
              restoredControl.controlId
            );
            if (
              !restoredField ||
              restoredField.action === "skip" ||
              restoredField.action === "review" ||
              restoredField.classification === "human_review"
            ) {
              continue;
            }
            const restoredValue = await applyValue(
              page,
              restoredControl,
              restoredField.testValue,
              authorizeWrites
            ).catch(() => undefined);
            if (restoredValue !== undefined) {
              enteredValues.set(descriptorIdentity(restoredControl), {
                fieldKey: semanticKey(restoredControl, enteredValues.size),
                label:
                  restoredControl.label ||
                  restoredControl.name ||
                  restoredControl.controlId,
                value: restoredValue,
                source: restoredPlan.source,
                control: restoredControl.type,
                required: Boolean(restoredControl.required),
                sensitive: false,
                consent: Boolean(restoredControl.consent),
                adminAssisted: Boolean(restoredControl.adminAssisted),
                upload: restoredControl.type === "file",
                sectionText: restoredControl.sectionText || "",
                formId: restoredControl.formId || "",
                classification:
                  restoredField.classification || "deterministic",
              });
            }
          }
          await waitForStableState(
            page,
            settings,
            onEvent,
            `restored main path for state ${step + 1}`
          );
        } else if (baseValue !== undefined && baseValue !== "") {
          await applyValue(page, descriptor, baseValue, authorizeWrites).catch(
            () => {}
          );
        }
      }
    }

    if (
      plan.haltAfterBranchProbe &&
      (branchStates > 0 || branchProbeFailures > 0)
    ) {
      scriptHaltReason =
        plan.branchHaltReason ||
        "The form-specific script requires review after conditional branch probing.";
      const fingerprint = await stateFingerprint(page, evidence.length);
      const halted = await captureState(
        page,
        evidence,
        settings,
        browserMode,
        "blocked_final",
        "Form-specific branch boundary halted for review",
        enteredValues,
        onEvent
      );
      actions.push({
        category: "branch_probe",
        label: "Form-specific branching boundary",
        strategy: `${plan.source} branch halt`,
        beforeFingerprint: fingerprint,
        afterFingerprint: fingerprint,
        changed: false,
        timestamp: new Date().toISOString(),
        stateId: halted?.id,
        classification: "human_review",
        rationale: scriptHaltReason,
        outcome: "could_not_test",
        failureCode: "could_not_test",
        error: scriptHaltReason,
      });
      finalSubmission = "not_requested";
      break;
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
      const conditionalPlan = await reconScript.planState({
        controls: conditionalControls,
        advances: refreshed.advances,
        progressText: refreshed.progressText,
        stateIndex: step,
        conditional: true,
        settings,
      });
      const conditionalPlanByControl = new Map(
        conditionalPlan.fields.map((field) => [field.controlId, field])
      );
      let conditionalEntries = 0;
      for (const [index, descriptor] of conditionalControls.entries()) {
        const planField = conditionalPlanByControl.get(descriptor.controlId);
        if (!planField) continue;
        const identity = descriptorIdentity(descriptor);
        if (
          planField.action === "skip" ||
          planField.action === "review" ||
          planField.classification === "human_review"
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
    if (plan.advance.classification === "review") {
      const beforeFingerprint = await stateFingerprint(page, evidence.length);
      const halted = await captureState(
        page,
        evidence,
        settings,
        browserMode,
        "blocked_final",
        "Ambiguous advance halted for review",
        enteredValues,
        onEvent
      );
      actions.push({
        category: "form_advance",
        label: "Ambiguous submit-typed controls",
        strategy: `${plan.source} terminality decision`,
        beforeFingerprint,
        afterFingerprint: beforeFingerprint,
        changed: false,
        timestamp: new Date().toISOString(),
        stateId: halted?.id,
        classification: "human_review",
        rationale: plan.advance.rationale,
        outcome: "could_not_test",
        failureCode: plan.advance.failureCode || "could_not_test",
        error: plan.advance.rationale,
      });
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
      });
    if (!advance) break;
    const classification = plan.advance.classification;
    const preAdvance = await captureState(
      page,
      evidence,
      settings,
      browserMode,
      classification === "final"
        ? executionMode === "fixture_submit"
          ? "pre_advance"
          : "blocked_final"
        : "pre_advance",
      classification === "final"
        ? executionMode === "fixture_submit"
          ? "Completed synthetic values before crawl-time terminal submission"
          : "Completed values before final submission"
        : `Completed values before ${advance.label}`,
      enteredValues,
      onEvent
    );
    const beforeFingerprint = await stateFingerprint(page);
    if (classification === "final") {
      if (executionMode === "fixture_submit") {
        const frame = frameFor(page, advance);
        const origin = new URL(page.url()).origin;
        const beforeSubmitEvents = await submitEventCount(frame);
        await permitSubmit(frame, 8_000);
        const closeWriteWindow =
          authorizeWrites({
            scope: "final-action",
            durationMs: 8_000,
            reason: `explicit synthetic crawl submission ${advance.label}`,
            origin,
          }) || (() => {});
        submissionsAttempted += 1;
        let error = "";
        try {
          await actionLocator(page, advance).click({ timeout: 8_000 });
          await waitForStableState(
            page,
            settings,
            onEvent,
            `crawl-time submission ${advance.label}`
          );
        } catch (caught) {
          error =
            caught instanceof Error
              ? caught.message
              : "Crawl-time submission failed.";
        } finally {
          closeWriteWindow();
        }
        const afterSubmitEvents = Math.max(
          await submitEventCount(frame),
          await submitEventCount(page.mainFrame())
        );
        const submitted = !error && afterSubmitEvents > beforeSubmitEvents;
        if (submitted) submissionsSucceeded += 1;
        finalSubmission = submitted ? "submitted" : "not_requested";
        const afterFingerprint = await stateFingerprint(page);
        const postState = await captureState(
          page,
          evidence,
          settings,
          browserMode,
          "submitted",
          submitted
            ? "Crawl-time terminal submission completed"
            : "Crawl-time terminal submission could not be verified",
          enteredValues,
          onEvent
        );
        actions.push({
          category: "final_submit_fixture",
          label: advance.label,
          strategy: "explicit synthetic crawl terminal action",
          beforeFingerprint,
          afterFingerprint,
          changed: beforeFingerprint !== afterFingerprint,
          timestamp: new Date().toISOString(),
          stateId: postState?.id,
          classification: "deterministic",
          rationale:
            "The client explicitly authorized terminal submission with synthetic crawl data.",
          outcome: submitted ? "landed" : "could_not_test",
          ...(!submitted
            ? {
                failureCode: error
                  ? "actuation_unverified"
                  : "advance_no_navigation",
                error:
                  error ||
                  "No permitted submit event was observed after the terminal click.",
              }
            : {}),
        });
        await onEvent?.(
          submitted
            ? "fixture_terminal_submission_completed"
            : "fixture_terminal_submission_unverified",
          submitted
            ? `Submitted crawl target through ${advance.label}.`
            : `Could not verify crawl-time submission through ${advance.label}.`,
          {
            label: advance.label,
            stateId: postState?.id || "",
            submitEventsBefore: beforeSubmitEvents,
            submitEventsAfter: afterSubmitEvents,
            ...(error ? { error } : {}),
          }
        );
        break;
      }
      finalSubmission = "blocked";
      actions.push({
        category: "final_submit_blocked",
        label: advance.label,
        strategy: "phase-1 terminal-submit boundary",
        beforeFingerprint,
        afterFingerprint: beforeFingerprint,
        changed: false,
        timestamp: new Date().toISOString(),
        stateId: preAdvance?.id,
        classification: "human_review",
        rationale:
          "Phase 1 traverses and populates the form but is structurally unable to activate the terminal submit control.",
        outcome: "landed",
      });
      await onEvent?.(
        "final_submission_blocked",
        `Phase 1 stopped before terminal action: ${advance.label}.`,
        { label: advance.label, stateId: preAdvance?.id || "" }
      );
      break;
    }

    const frame = frameFor(page, advance);
    await permitSubmit(frame, 8_000);
    const closeWriteWindow =
      authorizeWrites({
      scope: "same-origin",
      durationMs: 8_000,
      reason: `corroborated intermediate form action ${advance.label}`,
      }) || (() => {});
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
    } finally {
      closeWriteWindow();
    }
    const afterFingerprint = await stateFingerprint(page);
    const category = "form_advance";
    const postState = await captureState(
      page,
      evidence,
      settings,
      browserMode,
      "post_advance",
      `State after ${advance.label}`,
      enteredValues,
      onEvent
    );
    actions.push({
      category,
      label: advance.label,
      strategy: `phase-1 ${classification} action`,
      beforeFingerprint,
      afterFingerprint,
      changed: beforeFingerprint !== afterFingerprint,
      timestamp: new Date().toISOString(),
      stateId: postState?.id,
      classification: "deterministic",
      rationale: plan.advance.rationale,
      outcome:
        error || afterFingerprint === beforeFingerprint
          ? "could_not_test"
          : "landed",
      ...(error || afterFingerprint === beforeFingerprint
        ? {
            failureCode: error
              ? /locator|resolve|not found|detached/i.test(error)
                ? "locator_unresolved"
                : "actuation_unverified"
              : "advance_no_navigation",
          }
        : {}),
      ...(error ? { error } : {}),
    });
    if (
      !error &&
      afterFingerprint !== beforeFingerprint &&
      typeof reconScript.detectCrossPageDependency === "function"
    ) {
      const dependency = await reconScript.detectCrossPageDependency({
        page,
        previousUrl: baselineUrl,
        currentUrl: page.url(),
        enteredValues: [...enteredValues.values()],
        stateIndex: step,
      });
      if (dependency?.detected) {
        scriptHaltReason =
          dependency.reason ||
          "The form-specific script detected a cross-page dependency.";
        const halted = await captureState(
          page,
          evidence,
          settings,
          browserMode,
          "blocked_final",
          "Cross-page dependency halted for review",
          enteredValues,
          onEvent
        );
        actions.push({
          category: "form_advance",
          label: dependency.label || "Cross-page dependency",
          strategy: `${plan.source} cross-page dependency detector`,
          beforeFingerprint,
          afterFingerprint,
          changed: true,
          timestamp: new Date().toISOString(),
          stateId: halted?.id,
          classification: "human_review",
          rationale: scriptHaltReason,
          outcome: "could_not_test",
          failureCode: "could_not_test",
          error: scriptHaltReason,
        });
        finalSubmission = "not_requested";
        await onEvent?.(
          "cross_page_dependency_detected",
          scriptHaltReason,
          {
            previousUrl: baselineUrl,
            currentUrl: page.url(),
            stateId: halted?.id || "",
          }
        );
        break;
      }
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
    certificationStatus:
      entryFailures > 0 || scriptHaltReason
        ? "could_not_test"
        : executionMode === "fixture_submit" &&
            finalSubmission === "submitted"
          ? "fixture_submitted"
          : "probe_completed",
    reconScriptId: reconScript.id,
    reconScriptVersion: reconScript.version,
  };
}
