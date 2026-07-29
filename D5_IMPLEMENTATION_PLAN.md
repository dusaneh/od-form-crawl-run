# D5-first implementation plan

Authority: `FEATURES_CONTRACT_V2.md`  
Gate: unseen public URL → agentic recon → immutable generated script →
LLM-disabled deterministic replay → live-form verification

No work package below may claim generation capability before Gate 5 passes.

## Gate 0 — Binding types and storage

Deliverables:

- Runtime-validated D2 semantic-contract schema.
- Typed state model with exactly one `advance` or `terminal_submit` action per
  state and exactly one terminal state.
- Runtime-validated D8 observed-state-identity schema: normalized route, sorted
  visible D2 contract-control keys, and visible typed progression-action key.
  Values, validation text, enablement, generated DOM IDs, and non-contract
  controls are excluded.
- Every D2 state declares one expected D8 identity; duplicate expected
  identities fail contract validation.
- Closed field, state, progression, proposal-rejection, and fault codes.
- F13.5 result-envelope schema.
- D6 raw-observation and change-map schemas.
- D7 probe-directive schema.
- Immutable local artifact layout:

```text
data/artifacts/<artifact-id>/
  versions/<artifact-version>/
    contract.json
    fingerprint.json
    scripts/<script-version>/
      manifest.json
      generated.mjs
      source.sha256
      generation-input.json
      validation/
        result-envelope.json
        events.jsonl
        evidence/
```

Manifest records the D4 triplet, normalized URL, generated-at, model, prompt
version, source hash, parent script version, contract hash, and certification
eligibility.

Acceptance:

- Invalid contracts, unknown codes, multiple progressions, multiple terminal
  states, duplicate expected D8 identities, and mutation/deletion deltas fail
  validation.
- An existing immutable script path cannot be overwritten.
- Manual planner integers cannot be loaded through the generated-script loader.

## Gate 1 — One D3 executor and physics toolbox

Deliverables:

- One executor invocation:

```text
execute({
  scriptVersion,
  contractVersion,
  stateKey,
  inputs,
  directive,
  mode
}) -> ResultEnvelope
```

- Toolbox capabilities extracted from current code: settle, nudge,
  consent/overlay preparation, DOM/accessibility sensing, field resolution,
  fill/select/check, exact readback, click ladder, state-change observation,
  evidence capture, re-baseline, request guard, and submit guard.
- D8 arrival and confirm-time observations are captured only after the shared
  settle routine completes. Animation or pending-render observations are
  diagnostic and cannot satisfy a declared state.
- No toolbox API accepts a semantic label and decides what it means.
- No executor branch checks a hostname, site ID, form ID, or site-specific
  wording.

Acceptance:

- Probe, validation replay, and fixture/real-data-shaped invocation use the
  same function.
- Unsupplied fields are `unattempted`.
- Progression occurs only from the typed contract action and only when the
  directive permits it.
- Every field and progression returns the full envelope even on failure.
- The existing FCR_B fixture at
  `C:\pp2\FCR_B\server\test\fixtures\form.html` must recognize both
  visibility-only transitions without a URL change: selecting
  `housing_type=shelter` adds visible `shelter_name`, and `Continue` replaces
  the page-1 visible control set with `income` plus `terminal_submit`. Each
  transition must produce a distinct D8 identity and match exactly one
  declared successor.
- The rehearsal explicitly watches for a progression action that is hidden
  until the state becomes valid. If arrival matching fails for that reason,
  the run halts and records the mismatch; moving progression visibility from
  arrival-time to confirm-time requires an explicit contract amendment rather
  than an executor workaround.
- Repeating/add-another flows that return to an identical D8 identity are an
  accepted Contract v2 limitation and fail as
  `repeated_state_unrepresentable`.

## Gate 2 — Semantic generation and proposal safety

Deliverables:

- Per-novel-state semantic call receiving rendered DOM facts, accessibility
  facts, sensing screenshots, prior states, guidance, sections, options, and
  the existing expand-only contract.
- Structured model output for canonical fields, state identity, resolution
  hints, synthetic test values, typed progression, and proposal rationale.
- A non-model safety validator between proposal and action.
- Rejected proposals retained with closed reason codes.
- Prompt/model provenance stored with generation input.

Acceptance:

- No semantic call occurs from the D3 executor or a loaded D1 script.
- CAPTCHA, login, payment, credential, upload, legal acceptance, and terminal
  submission proposals are rejected before actuation.
- The semantic layer cannot modify or delete existing contract entries.

Status (2026-07-24):

- **Passed in isolation.** Three localhost targets were discovered from live
  pages and generated without fixture-registry or answer-key access. The
  worker's pre-model answer-key probe returned `ERR_ACCESS_DENIED`.
- A separate scorer read ground truth only after generation artifacts were
  frozen, verified their hash stayed unchanged, and scored 95.97% aggregate.
  Evidence: `data/verification/gate2-2026-07-24.json` and
  `data/gate2-localhost/2026-07-25T02-21-31-966Z/score.json`.
- This gate produces and validates semantic proposals only. It does not
  actuate model proposals, compile D1 source, exercise conditional branches,
  or count as the loopback rehearsal/public D5 attempt.

## Gate 3 — D1 source generation and immutable versioning

Deliverables:

- A compiler writes an executable per-form Playwright module from the validated
  semantic contract and mechanics proposal.
- Generated source exports only the D1 interface and calls the executor
  toolbox; it cannot import the server, semantic client, ground truth, or
  unrestricted Playwright/browser objects.
