import { fixtureSuiteScript } from "./fixture-suite.mjs";
import { holdoutFcrbHousingScript } from "./holdout-fcrb-housing.mjs";
import { pgeCareFeraScript } from "./pge-carefera.mjs";
import { unitedWayHousingScript } from "./united-way-housing.mjs";

export const reconScripts = Object.freeze([
  unitedWayHousingScript,
  pgeCareFeraScript,
  fixtureSuiteScript,
  holdoutFcrbHousingScript,
]);

export function reconScriptFor(url, options = {}) {
  return (
    reconScripts.find((script) => {
      try {
        return script.matches(url, options);
      } catch {
        return false;
      }
    }) || null
  );
}

// Production may only replay an artifact whose action decisions were produced
// by the semantic generation pipeline. The repository scripts above predate
// that pipeline and remain available only to legacy/isolation tests.
export function generatedReconScriptFor(url, options = {}) {
  const script = reconScriptFor(url, options);
  return script?.decisionAuthority === "llm_generated" ? script : null;
}
