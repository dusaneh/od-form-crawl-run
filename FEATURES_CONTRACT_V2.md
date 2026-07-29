# FormWeave — Revised Architecture and Feature Requirements (Contract v2)

This document **supersedes** `FEATURES_ADDENDUM_SCRIPT_CONTRACT.md`. Per the
maintenance contract, mark that file superseded with this as its replacement;
do not merge both. Part A is the architecture to understand before
implementing. Part B is binding definitions. Part C is the requirement set.
All new requirements start **Not built**. Update `FEATURE_STATUS.md` and
`FEATURES_MATRIX.md` in the same change.

---

## Part A — Architecture concept

### A.1 Three actors and a toolbox

**Semantic layer (LLM).** Decides what the form *means*. Produces and expands
the semantic contract: canonical field keys with raw labels, control types,
requirement rules (including branch-scoped), option sets, section and guidance
references, and the ordered states with typed progression actions. It runs
only at generation and interpretation moments — never during deterministic
execution.

**Generated script (per form, on disk).** Decides *how to act on this page
right now*. On every run it re-resolves each contract field against the live
DOM/HTML/JS/CSS, performs entries and progressions through the physics
toolbox, and observes and reports raw facts. It never interprets, never
invents or renames a field, never acts outside its contract. Unresolvable →
failure code, not a guess.

**Executor (shared, one implementation).** Decides *what happens next*. It
loads a script plus input data, orders the work — which state, which fields,
which probe values — enforces every safety boundary at the browser level, and
returns the result envelope. It owns the **physics toolbox** — settle waits,
interaction nudge, consent handling, click ladders, readback verification,
evidence capture, request and submit guards — which the script calls and
never reimplements. The executor never performs a form-semantic action of its
own accord: every fill, choice, and progression flows through the script.

Physics is not a fourth actor; it is the executor's toolbox.

Running example for the rest of this document: a `housing_status` dropdown
where choosing `at_risk` reveals a required `monthly_income` number field.

### A.2 Artifacts that cross the boundaries

| Artifact | Produced by | Consumed by | Nature |
| --- | --- | --- | --- |
| Semantic contract | Semantic layer | Generation, executor, UI, Phase 2 | Meaning. Versioned. Evolves expand-only. |
| Generated script | Generation (LLM-assisted) | Executor | Executable mechanics. Immutable versioned source on disk. |
| Probe directive | Executor | Script | "State S: set `housing_status` = `at_risk`; do not progress." |
| Raw observation | Script | Executor → semantic layer | DOM-derived before/after control-set delta. Zero interpretation. |
| Change-map | Executor (aggregated) | Semantic layer | Every probe delta, per field and value. |
| Result envelope | Script + executor | Everyone | Per-field outcomes, state outcome, progression confirmation, evidence refs. |

### A.3 Loop 1 — Generation (a form with no script)

1. Executor prepares the page (toolbox) and captures DOM, accessibility
   facts, and screenshots.
2. Semantic layer proposes the state's contract and actions.
3. A safety layer validates every proposal against the locked boundaries — no
   terminal submit, no CAPTCHA/login/payment/legal-acceptance interaction,
   synthetic values only. A rejected proposal is recorded as rejected, never
   silently patched. The LLM proposes; the executor's guards dispose.
4. The generated script is written to disk with provenance: generated-at,
   model identity, prompt version, source hash, source artifact version.
5. **Validation replay**: the executor immediately replays the script with
   the LLM disabled. Every contract field must enter and verify; every state
   must progress. A failed replay routes its envelope back to generation for
   root-cause repair; the failing script is retained as evidence and is never
   certification-eligible.

### A.4 Loop 2 — Dynamics discovery (branching)

1. The executor enumerates: for each choice field, each value, it issues a
   probe directive; the page is re-baselined between fields.
2. The script sets the value with verified actuation and returns the raw
   observation: the control set before versus after. Facts only.
3. The executor aggregates the change-map:
   `housing_status=at_risk → +monthly_income (required)`;
   `housing_status=housed → no change`.
