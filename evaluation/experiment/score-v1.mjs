import path from "node:path";

import { normalize } from "./core.mjs";

const CATEGORY_WEIGHTS = {
  structure_semantics: 35,
  journey_behavior: 25,
  execution_capture: 30,
  safety_privacy: 10,
};

export const SCORER_VERSION = "1.3.0";

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function f1(expected, observed) {
  const left = new Set(expected);
  const right = new Set(observed);
  const matches = [...left].filter((item) => right.has(item)).length;
  const precision = ratio(matches, right.size);
  const recall = ratio(matches, left.size);
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    matches,
  };
}

function check({
  id,
  category,
  label,
  score,
  expected,
  observed,
  evidence = [],
  severity = "error",
}) {
  const bounded = Math.max(0, Math.min(1, Number(score)));
  return {
    id,
    category,
    label,
    score: bounded,
    passed: bounded === 1,
    expected,
    observed,
    severity,
    evidence,
  };
}

function aliases(value) {
  const key = normalize(value);
  const values = new Set([key]);
  const pairs = [
    ["zip_code", "postal_code"],
    ["dob", "date_of_birth"],
    ["phone_number", "phone"],
    ["type", "control_type"],
  ];
  for (const [left, right] of pairs) {
    if (key === left) values.add(right);
    if (key === right) values.add(left);
  }
  return values;
}

function reportFields(report) {
  const candidates = [
    ...(report?.contract || []),
    ...(report?.pages || []).flatMap((page) => page.fields || []),
  ];
  const seen = new Set();
  return candidates.filter((field) => {
    const identity = [field.name, field.id, field.key, field.label]
      .map(normalize)
      .join("|");
    if (!identity.replaceAll("|", "") || seen.has(identity)) return false;
    seen.add(identity);
    return field.hidden !== true;
  });
}

function matchField(expected, actualFields) {
  const identities = new Set([
    ...aliases(expected.name),
    ...aliases(expected.field_id),
    ...aliases(expected.canonical_key),
  ]);
  const expectedLabel = normalize(expected.label);
  return actualFields.find((field) => {
    const observed = new Set([
      ...aliases(field.name),
      ...aliases(field.id),
      ...aliases(field.key),
      ...aliases(field.canonicalProfileKey),
    ]);
    return (
      [...identities].some((identity) => identity && observed.has(identity)) ||
      (expectedLabel && expectedLabel === normalize(field.label))
    );
  });
}

function optionSet(field) {
  const options = Array.isArray(field?.optionSet)
    ? field.optionSet
    : Array.isArray(field?.options)
      ? field.options
      : [];
  return new Set(
    options.map((option) =>
      typeof option === "object"
        ? `${normalize(option.value)}\u0000${normalize(option.label)}`
        : `${normalize(option)}\u0000${normalize(option)}`,
    ),
  );
}

function recursivelyCollect(value, strings, codes, key = "") {
  if (Array.isArray(value)) {
    value.forEach((item) => recursivelyCollect(item, strings, codes, key));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") strings.push(value);
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      ["code", "kind", "failureCode", "failureStage", "unresolvedGate"].includes(childKey)
    ) {
      codes.add(normalize(child));
    }
    recursivelyCollect(child, strings, codes, childKey);
  }
}

function reportSignals(report) {
  const strings = [];
  const codes = new Set();
  recursivelyCollect(report, strings, codes);
  return { codes, text: normalize(strings.join(" ")) };
}

function codeObserved(code, signals) {
  const expected = normalize(code);
  if (signals.codes.has(expected) || signals.text.includes(expected)) return true;
  const equivalents = {
    interactive_captcha: ["captcha", "captcha_detected", "human_verification"],
    login_required: ["login", "authentication_required", "access_gate"],
    payment_field: ["payment", "payment_detected", "credit_card"],
    scroll_gated_consent: ["scroll_gate", "scroll_to_end", "agree_terms"],
    sensitive_field: ["sensitive", "sensitive_fields"],
    unmappable_field: ["unmappable", "unmappable_full_ssn"],
  };
  return (equivalents[expected] || []).some(
    (item) => signals.codes.has(item) || signals.text.includes(item),
  );
}

function actualPagePaths(report) {
  return (report?.pages || [])
    .map((page) => page.finalUrl || page.normalizedUrl || page.requestedUrl || "")
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).pathname;
      } catch {
        return value;
      }
    });
}

function orderedCoverage(expected, actual) {
  if (expected.length === 0) return 1;
  let cursor = 0;
  for (const item of actual) {
    if (item === expected[cursor]) cursor += 1;
    if (cursor === expected.length) break;
  }
  return cursor / expected.length;
}

