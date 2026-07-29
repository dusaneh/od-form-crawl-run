# FormWeave two-effort stabilization program

## Current outcome

Development effort 1 is complete for the supported Phase 1 localhost
envelope. Fresh `gpt-5.4-mini` production generation now has:

- 37/37 functional expected outcomes after the generic disclosure fix;
- 244/244 expected fields discovered;
- evidence on 37/37 sites;
- 25/25 attempted fixture submissions verified;
- zero production failures and zero unsafe conditional submissions;
- generic harmless loopback file upload on the upload fixtures;
- 71/71 automated tests passing.

The full-cohort audit itself was 36/37 because `site_l_gated` exposed
nondeterministic disclosure sequencing. The shared contract was fixed and that
site then passed twice consecutively. This distinction is retained rather than
presenting the combined result as one post-fix 37-site run.

Strict exact-oracle parity is 25/37. The other twelve forms are functionally
correct and differ only on sensitivity metadata that requires human policy
review. Privacy treatment will not be weakened merely to improve an oracle
score.

Development effort 2 is now the active effort. Its target is a trustworthy
working copy that:

1. stores and replays one canonical, versioned, human-certified form script;
2. accepts a typed real-user payload and executes it in non-submitting
   `dry-run` mode;
3. refuses uncovered, stale, ambiguous, unmaskable, or otherwise unsafe input
   before harmful actuation;
4. retains inspectable, privacy-safe evidence and logs; and
5. survives a previously unseen holdout without shared-code or hostname
   exceptions.

Public terminal submission is not implied by this milestone. It remains
behind the separately approved-live boundary, D5, certification, and per-run
human approval.

## Anti-overfitting contract

The corpus is a measurement instrument, not production input.

- Production generation, compilation, and replay may not import fixture
  registries, `README.md` expectations, `ground_truth.yaml`, scorer code, or
  per-site `LEARNINGS.md`.
- No hostname branch, fixture ID, label keyword, or known-answer map may decide
  an action.
- The LLM authors semantic choices from live sensing. Shared code may enforce
  types, safety, coverage, and browser mechanics but may not infer site
  semantics.
- Every corpus run freezes all artifacts before a separate offline process
  opens ground truth.
- Shared browser physics is frozen before the unseen holdout. Any shared-code
  change made to pass the holdout invalidates that attempt.
- Test-specific behavior is acceptable only inside fixture/scorer code and
  must never be reachable from the production API.
- The mini-model benchmark uses fresh generation. Historical scripts may be
  replayed for reproducibility, but they cannot substitute for measuring
  `gpt-5.4-mini` generation quality.

## Development effort 1 - completed 2026-07-28

### Delivered

1. **Generic loopback upload conformance**
   - Harmless in-memory files are created only under explicit loopback upload
     authority.
   - MIME type, extension, multiplicity, and requiredness come from observed
     facts.
   - Upload occurs only when declared by the LLM-authored action plan.
   - Browser file-list readback and path-safe evidence are retained.
   - Public uploads and real documents remain structurally prohibited.

2. **Functional versus metadata verdicts**
   - Functional, safety, and metadata results are reported separately.
   - Sensitivity decisions retain reason and provenance.
   - Conservative privacy treatment is not scored as a traversal failure.

3. **Generic repair and dynamics improvements**
   - Bounded repair receives cumulative immutable failure history.
   - Same-page branching works to exactly one level.
   - Cross-page branching is detected but not executed.
   - Mismatched echoes, disclosure sequencing, CAPTCHA boundaries, and
     client-side loopback completion are handled without fixture branches.

4. **Fresh mini-model corpus verification**
   - The production audit used fresh `gpt-5.4-mini` generation.
   - Runs and generated artifacts froze before any oracle read.
   - The complete serialized suite is green at 71/71.

### Measured acceptance

