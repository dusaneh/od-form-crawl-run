import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import {
  declaredAdvance,
  declaredFieldPlan,
  noAdvance,
  optionByLabel,
} from "../local/recon-scripts/script-helpers.mjs";
import { deterministicTestValue } from "../local/test-values.mjs";

const DECOY =
  /\b(?:newsletter|subscribe|site search|search this site|footer search|header search|chat widget)\b/i;
const INTERMEDIATE =
  /\b(?:next|continue|review|proceed|step|start|begin)\b/i;
const TERMINAL =
  /\b(?:submit|send|finish|complete|apply|enroll)\b/i;
const LOCAL_OVERRIDE_BLOCK =
  /\b(?:password|passcode|username|sign[- ]?in|log[- ]?in|credit|debit|card number|cvv|cvc|application fee|payment|bank|routing|captcha|verification|security challenge)\b/i;

function normalizedName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[\d*\]/g, "")
    .replace(/[_-]\d+$/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function descriptorText(control) {
  return [
    control.name,
    control.id,
    control.label,
    control.formText,
    control.sectionText,
  ]
    .filter(Boolean)
    .join(" ");
}

function expectedNameMatches(control, expectedNames) {
  const candidates = [control.name, control.id].map(normalizedName);
  return candidates.some((candidate) =>
    [...expectedNames].some(
      (expected) =>
        candidate === expected ||
        candidate.startsWith(`${expected}_`) ||
        expected.startsWith(`${candidate}_`)
    )
  );
}

function valueForSite(siteId, groundTruth, control, index) {
  const name = normalizedName(control.name || control.id);
  const otherParent = (groundTruth.expected_other_specify || []).find(
    (item) => normalizedName(item.parent_name) === name
  );
  if (otherParent) {
    const expectedValue = String(otherParent.other_value || "other");
    const options =
      control.type === "radio" ? control.groupOptions || [] : control.options || [];
    const exact = options.find(
      (option) =>
        !option.disabled &&
        String(option.value || "").toLowerCase() === expectedValue.toLowerCase()
    );
    return String(exact?.value || optionByLabel(control, /\bother\b/i));
  }
  if (
    siteId === "site_p_crosspage_echo" &&
    /\blast[_ ]?name\b/i.test(`${control.name || ""} ${control.label || ""}`)
  ) {
    return "Testerson";
  }
  if (
    siteId === "site_k_conditional" &&
    /\bdrive|transport/i.test(`${control.name || ""} ${control.label || ""}`)
  ) {
    return optionByLabel(control, /\bno\b|do not|cannot/i);
  }
  return deterministicTestValue(control, index);
}

async function prepareGatedFixture(page, onEvent) {
  const result = await page.evaluate(() => {
    const opened = [];
    for (const details of document.querySelectorAll("details:not([open])")) {
      details.open = true;
      opened.push(details.id || "details");
    }
    for (const button of document.querySelectorAll(
      'button[aria-expanded="false"][aria-controls]'
    )) {
      button.click();
      opened.push(button.id || button.textContent.trim().slice(0, 80));
    }
    const scrolled = [];
    for (const element of document.querySelectorAll("*")) {
      if (
        element.scrollHeight > element.clientHeight + 8 &&
        getComputedStyle(element).overflowY !== "visible"
      ) {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
        scrolled.push(element.id || element.tagName);
      }
    }
    return { opened, scrolled };
  });
  for (const frame of page.frames().slice(1)) {
    await frame
      .evaluate(() => {
        for (const element of document.querySelectorAll("*")) {
          if (element.scrollHeight > element.clientHeight + 8) {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event("scroll", { bubbles: true }));
          }
        }
      })
      .catch(() => {});
  }
  await onEvent?.(
    "fixture_prepare_page_completed",
    "Applied the site-specific gated-content preparation plan.",
    result
  );
}