4. The semantic layer (delta agent) interprets the change-map and returns
   **additions only**, each with lineage: `monthly_income` revealed by
   `housing_status=at_risk`, required within that branch. Fields hidden by a
   value become branch-scoped visibility — never deletions.
5. The expanded contract triggers regeneration of that state's script, a
   script version increment, and a fresh validation replay.

Same discipline as fingerprinting: **facts are mechanical and DOM-derived;
meaning is LLM-derived and happens once.**

### A.5 Runtime (validation replay, scheduled probe, real data)

One identical path. The executor invokes the script per state; piecemeal data
is allowed — the script enters what is supplied, reports per-field
`{resolved, entered, verified, failure_code}`, leaves unsupplied fields
`unattempted`, and performs the state's progression only on instruction,
confirmed only by observed runtime state identity/change per D8 and F13.3. The
envelope is returned in every mode. The LLM is absent.

### A.6 Drift path

Execution failure → classify first: **input-data fault** (the supplied value
fails the form's own validation, or a required value is missing → report to
the data owner; nothing else happens) | **environment fault** (timeout,
network → bounded retry) | **form-change suspicion** (a previously verified
field won't resolve, actuation won't verify, progression produces no state
change, an unrecognized state appears, or validation names a control absent
from the contract). Suspicion → halt before further entry (real data) →
automatic re-crawl → fingerprint verdict: digest changed = new artifact
version plus a regeneration cycle; digest unchanged = script defect →
script-only fix with a script version increment.

### A.7 Invariants — violating any of these is a defect, not a style choice

1. Meaning is decided only in the semantic layer, only at generation or
   interpretation time.
2. The script never invents or renames semantics at runtime; unresolvable
   yields a failure code.
3. The executor never performs a form-semantic action of its own accord.
4. The physics toolbox gains no site-specific code when a form is added.
5. Raw observations carry zero interpretation.
6. Contract evolution is expand-only with lineage; hidden is never deleted.
7. A contract change forces script regeneration and a script version
   increment.
8. One code path serves probing, validation replay, and real-data execution.
9. No LLM call occurs during deterministic execution.
10. Safety boundaries live at the executor and browser level; neither scripts
    nor LLM proposals can bypass them.

---

## Part B — Binding definitions

- `D1` **Generated script**: an executable per-form Playwright program
  produced with the LLM in the loop, written to disk as immutable versioned
  source, replayable by the executor **without any LLM call**. A hand-authored
  planner, adapter, policy object, or ground-truth-derived plan does not
  satisfy any requirement that says "generated script."
- `D2` **Semantic contract**: the standardized meaning description of A.2,
  produced and expanded only by the semantic layer, consumed at run time,
  never invented or extended at run time. Evolution is expand-only with
  lineage.
- `D3` **Executor**: the single shared runtime of A.1 — orchestration plus
  the physics toolbox. It contains no site-specific branches and performs no
  form-semantic actions of its own accord.
- `D4` **Three version concepts** — artifact/schema version,
  fingerprint-algorithm version, script version — are linked, recorded
  together on every stored script, and never interchangeable.
- `D5` **The vertical slice**: unseen public URL → no script exists → agentic
  recon → generated script on disk → deterministic replay with the LLM
  disabled → replay verified against the live form. Until it passes, every
  generation-dependent status row reads "blocked by D5," and no such
  capability is claimed on the strength of hand-authored stand-ins.
- `D6` **Raw observation**: a typed, DOM-derived before/after control-set
  delta produced by the script under a probe directive. It contains no
  interpretation, no semantics, and no model output.
- `D7` **Probe directive**: an executor-issued instruction naming the state,
  the field, the value to set, and whether progression is permitted.
- `D8` **Observed runtime state identity**: a visibility-aware,
  contract-relative fact record derived mechanically by the executor without a
  model call or structural fingerprint. It contains the normalized route, the
  canonically sorted set of currently applicant-visible D2 contract-control
  keys, and the one currently visible D2 progression-action key and typed kind.
  It excludes entered values, validation text, enabled state, body text,
  transient/generated DOM IDs, and non-contract controls.

