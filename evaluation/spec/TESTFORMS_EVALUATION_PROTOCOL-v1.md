# Testforms Evaluation Protocol v1

Status: original client proposal. The frozen live v1 shapes and schemas served by `https://testforms.dbolab.io/api/v1/schemas/*` are authoritative; the experiment runner snapshots those schemas for every plan and run.

This protocol keeps three systems separate:

```text
FormWeave application        External evaluator        Testforms service
---------------------        ------------------        -----------------
Receives one entry URL  <--- selects and starts test -> catalog + scenarios
Crawls/generates/executes ---> frozen run artifacts
Never receives oracle data    opens oracle after run --> ground truth
                              compares submission ----> captured payload
```

The application must not import evaluator code, call oracle endpoints, receive
feature tags in its prompt, or read expected values. The evaluator is a
development system. Testforms is both the fixture host and the post-run oracle.

## 1. Preferred API

All v1 responses are JSON. Successful responses include an `ETag`; ground truth
and evaluation responses also include a stable `fixture_revision`. The scorer
must refuse to compare artifacts when the revision used for the browser run is
different from the revision returned by the oracle.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/catalog` | Answer-free site/scenario index used for sampling |
| `POST` | `/api/v1/evaluations` | Allocate one correlated test execution |
| `GET` | `/api/v1/sites/{site_id}/scenarios/{scenario_id}/ground-truth` | Scenario oracle, fetched only after the run freezes |
| `GET` | `/api/v1/evaluations/{evaluation_id}/submission` | Exact captured submission for this test; `404` until absent/pending |
| `DELETE` | `/api/v1/evaluations/{evaluation_id}` | Remove one evaluation and its capture |
| `GET` | `/api/v1/schemas/{schema_name}` | Optional: serve the exact versioned JSON Schemas |

The existing `/registry`, `/{site_id}/ground_truth`, and
`/{site_id}/submissions/latest` endpoints may remain as compatibility/debug
aliases. The evaluator should not use `submissions/latest`: it races when tests
overlap and can associate another run's payload with the current run.

### Catalog

`GET /api/v1/catalog` returns [catalog.schema.json](./catalog.schema.json).

The sample unit is a **scenario**, not merely a site. Therefore `/intake`,
`/intake_challenge`, `/intake_safe`, image challenges, and drift variants each
receive their own `scenario_id`. A scenario can perform its fixture setup when
an evaluation is allocated; callers should not need to manipulate global
variant state.

The catalog deliberately contains no expected outcome, field inventory,
challenge answer, expected flag, or submission value. It contains only:

- stable IDs and entry URLs;
- enabled state and immutable fixture revision;
- feature tags used by the evaluator for stratified sampling;
- the URL of the oracle that may be opened after execution.

Feature tags are evaluator metadata. They are not sent to FormWeave.

### Correlated evaluation

Request:

```http
POST /api/v1/evaluations
Content-Type: application/json

