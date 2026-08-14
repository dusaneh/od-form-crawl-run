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
    const repeatableOf = (element) => {
      const container = element.closest(
        '[data-repeatable], [data-repeater], .repeater, .repeatable, [class*="repeater" i]',
      );
      if (!container) return null;
      const heading = container.querySelector(
        ":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4",
      );
      const addControl = [...container.querySelectorAll('button, [role="button"], input[type="button"]')]
        .find((candidate) => /\b(?:add|another|more|new)\b/i.test(clean(candidate.textContent || candidate.value)));
      return {
        key: clean(
          container.getAttribute("data-repeatable") ||
            container.getAttribute("data-repeater") ||
            container.id ||
            heading?.textContent ||
            "repeatable_group",
        ),
        label: clean(heading?.textContent || container.getAttribute("aria-label") || ""),
        addControlText: clean(addControl?.textContent || addControl?.value || ""),
      };
    };
    const documentOrder = new Map(
      [...document.querySelectorAll("*")].map((element, index) => [
        element,
        index,
      ]),
    );

    const controlElements = [
      ...document.querySelectorAll("input, select, textarea"),
    ].filter(
      (element) =>
        !(
          element instanceof HTMLInputElement &&
          ["button", "image", "reset", "submit"].includes(
            element.type.toLowerCase(),
          )
        ),
    );
    const nativeControls = controlElements.map((element, index) => {
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
      const repeatable = repeatableOf(element);
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
        repeatableKey: repeatable?.key || "",
        repeatableLabel: repeatable?.label || "",
        addRowControl: repeatable?.addControlText || "",
        selectorCandidates: selectors(element),
        documentOrdinal:
          documentOrder.get(element) ?? Number.MAX_SAFE_INTEGER,
      };
    });

    const virtualContainers = [...document.querySelectorAll("*")].filter(
      (element) => {
        if (!visible(element)) return false;
        if (element.matches("input, select, textarea, button, a, label")) {
          return false;
        }
        if (element.querySelector("input, select, textarea")) return false;
        const role = clean(element.getAttribute("role")).toLowerCase();
        const hasIdentity = Boolean(
          element.id ||
            element.getAttribute("aria-label") ||
            element.getAttribute("aria-labelledby") ||
            ["group", "listbox", "radiogroup", "slider"].includes(role),
        );
        if (!hasIdentity) return false;
        const valueChildren = [
          ...element.querySelectorAll(
            ":scope > [data-value], :scope > [data-v], :scope > [role=option], :scope > [aria-valuenow], :scope > * > [data-value], :scope > * > [data-v], :scope > * > [role=option]",
          ),
        ].filter(visible);
        const values = valueChildren
          .map((child) =>
            child.getAttribute("data-value") ??
            child.getAttribute("data-v") ??
            child.getAttribute("aria-valuenow") ??
            child.getAttribute("value"),
          )
          .filter((value) => value !== null && clean(value) !== "");
        return values.length >= 2 && new Set(values.map(clean)).size >= 2;
      },
    );
    const virtualControls = virtualContainers.map((element, index) => {
      const optionElements = [
        ...element.querySelectorAll(
          ":scope > [data-value], :scope > [data-v], :scope > [role=option], :scope > [aria-valuenow], :scope > * > [data-value], :scope > * > [data-v], :scope > * > [role=option]",
        ),
      ].filter(visible);
      const options = optionElements.flatMap((child) => {
        const value =
          child.getAttribute("data-value") ??
          child.getAttribute("data-v") ??
          child.getAttribute("aria-valuenow") ??
          child.getAttribute("value");
        if (value === null || clean(value) === "") return [];
        const rawOptionLabel = clean(
          child.getAttribute("aria-label") ||
            child.getAttribute("title") ||
            child.textContent,
        );
        const numericRating = /^\d+(?:\.\d+)?$/.test(clean(value));
        const glyphOnly =
          rawOptionLabel !== "" &&
          !/[A-Za-z0-9]/.test(rawOptionLabel);
        return [{
          value: String(value),
          label:
            numericRating && (glyphOnly || rawOptionLabel === "")
              ? `${value} ${String(value) === "1" ? "star" : "stars"}`
              : rawOptionLabel || String(value),
        }];
      });
      let precedingHeading = "";
      let cursor = element.previousElementSibling;
      while (cursor && !precedingHeading) {
        if (/^H[1-6]$/.test(cursor.tagName)) {
          precedingHeading = clean(cursor.textContent);
          break;
        }
        cursor = cursor.previousElementSibling;
      }
      const rawLabel = clean(
        precedingHeading ||
          element.getAttribute("aria-label") ||
          (element.getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ") ||
          element.id,
      );
      return {
        factId: `virtual_field_${index}`,
        tag: element.tagName.toLowerCase(),
        rawType: "custom",
        name: element.getAttribute("name") || element.id || null,
        id: element.id || null,
        rawLabel,
        groupLegend: "",
        description: describedBy(element),
        placeholder: null,
        autocomplete: null,
        inputMode: null,
        pattern: null,
        min: null,
        max: null,
        step: null,
        minLength: null,
        maxLength: null,
        accept: null,
        multiple: false,
        maxFiles: null,
        maxFileSize: null,
        required:
          element.getAttribute("aria-required") === "true" ||
          element.hasAttribute("required"),
        visible: true,
        groupContainerVisible: true,
        disabled: element.getAttribute("aria-disabled") === "true",
        readOnly: false,
        options,
        sectionText: sectionOf(element),
        selectorCandidates: selectors(element),
        documentOrdinal:
          documentOrder.get(element) ?? Number.MAX_SAFE_INTEGER,
        virtual: true,
        actuationEligible: false,
      };
    });
    const controls = [...nativeControls, ...virtualControls].sort(
      (left, right) => left.documentOrdinal - right.documentOrdinal,
    );

    const actions = [
      ...document.querySelectorAll(
        "button, input[type=submit], input[type=button], summary, [role=button], [aria-expanded], a[href]",
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
      const rawHref = element.getAttribute("href")?.trim() || "";
      const navigationalAnchor =
        element.tagName === "A" &&
        rawHref !== "" &&
        !rawHref.startsWith("#");
      const navigationChrome = Boolean(
        element.closest("nav, header, footer, [role='navigation']"),
      );
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
      if (
        ariaExpanded !== null &&
        disclosureRoots.length === 0 &&
        element.nextElementSibling
      ) {
        disclosureRoots.push(element.nextElementSibling);
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
          !navigationChrome &&
          (element.tagName === "SUMMARY" ||
            (ariaExpanded !== null && !navigationalAnchor)),
        disclosureExpanded:
          navigationalAnchor || navigationChrome ? null : disclosureExpanded,
        blockedControlFactIds,
      };
    });

    const scrollRegions = [...document.querySelectorAll("*")]
      .filter((element) => {
        if (["HTML", "BODY"].includes(element.tagName)) return false;
        const style = getComputedStyle(element);
        return (
          visible(element) &&
          element.scrollHeight > element.clientHeight + 8 &&
          ["auto", "scroll"].includes(style.overflowY)
        );
      })
      .slice(0, 80)
      .map((element, index) => ({
        factId: `scroll_region_${index}`,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || null,
        rawLabel: clean(
          element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.closest("section, fieldset")?.querySelector("legend, h1, h2, h3")
              ?.textContent ||
            "",
        ),
        textExcerpt: clean(element.textContent).slice(0, 800),
        selectorCandidates: selectors(element),
        scrollTop: Math.round(element.scrollTop),
        clientHeight: Math.round(element.clientHeight),
        scrollHeight: Math.round(element.scrollHeight),
        atEnd:
          element.scrollTop + element.clientHeight >=
          element.scrollHeight - 2,
        containedControlFactIds: controlElements
          .flatMap((control, controlIndex) =>
            element.contains(control) ? [`field_${controlIndex}`] : [],
          )
          .sort(),
      }));

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
      scrollRegions,
      sections,
      guidance,
      challengeSignals,
    };
  });
  const frameScrollRegions = [];
  const childFrames = page
    .frames()
    .filter(
      (frame) =>
        frame !== page.mainFrame() && frame.parentFrame() === page.mainFrame(),
    )
    .slice(0, 24);
  for (const [frameIndex, frame] of childFrames.entries()) {
    try {
      const frameElement = await frame.frameElement();
      const frameSelectorCandidates = await frameElement.evaluate((element) => {
        const cssEscape = (value) =>
          window.CSS?.escape
            ? window.CSS.escape(value)
            : String(value).replace(/"/g, '\\"');
        const candidates = [];
        if (element.id) candidates.push(`#${cssEscape(element.id)}`);
        for (const attribute of ["name", "title", "src"]) {
          const value = element.getAttribute(attribute);
          if (value) {
            candidates.push(
              `${element.tagName.toLowerCase()}[${attribute}="${cssEscape(value)}"]`,
            );
          }
        }
        const siblings = element.parentElement
          ? [...element.parentElement.children].filter(
              (item) => item.tagName === element.tagName,
            )
          : [element];
        candidates.push(
          `${element.tagName.toLowerCase()}:nth-of-type(${Math.max(siblings.indexOf(element) + 1, 1)})`,
        );
        return [...new Set(candidates)];
      });
      const regions = await frame.evaluate((prefix) => {
        const clean = (value) =>
          String(value || "").replace(/\s+/g, " ").trim();
        const cssEscape = (value) =>
          window.CSS?.escape
            ? window.CSS.escape(value)
            : String(value).replace(/"/g, '\\"');
        const visible = (element) => {
          if (!element?.isConnected) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            element.getAttribute("aria-hidden") !== "true"
          );
        };
        const selectors = (element) => {
          const candidates = [];
          if (element.id) candidates.push(`#${cssEscape(element.id)}`);
          const role = element.getAttribute("role");
          const label = element.getAttribute("aria-label");
          if (role && label) {
            candidates.push(
              `[role="${cssEscape(role)}"][aria-label="${cssEscape(label)}"]`,
            );
          }
          const siblings = element.parentElement
            ? [...element.parentElement.children].filter(
                (item) => item.tagName === element.tagName,
              )
            : [element];
          candidates.push(
            `${element.tagName.toLowerCase()}:nth-of-type(${Math.max(siblings.indexOf(element) + 1, 1)})`,
          );
          return [...new Set(candidates)];
        };
        return [...document.querySelectorAll("*")]
          .filter((element) => {
            if (["HTML", "BODY"].includes(element.tagName)) return false;
            const style = getComputedStyle(element);
            return (
              visible(element) &&
              element.scrollHeight > element.clientHeight + 8 &&
              ["auto", "scroll"].includes(style.overflowY)
            );
          })
          .slice(0, 80)
          .map((element, index) => ({
            factId: `${prefix}_${index}`,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || null,
            rawLabel: clean(
              element.getAttribute("aria-label") ||
                element.getAttribute("title") ||
                "",
            ),
            textExcerpt: clean(element.textContent).slice(0, 800),
            selectorCandidates: selectors(element),
            scrollTop: Math.round(element.scrollTop),
            clientHeight: Math.round(element.clientHeight),
            scrollHeight: Math.round(element.scrollHeight),
            atEnd:
              element.scrollTop + element.clientHeight >=
              element.scrollHeight - 2,
            containedControlFactIds: [],
          }));
      }, `frame_scroll_region_${frameIndex}`);
      frameScrollRegions.push(
        ...regions.map((region) => ({
          ...region,
          frameUrl: frame.url(),
          frameSelectorCandidates,
        })),
      );
    } catch {
      // Detached or inaccessible frames remain absent raw facts; generation
      // must not invent a frame strategy without an observed region.
    }
  }
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
      scrollRegions: [...raw.scrollRegions, ...frameScrollRegions].slice(0, 160),
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
