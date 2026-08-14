# Qualitative analysis contract

Edit the generated `learnings.json`; do not invent a separate result format.

For every test retain:

- `worked[]`: claim, evidence links, why it matters, preservation invariant, and confidence.
- `failed[]`: claim, expected and observed behavior, evidence links, failing layer, severity, generalizable cause, and confidence.
- `unknowns[]`: conclusions the evidence cannot support.

Complete `batchSynthesis` with:

- `workedPatterns`: successes shared across tests.
- `failedPatterns`: recurring failure classes, not fixture names.
- `preservationRisks`: successful behavior a proposed change might damage.
- `recommendations`: generic changes and the tests that would validate them.

For every material failure, make the recommendation a generic capability requirement rather than a fixture repair. Include:

- the behavior that must hold on unseen sites;
- the architectural or implementation boundary responsible;
- whether the current architecture can satisfy it robustly;
- an architectural change when local repair would remain brittle;
- positive, negative, and structurally different regression examples;
- preservation invariants protecting previously successful behavior.

A validation run still produces requirements and learnings. Validation means the application version remains frozen during measurement; it does not mean newly exposed failures are ignored. Record those requirements for the next authorized development iteration.

Do not blame architecture as though it were immutable. Architecture is a development choice. When evidence shows whole-state cascading failure, uncontrolled generation variance, or inadequate recovery boundaries, state that the architecture should change and specify the intended capability of the replacement design.

Every substantive claim must cite an artifact and optional JSON pointer already present in the draft. Inspect screenshots when the failure concerns visibility, state, or post-action rendering. Prefer `unknowns[]` over unsupported causal claims.

Before finalizing:

1. Replace every draft `generalizableCause` that says semantic review is required.
2. Set `analysisStatus` to `complete`.
3. Preserve all passing safety and behavior checks as explicit invariants.
4. Confirm every recommendation is generic and not derived from fixture-specific labels, IDs, selectors, or incidental page structure.
5. Run `experiment:finalize`; fix all missing or escaping evidence paths.