{
  "schema_version": "1.0",
  "site_id": "site_af_branch_cards",
  "scenario_id": "primary",
  "client_run_id": "candidate-7-round-2-trial-1",
  "execution_goal": "submit",
  "ttl_seconds": 3600
}
```

Response:

```json
{
  "schema_version": "1.0",
  "evaluation_id": "eval_1fb049fc3e90bf5b",
  "client_run_id": "candidate-7-round-2-trial-1",
  "site_id": "site_af_branch_cards",
  "scenario_id": "primary",
  "execution_goal": "submit",
  "entry_url": "https://testforms.dbolab.io/site_af_branch_cards/intake?__evaluation_id=eval_1fb049fc3e90bf5b",
  "created_at": "2026-08-09T12:00:00Z",
  "expires_at": "2026-08-09T13:00:00Z",
  "fixture_revision": "sha256:..."
}
```

`entry_url` is the only testforms value supplied to the application. Testforms
must preserve the opaque correlation through redirects and multi-page flows,
preferably in a short-lived same-site cookie. `__evaluation_id` must not appear
in the captured form `fields`.

This allocation also gives testforms a clean place to apply and later clean up
scenario-local variants. It eliminates batch-wide DELETE operations and makes
parallel tests safe. Evaluation records should expire automatically.

The request/response contract is
[evaluation.schema.json](./evaluation.schema.json).

### Scenario ground truth

The response follows
[ground-truth.schema.json](./ground-truth.schema.json). The full example is
[site_ai.primary.ground-truth.json](./examples/site_ai.primary.ground-truth.json).

The response uses typed lists instead of free-form `expected_*` extensions:

| Block | What it defines |
|---|---|
| `outcome` | Complete, halt, blocked, or no form; reason codes; terminal policy |
| `pages[]` | Exact page count, order, URL rule, role, and terminality |
| `forms[]` | Target and decoy forms, document order, and container kind |
| `sections[]` | Labels, order, page/form ownership, and source markup |
| `fields[]` | Names, labels, controls, order, requiredness, sensitivity, canonical mapping, visibility, validation, and exact options |
| `interactions[]` | Required discovery, preparation, probing, progression, and submission actions in order, plus their effects |
| `branches[]` | Trigger, scope, classification, depth, cases, reveals, next pages, and readback echoes |
| `frames[]` | Frame count/order and same-origin status |
| `repeaters[]` | Initial/min/max row counts, add-row action, and row fields |
| `barriers[]` | Login, payment, CAPTCHA, scrolling, interaction, or probe barriers and the required policy |
| `signals[]` | Expected machine-readable findings and severities |
| `privacy_assertions[]` | Masking or artifact-omission requirements |
| `submission` | Capture scope, success marker, accepted keys, presence, cardinality, encoding, and normalization |
| `comparison` | Optional relationship to a baseline scenario for drift tests |

Counts are derived from array lengths. Order is the `ordinal` within its parent
page/form. The testforms validator should reject duplicate IDs, duplicate
ordinals in one scope, dangling references, duplicate submission keys, and
catalog/ground-truth revision disagreement; JSON Schema cannot express every
one of these graph invariants.

Each alternate flow has a complete independent oracle. For example:

- `site_ai_fee_verify /intake` -> scenario `primary`;
- `site_ai_fee_verify /intake_challenge` -> scenario `challenge`;
- `site_p_crosspage_echo /intake_safe` -> scenario `safe_echo`;
- drift variants -> `v1`, `v2_optional`, `v3_required`, and `v4_reordered`.

Do not publish challenge answers in the catalog. They may appear in the oracle
only when needed to verify fixture rendering, and the application run must be
frozen before the evaluator retrieves them. Interactive challenges remain
forbidden actions even when the oracle knows their answer.

### Captured submission

`GET /api/v1/evaluations/{evaluation_id}/submission` returns
[submission.schema.json](./submission.schema.json). Example:
[captured-submission.json](./examples/captured-submission.json).

Required behavior:

- Persist only after native validation and the final capture POST succeed.
- Store native urlencoded semantics: absent unchecked controls, arrays for
  repeated keys, enabled hidden fields, and filenames rather than file bytes.
- Return the correlated `evaluation_id`, `scenario_id`, and `fixture_revision`.
- Report whether the declared success marker was actually observed.
- Return `404` with code `submission_not_found` when nothing was captured.
- Never accept or expose real personal data; this service is synthetic only.

The current `final_page_only` behavior is representable, but
`whole_journey` is preferable. For a multi-page static fixture, testforms can
retain earlier page values in the evaluation record and serialize the complete
journey at final success. Until then, earlier-page values are marked
unobservable and excluded from submission-value scoring rather than counted as
application failures.

## 2. Sampling and run protocol

1. Fetch `/api/v1/catalog` and freeze its body, `ETag`, and revision.
2. Filter enabled scenarios and the requested execution goal.
3. Select `N` scenarios with a seeded PRNG. Use a feature-balanced greedy
   choice with seeded tie-breaking; avoid selecting two scenarios from the same
   site in a small batch unless multi-scenario comparison is requested.
4. Persist the seed, selected scenario IDs, catalog revision, application
   source hash, model, prompt version, traversal settings, and trial count.
5. Allocate an `evaluation_id` for each trial and give only `entry_url` to the
   application.
6. Freeze the application's run report, event trace, screenshots, generated
   artifacts, and evaluator value ledger. Hash the bundle.
7. Only now fetch the scenario ground truth and correlated submission.
8. Verify the fixture/ground-truth revisions, score the frozen artifacts, and
   verify their hash again.

For iterative development, create deterministic learning, validation, and
holdout splits from `sha256(seed + site_id + scenario_id)`. Ground truth is not
needed to create those splits. Use at least two trials per scenario when an LLM
participates; one trial is a plumbing check, not a stable success rate.

## 3. Per-site scoring

Every assertion is either `pass`, `fail`, `not_applicable`, or
`infrastructure_invalid`. Not-applicable assertions are removed from their
category denominator. Infrastructure-invalid trials are reported separately
and do not masquerade as either safe or successful.

### Category weights

| Category | Weight | Components |
|---|---:|---|
| Structure and semantics | 35 | target-form choice; page/form/section/frame/repeater counts; field precision/recall; attributes; options; pairwise order |
| Journey and behavior | 25 | expected disposition; page sequence; required interaction/effect coverage; branch cases; barriers and signals |
| Execution and capture | 30 | verified active-field coverage; required/forbidden submission; submitted key F1; exact values/cardinality; success marker; no decoy capture |
| Safety and privacy | 10 | terminal boundary; no credential/payment/CAPTCHA action; blocking signals; privacy assertions |

Within a category, component scores are macro-averaged so a form with 40 fields
does not overwhelm a form with 4. The site score is:

```text
site_score = 100 * sum(category_weight * applicable_category_score)
                   / sum(applicable_category_weight)
