import {
  declaredAdvance,
  declaredFieldPlan,
  optionByLabel,
} from "./script-helpers.mjs";
import { deterministicTestValue } from "../test-values.mjs";

const BRANCH =
  /\b(?:currently receive|currently enrolled|already enrolled|eligible for|electric account|gas account)\b/i;
const INTERMEDIATE =
  /\b(?:next|continue|review|check eligibility|get started|start)\b/i;
const TERMINAL =
  /\b(?:submit application|submit enrollment|submit|send application|complete application)\b/i;

function valueFor(control, index) {
  const label = `${control.label || ""} ${control.name || ""}`.toLowerCase();
  if (/\b(?:yes|no|eligible|enrolled|receive)\b/.test(label)) {
    return optionByLabel(control, /^(?:no|false)\b/i);
  }
  if (/household size|number of people/.test(label)) return "2";
  if (/income|annual|monthly/.test(label)) return "42000";
  if (/account/.test(label)) return "1234567890";
  return deterministicTestValue(control, index);
}

export const pgeCareFeraScript = {
  id: "pge-carefera",
  version: 5,
  target: "https://energyinsight.pge.com/carefera",
  matches(url) {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === "energyinsight.pge.com" &&
      /^\/carefera\/?$/i.test(parsed.pathname)
    );
  },
  planState({ controls, advances, progressText, settings }) {
    const siteProgressText =
      progressText ||
      (advances.some((advance) =>
        /\b(?:confirmation|review|certification|agreement|declaration)\b/i.test(
          advance.formText || ""
        )
      )
        ? "Recognized PG&E step heading"
        : "");
    const fieldPlan = declaredFieldPlan(controls, {
      include: () => true,
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
        progressText: siteProgressText,
      }),
    };
  },
};
