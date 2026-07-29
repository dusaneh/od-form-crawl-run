import {
  branchTestValues,
  classifyFieldSafety,
  deterministicTestValue,
} from "../test-values.mjs";

function descriptorText(descriptor) {
  return [
    descriptor.label,
    descriptor.name,
    descriptor.id,
    descriptor.formId,
    descriptor.formText,
    descriptor.sectionText,
  ]
    .filter(Boolean)
    .join(" ");
}

export function matchesDescriptor(descriptor, pattern) {
  if (!pattern) return true;
  return pattern.test(descriptorText(descriptor));
}

export function declaredFieldPlan(
  controls,
  {
    include = () => true,
    exclude = () => false,
    valueFor = (control, index) => deterministicTestValue(control, index),
    branch = () => false,
    maxBranchOptions = 3,
    allowHumanReview = () => false,
  } = {}
) {
  const fields = [];
  const branchControlIds = [];
  for (const [index, control] of controls.entries()) {
    const safety = classifyFieldSafety(control);
    const selected = include(control) && !exclude(control);
    const locallyAllowedReview =
      safety.classification === "human_review" &&
      allowHumanReview(control, safety);
    if (
      !selected ||
      (safety.classification === "human_review" && !locallyAllowedReview)
    ) {
      fields.push({
        controlId: control.controlId,
        action: safety.classification === "human_review" ? "review" : "skip",
        testValue: "",
        classification:
          safety.classification === "human_review"
            ? "human_review"
            : "deterministic",
        rationale:
          safety.classification === "human_review"
            ? safety.reason
            : "The form-specific recon script excludes this control.",
      });
      continue;
    }
    const testValue = String(valueFor(control, index) ?? "");
    fields.push({
      controlId: control.controlId,
      action:
        control.type === "select" || control.type === "radio"
          ? "select"
          : ["checkbox", "switch"].includes(control.type)
            ? "check"
            : "fill",
      testValue,
      classification: branch(control) ? "conditional" : "deterministic",
      rationale: locallyAllowedReview
        ? "Explicitly allowed by the loopback fixture script."
        : "Declared by the selected form-specific recon script.",
    });
    if (
      branch(control) &&
      branchTestValues(control, maxBranchOptions).length > 1
    ) {
      branchControlIds.push(control.controlId);
    }
  }
  return { fields, branchControlIds };
}

export function noAdvance(reason = "No advance is declared for this state.") {
  return {
    controlId: "",
    classification: "none",
    rationale: reason,
  };
}

export function declaredAdvance(
  advances,
  {
    intermediate,
    terminal,
    progressText = "",
    prefer = () => true,
  }
) {
  const candidates = advances.filter(prefer);
  const submitTyped = candidates.filter((candidate) => candidate.submitLike);
  if (submitTyped.length >= 2 && !String(progressText).trim()) {
    return {
      controlId: "",
      classification: "review",
      rationale:
        "Two or more submit-typed controls were visible without a corroborating progress indicator.",
      failureCode: "could_not_test",
    };
  }
  const intermediateCandidate = candidates.find((candidate) =>
    intermediate.test(candidate.label)
  );
  if (intermediateCandidate) {
    return {
      controlId: intermediateCandidate.controlId,
      classification: "intermediate",
      rationale:
        "The form-specific script declares this label as an intermediate transition.",
    };
  }
  const terminalCandidate = candidates.find((candidate) =>
    terminal.test(candidate.label)
  );
  if (terminalCandidate) {
    return {
      controlId: terminalCandidate.controlId,
      classification: "final",
      rationale:
        "The form-specific script declares this label as the terminal submission boundary.",
    };
  }
  return noAdvance("The form-specific script found no declared advance control.");
}

export function optionByLabel(control, pattern, fallbackIndex = 0) {
  const options =
    control.type === "radio" ? control.groupOptions || [] : control.options || [];
  const matching = options.find(
    (option) =>
      !option.disabled &&
      pattern.test(`${option.label || ""} ${option.value || ""}`)
  );
  const enabled = options.filter(
    (option) => !option.disabled && String(option.value || "").trim()
  );
  return String((matching || enabled[fallbackIndex] || enabled[0])?.value || "");
}