- Every invocation re-resolves contract fields against the live page.
- Hints may rank candidates but never permit acting outside contract identity.
- Source and manifest are written once under a new script version.

Acceptance:

- The generated module runs in a restricted loader with an explicit import
  allowlist.
- Source hash mismatch, manifest mismatch, or missing D4 linkage prevents load.
- Contract expansion automatically creates script N+1 and preserves N.

Status (2026-07-24):

- **Partial: compiler and restricted replay verified.** The compiler emits a
  fixed-template executable D1, mechanics must be tied to the specific field's
  raw DOM facts, the loader permits only the generated-runtime import, and D3
  independently refuses protected-field inputs.
- Three localhost D1 modules compiled, hash-linked, loaded, and executed with
  no answer-key access. All supplied values verified by readback and every
  terminal action was blocked without an attempt. A separate post-freeze
  scorer reported 95.95% and verified artifact immutability. Evidence:
  `data/verification/gate3-2026-07-24.json`.
- Automatic script N+1 allocation after expand-only contract growth is not yet
  wired, so this gate is not marked complete.

## Gate 4 — Dynamics discovery and repair replay

Deliverables:

- Executor enumerates every choice value with D7 directives and re-baselines
  between fields.
- Generated script returns D6 before/after control facts only.
- Executor aggregates the change-map without semantic interpretation.
- Delta semantic call returns additions with trigger lineage only.
- Expansion regenerates the script and restarts validation replay.
- Failed replay envelope returns to generation for root-cause repair; every
  failed source version remains retained and certification-ineligible.

Acceptance:

- “No conditional behavior” is possible only after every declared value lands
  and verifies.
- A failed option is `could_not_test`, not an empty delta.
- Hidden controls are represented as branch-scoped, never deleted.
- The final validation replay performs zero model calls.

Status (2026-07-24):

- **Partial.** D7 choice enumeration, clean re-baselining, visibility-aware D6
  observations, change-map aggregation, and confidence/failure/contradiction
  repair prioritization are implemented.
- The isolated localhost run completed 25/25 probes and found the missed
  `disability_rating` branch. Evidence:
  `data/verification/gate4-2026-07-24.json`.
- Semantic repair, expand-only D2 application, immutable D1 N+1 regeneration,
  and final LLM-disabled repair-to-green replay remain before this gate passes.

## Gate 5 — D5 public vertical slice

Preconditions:

- The selected target is
  `https://www.stayhousedla.org/get-legal-help/`. It has no legacy or generated
  FormWeave script as of 2026-07-24; its target eligibility is documented
  without exposing scorer facts in `D5_TARGET_SELECTION.md`.
- Freeze shared executor/physics source hashes before generation begins.
- The operator personally reviews and approves the hidden oracle against the
  live form before Gate 5. Agent authorship plus a read probe is not independent
  review.
- Generator/model inputs and the generated-script loader have no access to the
  external scorer directory or its hidden ground truth. Same-Windows-user path
  separation is insufficient: before generation, the oracle must be moved out
  of the generator's reachable filesystem or protected by an OS identity/ACL
  the generator process cannot use. The scorer starts only after generated
  artifacts and shared-source hashes are frozen.
- Before the first model call, a generator-side read/stat probe for the oracle
  path must fail in addition to the enforced isolation. If the path is
  readable, the attempt aborts before generation and cannot be labeled D5.
- The public-target request audit must determine whether intermediate
  progression performs non-read requests. If it does, the public attempt has a
  fixed low attempt cap and every synthetic value set includes an immediately
  recognizable `FORMWEAVE TEST` marker wherever the field format permits.
- The 2026-07-24 capped audit observed read-like same-origin POSTs for status
  and address/geographic validation, but no applicant-intake persistence
  request tied to the observed state advances. Gate 5 remains capped at three
  browser sessions and never activates the terminal control.
- Record every human intervention and worktree change.

Rehearsal:

- Before the public attempt, run the complete Gate 0–5 plumbing once against
  the FCR_B loopback fixture. Label the result `D5 rehearsal` in every artifact
  and status surface. It is not D5, cannot satisfy D5, and cannot be presented
  as public-target generation evidence.

Pass criteria:

1. Novel-state model calls are visible in the event log.
2. A D2 contract and immutable D1 source appear on disk with full provenance.
3. Safety rejection records exist for every rejected proposal.
4. The model client is disabled before replay.
5. The exact stored source is loaded by the D3 executor.
6. Every contract field returns a complete result-envelope record.
7. Every nonterminal progression is confirmed by D8 observed runtime state
   identity/change and matches exactly one declared successor.
8. Terminal submission is identified and blocked.
9. Replay completes without shared-code or human site-mechanics changes.
10. Only after freeze, a separate scorer loads hidden ground truth and reports
    pass, assisted, or failed.

Failure is retained as a D5 result. Editing shared physics or manually authoring
site mechanics during the run makes the outcome assisted or failed, never pass.

## Gate 6 — Only after D5

- F3.17 generated/hand-authored/observation-only UI and artifact inspection.
- F15 execution-fault classification, automatic recon verdict, and staleness.
- Human certification and coverage snapshot.
- Phase 2 typed real-data input, version pinning, masking, uploads, and
  approved-live authority.

## Explicit non-goals before D5

- Improving the legacy hand-authored PG&E or United Way planners.
- Treating the execution-conformance corpus as generator training or scoring.
- Repairing the assisted holdout as a substitute for generation.
- Adding more site-specific branches to shared traversal code.
- Claiming autonomous crawl completion from post-crawl LLM analysis.