---

## Part C — Requirements

### F13. The contract line

- `F13` Semantics are standardized above the script by the semantic layer;
  mechanics are resolved inside the script against the live page; physics and
  orchestration sit below in the executor.
- `F13.1` The semantic contract (D2) is the only vocabulary crossing the
  line. Progression steps are first-class typed actions the executor
  understands — `advance` and `terminal_submit` — never free-form clicks.
  Exactly one progression action per state; exactly one terminal state.
- `F13.2` The generated script re-resolves every contract field against the
  current DOM on every run; embedded strategies from generation time are
  hints, not truth. A field that cannot be resolved, actuated, or verified
  yields its closed failure code; the script never guesses, never invents or
  renames a field, never acts outside its contract.
- `F13.3` The executor owns orchestration and the physics toolbox per A.1. It
  interprets typed actions (progression confirmed only by D8 identity/change;
  ambiguous terminals halt; Back/Cancel are never progression candidates),
  enforces safety guards, and performs no form-semantic action of its own
  accord.
- `F13.3.1` D8 visibility is computed with one shared DOM, layout, ARIA, frame,
  and shadow-root rule. Disabled-but-visible controls remain in the identity;
  applicant-hidden controls do not.
- `F13.3.2` Every D2 state declares its expected D8 identity. Contract
  validation rejects two states with the same expected identity.
- `F13.3.3` An `advance` is confirmed only when the post-action D8 identity
  differs from the pre-action identity and matches exactly one declared
  successor. A changed but undeclared identity is form-change suspicion; an
  unchanged identity is `advance_no_navigation`.
- `F13.3.4` D8 identity is never an artifact fingerprint and never drives
  artifact versions or drift verdicts. F2.5 fingerprints remain recon-only.
- `F13.3.5` A D8 identity used for arrival matching or progression
  confirmation is captured only after the shared D3 settle routine reports a
  stable state. Pre-settle identities are diagnostic only.
- `F13.3.6` Contract v2 intentionally cannot represent a repeating semantic
  state whose visible contract controls and progression action yield the same
  D8 identity, such as some add-another-member loops. Encountering one fails
  loudly as `repeated_state_unrepresentable`; it is not confirmed as
  progression.
- `F13.4` **Piecemeal per-state execution.** The executor may invoke a script
  for a single state with any subset of that state's inputs. Unsupplied
  fields report `unattempted`; a form-required field left unsupplied surfaces
  as `validation_blocked` at progression, attributed to the missing input.
- `F13.5` **Result envelope.** Every invocation returns, in every mode: per
  field `{key, attempted, resolved, entered, verified, failure_code,
  detail}`, the state outcome, the progression outcome (attempted / confirmed
  by state change), the observed state identity, and evidence references.
  "Did the data go in, and if not exactly why not" is answerable from the
  envelope alone.
- `F13.6` **One code path.** The same script and executor serve crawl-time
  validation replay, recon probing, and real-data execution. A probe path
  that diverges from the production path is a defect.

### F14. Generation loop

- `F14` For a target with no current script, recon runs Loop 1 (A.3) with the
  LLM in the loop at each novel state.
- `F14.1` The safety layer of A.3 step 3 sits between every proposal and any
  action; rejections are recorded, never silently patched.
- `F14.2` Output is a generated script (D1) plus its semantic contract, on
  disk with full provenance (generated-at, model, prompt version, source
  hash, source artifact version).
- `F14.3` Generation is complete only when the validation replay (A.3 step 5)
  passes with the LLM disabled. A failing script is retained as evidence and
  is never certification-eligible.
- `F14.4` **Phase boundary (amends `F10`).** Synthetic-data script generation
  is a Phase 1 recon deliverable. Phase 2 consumes an existing certified
  generated script with real data, approval, and submission authority; it
  does not introduce generation.
