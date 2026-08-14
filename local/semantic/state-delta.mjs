export const STATE_DELTA_SCHEMA_VERSION = 4;

const BOOLEANISH = new Set(["true", "false", "yes", "no", "on", "off"]);

function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(" ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableEnteredValues(enteredValues = []) {
  return enteredValues
    .map((entry) => ({
      fieldKey: String(entry?.fieldKey || ""),
      label: String(entry?.label || entry?.fieldKey || ""),
      value: scalarText(entry?.value),
      sensitive: entry?.sensitive === true,
    }))
    .filter((entry) => {
      const value = normalized(entry.value);
      return value.length >= 2 && !BOOLEANISH.has(value);
    })
    .map((entry) => ({
      ...entry,
      dependencyDistinctive:
        normalized(entry.value).length >= 4 &&
        /[a-z]/i.test(normalized(entry.value)),
    }));
}

function comparableReadbackValues(enteredValues = []) {
  return enteredValues
    .map((entry) => ({
      fieldKey: String(entry?.fieldKey || ""),
      label: String(entry?.label || entry?.fieldKey || ""),
      value: scalarText(entry?.value),
      sensitive: entry?.sensitive === true,
    }))
    .filter((entry) => {
      const value = normalized(entry.value);
      return (
        value.length > 0 &&
        !BOOLEANISH.has(value) &&
        (value.length >= 2 || /^-?\d+(?:\.\d+)?$/.test(value))
      );
    });
}

function observationText(observation = {}) {
  return normalized(
    [
      observation.title,
      observation.heading,
      ...(observation.sections || []).map((item) => item?.rawText),
      ...(observation.guidance || []).map((item) => item?.rawText),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function observationRows(observation = {}) {
  return [
    { surface: "title", text: observation.title },
    { surface: "heading", text: observation.heading },
    ...(observation.sections || []).map((item) => ({
      surface: "section",
      text: item?.rawText || item?.label || item?.text,
    })),
    ...(observation.guidance || []).map((item) => ({
      surface: "guidance",
      text: item?.rawText || item?.label || item?.text,
    })),
  ]
    .map((row) => ({ ...row, text: normalized(row.text) }))
    .filter((row) => row.text);
}

const LABEL_STOP_WORDS = new Set([
  "answer",
  "choose",
  "enter",
  "field",
  "please",
  "required",
  "select",
  "value",
]);

function labelTokens(label) {
  return normalized(label)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 2 &&
        !LABEL_STOP_WORDS.has(token),
    );
}

function rowReferencesLabel(row, label) {
  const normalizedLabel = normalized(label).replace(/[^a-z0-9 ]/g, " ");
  if (normalizedLabel.length >= 4 && row.includes(normalizedLabel)) {
    return true;
  }
  const tokens = labelTokens(label);
  return tokens.length > 0 && tokens.every((token) => row.includes(token));
}

function readbackMismatchRows({ enteredValues, after }) {
  const strongReadbackCue =
    /\b(?:you told us|you entered|you provided|you selected|you chose|previously (?:entered|provided|selected|chose)|we received)\b/;
  const rows = observationRows(after);
  const mismatches = [];
  for (const entry of enteredValues) {
    const entered = normalized(entry.value);
    const numericEntered = /^-?\d+(?:\.\d+)?$/.test(entered);
    for (const row of rows) {
      if (
        !strongReadbackCue.test(row.text) ||
        !rowReferencesLabel(row.text, entry.label || entry.fieldKey) ||
        includesEnteredValue(row.text, entry)
      ) {
        continue;
      }
      if (numericEntered) {
        const observedNumbers = row.text.match(/\b\d+(?:\.\d+)?\b/g) || [];
        if (
          observedNumbers.length === 0 ||
          observedNumbers.some((value) => normalized(value) === entered)
        ) {
          continue;
        }
      }
      mismatches.push({
        fieldKey: entry.fieldKey,
        label: entry.label,
        sensitive: entry.sensitive,
        surface: row.surface,
        reason: numericEntered
          ? "labeled_readback_contains_different_numeric_value"
          : "labeled_readback_omits_exact_entered_value",
      });
      break;
    }
  }
  return mismatches;
}

function answerConditioningCues(before = {}, after = {}) {
  const afterText = observationText(after);
  const patterns = [
    /\bbased on (?:the |your )?(?:answer|response|selection|choice|information)\b/g,
    /\bbecause you (?:answered|chose|indicated|provided|said|selected)\b/g,
    /\bsince you (?:answered|chose|indicated|provided|said|selected)\b/g,
    /\bdue to (?:the |your )?(?:answer|response|selection|choice)\b/g,
    /\bdepending on (?:the |your )?(?:answer|response|selection|choice)\b/g,
  ];
  return patterns
    .flatMap((pattern) => [...afterText.matchAll(pattern)].map((match) => match[0]))
    .filter((cue, index, rows) => rows.indexOf(cue) === index)
    .sort();
}

function controlText(observation = {}) {
  return normalized(
    (observation.controls || [])
      .flatMap((control) => [
        control.rawLabel,
        control.groupLegend,
        control.description,
        control.placeholder,
        control.value,
        ...(control.options || []).flatMap((option) => [
          option?.label,
          option?.value,
        ]),
      ])
      .filter(Boolean)
      .join(" "),
  );
}

function decodedUrlValues(url) {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.entries()].map(([key, value]) => ({
      key,
      value: normalized(value),
    }));
  } catch {
    return [];
  }
}

