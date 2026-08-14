import assert from "node:assert/strict";
import test from "node:test";

import {
  selectRetainedEvidence,
  shouldCaptureStateScreenshot,
} from "../local/evidence-retention.mjs";

function state(sequence, kind, screenshot = true) {
  return {
    id: `state_${sequence}_${kind}`,
    sequence,
    kind,
    screenshot: screenshot ? Buffer.from(`${sequence}:${kind}`) : null,
  };
}

test("report evidence retains transition boundaries and drops exhaustive probes", () => {
  const retained = selectRetainedEvidence([
    state(1, "choice_probe"),
    state(2, "choice_probe"),
    state(3, "branch_variant_populated"),
    state(4, "populated"),
    state(5, "selected_branch_populated"),
    state(6, "post_advance"),
    state(7, "choice_probe"),
    state(8, "populated"),
    state(9, "submitted"),
  ]);
  assert.deepEqual(
    retained.map(({ sequence, evidenceRole }) => [sequence, evidenceRole]),
    [
      [4, "pre_action"],
      [5, "pre_action_branch"],
      [6, "post_action"],
      [8, "pre_action"],
      [9, "terminal_result"],
    ],
  );
});

test("a halted crawl retains one final failure boundary without probe noise", () => {
  const retained = selectRetainedEvidence(
    [
      state(1, "choice_probe"),
      state(2, "branch_variant_populated"),
    ],
    { halted: true },
  );
  assert.deepEqual(
    retained.map(({ sequence, evidenceRole }) => [sequence, evidenceRole]),
    [[2, "failure_boundary"]],
  );
});

test("transient choice probes omit screenshots unless their actuation failed", () => {
  assert.equal(
    shouldCaptureStateScreenshot("choice_probe", [
      { outcome: { verified: true } },
    ]),
    false,
  );
  assert.equal(
    shouldCaptureStateScreenshot("choice_probe", [
      { outcome: { verified: false, skipped: false } },
    ]),
    true,
  );
  assert.equal(shouldCaptureStateScreenshot("pre_advance", []), true);
  assert.equal(
    shouldCaptureStateScreenshot("selected_branch_populated", []),
    true,
  );
});

test("pre-actuation failure evidence is captured and retained as the failure boundary", () => {
  const failure = state(1, "pre_actuation_failure");
  const retained = selectRetainedEvidence([failure], { halted: true });
  assert.equal(shouldCaptureStateScreenshot("pre_actuation_failure", []), true);
  assert.deepEqual(retained.map((item) => item.id), [failure.id]);
  assert.equal(retained[0].evidenceRole, "pre_action");
});
