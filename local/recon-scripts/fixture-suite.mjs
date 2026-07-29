import {
  declaredAdvance,
  declaredFieldPlan,
} from "./script-helpers.mjs";
import { deterministicTestValue } from "../test-values.mjs";

const INTERMEDIATE = /\b(?:next|continue|review|get started|start|begin)\b/i;
const TERMINAL =
  /\b(?:submit application|submit test application|submit request|send request|request replacement|send question|save intake|enroll)\b/i;
const DECOY = /\b(?:newsletter|subscribe|site search|search this site|chat widget)\b/i;

export const fixtureSuiteScript = {
  id: "repository-fixture-suite",
  version: 1,
  target: "loopback:/fixtures/",
  matches(url, { allowLoopback = false } = {}) {
    if (!allowLoopback) return false;
    const parsed = new URL(url);
    return (
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname.startsWith("/fixtures/")
    );
  },
  planState({ controls, advances, progressText, settings }) {
    const fieldPlan = declaredFieldPlan(controls, {
      include: (control) =>
        !DECOY.test(
          `${control.formText || ""} ${control.label || ""} ${control.name || ""}`
        ),
      valueFor: deterministicTestValue,
      branch: (control) =>
        ["select", "radio", "checkbox", "switch"].includes(control.type),
      maxBranchOptions: settings.maxBranchOptionsPerControl,
    });
    return {
      source: `script:${this.id}@${this.version}`,
      ...fieldPlan,
      advance: declaredAdvance(advances, {
        intermediate: INTERMEDIATE,
        terminal: TERMINAL,
        progressText,
        prefer: (advance) => !DECOY.test(advance.formText || ""),
      }),
    };
  },
};
