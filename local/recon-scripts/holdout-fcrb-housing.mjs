import {
  declaredAdvance,
  declaredFieldPlan,
  optionByLabel,
} from "./script-helpers.mjs";
import { deterministicTestValue } from "../test-values.mjs";

const INTERMEDIATE = /^continue$/i;
const TERMINAL = /^submit application$/i;

function valueFor(control, index) {
  const identity = `${control.label || ""} ${control.name || ""}`;
  if (/housing type/i.test(identity)) {
    return optionByLabel(control, /emergency shelter/i);
  }
  if (/monthly income/i.test(identity)) return "2500";
  return deterministicTestValue(control, index);
}

export const holdoutFcrbHousingScript = {
  id: "holdout-fcrb-housing",
  version: 1,
  target: "loopback:/holdout-fcrb-housing",
  contractFromObserved: true,
  contractFilter(field) {
    return (
      field.formId === "intake" &&
      !/(?:csrf|xsrf|session|token)/i.test(
        `${field.name || ""} ${field.id || ""}`
      )
    );
  },
  matches(url, { allowLoopback = false } = {}) {
    if (!allowLoopback) return false;
    const parsed = new URL(url);
    return (
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/holdout-fcrb-housing"
    );
  },
  planState({ controls, advances, progressText, settings }) {
    const fieldPlan = declaredFieldPlan(controls, {
      include: (control) =>
        control.formId === "intake" &&
        !/(?:csrf|xsrf|session|token)/i.test(
          `${control.name || ""} ${control.id || ""}`
        ),
      valueFor,
      branch: (control) => control.name === "housing_type",
      maxBranchOptions: settings.maxBranchOptionsPerControl,
    });
    return {
      source: `script:${this.id}@${this.version}`,
      ...fieldPlan,
      advance: declaredAdvance(advances, {
        intermediate: INTERMEDIATE,
        terminal: TERMINAL,
        progressText,
        prefer: (advance) => advance.formId === "intake",
      }),
    };
  },
};