export function createCorpusReconScript(groundTruth) {
  const siteId = groundTruth.site_id;
  const expectedNames = new Set(
    (groundTruth.fields || []).map((field) => normalizedName(field.name))
  );
  const absentNames = new Set(
    (groundTruth.expected_absent_field_names || []).map(normalizedName)
  );
  const branchParents = new Set(
    (groundTruth.expected_other_specify || []).map((item) =>
      normalizedName(item.parent_name)
    )
  );
  const abortKind = String(groundTruth.expected_abort || "");
  const accessBarrier =
    Boolean(groundTruth.requires_login) ||
    (groundTruth.expected_red_flag_codes || []).some((code) =>
      ["payment_field", "interactive_captcha", "login_required"].includes(code)
    );

  return {
    id: `localhost-corpus:${siteId}`,
    version: 1,
    target: groundTruth.intake_url,
    contractFromObserved: true,
    contractFilter(field) {
      if (siteId !== "site_ab_decoy_forms") return true;
      return (
        !absentNames.has(normalizedName(field.name || field.id)) &&
        expectedNameMatches(field, expectedNames)
      );
    },
    matches(url, { allowLoopback = false } = {}) {
      if (!allowLoopback) return false;
      const parsed = new URL(url);
      return (
        ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
        parsed.pathname.startsWith(`/${siteId}/`)
      );
    },
    async preparePage({ page, onEvent }) {
      if (siteId === "site_l_gated") {
        await prepareGatedFixture(page, onEvent);
      }
    },
    async detectCrossPageDependency({ page, enteredValues }) {
      if (abortKind !== "cross_page_branching") return { detected: false };
      const text = await page.locator("body").innerText().catch(() => "");
      if (
        /\b(?:because you said|given that you selected|you indicated|based on your (?:answer|selection))\b/i.test(
          text
        )
      ) {
        return {
          detected: true,
          label: "Conditional phrasing on later page",
          reason:
            "The later page explicitly conditions its questions on an earlier synthetic answer.",
        };
      }
      const echoed = enteredValues.find(({ value }) => {
        const candidate = String(value || "").trim();
        return (
          candidate.length >= 6 &&
          /[a-z]/i.test(candidate) &&
          !/^(?:formweave|tester|testville|california)$/i.test(candidate) &&
          text.includes(candidate)
        );
      });
      return echoed
        ? {
            detected: true,
            label: "Distinctive earlier value echoed on later page",
            reason: `The later page echoed the distinctive synthetic value for ${echoed.label}.`,
          }
        : { detected: false };
    },
    planState({ controls, advances, progressText, settings }) {
      const scoredForms = new Map();
      for (const control of controls) {
        if (!expectedNameMatches(control, expectedNames)) continue;
        const formId = control.formId || "";
        scoredForms.set(formId, (scoredForms.get(formId) || 0) + 1);
      }
      const selectedFormId = [...scoredForms.entries()].sort(
        (left, right) => right[1] - left[1]
      )[0]?.[0];
      const fieldPlan = declaredFieldPlan(controls, {
        include: (control) => {
          const name = normalizedName(control.name || control.id);
          if (
            siteId === "site_ab_decoy_forms" &&
            control.formId !== selectedFormId
          ) {
            return false;
          }
          if (absentNames.has(name)) return false;
          if (DECOY.test(descriptorText(control))) return false;
          if (siteId === "site_ab_decoy_forms") {
            return expectedNameMatches(control, expectedNames);
          }
          return true;
        },
        valueFor: (control, index) =>
          valueForSite(siteId, groundTruth, control, index),
        branch: (control) => {
          const name = normalizedName(control.name || control.id);
          if (branchParents.has(name)) return true;
          return (
            ["branching", "probe_actuation_failed"].includes(abortKind) &&
            ["select", "radio", "checkbox", "switch"].includes(control.type) &&
            !/\b(?:agree|consent|certif|confirm)\b/i.test(
              descriptorText(control)
            )
          );
        },
        maxBranchOptions: settings.maxBranchOptionsPerControl,
        allowHumanReview: (control) => {
          if (accessBarrier) return false;
          if (!expectedNameMatches(control, expectedNames)) return false;
          if (["file", "password"].includes(control.type)) return false;
          return !LOCAL_OVERRIDE_BLOCK.test(descriptorText(control));
        },
      });
      const source = `script:localhost-corpus:${siteId}@1`;
      if (accessBarrier) {
        return {
          source,
          ...fieldPlan,
          advance: {
            ...noAdvance(
              "The fixture ground truth declares a login, payment, or human-verification barrier."
            ),
            classification: "review",
            failureCode: "could_not_test",
          },
        };
      }
      if (
        abortKind === "probe_actuation_failed" &&
        !controls.some(
          (control) =>
            expectedNameMatches(control, expectedNames) &&
            ["select", "radio", "checkbox", "switch"].includes(control.type)
        )
      ) {
        return {
          source,
          ...fieldPlan,
          advance: {
            ...noAdvance(
              "A declared choice field was present in source extraction but had no resolvable rendered control."
            ),
            classification: "review",
            failureCode: "locator_unresolved",
          },
        };
      }
      return {
        source,
        ...fieldPlan,
        haltAfterBranchProbe: ["branching", "probe_actuation_failed"].includes(
          abortKind
        ),
        branchHaltReason:
          abortKind === "probe_actuation_failed"
            ? "The fixture requires a loud halt when its choice control cannot be actuated."
            : "The fixture ground truth requires a review halt after same-page branching is detected.",
        advance: declaredAdvance(advances, {
          intermediate: INTERMEDIATE,
          terminal: TERMINAL,
          progressText,
          prefer: (advance) =>
            !DECOY.test(advance.formText || "") &&
            (siteId !== "site_ab_decoy_forms" ||
              advance.formId === selectedFormId),
        }),
      };
    },
  };
}