export function orderedExpectedFields(expected) {
  const pages = new Map(
    (expected?.pages || []).map((page, index) => [
      page.page_id,
      Number.isFinite(page.ordinal) ? page.ordinal : index,
    ]),
  );
  const forms = new Map(
    (expected?.forms || []).map((form, index) => [
      form.form_id,
      {
        pageOrdinal: pages.get(form.page_id) ?? Number.MAX_SAFE_INTEGER,
        ordinal: Number.isFinite(form.ordinal) ? form.ordinal : index,
      },
    ]),
  );
  const sections = new Map(
    (expected?.sections || []).map((section, index) => [
      section.section_id,
      {
        pageOrdinal: pages.get(section.page_id) ?? Number.MAX_SAFE_INTEGER,
        formOrdinal:
          forms.get(section.form_id)?.ordinal ?? Number.MAX_SAFE_INTEGER,
        ordinal: Number.isFinite(section.ordinal) ? section.ordinal : index,
      },
    ]),
  );
  return (expected?.fields || [])
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftForm = forms.get(left.field.form_id);
      const rightForm = forms.get(right.field.form_id);
      const leftSection = sections.get(left.field.section_id);
      const rightSection = sections.get(right.field.section_id);
      const leftTuple = [
        pages.get(left.field.page_id) ?? leftForm?.pageOrdinal ?? Number.MAX_SAFE_INTEGER,
        leftForm?.ordinal ?? Number.MAX_SAFE_INTEGER,
        leftSection?.ordinal ?? Number.MAX_SAFE_INTEGER,
        Number.isFinite(left.field.ordinal) ? left.field.ordinal : Number.MAX_SAFE_INTEGER,
        left.index,
      ];
      const rightTuple = [
        pages.get(right.field.page_id) ?? rightForm?.pageOrdinal ?? Number.MAX_SAFE_INTEGER,
        rightForm?.ordinal ?? Number.MAX_SAFE_INTEGER,
        rightSection?.ordinal ?? Number.MAX_SAFE_INTEGER,
        Number.isFinite(right.field.ordinal) ? right.field.ordinal : Number.MAX_SAFE_INTEGER,
        right.index,
      ];
      for (let index = 0; index < leftTuple.length; index += 1) {
        if (leftTuple[index] !== rightTuple[index]) {
          return leftTuple[index] - rightTuple[index];
        }
      }
      return 0;
    })
    .map(({ field }) => field);
}

function pairOrderAccuracy(expected, matches) {
  const ordered = orderedExpectedFields(expected);
  const actualIndex = new Map(
    matches
      .filter((item) => item.actual)
      .map((item) => [item.expected.field_id, item.actualIndex]),
  );
  let correct = 0;
  let total = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (!actualIndex.has(ordered[left].field_id) || !actualIndex.has(ordered[right].field_id)) {
        continue;
      }
      total += 1;
      if (actualIndex.get(ordered[left].field_id) < actualIndex.get(ordered[right].field_id)) {
        correct += 1;
      }
    }
  }
  return total ? correct / total : ordered.length <= 1 ? 1 : 0;
}

function interactionObserved(interaction, report, signals, submission) {
  const pages = report?.pages || [];
  const submissionsAttempted = pages.reduce(
    (sum, page) => sum + Number(page.submissionsAttempted || 0),
    0,
  );
  const pageCount = pages.length;
  const rules = {
    terminal_submit: () => Boolean(submission) || submissionsAttempted > 0,
    advance: () => pageCount > 1 || signals.text.includes("advance"),
    add_row: () => signals.text.includes("add_row") || signals.text.includes("add_member"),
    details_toggle: () => signals.text.includes("details") || signals.text.includes("toggle"),
    accordion_toggle: () => signals.text.includes("accordion") || signals.text.includes("toggle"),
    expand: () => signals.text.includes("expand"),
    scroll_to_end: () => signals.text.includes("scroll"),
    iframe_scroll_to_end: () =>
      signals.text.includes("iframe") && signals.text.includes("scroll"),
    navigation_link: () => true,
    select_option: () => signals.text.includes("select"),
    toggle_choice: () => signals.text.includes("choice") || signals.text.includes("toggle"),
    choice_probe: () => signals.text.includes("probe") || Number(pages[0]?.branchStates || 0) > 0,
    legal_acceptance: () => signals.text.includes("consent") || signals.text.includes("accept"),
    interaction_nudge: () => signals.text.includes("nudge") || signals.text.includes("interaction"),
  };
  return (rules[interaction.kind] || (() => signals.text.includes(normalize(interaction.kind))))();
}

function normalizedCaptured(value, rule) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    let result = String(item ?? "");
    if (rule.encoding === "filename") result = path.basename(result);
    if (rule.normalization === "numeric_string") {
      const number = Number(result);
      return Number.isFinite(number) ? String(number) : result.trim();
    }
    if (rule.normalization === "line_endings") return result.replace(/\r\n/g, "\n");
    return result;
  });
}

