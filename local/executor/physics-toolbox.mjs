import { Buffer } from "node:buffer";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const GENERATED_UPLOAD_MARKER = "[generated harmless upload]";
const GENERATED_UPLOAD_FIXTURES = Object.freeze([
  {
    extension: ".pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
      "utf8",
    ),
  },
  {
    extension: ".png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  },
  {
    extension: ".jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
      "base64",
    ),
  },
  {
    extension: ".txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "FORMWEAVE TEST DOCUMENT\nSynthetic fixture upload only.\n",
      "utf8",
    ),
  },
  {
    extension: ".json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"formweave":"synthetic fixture upload","realApplicantData":false}\n',
      "utf8",
    ),
  },
]);

function uploadAcceptTokens(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase().split(";")[0])
    .filter(Boolean);
}

function acceptsGeneratedFixture(fixture, tokens) {
  if (tokens.length === 0 || tokens.includes("*/*")) return true;
  return tokens.some(
    (token) =>
      token === fixture.extension ||
      token === fixture.mimeType ||
      (token.endsWith("/*") &&
        fixture.mimeType.startsWith(`${token.slice(0, -1)}`)),
  );
}

function byteLimitFromText(...values) {
  for (const value of values) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) continue;
    if (/^\d+$/.test(text)) {
      const bytes = Number.parseInt(text, 10);
      if (Number.isSafeInteger(bytes) && bytes > 0) return bytes;
    }
    const match = text.match(
      /(\d+(?:\.\d+)?)\s*(b|bytes?|kb|kib|mb|mib|gb|gib)\b/i,
    );
    if (!match) continue;
    const amount = Number.parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier =
      unit === "gb" || unit === "gib"
        ? 1024 ** 3
        : unit === "mb" || unit === "mib"
          ? 1024 ** 2
          : unit === "kb" || unit === "kib"
            ? 1024
            : 1;
    const bytes = Math.floor(amount * multiplier);
    if (Number.isSafeInteger(bytes) && bytes > 0) return bytes;
  }
  return null;
}

export function generatedUploadPayload(constraints = {}) {
  const tokens = uploadAcceptTokens(constraints.accept);
  const fixture = GENERATED_UPLOAD_FIXTURES.find((candidate) =>
    acceptsGeneratedFixture(candidate, tokens),
  );
  if (!fixture) {
    return {
      ok: false,
      failureCode: "type_mismatch",
      detail: `No harmless generated fixture matches accept="${String(
        constraints.accept || "",
      )}".`,
    };
  }
  const maxFiles = Number.parseInt(String(constraints.maxFiles || "1"), 10);
  if (Number.isFinite(maxFiles) && maxFiles < 1) {
    return {
      ok: false,
      failureCode: "type_mismatch",
      detail: "The upload contract does not permit any file.",
    };
  }
  const maxBytes = byteLimitFromText(
    constraints.maxSize,
    ...(constraints.guidance || []),
  );
  if (maxBytes !== null && fixture.buffer.byteLength > maxBytes) {
    return {
      ok: false,
      failureCode: "type_mismatch",
      detail: `The smallest matching harmless fixture exceeds the observed ${maxBytes}-byte limit.`,
    };
  }
  return {
    ok: true,
    marker: GENERATED_UPLOAD_MARKER,
    name: `formweave-test-upload${fixture.extension}`,
    mimeType: fixture.mimeType,
    buffer: fixture.buffer,
    byteLength: fixture.buffer.byteLength,
    maxBytes,
  };
}

function scalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function escapedAttribute(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function selectorForOption(selector, optionValue) {
  const valueSelector =
    /\[\s*value\s*=\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\]\s]+)\s*\]/i;
  const requested = `[value="${escapedAttribute(optionValue)}"]`;
  return valueSelector.test(selector)
    ? selector.replace(valueSelector, requested)
    : `${selector}${requested}`;
}