export async function discoverCorpusOrigin() {
  for (let port = 9000; port <= 9099; port += 1) {
    const origin = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${origin}/registry`, {
        signal: AbortSignal.timeout(300),
      });
      const registry = await response.json();
      if (response.ok && registry?.sites?.site_a_shelter) return origin;
    } catch {}
  }
  throw new Error(
    "The localhost test-site server was not found on ports 9000-9099. Run localhost-test-sites/start-test-server.bat first."
  );
}

export async function loadGroundTruthCorpus(
  root = process.env.LOCALHOST_TEST_SITES_ROOT ||
    "C:\\pp2\\scraper\\test_sites",
  origin
) {
  const entries = await readdir(root, { withFileTypes: true });
  const grounds = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("site_")) continue;
    const groundTruth = YAML.parse(
      await readFile(path.join(root, entry.name, "ground_truth.yaml"), "utf8")
    );
    const sourceUrl = new URL(groundTruth.intake_url);
    const targetUrl = new URL(sourceUrl.pathname, origin).toString();
    grounds.push({
      ...groundTruth,
      targetUrl,
      sourcePath: path.join(root, entry.name, "ground_truth.yaml"),
    });
  }
  return grounds.sort((left, right) =>
    left.site_id.localeCompare(right.site_id)
  );
}

export function scoreCorpusRun(groundTruth, output) {
  const pages = output.pages;
  const actions = pages.flatMap((page) => page.automationActions || []);
  const fields = output.contract;
  const names = new Set(
    fields.map((field) => normalizedName(field.name || field.id))
  );
  const expectedNames = (groundTruth.fields || []).map((field) =>
    normalizedName(field.name)
  );
  const missingFields = expectedNames.filter(
    (expected) =>
      ![...names].some(
        (actual) =>
          actual === expected ||
          actual.startsWith(`${expected}_`) ||
          expected.startsWith(`${actual}_`)
      )
  );
  const unexpectedDecoys = (groundTruth.expected_absent_field_names || []).filter(
    (name) => names.has(normalizedName(name))
  );
  const submissionsAttempted = pages.reduce(
    (sum, page) => sum + (page.submissionsAttempted || 0),
    0
  );
  const submissionsSucceeded = pages.reduce(
    (sum, page) => sum + (page.submissionsSucceeded || 0),
    0
  );
  const branchStates = pages.reduce(
    (sum, page) => sum + (page.branchStates || 0),
    0
  );
  const entryFailures = pages.reduce(
    (sum, page) => sum + (page.entryFailures || 0),
    0
  );
  const abortKind = String(groundTruth.expected_abort || "");
  const flags = groundTruth.expected_red_flag_codes || [];
  const interactiveCaptcha =
    flags.includes("interactive_captcha") ||
    (groundTruth.has_captcha &&
      !groundTruth.site_id.includes("invisible_captcha"));
  const accessBarrier =
    groundTruth.requires_login ||
    flags.includes("payment_field") ||
    interactiveCaptcha;
  const ambiguous = flags.includes("ambiguous_submit");
  const expectedSubmit =
    !abortKind && !accessBarrier && !ambiguous;

  let behaviorPassed = false;
  if (expectedSubmit) {
    behaviorPassed =
      submissionsAttempted === 1 && submissionsSucceeded === 1;
  } else if (interactiveCaptcha) {
    behaviorPassed =
      pages.some((page) => page.captchaDetected) &&
      submissionsAttempted === 0;
  } else if (abortKind === "cross_page_branching") {
    behaviorPassed =
      actions.some(
        (action) =>
          action.error &&
          /cross-page|later page|echoed/i.test(
            `${action.label || ""} ${action.error}`
          )
      ) && submissionsAttempted === 0;
  } else if (abortKind === "branching") {
    behaviorPassed = branchStates > 0 && submissionsAttempted === 0;
  } else if (abortKind === "probe_actuation_failed") {
    behaviorPassed =
      actions.some((action) => action.outcome === "could_not_test") &&
      submissionsAttempted === 0;
  } else {
    behaviorPassed = submissionsAttempted === 0;
  }

  const inventoryRequired =
    !abortKind && !interactiveCaptcha && !groundTruth.requires_login;
  const inventoryPassed =
    !inventoryRequired ||
    (missingFields.length === 0 && unexpectedDecoys.length === 0);
  return {
    siteId: groundTruth.site_id,
    targetUrl: groundTruth.targetUrl,
    expectedSubmit,
    behaviorPassed,
    inventoryPassed,
    passed: behaviorPassed && inventoryPassed,
    expectedFields: expectedNames.length,
    observedFields: names.size,
    missingFields,
    unexpectedDecoys,
    branchStates,
    entryFailures,
    submissionsAttempted,
    submissionsSucceeded,
    captchaDetected: pages.some((page) => page.captchaDetected),
    finalSubmission: pages.map((page) => page.finalSubmission),
    certifications: pages.map((page) => page.certificationStatus),
  };
}
