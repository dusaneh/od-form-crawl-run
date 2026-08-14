const AFTER_ACTION_KINDS = new Set(["post_advance", "submitted"]);
const BASE_PRE_ACTION_KINDS = new Set([
  "branch",
  "pre_advance",
  "blocked_final",
  "populated",
  "pre_actuation_failure",
]);
const FINAL_BRANCH_KIND = "selected_branch_populated";

function bySequence(left, right) {
  return Number(left.sequence || 0) - Number(right.sequence || 0);
}

function hasScreenshot(state) {
  return Boolean(state?.screenshot);
}

function lastMatching(states, predicate) {
  for (let index = states.length - 1; index >= 0; index -= 1) {
    if (predicate(states[index])) return states[index];
  }
  return null;
}

/**
 * Select the compact, client-facing proof set from the richer transient
 * traversal trace. Model sensing and option-by-option probes remain available
 * in memory while the crawl runs, but are not durable report evidence.
 */
export function selectRetainedEvidence(states = [], { halted = false } = {}) {
  const ordered = [...states].sort(bySequence);
  const retained = new Map();
  let segment = [];

  const retain = (state, evidenceRole) => {
    if (!state || !hasScreenshot(state)) return;
    const existing = retained.get(state.id);
    retained.set(state.id, {
      ...state,
      evidenceRole: existing?.evidenceRole || evidenceRole,
    });
  };

  const retainBeforeAction = () => {
    const finalBranch = lastMatching(
      segment,
      (state) => state.kind === FINAL_BRANCH_KIND && hasScreenshot(state),
    );
    const base = lastMatching(
      segment,
      (state) => BASE_PRE_ACTION_KINDS.has(state.kind) && hasScreenshot(state),
    );
    retain(base, "pre_action");
    if (finalBranch?.id !== base?.id) retain(finalBranch, "pre_action_branch");
  };

  for (const state of ordered) {
    if (AFTER_ACTION_KINDS.has(state.kind)) {
      retainBeforeAction();
      retain(
        state,
        state.kind === "submitted" ? "terminal_result" : "post_action",
      );
      segment = [];
      continue;
    }
    segment.push(state);
  }

  retainBeforeAction();

  if (halted) {
    retain(
      lastMatching(ordered, (state) => hasScreenshot(state)),
      "failure_boundary",
    );
  }

  return [...retained.values()].sort(bySequence);
}

export function shouldCaptureStateScreenshot(kind, fieldResults = []) {
  if (
    [
      "populated",
      "pre_actuation_failure",
      "branch",
      "pre_advance",
      "post_advance",
      "selected_branch_populated",
      "blocked_final",
      "submitted",
    ].includes(kind)
  ) {
    return true;
  }
  return fieldResults.some(
    (result) => !result?.outcome?.verified || result?.outcome?.skipped,
  );
}