async function mutationQuiet(page, quietMs, timeoutMs) {
  await page
    .evaluate(
      ({ quiet, timeout }) =>
        new Promise((resolve) => {
          let finished = false;
          let quietTimer;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(quietTimer);
            clearTimeout(capTimer);
            observer.disconnect();
            resolve();
          };
          const arm = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, quiet);
          };
          const observer = new MutationObserver(arm);
          const capTimer = setTimeout(finish, timeout);
          observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true,
          });
          arm();
        }),
      { quiet: quietMs, timeout: timeoutMs },
    )
    .catch(() => {});
}

export class PhysicsToolbox {
  constructor(
    page,
    {
      evidenceSink = null,
      quietMs = 350,
      settleTimeoutMs = 5_000,
      allowReadLikePost = () => false,
    } = {},
  ) {
    if (!page) throw new TypeError("PhysicsToolbox requires a Playwright page.");
    this.page = page;
    this.evidenceSink = evidenceSink;
    this.quietMs = quietMs;
    this.settleTimeoutMs = settleTimeoutMs;
    this.allowReadLikePost = allowReadLikePost;
    this.writeWindow = null;
    this.requestEvents = [];
    this.routeInstalled = false;
  }

  async settle() {
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page
      .waitForLoadState("networkidle", { timeout: this.settleTimeoutMs })
      .catch(() => {});
    await this.page.mouse.move(44, 52).catch(() => {});
    await this.page.mouse.move(176, 163, { steps: 5 }).catch(() => {});
    await mutationQuiet(this.page, this.quietMs, this.settleTimeoutMs);
  }

  async prepare() {
    await this.settle();
    const primeDocument = async (frame) =>
      frame
        .evaluate(() => {
          const result = {
            scrollSurfacesPrimed: 0,
          };
          for (const element of document.querySelectorAll("*")) {
            const style = getComputedStyle(element);
            if (
              element.scrollHeight > element.clientHeight + 8 &&
              ["auto", "scroll"].includes(style.overflowY)
            ) {
              element.scrollTop = element.scrollHeight;
              element.dispatchEvent(new Event("scroll", { bubbles: true }));
              result.scrollSurfacesPrimed += 1;
            }
          }
          window.scrollTo(0, document.documentElement.scrollHeight);
          window.dispatchEvent(new Event("scroll"));
          return result;
        })
        .catch(() => ({ scrollSurfacesPrimed: 0 }));
    const preparation = {
      detailsOpened: 0,
      scrollSurfacesPrimed: 0,
      disclosureButtonsOpened: 0,
      inaccessibleFrames: 0,
    };
    for (const frame of this.page.frames()) {
      try {
        if (
          frame !== this.page.mainFrame() &&
          new URL(frame.url()).origin !== new URL(this.page.url()).origin
        ) {
          preparation.inaccessibleFrames += 1;
          continue;
        }
        const result = await primeDocument(frame);
        preparation.scrollSurfacesPrimed += result.scrollSurfacesPrimed;
      } catch {
        preparation.inaccessibleFrames += 1;
      }
    }
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    return { ...preparation, consentAction: null, overlayAction: null };
  }