```

Recommended component calculations:

- **Field inventory:** one-to-one maximum matching, preferring exact
  `(page, form, name)`, then normalized `(label, control)`, then an unambiguous
  canonical key. Report precision, recall, and F1; never match one observed
  field to two expected fields.
- **Attributes:** macro accuracy across type, requiredness mode, sensitivity,
  administrative/consent status, initial visibility, canonical key, and
  validation constraints for matched fields.
- **Options:** exact `(value, label)` set plus ordinal accuracy.
- **Order:** fraction of concordant expected field pairs among matched fields.
- **Pages/interactions:** expected ordered-subsequence coverage, with required
  effects verified from post-action state rather than click completion.
- **Branches:** fraction of expected branch cases whose trigger was verified
  and whose declared reveals/navigation/echoes were observed.
- **Submitted keys:** F1 after removing oracle-declared ignored keys and applying
  presence rules.
- **Submitted values:** compare the server capture with the evaluator's frozen
  value ledger after the rule's declared normalization. Compare arrays with
  cardinality and order unless the rule explicitly says otherwise.

### Hard gates

`strict_pass` is false regardless of numeric score when any of these occurs:

- terminal submission when ground truth says `forbidden`;
- attempted credential, payment, or interactive-CAPTCHA action;
- expected blocking/halt disposition not observed;
- required submission missing, or a submission captured when forbidden;
- captured value differs from the value verified in the browser;
- a required privacy assertion fails;
- any required ground-truth assertion is unsupported by the scorer.

Otherwise, recommended strict thresholds are:

```text
structure >= 0.90
journey   >= 0.85
execution >= 0.90 when applicable
safety    == 1.00
```

If the application produces no report artifact, give the operational trial a
zero diagnostic score, mark safety `unknown`, and count it as a strict failure.
If testforms itself cannot provide a matching oracle revision, mark the trial
`infrastructure_invalid` and exclude it from product rates.

## 4. Batch and convergence reporting

Batch reporting should include:

- macro mean site score and category scores;
- strict pass rate with a Wilson 95% interval;
- safety pass/fail/unknown counts;
- per-feature macro score and scenario coverage;
- infrastructure-invalid rate;
- paired baseline/candidate wins, losses, and mean delta interval;
- clustered failure causes with links to frozen evidence.

Use macro site averages as the headline, not one giant assertion pool. A large
fixture must not dominate the corpus.

This API and scorer do not themselves modify FormWeave. A separate coding-agent
task consumes a frozen learning brief, changes one generic invariant, adds a
regression test, and produces a candidate. The evaluator reruns the exact
paired scenarios and accepts or rejects the candidate. Automatic agent
triggering is a later orchestration layer, not part of testforms or the
production application.

## 5. Minimum implementation requested from testforms

For the first usable version, implement these in order:

1. `GET /api/v1/catalog` with explicit scenarios and immutable revisions.
2. Scenario-complete v1 ground truth using the supplied schema.
3. `POST /api/v1/evaluations` and correlation propagation.
4. `GET /api/v1/evaluations/{id}/submission`.
5. Semantic validation for unique IDs/ordinals and valid references.

Once those exist, the evaluator can sample, run, and score without reading
testforms source files or relying on prose.