- `F14.5` **Presentation honesty.** A target without a generated script is
  shown prominently as observed-only (`script_missing`); capability language
  describes only what actually occurred for that run.

### F15. Execution-based drift detection

- `F15` Day-to-day drift detection is execution verification per A.6, not
  digest comparison; no fingerprint is computed at run time.
- `F15.1` Classification precedes any drift action: input-data fault |
  environment fault | form-change suspicion, exactly as defined in A.6. An
  input-data fault never triggers a re-crawl and never mints a version.
- `F15.2` A form-change suspicion triggers an automatic re-crawl; the
  re-crawl renders the verdict through the existing fingerprint module
  (`F2.5`): digest changed → new artifact version plus a regeneration cycle;
  digest unchanged → script defect → script-only fix with a script version
  increment. Fingerprint comparison runs at recon time only.
- `F15.3` During real-data execution a suspicion halts before any further
  entry on that state; nothing improvises past it.
- `F15.4` **Accepted limitation, stated so it stays a decision:** execution
  verification cannot see changes that do not impede the script — added
  optional fields, changed labels, guidance, option wording, eligibility
  text. Those are caught only at re-crawl. Each target carries a configurable
  re-probe interval; past it, the target is flagged stale and requires a
  re-probe before an approved-live run.

### F16. Dynamics discovery and contract expansion (formalizes `F1.7`; Phase 2's `F11` consumes)

- `F16` The executor drives Loop 2 (A.4): it enumerates each value of each
  choice field via probe directives, re-baselining between fields. Verified
  actuation and the existing fail-loud rules apply: a value not confirmed as
  landed, an unactuatable option set, or unresolvable locators yield
  `could_not_test` — never "no conditional behavior."
- `F16.1` Under a probe directive the script reports exactly one thing: the
  raw observation (D6). Interpretation of any kind in the script or executor
  is a defect.
- `F16.2` The executor aggregates raw observations into the change-map and
  submits it to the semantic layer.
- `F16.3` The semantic layer returns **additions only**, each carrying
  lineage to its triggering field and value(s); requiredness may be
  branch-scoped; fields hidden by a value become branch-scoped visibility.
  The system rejects any delta that modifies or deletes an existing contract
  entry.
- `F16.4` A contract expansion regenerates the affected state's script,
  increments the script version (D4), and requires a fresh validation replay
  before the artifact is certification-eligible.
- `F16.5` A variant encountered later — during validation, scheduled probe,
  or a halted real-data run — whose base structure matches follows this same
  interpretation path (expansion); one whose base structure does not match
  follows the drift path (F15.2).

### F8.10 Hidden-ground-truth acceptance harness (amends `F8.9`)

- `F8.10` The generation capability is scored only under strict separation:
  generation sees only the website; ground truth is loaded by a separate
  scorer after the generated script is frozen; any human authoring or
  shared-code change during the run marks the result assisted or failed, and
  says so.
- `F8.10.1` The existing ground-truth-constructed corpus is relabeled
  **execution conformance** everywhere it is cited and is never presented as
  evidence of discovery or flexibility.
- `F8.10.2` D5 on at least one unseen public target is the first gate for the
  generation capability, before any other generation-adjacent feature work.

### Amendments to existing requirements

- `F10` (Phase 2): generation moves to `F14`; F10 retains the real-data typed
  input contract, modes, approval, coverage gating, document uploads, and
  masking. `F10.9` pins the D4 triplet — artifact version, script version,
  fingerprint-algorithm version.
- `F11` (Phase 2): consumes F16's output; enforcement of expand-only deltas
  at run time remains a runner obligation.
- `F9.12`: script versioning applies to generated scripts per D1/D4 —
  immutable retained source, source hash, provenance, linkage, automatic
  increment on contract-driven regeneration. A manual integer on a
  hand-authored planner does not satisfy it.
- `F3.17`: the UI states, for every run and target, whether traversal was
  driven by a generated script, a hand-authored script, or observation only;
  pipeline completion and hand-scripted traversal are never presented as
  autonomous capability.