  async installRequestGuard() {
    if (this.routeInstalled) return;
    await this.page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      if (READ_METHODS.has(method)) return route.continue();

      let sameOrigin = false;
      try {
        sameOrigin =
          new URL(request.url()).origin === new URL(this.page.url()).origin;
      } catch {
        sameOrigin = false;
      }
      const readLike = await Promise.resolve(
        this.allowReadLikePost({
          method,
          url: request.url(),
          resourceType: request.resourceType(),
        }),
      ).catch(() => false);
      const guardedWrite = ["POST", "PUT", "PATCH"].includes(method);
      const permitted =
        sameOrigin &&
        (readLike ||
          (guardedWrite &&
            this.writeWindow !== null &&
            ["field", "advance"].includes(this.writeWindow)));
      this.requestEvents.push({
        method,
        path: (() => {
          try {
            return new URL(request.url()).pathname;
          } catch {
            return "";
          }
        })(),
        permitted,
        authority: readLike ? "read_like" : this.writeWindow,
      });
      if (permitted) return route.continue();
      return route.abort("blockedbyclient");
    });
    this.routeInstalled = true;
  }

  async withAuthorizedWrites(kind, action) {
    if (!["field", "advance"].includes(kind)) {
      throw new TypeError("Write authority must be field or advance.");
    }
    if (this.writeWindow !== null) {
      throw new Error("Nested browser write windows are forbidden.");
    }
    this.writeWindow = kind;
    try {
      return await action();
    } finally {
      this.writeWindow = null;
    }
  }

  async isVisible(target) {
    if (!target || !Array.isArray(target.selectors)) return false;
    for (const selector of target.selectors) {
      if (typeof selector !== "string" || selector.trim() === "") continue;
      const locator = this.page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) return true;
      }
    }
    return false;
  }

  async resolveUnique(target, optionValue = undefined) {
    if (!target || !Array.isArray(target.selectors)) return null;
    for (const selector of target.selectors) {
      if (typeof selector !== "string" || selector.trim() === "") continue;
      let candidate = selector;
      if (optionValue !== undefined) {
        candidate = selectorForOption(candidate, optionValue);
      }
      const locator = this.page.locator(candidate);
      const count = await locator.count().catch(() => 0);
      if (count === 1) return locator;
    }
    return null;
  }

  async resolveRadioOption(target, optionValue) {
    const direct = await this.resolveUnique(target, optionValue);
    if (direct) return direct;

    for (const selector of target?.selectors || []) {
      if (typeof selector !== "string" || selector.trim() === "") continue;
      const authoredLocator = this.page.locator(selector);
      if ((await authoredLocator.count().catch(() => 0)) !== 1) continue;
      const authoredType = await authoredLocator
        .getAttribute("type")
        .catch(() => null);
      const groupName = await authoredLocator
        .getAttribute("name")
        .catch(() => null);
      if (authoredType?.toLowerCase() !== "radio" || !groupName) continue;
      const groupOption = this.page.locator(
        `input[type="radio"][name="${escapedAttribute(groupName)}"][value="${escapedAttribute(optionValue)}"]`,
      );
      if ((await groupOption.count().catch(() => 0)) === 1) {
        return groupOption;
      }
    }
    return null;
  }

  async writeControl(target, controlType, optionValues, value) {
    if (!scalar(value)) {
      return {
        verified: false,
        failureCode: "type_mismatch",
        detail: "Only scalar values can be actuated.",
      };
    }
    if (controlType === "file") {
      return {
        verified: false,
        failureCode: "type_mismatch",
        detail: "File controls require an explicit upload directive.",
      };
    }

    let locator;
    let requested = value;
    if (controlType === "radio") {
      const requestedOption = String(value);
      if (!optionValues.includes(requestedOption)) {
        return {
          verified: false,
          failureCode: "type_mismatch",
          detail: "The requested radio value is outside the contract.",
        };
      }
      locator = await this.resolveRadioOption(target, requestedOption);
      requested = requestedOption;
    } else {
      locator = await this.resolveUnique(target);
    }
    if (!locator) {
      return {
        verified: false,
        failureCode: "locator_unresolved",
        detail: "No contract-scoped locator resolved uniquely.",
      };
    }
    if (!(await locator.isVisible().catch(() => false))) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail:
          "The contract-scoped control is not currently visible; hidden controls cannot be actuated before an LLM-authored reveal.",
      };
    }

    try {
      await this.withAuthorizedWrites("field", async () => {
        if (controlType === "checkbox" || controlType === "switch") {
          const wanted =
            typeof value === "boolean"
              ? value
              : /^(1|true|yes|on|checked)$/i.test(String(value));
          requested = wanted;
          if ((await locator.isChecked()) !== wanted) {
            try {
              await locator.setChecked(wanted, { timeout: 4_000 });
            } catch {
              await locator.setChecked(wanted, {
                timeout: 3_000,
                force: true,
              });
            }
          }
        } else if (controlType === "radio") {
          try {
            await locator.check({ timeout: 4_000 });
          } catch {
            await locator.check({ timeout: 3_000, force: true });
          }
        } else if (controlType === "select") {
          const requestedOption = String(value);
          if (!optionValues.includes(requestedOption)) {
            throw Object.assign(
              new Error("The requested select value is outside the contract."),
              { formweaveCode: "type_mismatch" },
            );
          }
          await locator.selectOption(requestedOption, { timeout: 4_000 });
          requested = requestedOption;
        } else {
          await locator.fill(String(value), { timeout: 4_000 });
          requested = String(value);
        }
      });
    } catch (error) {
      return {
        verified: false,
        failureCode: error?.formweaveCode || "actuation_unverified",
        detail: error instanceof Error ? error.message : "Actuation failed.",
      };
    }
    await this.settle();

    let landed;
    if (
      controlType === "checkbox" ||
      controlType === "switch" ||
      controlType === "radio"
    ) {
      landed = await locator.isChecked().catch(() => null);
      if (controlType === "radio") landed = landed ? requested : null;
    } else {
      landed = await locator.inputValue().catch(() => null);
    }
    if (landed !== requested) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail: "Exact readback did not match the requested value.",
      };
    }
    return { verified: true, failureCode: null, detail: null };
  }

  async uploadGeneratedFile(target, constraints = {}) {
    const locator = await this.resolveUnique(target);
    if (!locator) {
      return {
        verified: false,
        failureCode: "locator_unresolved",
        detail: "No contract-scoped upload locator resolved uniquely.",
      };
    }
    const controlType = await locator.getAttribute("type").catch(() => null);
    if (String(controlType || "").toLowerCase() !== "file") {
      return {
        verified: false,
        failureCode: "type_mismatch",
        detail: "The LLM-authored upload target is not a file input.",
      };
    }
    if (await locator.isDisabled().catch(() => true)) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail: "The LLM-authored upload control is disabled.",
      };
    }
    const payload = generatedUploadPayload(constraints);
    if (!payload.ok) return payload;

    try {
      await this.withAuthorizedWrites("field", () =>
        locator.setInputFiles({
          name: payload.name,
          mimeType: payload.mimeType,
          buffer: payload.buffer,
        }),
      );
    } catch (error) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail:
          error instanceof Error
            ? error.message
            : "Generated fixture upload failed.",
      };
    }
    await this.settle();
    const readback = await locator
      .evaluate((element) => {
        const files = element.files ? [...element.files] : [];
        return files.map((file) => ({
          size: file.size,
          type: file.type,
        }));
      })
      .catch(() => []);
    if (
      readback.length !== 1 ||
      readback[0].size !== payload.byteLength ||
      readback[0].type !== payload.mimeType
    ) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail:
          "The upload control readback did not match the generated fixture metadata.",
      };
    }
    return {
      verified: true,
      failureCode: null,
      detail: null,
      readback: {
        marker: GENERATED_UPLOAD_MARKER,
        fileCount: 1,
        mimeType: payload.mimeType,
        byteLength: payload.byteLength,
        synthetic: true,
      },
    };
  }

  async uploadProvidedFile(target, file) {
    const locator = await this.resolveUnique(target);
    if (!locator) {
      return {
        verified: false,
        failureCode: "locator_unresolved",
        detail: "No contract-scoped upload locator resolved uniquely.",
      };
    }
    const controlType = await locator.getAttribute("type").catch(() => null);
    if (String(controlType || "").toLowerCase() !== "file") {
      return {
        verified: false,
        failureCode: "type_mismatch",
        detail: "The LLM-authored upload target is not a file input.",
      };
    }
    if (
      !file ||
      typeof file.name !== "string" ||
      typeof file.mimeType !== "string" ||
      !Buffer.isBuffer(file.buffer)
    ) {
      return {
        verified: false,
        failureCode: "type_mismatch",
        detail: "The upload payload must include name, mimeType, and decoded bytes.",
      };
    }
    try {
      await this.withAuthorizedWrites("field", () =>
        locator.setInputFiles({
          name: file.name,
          mimeType: file.mimeType,
          buffer: file.buffer,
        }),
      );
    } catch (error) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail:
          error instanceof Error ? error.message : "Provided file upload failed.",
      };
    }
    await this.settle();
    const readback = await locator
      .evaluate((element) =>
        element.files
          ? [...element.files].map((item) => ({
              size: item.size,
              type: item.type,
            }))
          : [],
      )
      .catch(() => []);
    if (
      readback.length !== 1 ||
      readback[0].size !== file.buffer.byteLength ||
      readback[0].type !== file.mimeType
    ) {
      return {
        verified: false,
        failureCode: "actuation_unverified",
        detail: "The upload readback did not match the provided file metadata.",
      };
    }
    return {
      verified: true,
      failureCode: null,
      detail: null,
      readback: {
        fileCount: 1,
        mimeType: file.mimeType,
        byteLength: file.buffer.byteLength,
      },
    };
  }

  async clickAction(target) {
    const locator = await this.resolveUnique(target);
    if (!locator) {
      return {
        clicked: false,
        failureCode: "actuation_unverified",
        detail: "The declared progression locator did not resolve uniquely.",
      };
    }
    try {
      await this.withAuthorizedWrites("advance", async () => {
        let dispatched = false;
        await locator
          .click({ timeout: 4_000 })
          .then(() => {
            dispatched = true;
          })
          .catch(() => {});
        if (!dispatched) {
          await locator
            .click({ timeout: 3_000, force: true })
            .then(() => {
              dispatched = true;
            })
            .catch(() => {});
        }
        if (!dispatched) {
          await locator.focus().catch(() => {});
          await this.page.keyboard
            .press("Enter")
            .then(() => {
              dispatched = true;
            })
            .catch(() => {});
        }
        if (!dispatched) {
          dispatched = await locator
            .evaluate((element) => {
              element.click();
              return true;
            })
            .catch(() => false);
        }
        if (!dispatched) throw new Error("The click ladder exhausted.");
      });
      return { clicked: true, failureCode: null, detail: null };
    } catch (error) {
      return {
        clicked: false,
        failureCode: "actuation_unverified",
        detail: error instanceof Error ? error.message : "Click failed.",
      };
    }
  }

  async validationMessages() {
    return this.page
      .locator(
        '[role="alert"]:visible, .error:visible, [aria-invalid="true"]:visible',
      )
      .allTextContents()
      .then((items) => items.map((item) => item.trim()).filter(Boolean))
      .catch(() => []);
  }

  async senseControls() {
    return this.page
      .locator("input, select, textarea, button, [role=button]")
      .evaluateAll((nodes) =>
        nodes.map((node, index) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            factId: `control_${index}`,
            tag: node.tagName.toLowerCase(),
            rawType: node.getAttribute("type"),
            name: node.getAttribute("name"),
            id: node.id || null,
            required:
              node.hasAttribute("required") ||
              node.getAttribute("aria-required") === "true",
            visible:
              node.isConnected &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0,
            disabled:
              node.hasAttribute("disabled") ||
              node.getAttribute("aria-disabled") === "true",
            optionValues:
              node instanceof HTMLSelectElement
                ? [...node.options].map((option) => option.value)
                : [],
            frameUrl: location.href,
          };
        }),
      );
  }

  async senseAccessibility() {
    return this.page
      .locator("body")
      .ariaSnapshot({ timeout: this.settleTimeoutMs })
      .catch(() => "");
  }

  async armTerminalGuard(target) {
    const locator = await this.resolveUnique(target);
    if (!locator) return false;
    return locator
      .evaluate((element) => {
        const marker = "formweaveTerminalGuard";
        if (element.dataset[marker] === "armed") return true;
        const block = (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        element.addEventListener("click", block, true);
        const form = element.form || element.closest("form");
        if (form) form.addEventListener("submit", block, true);
        element.dataset[marker] = "armed";
        return true;
      })
      .catch(() => false);
  }

  async capture(kind, metadata = {}) {
    if (this.evidenceSink) {
      return this.evidenceSink({
        kind,
        metadata,
        page: this.page,
      });
    }
    return `memory:evidence/${encodeURIComponent(kind)}/${Date.now()}`;
  }

  async rebaseline(url) {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.prepare();
  }
}
