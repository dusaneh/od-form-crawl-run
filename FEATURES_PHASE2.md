# FormWeave Phase 2 Feature Requirements

This file defines the future execution phase that consumes a certified
FormWeave Phase 1 artifact. It is intentionally a requirements skeleton only;
the capabilities below are not implemented merely because they are specified.

## Maintenance contract

- Update `FEATURE_STATUS.md` whenever the implementation status or verification
  evidence for one of these requirements changes.
- Every new or amended requirement is checked against the Design principles in
  `FEATURES.md`; conflicts are resolved explicitly.
- The principles and their scars may not be removed or reworded without
  operator sign-off.

## F10. Real-data runner contract

- `F10` Phase 2 consumes an existing certified D1 generated script and D2
  semantic contract produced and validation-replayed by Phase 1 under F14.
  Phase 2 supplies typed real data, approval, coverage gating, and optional
  terminal-submission authority; it does not introduce script generation.
- `F10.1` One shared executor owns browser physics: settle waits, interaction
  nudge, consent dismissal, shadow walking, click ladders, value normalization,
  browser-layer request/submit guards, and verification of every write.
- `F10.2` Generated per-form scripts contain only live-page mechanics within
  their semantic contract; shared executor code does not grow when a form is
  added.
- `F10.3` Each script declares every field it can populate and accepts any
  subset of those fields as input.
- `F10.4` Each state permits one advance action, confirmed only by observed
  runtime state identity/change per `F13.3`. Back and Cancel are never advance
  candidates.
- `F10.5` A state with two or more submit-typed controls and no corroborating
  progress indicator is ambiguous and halts.
- `F10.6` The runner modes are `probe`, `dry-run`, and `approved-live`.
- `F10.6.1` Real client data and terminal submission are structurally
  unreachable outside `approved-live`.
- `F10.6.2` `approved-live` requires human approval of the exact crawl-scoped
  `formId` and its pinned generated-script identity. Each execution separately
  supplies `submit: true` or `submit: false`; only `true` opens the bounded
  terminal-action window. Approval of a URL, lineage, or mutable latest
  version is insufficient.
- `F10.7` Validation, autosave, and corroborated intermediate POSTs may persist
  partial state and are recorded separately from terminal submission.
- `F10.8` Runner-only failures use `validation_blocked`, `type_mismatch`, or
  `drift_undeclared_required`, with before/after observed runtime state identity
  per `F13.3` and screenshot evidence.
- `F10.9` Every run pins the D4 triplet: artifact/schema version,
  fingerprint-algorithm version, and exact generated-script version. The runner
  refuses an unavailable, superseded, uncertified, stale, or drifted version
  unless an operator completes the applicable review and approval flow.
- `F10.10` Real user data enters through a typed input contract mapped to the
  certified form contract. Unmapped values, undeclared fields, incompatible
  types, and missing conditionally required values halt before actuation.
- `F10.11` Phase 1 generated scripts and their manifests remain locally stored
  immutable artifacts, inspectable independently of the current generator
  implementation.

### F10.12. Document uploads

- `F10.12` Real-data execution resolves file-upload controls from either an
  authenticated client document reference or an inline client file object
  declared by the crawl input schema. An inline file contains filename,
  content type, and base64 bytes and is held only for the execution lifetime.
  Each upload field maps to a declared document type or captured upload
  constraint.
- `F10.12.1` Before actuation, the runner verifies the resolved file against
  the captured accept list, maximum size, and maximum file count. If no
  conforming document is available, execution halts with `validation_blocked`
  before any upload begins.
- `F10.12.2` Upload success is verified by reading back the resulting control
  or page state; an unverified upload is a failure under Design principle 4.
- `F10.12.3` Document filenames, contents, and echoed document metadata are
  sensitive for evidence purposes and are masked under F12.
- `F10.12.4` Phase 1 may upload only a generated, conspicuously synthetic
  in-memory file to validate mechanics on public and local forms equally.
  Captured upload constraints and the document types a form appears to require
  are part of the certified contract; Phase 1 never consumes an end-user file.

### F10.14. Crawl-scoped approval and run API

- `F10.14` The service exposes a form-approval API keyed by `formId` and an
  asynchronous run API keyed by the same approved `formId`.
- `F10.14.1` `POST /api/forms/{formId}/approval` records `approved` or
  `rejected`, actor, notes, decision time, and the exact pinned script identity.
  Disqualified forms cannot be approved.
- `F10.14.2` `POST /api/forms/{formId}/runs` accepts `data`, mandatory boolean
  `submit`, and browser mode. `data` must conform to the JSON Schema returned
  for that exact `formId`; outside-contract keys, inactive-branch fields,
  incompatible types, files outside captured constraints, and missing active
  required values fail closed.
- `F10.14.3` Approved execution deterministically replays the retained script.
  It does not call the semantic generator, invent selectors, widen branch
  coverage, or choose new actions at run time.
- `F10.14.4` `GET /api/executions/{executionId}` returns execution status,
  verified/failed field counts, stable failure code and detail, whether
  terminal submission occurred, and rendered/transport result verification.
- `F10.14.5` Raw input values and file bytes are never written to execution
  records or event logs. Persisted event values are redacted; post-submit model
  evidence redacts supplied scalar values and visible controls before model
  assessment.

### F10.13. Coverage-gated execution

- `F10.13` An artifact may be certified with incomplete behavioral coverage.
  Certification records which questions, options, and branches were verified.
- `F10.13.1` Before actuation, the runner compares client input against the
  certified coverage map and refuses to start when supplied values would
  require an unverified field, option, or branch.
- `F10.13.2` If execution reaches an uncertified state at runtime, including an
  unexpected reveal, untested branch, or observed runtime state identity
  outside the certified set, the run halts with evidence rather than
  improvising.
- `F10.13.3` A refusal or halt names the specific uncovered question, option,
  or branch so it can be targeted by a follow-up probe.
- `F10.13.4` Coverage gating never widens implicitly. A halt is resolved by
  probing and re-certifying, never by relaxing the gate for a run.

## F11. Conditional schema expansion

- `F11` Under confirmed Option A, branch discovery and conditional schema
  expansion are Phase 1 requirements F1.7; Phase 2 consumes their output.
- `F11.1` A narrowly scoped delta agent returns only additions between a base
  schema and an observed variant, including lineage to its triggering field and
  value.
- `F11.2` The runner enforces expand-only deltas and rejects modification or
  deletion of existing fields.
- `F11.3` Each certified branch variant is a distinct D2 state with its own
  expected D8 identity and trigger lineage. Runtime coverage checks use those
  identities; structural fingerprints remain recon-only.
- `F11.4` Cross-page dependence is flagged from conditional phrasing or
  distinctive earlier-value echoes, with short/common-value false-positive
  guards.

## F12. Sensitive-data evidence handling

- `F12` Once any field is filled, every stored screenshot masks sensitive
  inputs by bounding box and masks text echoes of entered sensitive values on
  read-back and post-submit pages.
- `F12.1` Masking tracks the values actually entered during the run rather than
  relying only on field metadata.
- `F12.2` A sensitive field or echoed value that cannot be masked causes
  screenshot capture to fail safe to no stored screenshot.
- `F12.3` Masking applies in probe, dry-run, and approved-live modes without
  weakening the runner's evidence and failure logging.
- `F12.4` Document filenames, previews, and echoed upload metadata are masked
  in stored evidence under the same rules as sensitive field values.