function includesExactNormalized(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(
    haystack,
  );
}

function compactComparable(value) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function includesEnteredValue(haystack, entry) {
  const value = normalized(entry.value);
  if (includesExactNormalized(haystack, value)) return true;
  if (!entry.sensitive) return false;
  const compactValue = compactComparable(value);
  return (
    compactValue.length >= 4 &&
    compactComparable(haystack).includes(compactValue)
  );
}

function visibleApplicantControls(observation = {}) {
  return (observation.controls || []).filter((control) => {
    if (control.visible !== true || control.disabled === true) return false;
    const type = String(control.rawType || "").toLocaleLowerCase("en-US");
    return !["button", "hidden", "reset", "submit"].includes(type);
  });
}

function reflectionRows({ enteredValues, before, after }) {
  const beforeVisible = observationText(before);
  const afterVisible = observationText(after);
  const beforeControls = controlText(before);
  const afterControls = controlText(after);
  const beforeUrl = decodedUrlValues(before?.url);
  const afterUrl = decodedUrlValues(after?.url);
  const rows = [];

  for (const entry of enteredValues) {
    const value = normalized(entry.value);
    const urlMatches = afterUrl.filter((item) => item.value === value);
    const urlWasPresent = beforeUrl.some((item) => item.value === value);
    if (urlMatches.length > 0 && !urlWasPresent) {
      rows.push({
        fieldKey: entry.fieldKey,
        label: entry.label,
        sensitive: entry.sensitive,
        distinctive: entry.dependencyDistinctive,
        surface: "url_query",
        references: urlMatches.map((item) => item.key).sort(),
      });
    }
    if (
      includesEnteredValue(afterVisible, entry) &&
      !includesEnteredValue(beforeVisible, entry)
    ) {
      rows.push({
        fieldKey: entry.fieldKey,
        label: entry.label,
        sensitive: entry.sensitive,
        distinctive: entry.dependencyDistinctive,
        surface: "visible_text",
        references: [],
      });
    }
    if (
      includesEnteredValue(afterControls, entry) &&
      !includesEnteredValue(beforeControls, entry)
    ) {
      rows.push({
        fieldKey: entry.fieldKey,
        label: entry.label,
        sensitive: entry.sensitive,
        distinctive: entry.dependencyDistinctive,
        surface: "control_metadata",
        references: [],
      });
    }
  }
  return rows;
}

export function buildTransitionStateDelta({
  transitionKind,
  before,
  after,
  enteredValues = [],
}) {
  const comparableValues = comparableEnteredValues(enteredValues);
  const reflections = reflectionRows({
    enteredValues: comparableValues,
    before,
    after,
  });
  const readbackMismatches = readbackMismatchRows({
    enteredValues: comparableReadbackValues(enteredValues),
    after,
  });
  const surfaces = [...new Set(reflections.map((item) => item.surface))].sort();
  const hasUrlReflection = surfaces.includes("url_query");
  const hasRenderedReflection =
    surfaces.includes("visible_text") || surfaces.includes("control_metadata");
  const hasDistinctiveRenderedReflection = reflections.some(
    (item) => item.distinctive && item.surface !== "url_query",
  );
  const hasSensitiveRenderedReflection = reflections.some(
    (item) => item.sensitive && item.surface !== "url_query",
  );
  const editableControls = visibleApplicantControls(after).length;
  const dependencyCues = answerConditioningCues(before, after);
  const hasAnswerConditionedWording = dependencyCues.length > 0;
  const semanticReviewRequired =
    transitionKind === "page_advance" && hasDistinctiveRenderedReflection;
  const classification =
    transitionKind === "page_advance" && hasRenderedReflection
      ? semanticReviewRequired
        ? "rendered_reflection_requires_semantic_review"
        : "passive_readback"
      : transitionKind === "page_advance" && hasUrlReflection
        ? "transport_carry_forward"
        : reflections.length > 0
          ? "same_page_reflection"
          : "no_reflection";

  return {
    schemaVersion: STATE_DELTA_SCHEMA_VERSION,
    transitionKind,
    beforeUrl: String(before?.url || ""),
    afterUrl: String(after?.url || ""),
    enteredValueCount: comparableValues.length,
    editableControlCount: editableControls,
    reflections,
    surfaces,
    classification,
    hasRenderedReflection,
    hasSensitiveRenderedReflection,
    readbackMismatches,
    hasReadbackMismatch: readbackMismatches.length > 0,
    dependencyCues,
    hasAnswerConditionedWording,
    semanticReviewRequired,
    blocking: false,
    terminalAuthorization: semanticReviewRequired
      ? "requires_semantic_review"
      : "eligible_for_semantic_review",
  };
}