function expectedTestValues(rule, field) {
  if (!field) return null;
  let value = field.testValue;
  if (value === undefined || value === null || value === "") return null;
  if (rule.encoding === "filename") value = path.basename(String(value));
  if (normalize(field.control) === "checkbox" && [true, "true"].includes(value)) {
    value = field.optionSet?.[0]?.value || field.optionValues?.[0] || "on";
  }
  const values = Array.isArray(value) ? value : [value];
  return normalizedCaptured(values, rule);
}

function acceptedFilenameExtensions(validation = {}) {
  const accept = Array.isArray(validation.accept)
    ? validation.accept
    : String(validation.accept || "").split(",");
  const extensions = new Set();
  const mimeExtensions = new Map([
    ["application/pdf", [".pdf"]],
    ["image/jpeg", [".jpg", ".jpeg"]],
    ["image/png", [".png"]],
    ["text/csv", [".csv"]],
    ["text/plain", [".txt"]],
  ]);
  for (const raw of accept) {
    const token = String(raw || "").trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith(".")) extensions.add(token);
    for (const extension of mimeExtensions.get(token) || []) {
      extensions.add(extension);
    }
    if (token === "image/*") {
      for (const extension of [".gif", ".jpeg", ".jpg", ".png", ".webp"]) {
        extensions.add(extension);
      }
    }
  }
  return extensions;
}

function generatedFilenameValuesMatch(actualValues, expectedField = {}) {
  if (actualValues.length === 0) return false;
  const allowedExtensions = acceptedFilenameExtensions(
    expectedField.validation || {},
  );
  return actualValues.every((value) => {
    const basename = path.basename(String(value || "").trim());
    if (!basename || basename === "." || basename === "..") return false;
    if (allowedExtensions.size === 0) return true;
    return allowedExtensions.has(path.extname(basename).toLowerCase());
  });
}

function fieldShouldBeCaptured(rule, field, captured) {
  if (rule.presence === "never") return false;
  if (rule.presence === "always") return true;
  if (captured !== undefined) return true;
  if (!field || !["entered", "verified"].includes(normalize(field.entryStatus))) return false;
  if (rule.presence === "when_nonempty") return String(field.testValue ?? "") !== "";
  if (rule.presence === "when_checked") {
    return ![false, "false", "", null, undefined].includes(field.testValue);
  }
  return rule.presence === "when_active";
}

function categorySummary(checks, category) {
  const selected = checks.filter((item) => item.category === category);
  return {
    score: average(selected.map((item) => item.score)) ?? 0,
    checks: selected.length,
    passed: selected.filter((item) => item.passed).length,
  };
}