| Acceptance measure | Result |
| --- | ---: |
| Functional expected outcomes | 37/37 |
| Expected fields discovered | 244/244 |
| Evidence-bearing sites | 37/37 |
| Verified fixture submissions | 25/25 attempted |
| Production failures | 0 |
| Unsafe conditional submissions | 0 |
| Automated tests | 71/71 |
| Strict exact-oracle passes | 25/37 |
| Metadata-policy review items | 12 |

Effort 1 closed the supported local functional envelope. Phase 1 is now
approximately 85-88% complete: remaining Phase 1 work is primarily canonical
artifact routing, version/certification controls, D5, drift, locale, and
broader public proof rather than fixture traversal.

## Development effort 2 - controlled real-data readiness

### Build order

1. **Sensitivity taxonomy approval**
   - Human-review the twelve current policy/oracle disagreements.
   - Approve one product taxonomy and update scorer expectations where the
     oracle is stale or internally inconsistent.
   - Do not weaken runtime privacy classification to match the scorer.

2. **Canonical D1/D3 production cutover**
   - Compile every accepted complete production plan to canonical D1.
   - Allocate N+1 after an expand-only D2 change.
   - Load and execute production artifacts only through D3.
   - Remove or quarantine the parallel retained-plan executor after parity.

3. **Version and certification boundary**
   - Expose artifact, schema, and script versions, deltas, and coverage in the
     UI.
   - Allow browsing and explicit pinning.
   - Implement human-only `observed -> certified -> revoked/superseded` state.
   - Store the exact per-question, per-option, and per-branch coverage approved
     at certification.

4. **Typed real-user input contract**
   - Accept data only by certified semantic question key.
   - Validate types, requiredness, formats, branch compatibility, and document
     references before opening a browser.
   - Reject unmapped, undeclared, incompatible, or uncovered values with exact
     diagnostics.
   - Keep LLMs out of user-data-to-field mapping during execution.

5. **Coverage-gated dry-run executor**
   - Pin the certified D4 triplet for every run.
   - Execute through D3 using real-user-shaped input.
   - Halt if runtime enters an uncertified state or observes form-change
     suspicion.
   - Block terminal submit at the browser layer in `dry-run`.

6. **Sensitive evidence protection**
   - Mask sensitive control bounding boxes and echoed values after real data is
     populated.
   - Mask upload filenames, previews, and echoed document metadata.
   - If masking cannot be verified, do not persist the screenshot and halt
     when the contract requires it.
   - Redact sensitive values from logs and architecture exchanges.

7. **Frozen-framework rehearsal and holdout**
   - Run the entire slice against a loopback rehearsal first.
   - Freeze shared physics.
   - Run an unseen holdout that may add only a generated per-form script.
   - Report any shared-code or site-specific exception as a failed holdout.

### Acceptance

- Fresh generation and zero-LLM replay produce equivalent canonical D2/D1/D8
  results.
- A human can inspect and certify an exact artifact version and coverage map.
- A typed real-user-shaped payload populates a certified fixture end to end in
  `dry-run`, with terminal submit blocked.
- Uncovered branch values, stale versions, drift suspicion, type mismatches,
  and unmaskable evidence all fail closed before unsafe continuation.
- Sensitive values do not appear in stored screenshots, logs, reports, or
  model payloads during execution.
- The unseen holdout passes with frozen shared code and no hostname or fixture
  exception.
- The full 37-site corpus remains functionally green after D1/D3 cutover.

### Expected position after effort 2

- A stable working copy can accept real user data and run a controlled,
  non-submitting execution against a human-certified script.
- Phase 1: approximately 90-93% complete.
- Phase 2 execution foundation: approximately 50-60% complete.
- Overall Phase 1 + Phase 2 roadmap: approximately 70-75% complete.

## Explicitly after these two efforts

The following are not silently folded into the two-effort promise:

- approved public terminal submission;
- production real-document upload;
- the clean public D5 attempt and its human-owned hidden oracle;
- scheduled staleness probing and complete execution-based drift automation;
- locale and language variants; and
- operational access control, retention policy, and deployment hardening.

Those follow only after controlled real-data dry-run and the frozen holdout are
green.