export function enforceStateDeltaAssessment(assessment, stateDelta) {
  if (
    assessment?.transitionKind !== "page_advance" ||
    assessment?.outcome !== "cross_page_dependency" ||
    stateDelta?.transitionKind !== "page_advance"
  ) {
    return { assessment, overridden: false, overrideReason: null };
  }

  const assessmentText = normalized([
    assessment.rationale,
    ...(assessment.evidence || []),
  ].join(" "));
  const hasConcreteStructuralClaim = [
    /\b(?:required|requiredness|optional)\b.{0,80}\b(?:became|changed|differ|depends?|removed)\b/,
    /\b(?:became|changed|differ|depends?|removed)\b.{0,80}\b(?:required|requiredness|optional)\b/,
    /\b(?:option|control|field|question)s?\b.{0,80}\b(?:added|changed|differ|disappear|hidden|removed|revealed|skipped)\b/,
    /\b(?:added|changed|different|skipped)\b.{0,50}\b(?:page|route|routing)\b/,
    /\b(?:page|route|routing)\b.{0,50}\b(?:added|changed|different|skipped)\b/,
    /\b(?:task|instruction|record|application|request|case|subject)\b.{0,80}\b(?:meaning|target|tied|depends?|identif|updated?|selected)\b/,
    /\b(?:meaning|target|tied|depends?|identif|updated?|selected)\b.{0,80}\b(?:task|instruction|record|application|request|case|subject)\b/,
  ].some((pattern) => pattern.test(assessmentText));
  if (hasConcreteStructuralClaim) {
    return { assessment, overridden: false, overrideReason: null };
  }

  if (
    stateDelta?.hasReadbackMismatch === true &&
    stateDelta?.hasAnswerConditionedWording !== true
  ) {
    return {
      assessment: {
        ...assessment,
        outcome: "independent",
        confidence:
          assessment.confidence === "low" ? "medium" : assessment.confidence,
        rationale:
          "Typed transition evidence found a labeled readback that did not reproduce the value actually entered. With no separate causal wording or concrete structural dependency, that mismatch cannot support cross-page branching.",
        evidence: [
          ...(assessment.evidence || []),
          "stateDelta: labeled readback did not match the typed entered value",
        ]
          .filter((value, index, rows) => rows.indexOf(value) === index)
          .sort(),
      },
      overridden: true,
      overrideReason: "mismatched_readback_without_dependency_evidence",
    };
  }

  if (
    stateDelta?.hasRenderedReflection !== true ||
    stateDelta?.hasAnswerConditionedWording === true
  ) {
    return { assessment, overridden: false, overrideReason: null };
  }

  return {
    assessment: {
      ...assessment,
      outcome: "independent",
      confidence: assessment.confidence === "low" ? "medium" : assessment.confidence,
      rationale:
        "Typed transition evidence found only a rendered readback of an earlier value. No answer-conditioned instruction, changed requiredness/options/controls, or routing change was observed, so the successor remains independent.",
      evidence: [
        ...(assessment.evidence || []),
        "stateDelta: rendered reflection without an answer-conditioned or structural dependency cue",
      ].filter((value, index, rows) => rows.indexOf(value) === index).sort(),
    },
    overridden: true,
    overrideReason: "passive_readback_without_dependency_evidence",
  };
}

export function contextualDynamicsFallback(
  assessment,
  { transitionKind, outcome, issue },
) {
  const allowed =
    transitionKind === "page_advance"
      ? new Set(["independent", "uncertain"])
      : new Set(["validation_only", "cosmetic", "uncertain"]);
  const fallbackOutcome = allowed.has(outcome)
    ? outcome
    : transitionKind === "page_advance"
      ? "independent"
      : "uncertain";
  return {
    ...assessment,
    transitionKind,
    outcome: fallbackOutcome,
    confidence: "medium",
    evidence: [
      ...(assessment?.evidence || []),
      `typed runtime contradiction: ${String(issue || "unsupported semantic classification")}`,
    ]
      .filter((value, index, rows) => rows.indexOf(value) === index)
      .sort(),
    rationale:
      fallbackOutcome === "independent"
        ? "Typed runtime evidence contradicts the claimed answer-conditioned dependency, so the observed successor is conservatively retained as an independent journey step."
        : fallbackOutcome === "cosmetic"
          ? "Typed runtime evidence found no newly visible or materially changed applicant control, so the observed same-page change is retained as cosmetic."
          : "Typed runtime evidence contradicts the specific semantic classification; the transition is retained as uncertain without authorizing dependent behavior.",
  };
}
