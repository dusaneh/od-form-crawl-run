import { createHash } from "node:crypto";

import { normalizeRuntimeRoute } from "../executor/state-identity.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function captureNovelStateInput({
  page,
  toolbox,
  existingContract = null,
  priorStates = [],
  locale = "en-US",
}) {
  await toolbox.prepare();
  const raw = await page.evaluate(() => {
    const visible = (element) => {
      if (!element?.isConnected) return false;
      const closedDetails = element.closest("details:not([open])");
      if (
        closedDetails &&
        !closedDetails.querySelector(":scope > summary")?.contains(element)
      ) {
        return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const hasVisibleBox =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        element.getAttribute("aria-hidden") !== "true";
      if (!hasVisibleBox) return false;
      if (Number.parseFloat(style.opacity || "1") !== 0) return true;
      if (
        !(element instanceof HTMLInputElement) ||
        !["radio", "checkbox"].includes(element.type) ||
        !element.id
      ) {
        return false;
      }
      const associatedLabel = document.querySelector(
        `label[for="${window.CSS?.escape ? window.CSS.escape(element.id) : element.id.replace(/"/g, '\\"')}"]`,
      );
      if (!associatedLabel) return false;
      const labelStyle = getComputedStyle(associatedLabel);
      const labelRect = associatedLabel.getBoundingClientRect();
      return (
        labelStyle.display !== "none" &&
        labelStyle.visibility !== "hidden" &&
        Number.parseFloat(labelStyle.opacity || "1") !== 0 &&
        labelRect.width > 0 &&
        labelRect.height > 0 &&
        associatedLabel.getAttribute("aria-hidden") !== "true"
      );
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const cssEscape = (value) =>
      window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');
    const uniqueCssPath = (element) => {
      const segments = [];
      let cursor = element;
      while (cursor instanceof Element) {
        if (cursor.id) {
          segments.unshift(`#${cssEscape(cursor.id)}`);
          break;
        }
        const tag = cursor.tagName.toLowerCase();
        const siblings = cursor.parentElement
          ? [...cursor.parentElement.children].filter(
              (item) => item.tagName === cursor.tagName,
            )
          : [cursor];
        const position = siblings.indexOf(cursor) + 1;
        segments.unshift(`${tag}:nth-of-type(${Math.max(position, 1)})`);
        cursor = cursor.parentElement;
      }
      return segments.join(" > ");
    };
    const selectors = (element) => {
      const candidates = [];
      if (element.id) candidates.push(`#${cssEscape(element.id)}`);
      const name = element.getAttribute("name");
      const type = element.getAttribute("type");
      const value = element.getAttribute("value");
      if (name && type && value !== null) {
        candidates.push(
          `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"][type="${cssEscape(type)}"][value="${cssEscape(value)}"]`,
        );
      }
      if (name && type) {
        candidates.push(
          `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"][type="${cssEscape(type)}"]`,
        );
      }
      if (name) {
        candidates.push(
          `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`,
        );
      }
      if (
        element instanceof HTMLButtonElement &&
        element.getAttribute("type")
      ) {
        candidates.push(
          `button[type="${cssEscape(element.getAttribute("type"))}"]`,
        );
      }
      if (
        element instanceof HTMLInputElement &&
        ["button", "submit"].includes(element.type)
      ) {
        candidates.push(`input[type="${cssEscape(element.type)}"]`);
      }
      if (element instanceof HTMLAnchorElement && element.getAttribute("href")) {
        candidates.push(
          `a[href="${cssEscape(element.getAttribute("href"))}"]`,
        );
      }
      candidates.push(uniqueCssPath(element));
      return [...new Set(candidates)].sort();
    };
    const labelOf = (element) => {
      const explicit = element.id
        ? document.querySelector(`label[for="${cssEscape(element.id)}"]`)
        : null;
      const wrapping = element.closest("label");
      const aria = element.getAttribute("aria-label");
      const labelledBy = element
        .getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      return clean(
        explicit?.textContent ||
          wrapping?.textContent ||
          aria ||
          labelledBy ||
          element.getAttribute("placeholder") ||
          element.getAttribute("name"),
      );
    };
    const describedBy = (element) =>
      clean(
        (element.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" "),
      );
    const sectionOf = (element) => {
      const fieldset = element.closest("fieldset");
      if (fieldset) return clean(fieldset.querySelector(":scope > legend")?.textContent);
      let cursor = element.previousElementSibling;
      while (cursor) {
        if (/^H[1-6]$/.test(cursor.tagName)) return clean(cursor.textContent);
        cursor = cursor.previousElementSibling;
      }
      return "";
    };

    const controlElements = [
      ...document.querySelectorAll("input, select, textarea"),
    ];
    const controls = controlElements.map((element, index) => {
      const optionFacts =
        element instanceof HTMLSelectElement
          ? [...element.options].map((option) => ({
              value: option.value,
              label: clean(option.textContent),
            }))
          : element instanceof HTMLInputElement &&
              ["radio", "checkbox"].includes(element.type)
            ? [
                {
                  value: element.value,
                  label: labelOf(element),
                },
              ]
            : [];
      const fieldset = element.closest("fieldset");
      const groupContainer = element.closest("fieldset, [role=group]");
      return {
        factId: `field_${index}`,
        tag: element.tagName.toLowerCase(),
        rawType: element.getAttribute("type") || null,
        name: element.getAttribute("name") || null,
        id: element.id || null,
        rawLabel: labelOf(element),
        groupLegend: clean(
          fieldset?.querySelector(":scope > legend")?.textContent || "",
        ),
        description: describedBy(element),
        placeholder: element.getAttribute("placeholder") || null,
        autocomplete: element.getAttribute("autocomplete") || null,
        inputMode: element.getAttribute("inputmode") || null,
        pattern: element.getAttribute("pattern") || null,
        min: element.getAttribute("min") || null,
        max: element.getAttribute("max") || null,
        step: element.getAttribute("step") || null,
        minLength: element.getAttribute("minlength") || null,
        maxLength: element.getAttribute("maxlength") || null,
        accept: element.getAttribute("accept") || null,
        multiple: element.hasAttribute("multiple"),
        maxFiles:
          element.getAttribute("data-max-files") ||
          (element instanceof HTMLInputElement &&
          element.type === "file" &&
          !element.hasAttribute("multiple")
            ? "1"
            : null),
        maxFileSize:
          element.getAttribute("data-max-file-size") ||
          element.getAttribute("data-maxsize") ||
          null,
        required:
          element.hasAttribute("required") ||
          element.getAttribute("aria-required") === "true" ||
          (element instanceof HTMLInputElement &&
            element.type === "radio" &&
            /(?:\brequired\b|\*)/i.test(
              clean(
                fieldset?.querySelector(":scope > legend")?.textContent ||
                  "",
              ),
            )),
        visible: visible(element),
        groupContainerVisible: groupContainer
          ? visible(groupContainer)
          : false,
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
        readOnly:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
            ? element.readOnly
            : false,
        options: optionFacts,
        sectionText: sectionOf(element),
        selectorCandidates: selectors(element),
      };
    });

    const actions = [
      ...document.querySelectorAll(
        "button, input[type=submit], input[type=button], summary, [role=button], a[href]",
      ),
    ].map((element, index) => {
      const disclosureRoots = [];
      let disclosureExpanded = null;
      if (element instanceof HTMLElement && element.tagName === "SUMMARY") {
        const details = element.closest("details");
        if (details) {
          disclosureExpanded = details.open;
          if (!details.open) disclosureRoots.push(details);
        }
      }
      const ariaExpanded = element.getAttribute("aria-expanded");
      if (ariaExpanded === "true") disclosureExpanded = true;
      if (ariaExpanded === "false") disclosureExpanded = false;
      const controlledIds = clean(element.getAttribute("aria-controls"))
        .split(/\s+/)
        .filter(Boolean);
      for (const id of controlledIds) {
        const controlled = document.getElementById(id);
        if (controlled) disclosureRoots.push(controlled);
      }
      const targetSelector = element.getAttribute("data-bs-target");
      if (targetSelector?.startsWith("#")) {
        const controlled = document.getElementById(targetSelector.slice(1));
        if (controlled) disclosureRoots.push(controlled);
      }
      const blockedControlFactIds = [
        ...new Set(
          disclosureRoots.flatMap((root) =>
            controlElements.flatMap((control, controlIndex) =>
              root.contains(control) && !visible(control)
                ? [`field_${controlIndex}`]
                : [],
            ),
          ),
        ),
      ].sort();
      return {
        factId: `action_${index}`,
        tag: element.tagName.toLowerCase(),
        rawType: element.getAttribute("type") || null,
        rawText: clean(
          element.textContent ||
            element.getAttribute("value") ||
            element.getAttribute("aria-label"),
        ),
        visible: visible(element),
        disabled:
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true",
        href: element.getAttribute("href"),
        selectorCandidates: selectors(element),
        formMethod: element.form?.method?.toUpperCase?.() || null,
        formAction: element.form?.action || null,
        disclosureControl:
          element.tagName === "SUMMARY" ||
          ariaExpanded !== null,
        disclosureExpanded,
        blockedControlFactIds,
      };
    });

    const sections = [
      ...document.querySelectorAll("fieldset, section, [role=group]"),
    ]
      .filter(visible)
      .map((element, index) => ({
        factId: `section_${index}`,
        rawText: clean(
          element.querySelector(":scope > legend, :scope > h1, :scope > h2, :scope > h3")
            ?.textContent || element.getAttribute("aria-label"),
        ),
      }))
      .filter((item) => item.rawText);

    const guidance = [
      ...document.querySelectorAll(
        "p, small, [class*=help i], [class*=hint i], [class*=instruction i], [role=note], [role=alert]",
      ),
    ]
      .filter(visible)
      .map((element, index) => ({
        factId: `guidance_${index}`,
        rawText: clean(element.textContent).slice(0, 1_500),
      }))
      .filter((item) => item.rawText.length >= 3)
      .slice(0, 120);

    const challengeSignals = [
      ...document.querySelectorAll(
        'iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
      ),
    ].map((element, index) => ({
      factId: `challenge_${index}`,
      tag: element.tagName.toLowerCase(),
      src: element.getAttribute("src"),
      rawText: clean(element.textContent),
      visible: visible(element),
    }));

    return {
      title: document.title,
      heading: clean(document.querySelector("h1")?.textContent),
      controls,
      actions,
      sections,
      guidance,
      challengeSignals,
    };
  });
  const screenshot = await page.screenshot({ fullPage: true, type: "png" });
  const accessibilitySnapshot = await toolbox.senseAccessibility();
  return {
    observation: {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      url: page.url(),
      normalizedRoute: normalizeRuntimeRoute(page.url()),
      locale,
      title: raw.title,
      heading: raw.heading,
      controls: raw.controls,
      actions: raw.actions,
      sections: raw.sections,
      guidance: raw.guidance,
      challengeSignals: raw.challengeSignals,
      accessibilitySnapshot,
      screenshot: {
        sha256: sha256(screenshot),
        byteLength: screenshot.byteLength,
        mediaType: "image/png",
      },
      priorStates: structuredClone(priorStates),
      existingContract: existingContract
        ? structuredClone(existingContract)
        : null,
    },
    screenshot,
  };
}
