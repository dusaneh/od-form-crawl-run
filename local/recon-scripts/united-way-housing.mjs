import {
  declaredAdvance,
  declaredFieldPlan,
  optionByLabel,
} from "./script-helpers.mjs";
import { deterministicTestValue } from "../test-values.mjs";

const DECOY =
  /\b(?:newsletter|mailing list|subscribe|site search|search this site|donation|stay connected)\b/i;
const BRANCH =
  /\b(?:housing situation|currently live in|calaim|medi[-‑ ]cal eligibility|hud definition)\b/i;
const INTERMEDIATE =
  /\b(?:next|continue|review|check eligibility|see results|start application|begin application)\b/i;
const TERMINAL =
  /^(?:submit|submit application|send application|submit request)$/i;

function valueFor(control, index) {
  const label = `${control.label || ""} ${control.name || ""}`.toLowerCase();
  if (/birthdate/.test(label)) {
    if (/_1$/.test(control.id || "")) return "1";
    if (/_2$/.test(control.id || "")) return "15";
    if (/_3$/.test(control.id || "")) return "1990";
  }
  if (/medical number/.test(label)) return "91234567A89012";
  if (/housing situation/.test(label)) {
    return optionByLabel(control, /(?:unhoused|homeless|at risk|housing)/i);
  }
  if (/\bcounty\b/.test(label)) {
    return optionByLabel(
      control,
      /(?:san bernardino|riverside|ventura|santa barbara)/i
    );
  }
  if (/\b(?:calaim|medi[-‑ ]cal|medicaid|eligibility)\b/.test(label)) {
    return optionByLabel(control, /^(?:yes|true)\b/i);
  }
  if (/referral/.test(label)) {
    return optionByLabel(control, /(?:other|self|website)/i);
  }
  return deterministicTestValue(control, index);
}

export const unitedWayHousingScript = {
  id: "united-way-housing-navigation",
  version: 2,
  target:
    "https://www.yourlocalunitedway.org/our-work/healthy-community/housing-navigation/",
  matches(url) {
    const parsed = new URL(url);
    return (
      /(?:^|\.)yourlocalunitedway\.org$/i.test(parsed.hostname) &&
      /\/housing-navigation\/?$/i.test(parsed.pathname)
    );
  },
  planState({ controls, advances, progressText, settings }) {
    const fieldPlan = declaredFieldPlan(controls, {
      include: (control) =>
        ["gform_14", "gform_37"].includes(control.formId) &&
        control.type !== "search" &&
        !DECOY.test(control.formText || "") &&
        !/^(?:q|s|search)$/i.test(control.name || ""),
      exclude: (control) =>
        control.type === "search" ||
        /^(?:q|s|search)$/i.test(control.name || "") ||
        DECOY.test(
          `${control.label || ""} ${control.name || ""} ${control.formText || ""}`
        ),
      valueFor,
      branch: (control) =>
        BRANCH.test(`${control.label || ""} ${control.name || ""}`),
      maxBranchOptions: settings.maxBranchOptionsPerControl,
    });
    return {
      source: `script:${this.id}@${this.version}`,
      ...fieldPlan,
      advance: declaredAdvance(advances, {
        intermediate: INTERMEDIATE,
        terminal: TERMINAL,
        progressText,
        prefer: (advance) =>
          advance.formId === "gform_14" &&
          !DECOY.test(advance.formText || ""),
      }),
    };
  },
};
