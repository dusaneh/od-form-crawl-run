import { validateObservedStateIdentity } from "../contracts/runtime-schemas.mjs";

export function normalizeRuntimeRoute(url) {
  const parsed = new URL(url);
  let route = parsed.pathname || "/";
  if (route.length > 1) route = route.replace(/\/+$/, "");
  return route || "/";
}

export function observedIdentityKey(identity) {
  return JSON.stringify([
    identity.normalizedRoute,
    identity.visibleControlKeys,
    identity.progression.key,
    identity.progression.kind,
  ]);
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function observeRuntimeStateIdentity({
  page,
  contract,
  mechanics,
  toolbox,
  hintedState,
}) {
  const normalizedRoute = normalizeRuntimeRoute(page.url());
  const visibleControlKeys = [];
  for (const field of contract.fields) {
    const target = mechanics.fields?.[field.key];
    if (target && (await toolbox.isVisible(target))) {
      visibleControlKeys.push(field.key);
    }
  }
  visibleControlKeys.sort();

  const routeCandidates = contract.states.filter(
    (state) =>
      state.expectedIdentity.normalizedRoute === normalizedRoute &&
      sameStrings(
        state.expectedIdentity.visibleControlKeys,
        visibleControlKeys,
      ),
  );
  const progressionCandidates = [];
  for (const state of routeCandidates) {
    const progressionTarget = mechanics.states?.[state.key]?.progression;
    if (
      progressionTarget &&
      progressionTarget.key === state.progression.key &&
      progressionTarget.kind === state.progression.kind &&
      (await toolbox.isVisible(progressionTarget))
    ) {
      progressionCandidates.push(state.progression);
    }
  }

  let progression;
  if (progressionCandidates.length === 1) {
    progression = progressionCandidates[0];
  } else {
    progression = {
      key:
        progressionCandidates.length > 1
          ? "__ambiguous_visible_progression__"
          : "__progression_not_visible__",
      kind: hintedState.progression.kind,
    };
  }
  const identity = {
    normalizedRoute,
    visibleControlKeys,
    progression,
  };
  validateObservedStateIdentity(identity);
  return identity;
}

export function matchDeclaredState(contract, identity) {
  const key = observedIdentityKey(identity);
  return (
    contract.states.find(
      (state) => observedIdentityKey(state.expectedIdentity) === key,
    ) || null
  );
}
