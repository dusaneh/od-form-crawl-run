# Contract v2 implementation gap audit

Date: 2026-07-24  
Authority: `FEATURES_CONTRACT_V2.md`

This audit classifies the current repository without treating hand-authored or
ground-truth-derived planners as generated scripts.

## D1–D7 disposition

| Definition | Current reality | Status | Required disposition |
| --- | --- | --- | --- |
| D1 Generated script | No generated executable source exists. `local/recon-scripts/*.mjs` are hand-authored planner objects; localhost corpus planners are derived from scoring ground truth. | Not built; blocked by D5 | Add an immutable generated-script store, manifest, source hash, provenance, loader, and LLM-disabled replay. Keep existing planners only as explicitly labeled legacy/conformance fixtures. |
| D2 Semantic contract | `FieldContract`, guidance, sections, options, and state evidence are useful observations, but no versioned semantic-layer output enforces typed states, one progression per state, one terminal state, or expand-only lineage. | Not built; blocked by D5 | Define a validated semantic-contract schema and additions-only delta schema. Only semantic-generation code may create or expand it. |
| D3 Executor | `playwright-crawler.mjs`, `form-traversal.mjs`, and `server.mjs` split orchestration informally. `form-traversal.mjs` mixes orchestration, mechanics, planner calls, branching policy, and result construction. | Not built; blocked by D5 | Create one executor interface. Extract reusable waits, nudge, consent, click, entry/readback, evidence, request guards, and submit guards as its toolbox. Remove autonomous semantic choices from shared code. |
| D4 Version triplet | Fingerprint algorithm and artifact lineage exist; planner files carry manual integers. No generated script source/version exists or links the triplet. | Not built; blocked by D5 | Persist artifact/schema version, fingerprint-algorithm version, and generated-script version together in every immutable manifest. |
| D5 Vertical slice | Unknown targets are observation-only; the LLM runs after crawling; no script is generated or replayed. | Not passed | This is the first implementation gate. No adjacent capability may substitute for it. |
| D6 Raw observation | Existing state snapshots and fingerprints contain useful DOM facts, but branch actions and planner semantics are mixed into the same path and no dedicated typed before/after control-set delta exists. | Not built; blocked by D5 | Define an interpretation-free control-fact record and delta record emitted only after verified probe actuation. |
| D7 Probe directive | Branch loops are internal traversal behavior, not a typed executor-to-script instruction. | Not built; blocked by D5 | Define state, field, value, and progression-permission directive types and use them through the same invocation path as validation/runtime. |

## Component disposition

### Retain as foundations

- `local/browser-evidence.mjs`: full-page/tiled capture primitives, after
  adapting outputs to evidence references and masking requirements.
- `local/fingerprint.ts`: recon-time DOM-fact extraction and versioned digest.
  It must not run in day-to-day deterministic execution.
- Browser-layer request and submit guards in `local/form-traversal.mjs` and
  `local/playwright-crawler.mjs`, after extraction into the executor toolbox.
- Stable-state waits, pointer/scroll nudge, consent/overlay handling, locator
  actuation, and browser readback primitives, after removing orchestration and
  semantic policy from them.
- Filesystem run/artifact/event persistence in `local/server.mjs`, extended
  with immutable contract/script directories and manifests.
- Existing DOM extraction for labels, validation, sections, guidance, groups,
  and options as semantic-layer input facts—not as runtime-created meaning.
- UI evidence, field-contract, diagnostics, and local artifact inspection
  surfaces.

### Replace or extract

- Replace post-crawl-only `openai-analysis.mjs` as the only semantic use with
  explicit state-generation and delta-interpretation calls. Post-crawl summary
  may remain secondary.
- Split `form-traversal.mjs` into executor orchestration, physics toolbox, and
  typed result-envelope construction.
- Replace planner `planState()` calls with generated-script invocations that
  accept only a semantic contract plus executor directive and toolbox handle.
- Replace runtime fingerprint-based progression confirmation with D8 observed
  runtime state identity: normalized route plus the canonically sorted visible
  D2 contract-control keys and the visible typed progression-action key.
  Progression requires a changed identity matching exactly one declared
  successor. Retain fingerprints for recon verdicts only.

### Quarantine and label honestly

- `local/recon-scripts/pge-carefera.mjs` and
  `local/recon-scripts/united-way-housing.mjs`: legacy hand-authored planners.
- `local/recon-scripts/fixture-suite.mjs`: hand-authored execution fixture.
- `local/recon-scripts/holdout-fcrb-housing.mjs`: assisted holdout planner.
- `test-sites/localhost-corpus.mjs`: ground-truth-derived execution-conformance
  planner factory.
- Existing reports produced by those planners remain valid evidence of their
  recorded mechanics, but never evidence of autonomous generation.

## Current invariant violations

1. Meaning is partly encoded in hand-authored planner regexes rather than
   produced by the semantic layer.
2. Shared traversal code still chooses and sequences some behavior outside a
   D1 script/D2 contract invocation.
3. Branch probing does not produce interpretation-free D6 observations.
4. Validation replay, probing, and eventual real-data execution do not share a
   defined invocation/result-envelope path.
5. Manual planner integers are presented near artifact versions without a D4
   generated-script version.
6. The UI does not yet satisfy F3.17 for every target.

## D5 implementation gate

D5 passes only when a target with no existing generated script completes all
of the following without human-authored site mechanics:

1. Capture state facts, accessibility information, and sensing screenshots.
2. Call the semantic layer for each novel state.
3. Validate every proposed action against locked safety boundaries.
4. Persist a validated D2 contract.
5. Generate and persist immutable D1 source plus manifest and D4 triplet.
6. Disable semantic/model calls.
7. Load that exact source through the D3 executor.
8. Replay every contract field and nonterminal progression.
9. Return complete F13.5 result envelopes and evidence.
10. Freeze the generated artifact before a separate scorer sees hidden ground
    truth.

Until all ten steps pass, generation-dependent work remains **Not built —
blocked by D5**.
