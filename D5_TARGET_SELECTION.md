# D5 public-target decision

Date selected: 2026-07-24  
Authority: `FEATURES_CONTRACT_V2.md` D5 and `D5_IMPLEMENTATION_PLAN.md`

## Selected target

`https://www.stayhousedla.org/get-legal-help/`

Stay Housed LA is a Los Angeles County/City legal-services intake. The official
page is publicly reachable without login and permits a terminal boundary to be
inspected without activating it.

Repository search found no legacy planner, generated script, fixture adapter,
or target-specific shared-code branch for this URL or host as of selection.
PG&E and United Way remain excluded because they have legacy planners.

## Why this is a meaningful D5 target

- It is a public, no-login, multi-state intake with enough behavioral depth to
  exercise the D5 vertical slice.
- It had no legacy planner, generated script, fixture adapter, or
  target-specific shared-code branch when selected.
- It was chosen before generation and is not part of the localhost corpus.
- Detailed fields, options, branches, expected states, and scoring assertions
  are intentionally absent from this repository-visible decision record.

## Hidden oracle

The manually authored scorer oracle is intentionally outside the repository:

`C:\pp2\FormWeave-D5-Scorer\oracles\stay-housed-la.v1.json`

SHA-256:

`D134B186F295324534BE844427917213B6EB6B009CC25B562916ABFF0B8A3CC9`

It was authored by direct live-form inspection without using FormWeave
generation, legacy planners, repository ground truth, or the localhost corpus.
Its structural assertions remain scorer-only.

The target URL and this selection record are visible to generation. Before
Gate 5, the operator must personally review the oracle against the live form
and record approval outside this repository. At generation time, the oracle
must be physically moved outside the generator's reachable filesystem or
locked behind a distinct OS identity/ACL; directory separation under the same
Windows account is not isolation. A generator-side read/stat probe must also
fail before any model call. Only the separate scorer process receives the
oracle after shared-source hashes and generated artifacts are frozen.

## Rehearsal

Run the entire vertical-slice plumbing first against the FCR_B loopback
fixture. Every rehearsal artifact must say `D5 rehearsal`. It is not D5 and
cannot be used as the public pass result.

## Etiquette and request audit

A two-session, terminal-blocked request audit was recorded outside the
repository at:

`C:\pp2\FormWeave-D5-Scorer\audit\stay-housed-la-request-audit.json`

The target emitted same-origin POSTs for form-status checks and address
lookup/geographic validation. These behaved as read-like service calls. The
observed state-advance clicks did not emit an applicant-intake persistence
request, and the terminal control was never activated. This lowers but does
not eliminate pollution risk.

The public D5 attempt is therefore capped at three browser sessions. Synthetic
free-text values must include `FORMWEAVE TEST — DO NOT PROCESS` wherever the
field format permits; strict-format values remain obviously synthetic in the
run record. No cap or marker authorizes terminal submission.

## Selection caveat

This is a live third-party form and can change. A reachability or safety change
before the public attempt does not authorize silently selecting another target.
Record the change, retain this oracle and target decision, and make a new
explicit target-selection decision.