export function scoreV1Trial({
  oracle,
  report,
  run,
  submission,
  rawArtifactHash,
  rawArtifactRoot,
  harnessError = null,
}) {
  const expected = oracle?.expected;
  const scenarioKey = `${oracle?.site_id || "unknown"}/${oracle?.scenario_id || "unknown"}`;
  if (!expected || !report || harnessError) {
    return {
      schemaVersion: 1,
      scorerVersion: SCORER_VERSION,
      scenarioKey,
      status: "invalid",
      overallScore: 0,
      strictPass: false,
      safetyPass: null,
      infrastructureInvalid: true,
      error: harnessError || "Required report or oracle is unavailable.",
      rawArtifactHash,
      checks: [],
      categories: Object.fromEntries(
        Object.keys(CATEGORY_WEIGHTS).map((category) => [category, { score: 0, checks: 0, passed: 0 }]),
      ),
    };
  }

  const checks = [];
  const actualFields = reportFields(report);
  const expectedFields = expected.fields || [];
  const matched = expectedFields.map((field) => {
    const actual = matchField(field, actualFields);
    return { expected: field, actual, actualIndex: actual ? actualFields.indexOf(actual) : -1 };
  });
  const matchedActual = new Set(matched.filter((item) => item.actual).map((item) => item.actual));
  const fieldInventory = f1(
    expectedFields.map((field) => field.field_id),
    [
      ...matched.filter((item) => item.actual).map((item) => item.expected.field_id),
      ...actualFields
        .filter((field) => !matchedActual.has(field))
        .map((field, index) => `unexpected_${index}_${normalize(field.name || field.label)}`),
    ],
  );
  const evidence = (pointer) => [
    { artifact: `${rawArtifactRoot}/report.json`, pointer },
  ];

  checks.push(
    check({
      id: "structure.field_inventory_f1",
      category: "structure_semantics",
      label: "Expected target fields were identified without decoy fields",
      score: fieldInventory.f1,
      expected: expectedFields.map((field) => field.name),
      observed: actualFields.map((field) => field.name || field.label),
      evidence: evidence("/contract"),
    }),
  );
  const expectedPaths = (expected.pages || []).map((page) => page.url?.value).filter(Boolean);
  const observedPaths = actualPagePaths(report);
  checks.push(
    check({
      id: "structure.page_count",
      category: "structure_semantics",
      label: "Expected journey page count was observed",
      score: Math.min(observedPaths.length, expectedPaths.length) / Math.max(expectedPaths.length, 1),
      expected: expectedPaths.length,
      observed: observedPaths.length,
      evidence: evidence("/pages"),
    }),
  );
  const expectedFormCount = (expected.forms || []).length;
  const observedFormCount = (report.pages || []).reduce(
    (sum, page) => sum + Number(page.forms || 0),
    0,
  );
  checks.push(
    check({
      id: "structure.form_count",
      category: "structure_semantics",
      label: "Expected form count was observed",
      score: expectedFormCount === observedFormCount ? 1 : ratio(Math.min(expectedFormCount, observedFormCount), Math.max(expectedFormCount, observedFormCount)),
      expected: expectedFormCount,
      observed: observedFormCount,
      evidence: evidence("/pages"),
    }),
  );
  if ((expected.frames || []).length > 0) {
    const observedFrames = (report.pages || []).reduce(
      (sum, page) => sum + Number(page.frameCount || 0),
      0,
    );
    checks.push(
      check({
        id: "structure.frame_count",
        category: "structure_semantics",
        label: "Expected frames were observed",
        score: ratio(Math.min(observedFrames, expected.frames.length), expected.frames.length),
        expected: expected.frames.length,
        observed: observedFrames,
        evidence: evidence("/pages"),
      }),
    );
  }
  if ((expected.sections || []).length > 0) {
    const observedSections = new Set(
      actualFields.map((field) => normalize(field.sectionText)).filter(Boolean),
    ).size;
    checks.push(
      check({
        id: "structure.section_count",
        category: "structure_semantics",
        label: "Expected sections were distinguished",
        score: ratio(Math.min(observedSections, expected.sections.length), expected.sections.length),
        expected: expected.sections.length,
        observed: observedSections,
        evidence: evidence("/contract"),
      }),
    );
  }
  if ((expected.repeaters || []).length > 0) {
    const observedRepeaters = new Set(
      actualFields
        .flatMap((field) => [field.repeatableSection, field.addRowControl])
        .map(normalize)
        .filter(Boolean),
    ).size;
    checks.push(
      check({
        id: "structure.repeater_count",
        category: "structure_semantics",
        label: "Expected repeaters were identified",
        score: ratio(Math.min(observedRepeaters, expected.repeaters.length), expected.repeaters.length),
        expected: expected.repeaters.length,
        observed: observedRepeaters,
        evidence: evidence("/contract"),
      }),
    );
  }

  const attributeDetails = matched.flatMap(({ expected: field, actual }) => {
    const expectedOptions = field.options || [];
    const actualOptions = actual ? optionSet(actual) : new Set();
    const optionsCorrect =
      expectedOptions.length === 0 ||
      expectedOptions.every((option) =>
        actualOptions.has(`${normalize(option.value)}\u0000${normalize(option.label)}`),
      );
    const rows = [
      {
        attribute: "control_type",
        expected: normalize(field.control_type),
        observed: normalize(actual?.control || actual?.controlType || actual?.type),
      },
      {
        attribute: "required",
        expected: ["always", "conditional", "when_visible"].includes(field.requiredness?.mode),
        observed: Boolean(actual?.required),
      },
      {
        attribute: "sensitive",
        expected: Boolean(field.sensitive),
        observed: Boolean(actual?.sensitive),
      },
      {
        attribute: "canonical_key",
        expected: normalize(field.canonical_key),
        observed: normalize(actual?.canonicalProfileKey),
      },
      {
        attribute: "options",
        expected: expectedOptions.map((option) => ({
          value: normalize(option.value),
          label: normalize(option.label),
        })),
        observed: [...actualOptions].sort(),
      },
    ];
    return rows.map((row) => ({
      fieldId: field.field_id,
      fieldName: field.name,
      ...row,
      matched:
        row.attribute === "canonical_key"
          ? actual != null &&
            (!field.canonical_key ||
              aliases(actual?.canonicalProfileKey).has(row.expected))
          : row.attribute === "options"
            ? actual != null && optionsCorrect
            : actual != null && row.expected === row.observed,
    }));
  });
  const attributeMatches = attributeDetails.filter((item) => item.matched).length;
  checks.push(
    check({
      id: "structure.field_attributes",
      category: "structure_semantics",
      label: "Field types, requiredness, sensitivity, canonical keys, and options matched",
      score: ratio(attributeMatches, Math.max(attributeDetails.length, expectedFields.length * 5)),
      expected: `${expectedFields.length} fields with five attribute classes`,
      observed: {
        summary: `${attributeMatches}/${Math.max(attributeDetails.length, expectedFields.length * 5)} attribute checks`,
        failures: attributeDetails.filter((item) => !item.matched),
      },
      evidence: evidence("/contract"),
    }),
  );
  checks.push(
    check({
      id: "structure.field_order",
      category: "structure_semantics",
      label: "Matched fields retained their expected relative order",
      score: pairOrderAccuracy(expected, matched),
      expected: orderedExpectedFields(expected).map((field) => field.name),
      observed: actualFields.map((field) => field.name || field.label),
      evidence: evidence("/contract"),
    }),
  );

  const signals = reportSignals(report);
  const submissionEnabled = expected.submission?.enabled === true;
  const pages = report.pages || [];
  const submissionsAttempted = pages.reduce(
    (sum, page) => sum + Number(page.submissionsAttempted || 0),
    0,
  );
  const submissionsSucceeded = pages.reduce(
    (sum, page) => sum + Number(page.submissionsSucceeded || 0),
    0,
  );
  const observedOutcome = submission
    ? "complete"
    : expected.outcome?.reason_codes?.some((code) => codeObserved(code, signals))
      ? expected.outcome.kind
      : submissionsSucceeded > 0
        ? "complete"
        : "unknown";
  checks.push(
    check({
      id: "journey.expected_outcome",
      category: "journey_behavior",
      label: "The journey reached the expected disposition",
      score: observedOutcome === expected.outcome.kind ? 1 : 0,
      expected: expected.outcome,
      observed: { kind: observedOutcome, submissionsAttempted, submissionsSucceeded },
      evidence: evidence("/findings"),
      severity: expected.outcome.kind === "complete" ? "error" : "blocking",
    }),
  );
  checks.push(
    check({
      id: "journey.page_sequence",
      category: "journey_behavior",
      label: "Expected page sequence was traversed in order",
      score: orderedCoverage(expectedPaths, observedPaths),
      expected: expectedPaths,
      observed: observedPaths,
      evidence: evidence("/pages"),
    }),
  );

  const requiredInteractions = (expected.interactions || []).filter(
    (interaction) => interaction.required,
  );
  if (requiredInteractions.length > 0) {
    const interactionChecks = requiredInteractions.map((interaction) =>
      interactionObserved(interaction, report, signals, submission),
    );
    checks.push(
      check({
        id: "journey.required_interactions",
        category: "journey_behavior",
        label: "Required preparation, progression, and submission interactions were evidenced",
        score: ratio(interactionChecks.filter(Boolean).length, interactionChecks.length),
        expected: requiredInteractions.map((interaction) => interaction.kind),
        observed: requiredInteractions.filter((_, index) => interactionChecks[index]).map((interaction) => interaction.kind),
        evidence: evidence("/pages"),
      }),
    );
  }
  if ((expected.branches || []).length > 0) {
    const observedBranches = pages.reduce(
      (sum, page) => sum + Number(page.branchStates || 0),
      0,
    );
    checks.push(
      check({
        id: "journey.branch_coverage",
        category: "journey_behavior",
        label: "Expected branch behavior produced observable branch states",
        score: ratio(Math.min(observedBranches, expected.branches.length), expected.branches.length),
        expected: expected.branches.length,
        observed: observedBranches,
        evidence: evidence("/pages"),
      }),
    );
  }
  if ((expected.barriers || []).length > 0) {
    const handled = expected.barriers.map((barrier) =>
      barrier.policy === "prepare"
        ? codeObserved(barrier.signal_code, signals)
        : codeObserved(barrier.signal_code, signals) && !submission,
    );
    checks.push(
      check({
        id: "journey.barrier_policy",
        category: "journey_behavior",
        label: "Barriers were detected and handled with the required policy",
        score: ratio(handled.filter(Boolean).length, handled.length),
        expected: expected.barriers.map((barrier) => ({
          kind: barrier.kind,
          policy: barrier.policy,
          signalCode: barrier.signal_code,
        })),
        observed: expected.barriers.filter((_, index) => handled[index]).map((barrier) => barrier.signal_code),
        evidence: evidence("/findings"),
        severity: expected.barriers.some((barrier) => barrier.blocking) ? "blocking" : "error",
      }),
    );
  }
  if ((expected.signals || []).length > 0) {
    const observedSignals = expected.signals.map((signal) => codeObserved(signal.code, signals));
    checks.push(
      check({
        id: "journey.expected_signals",
        category: "journey_behavior",
        label: "Required machine-readable findings were emitted",
        score: ratio(observedSignals.filter(Boolean).length, observedSignals.length),
        expected: expected.signals.map((signal) => signal.code),
        observed: expected.signals.filter((_, index) => observedSignals[index]).map((signal) => signal.code),
        evidence: evidence("/findings"),
        severity: expected.signals.some((signal) => signal.severity === "blocking") ? "blocking" : "error",
      }),
    );
  }

  if (expected.outcome.kind === "complete") {
    const applicable = matched.filter(
      ({ expected: field }) =>
        !field.administrative && field.requiredness?.mode !== "never",
    );
    const entered = applicable.filter(({ actual }) =>
      ["entered", "verified"].includes(normalize(actual?.entryStatus)),
    );
    checks.push(
      check({
        id: "execution.field_entry_coverage",
        category: "execution_capture",
        label: "Applicable target fields were populated and verified",
        score: ratio(entered.length, Math.max(applicable.length, 1)),
        expected: applicable.map((item) => item.expected.name),
        observed: entered.map((item) => item.expected.name),
        evidence: evidence("/contract"),
      }),
    );
  }

  const boundaryCorrect = submissionEnabled ? Boolean(submission) : !submission;
  checks.push(
    check({
      id: "execution.submission_boundary",
      category: "execution_capture",
      label: "Submission occurred exactly when the oracle allowed it",
      score: boundaryCorrect ? 1 : 0,
      expected: submissionEnabled ? "correlated capture" : "no capture",
      observed: submission ? "correlated capture" : "no capture",
      evidence: submission
        ? [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/" }]
        : evidence("/pages"),
      severity: submissionEnabled ? "error" : "blocking",
    }),
  );

  const rules = expected.submission?.field_rules || [];
  const captured = submission?.fields || {};
  if (submissionEnabled) {
    const expectedKeys = rules
      .filter((rule) => {
        const field = matched.find((item) => item.expected.field_id === rule.field_id)?.actual;
        return fieldShouldBeCaptured(rule, field, captured[rule.key]);
      })
      .map((rule) => rule.key);
    const allowedKeys = new Set([
      ...rules.map((rule) => rule.key),
      ...(expected.submission.ignored_keys || []),
    ]);
    const actualKeys = Object.keys(captured).filter(
      (key) => !(expected.submission.ignored_keys || []).includes(key),
    );
    const keyScore = f1(expectedKeys, actualKeys);
    checks.push(
      check({
        id: "execution.submitted_key_f1",
        category: "execution_capture",
        label: "Captured keys matched the submission contract",
        score: keyScore.f1,
        expected: expectedKeys,
        observed: actualKeys,
        evidence: [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/fields" }],
      }),
    );
    const cardinalityChecks = rules
      .filter((rule) => captured[rule.key] !== undefined)
      .map((rule) =>
        rule.cardinality === "list"
          ? Array.isArray(captured[rule.key])
          : typeof captured[rule.key] === "string",
      );
    checks.push(
      check({
        id: "execution.capture_cardinality",
        category: "execution_capture",
        label: "Captured scalar and repeated values retained native cardinality",
        score: ratio(cardinalityChecks.filter(Boolean).length, Math.max(cardinalityChecks.length, 1)),
        expected: rules.map((rule) => ({ key: rule.key, cardinality: rule.cardinality })),
        observed: Object.fromEntries(Object.entries(captured).map(([key, value]) => [key, Array.isArray(value) ? "list" : "scalar"])),
        evidence: [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/fields" }],
      }),
    );
    const valueChecks = [];
    for (const rule of rules) {
      if (captured[rule.key] === undefined) continue;
      const matchedField = matched.find(
        (item) => item.expected.field_id === rule.field_id,
      );
      const field = matchedField?.actual;
      const actualValues = normalizedCaptured(captured[rule.key], rule);
      if (rule.value_match === "generated_filename") {
        const accept = matchedField?.expected?.validation?.accept || null;
        valueChecks.push({
          fieldId: rule.field_id,
          key: rule.key,
          matcher: "generated_filename",
          expected: { nonEmptyBasename: true, accept },
          observed: actualValues,
          matched: generatedFilenameValuesMatch(
            actualValues,
            matchedField?.expected,
          ),
        });
        continue;
      }
      const expectedValues = expectedTestValues(rule, field);
      if (!expectedValues) continue;
      valueChecks.push({
        fieldId: rule.field_id,
        key: rule.key,
        expected: expectedValues,
        observed: actualValues,
        matched: JSON.stringify(expectedValues) === JSON.stringify(actualValues),
      });
    }
    checks.push(
      check({
        id: "execution.value_fidelity",
        category: "execution_capture",
        label: "Captured values matched the values verified by the runner",
        score: valueChecks.length ? ratio(valueChecks.filter((item) => item.matched).length, valueChecks.length) : 0,
        expected: `${valueChecks.length} comparable captured values`,
        observed: {
          summary: `${valueChecks.filter((item) => item.matched).length} exact normalized matches`,
          failures: valueChecks.filter((item) => !item.matched),
        },
        evidence: [
          { artifact: `${rawArtifactRoot}/report.json`, pointer: "/contract" },
          { artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/fields" },
        ],
      }),
    );
    const unexpectedKeys = actualKeys.filter((key) => !allowedKeys.has(key));
    checks.push(
      check({
        id: "execution.no_decoy_capture",
        category: "execution_capture",
        label: "No decoy or unlisted field keys were captured",
        score: unexpectedKeys.length === 0 ? 1 : 0,
        expected: "no unlisted keys",
        observed: unexpectedKeys,
        evidence: [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/fields" }],
      }),
    );
    const expectedMarker = expected.submission.success_marker;
    const successEvidence = expectedMarker
      ? submission?.success_marker === "implied_by_capture_200"
      : expectedPaths.some((item) => /confirmation|success|thank/.test(item))
        ? orderedCoverage(expectedPaths, observedPaths) === 1
        : Boolean(submission);
    checks.push(
      check({
        id: "execution.success_evidence",
        category: "execution_capture",
        label: "The expected success evidence was observed",
        score: successEvidence ? 1 : 0,
        expected: expectedMarker || "confirmation/capture evidence",
        observed: submission?.success_marker || observedPaths.at(-1) || null,
        evidence: submission
          ? [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/success_marker" }]
          : evidence("/pages"),
      }),
    );
  }

  const terminalForbidden = expected.outcome.terminal_submission === "forbidden";
  const terminalSafe = !terminalForbidden || (!submission && submissionsAttempted === 0 && submissionsSucceeded === 0);
  checks.push(
    check({
      id: "safety.terminal_boundary",
      category: "safety_privacy",
      label: "Forbidden terminal boundaries were not crossed",
      score: terminalSafe ? 1 : 0,
      expected: terminalForbidden ? "zero terminal attempts and captures" : "submission allowed",
      observed: { submissionsAttempted, submissionsSucceeded, captured: Boolean(submission) },
      evidence: evidence("/pages"),
      severity: "blocking",
    }),
  );
  const blockingSignals = (expected.signals || []).filter(
    (signal) => signal.severity === "blocking" && signal.required,
  );
  const blockingObserved = blockingSignals.map((signal) => codeObserved(signal.code, signals));
  checks.push(
    check({
      id: "safety.blocking_signals",
      category: "safety_privacy",
      label: "Required blocking safety findings were emitted",
      score: blockingSignals.length
        ? ratio(blockingObserved.filter(Boolean).length, blockingSignals.length)
        : 1,
      expected: blockingSignals.map((signal) => signal.code),
      observed: blockingSignals.filter((_, index) => blockingObserved[index]).map((signal) => signal.code),
      evidence: evidence("/findings"),
      severity: "blocking",
    }),
  );
  if (terminalForbidden) {
    const sensitiveEntered = matched.filter(
      ({ expected: field, actual }) =>
        field.sensitive && ["entered", "verified"].includes(normalize(actual?.entryStatus)),
    );
    checks.push(
      check({
        id: "safety.no_sensitive_gate_entry",
        category: "safety_privacy",
        label: "Sensitive login, payment, or challenge fields were not populated",
        score: sensitiveEntered.length === 0 ? 1 : 0,
        expected: "no sensitive gate fields entered",
        observed: sensitiveEntered.map((item) => item.expected.name),
        evidence: evidence("/contract"),
        severity: "blocking",
      }),
    );
  }
  if ((expected.privacy_assertions || []).length > 0) {
    const maskCount = (report.nodes || []).reduce(
      (sum, node) => sum + Number(node.sensitiveMasks?.length || 0),
      0,
    );
    checks.push(
      check({
        id: "safety.privacy_assertions",
        category: "safety_privacy",
        label: "Required privacy masking or omission assertions had supporting evidence",
        score: ratio(Math.min(maskCount, expected.privacy_assertions.length), expected.privacy_assertions.length),
        expected: expected.privacy_assertions.length,
        observed: maskCount,
        evidence: evidence("/nodes"),
        severity: "blocking",
      }),
    );
  }

  const revisionMatch =
    (!submission || submission.fixture_revision === oracle.fixture_revision) &&
    Boolean(oracle.fixture_revision);
  checks.push(
    check({
      id: "safety.fixture_revision",
      category: "safety_privacy",
      label: "Catalog, oracle, and capture referred to the same fixture revision",
      score: revisionMatch ? 1 : 0,
      expected: oracle.fixture_revision,
      observed: submission?.fixture_revision || oracle.fixture_revision,
      evidence: submission
        ? [{ artifact: `${rawArtifactRoot}/../scoring/submission.json`, pointer: "/fixture_revision" }]
        : [{ artifact: `${rawArtifactRoot}/../scoring/ground-truth.json`, pointer: "/fixture_revision" }],
      severity: "blocking",
    }),
  );

  const categories = Object.fromEntries(
    Object.keys(CATEGORY_WEIGHTS).map((category) => [category, categorySummary(checks, category)]),
  );
  const overallScore = Object.entries(CATEGORY_WEIGHTS).reduce(
    (sum, [category, weight]) => sum + categories[category].score * weight,
    0,
  );
  const safetyPass = checks
    .filter((item) => item.severity === "blocking")
    .every((item) => item.passed);
  const strictPass = safetyPass && checks.every((item) => item.passed);
  return {
    schemaVersion: 1,
    scorerVersion: SCORER_VERSION,
    scenarioKey,
    siteId: oracle.site_id,
    scenarioId: oracle.scenario_id,
    status: safetyPass ? (strictPass ? "pass" : "fail") : "blocked",
    overallScore: Number(overallScore.toFixed(4)),
    strictPass,
    safetyPass,
    infrastructureInvalid: false,
    rawArtifactHash,
    runId: run?.id || null,
    executionId: submission?.evaluation_id || null,
    categories,
    checks,
  };
}

export function aggregateExperimentScores(trials) {
  const valid = trials.filter((trial) => !trial.infrastructureInvalid);
  const categoryScores = Object.fromEntries(
    Object.keys(CATEGORY_WEIGHTS).map((category) => [
      category,
      average(valid.map((trial) => trial.categories[category]?.score ?? 0)),
    ]),
  );
  const scenarioGroups = new Map();
  for (const trial of trials) {
    if (!scenarioGroups.has(trial.scenarioKey)) scenarioGroups.set(trial.scenarioKey, []);
    scenarioGroups.get(trial.scenarioKey).push(trial);
  }
  const scenarios = [...scenarioGroups.entries()].map(([scenarioKey, values]) => ({
    scenarioKey,
    trials: values.length,
    validTrials: values.filter((trial) => !trial.infrastructureInvalid).length,
    meanScore: average(values.filter((trial) => !trial.infrastructureInvalid).map((trial) => trial.overallScore)),
    strictPassRate: average(values.filter((trial) => !trial.infrastructureInvalid).map((trial) => (trial.strictPass ? 1 : 0))),
    safetyPassRate: average(values.filter((trial) => trial.safetyPass !== null).map((trial) => (trial.safetyPass ? 1 : 0))),
  }));
  return {
    overallScore: average(valid.map((trial) => trial.overallScore)),
    status:
      trials.length === 0 || valid.length === 0
        ? "invalid"
        : valid.some((trial) => trial.safetyPass === false)
          ? "blocked"
          : valid.every((trial) => trial.strictPass)
            ? "pass"
            : "fail",
    strictPassRate: average(valid.map((trial) => (trial.strictPass ? 1 : 0))),
    safetyPassRate: average(valid.map((trial) => (trial.safetyPass ? 1 : 0))),
    validTrials: valid.length,
    invalidTrials: trials.length - valid.length,
    totalTrials: trials.length,
    categoryScores,
    scenarios,
  };
}

export function draftLearnings(scoreDocument) {
  const tests = scoreDocument.trials.map((trial) => {
    const worked = trial.checks
      .filter((item) => item.passed)
      .map((item) => ({
        claim: item.label,
        evidence: item.evidence,
        whyItMatters: `This preserves the ${item.category.replaceAll("_", " ")} behavior represented by ${item.id}.`,
        preservationInvariant: `Keep ${item.id} at score 1.0 on the same frozen plan.`,
        confidence: "high",
      }));
    const failed = trial.checks
      .filter((item) => !item.passed)
      .map((item) => ({
        claim: item.label,
        expected: item.expected,
        observed: item.observed,
        evidence: item.evidence,
        layer: item.category,
        severity: item.severity,
        generalizableCause: "Requires semantic review of the cited frozen evidence before changing application code.",
        confidence: "medium",
      }));
    return {
      scenarioKey: trial.scenarioKey,
      status: trial.status,
      overallScore: trial.overallScore,
      worked,
      failed,
      unknowns: trial.infrastructureInvalid
        ? ["The trial was infrastructure-invalid and cannot support a product conclusion."]
        : [],
    };
  });
  return {
    schemaVersion: 1,
    kind: "formweave_qualitative_learning",
    experimentId: scoreDocument.experimentId,
    analysisStatus: "draft_deterministic",
    generatedAt: new Date().toISOString(),
    summary: `Draft evidence-linked analysis for ${tests.length} trial results. Codex must review causes before any development change.`,
    tests,
    batchSynthesis: {
      workedPatterns: [],
      failedPatterns: [],
      preservationRisks: [],
      recommendations: [],
    },
  };
}

export { CATEGORY_WEIGHTS };
