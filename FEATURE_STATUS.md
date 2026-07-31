# FormWeave Feature Status

Status snapshot for `FEATURES.md` under the binding architecture in
`FEATURES_CONTRACT_V2.md`.

- Snapshot: 2026-07-30, America/Los_Angeles
- **Built** means implemented and verified through the active production path.
- **Partial** means useful implementation exists but the complete requirement
  or acceptance gate has not passed.
- **Not built** means no adequate implementation exists.
- Phase 2 remains separately defined in `FEATURES_PHASE2.md`; Phase 1
  generation work is not credited as a real-data runner.

## Executive status

FormWeave remains fully runnable as a local application: React/vinext UI, Node
API, Playwright Chromium, generated scripts, reports, screenshots, rendered
HTML, and JSONL logs all run or persist on this machine under `data/`.

An optional hosted staging path is now implemented. One Node gateway owns the
public port, serves the public API landing page, protects `/control-plane` and
`/api-console`, and the unlinked operations dashboard, and proxies
authenticated `/api/*` traffic to the internal crawler API. PostgreSQL is
authoritative in hosted mode. OpenAI remains the only external
semantic-compute dependency.

The active production path now follows the required decision boundary:

1. generic browser sensing captures DOM, accessibility, screenshots, sections,
   guidance, options, and prior-state context;
2. the LLM proposes semantic fields and actions for a novel state;
3. safety validation admits or rejects those actions before storage;
4. a form-specific script records the accepted mechanics;
5. deterministic Playwright replay executes only those recorded mechanics.

No keyword, hostname, link-text, fixture registry, or answer key may decide an
action. A target with neither a retained script nor model access is
`script_missing`: observation only, zero actuation.

The current production path also:

- enters format-plausible synthetic values and verifies exact browser readback;
- exhaustively probes safe choice options from clean baselines;
- supports exactly one level of same-page branch expansion;
- populates each detected sibling variant and restores the final selected
  branch before terminal submit, clearing script-declared inactive sibling
  values so exploration data is not submitted;
- detects but does not execute cross-page conditional branching;
- retains partial contracts, exchanges, failures, and screenshots after safe
  halts;
- requires transport proof plus explicit rendered success markers before a
  normal synthetic crawl submission counts as successful, with a separately
  reported client-side exception requiring exact terminal actuation, material
  state change, and high-confidence rendered success markers;
- replays a retained immutable form script with zero traversal-model calls.
- assigns a unique `crawlId` to each crawl and a new crawl-scoped `formId` to
  every complete published form journey, including recrawls of the same URL;
- returns a client input JSON Schema, records approval against the exact
  form/script/hash, and runs approved dry-run or submit executions without
  persisting supplied values.

The public D5 vertical slice has **not passed**. The production retained-script
registry is not yet the canonical Gate-3 D1 lineage routed exclusively through
the one D3 executor. Automatic N+1 artifact allocation, operator version
selection, certification, execution-based drift, locale determinism, and the
public unseen-target attempt remain.

## Latest blind production audit

Full-cohort audit:
`data/production-corpus-audit/2026-07-28T22-51-54-336Z/summary.json`

Post-fix repeated L verification:

- `data/production-corpus-audit/2026-07-28T23-53-15-188Z/summary.json`
- `data/production-corpus-audit/2026-07-28T23-55-02-533Z/summary.json`

All 37 full-cohort runs froze before the scorer opened any
`ground_truth.yaml`. That run produced 36/37 functional passes. Its only miss
was nondeterministic disclosure sequencing on `site_l_gated`. The generic
disclosure contract was then corrected and L passed twice consecutively with
5/5 fields, 10 evidence images, and a verified submission. Combining the full
cohort with those post-fix repetitions gives the current measured position:

| Measure | Result |
| --- | ---: |
| Strict exact-oracle passes | 25/37 (67.6%) |
| Functional expected outcomes | 37/37 (100%) |
| Expected fields found | 244/244 (100%) |
| Evidence-bearing sites | 37/37 |
| Retained evidence captures | 391 |
| Production failures | 0 |
| Full-cohort model calls | 150 |
| Branch execution misses | 0 |
| Verified submissions | 25/25 attempted |
| Unsafe conditional submissions | 0 |
| Full automated suite | 90/90 executable checks; 1 optional PostgreSQL integration check skipped |

The twelve non-strict results are sensitivity-policy/oracle disagreements on
otherwise functionally correct outcomes. They remain review items rather than
being treated as traversal failures or “fixed” by weakening privacy policy.
The production corpus has no remaining known field-discovery, upload,
same-page-branch, cross-page-halt, CAPTCHA, evidence, or fixture-submission
failure in the supported Phase 1 envelope.

## Status by requirement area

| Requirement | Status | Current evidence and remaining work |
| --- | --- | --- |
| `F0` Phase 1 deliverable | **Partial** | Production generates, stores, validates, and deterministically replays form-specific scripts. Canonical D1/D3 routing and public D5 remain. |
| `F1.1–F1.3` rendered crawl/journey | **Partial** | Real Chromium accepts one starting URL and retains one cumulative multi-state journey. Heuristic related-page discovery is removed; the LLM alone may select exact observed actions toward one OneDegree-relevant resource-access form, with direct intake/application/access forms preferred and contact as fallback. Iframes/open shadow roots, waits, and scrolling work. Mid-flow entry warning, locale handling, and broad public selection proof remain. |
| `F1.3.4` form-specific actuation | **Built for current supported envelope** | Novel actions are LLM-authored and stored; replay is deterministic; readback is verified. No heuristic decider is active. |
| `F1.3.4.1` synthetic values | **Built** | Values are format-plausible by control and label while remaining conspicuously synthetic where formats allow it. |
| `F1.3.4.10–F1.3.4.12` validation | **Built for current supported envelope** | Ordinary controls, branch variants, disclosures, and harmless synthetic uploads use LLM-authored actions and exact browser readback under origin-neutral crawl policy. Fresh public proof remains. |
| `F1.3.5` journey accumulation | **Built for canonical starts** | All states, fields, actions, routes, and evidence survive later halts. Explicit mid-flow predecessor coverage remains. |
| `F1.4` question contract | **Partial** | Raw controls, labels, options, sections, guidance, provenance, validation, consent/admin/upload flags, and test values persist. Some metadata-policy mappings remain. |
| `F1.4.6` guidance | **Built for production generation** | First-class scoped guidance with kind/provenance reaches the LLM, runner, report, and UI. |
| `F1.4.7` sections | **Built** | DOM-derived trees and exact question membership reach the LLM, runner, report, and UI. |
| `F1.4.8` option semantics | **Built** | Group legends and per-option labels/values remain distinct. |
| `F1.4.9` consent semantics | **Partial — implementation generalized** | Consent/acknowledgement/review/signature are typed and LLM-authored synthetic actuation no longer depends on localhost component flags. The fresh three-page J crawl verified signature, review confirmation, and consent with all legacy flags false; equivalent public proof remains. |
| `F1.5` uncertified states | **Built** | Unknown/protected/unsupported states fail loudly and are never certified. |
| `F1.6` obstacles | **Partial** | Stable waits plus required fixed pointer and bounded document/frame/nested-container scrolling are shared physics. Cookie gates and every visible collapsed disclosure are LLM-authored actions; collapsed expandos block unrelated progression until opened once and re-sensed, while already-expanded controls cannot be reused. Generated-script interface 13 invalidates older retained scripts so recrawls regenerate under the current selection/discovery contract. Interactive CAPTCHA and required login produce explicit disqualified crawl/form eligibility; broader public proof remains. |
| `F1.7.9 / F16.6–F16.13` same-page branching | **Built for exactly one level** | Clean-baseline exhaustive option probes, additions-only visible-control deltas, sibling replay, variant population, selected-branch restoration, and depth-exceeded halt are implemented. |
| `F1.7.10 / F16.8–F16.13` cross-page branching | **Built as detection-only; execution intentionally unsupported** | Detected/uncertain dependence halts before dependent-page actuation or submit. Cross-page branch execution is outside the current product scope, not an outstanding implementation item. K and P passed this boundary. |
| `F1.4.2.1–F1.4.2.4` browser/API input contract | **Built** | Published schemas retain native names, option labels, browser hints, read-only/multiple state, date/time encodings, numeric step, and client-ready synthetic values from the pinned crawl script. Approved execution rejects malformed browser-native values before Chromium starts; existing form records derive the current schema from their pinned script when read. |
| `F1.8` quality floor | **Built for current corpus** | All 37 final-cohort runs retained useful artifacts; no empty false success or lost prior states. Validation exhaustion now retains a durable `could_not_test` artifact instead of collapsing into an empty run. |
| `F1.9` locale | **Not built** | Locale pinning, mismatch detection, variants, and locale-separated lineage remain. |
| `F2.1–F2.4` local artifacts/logs | **Built** | Rendered HTML, PNGs, reports, model/script records, and JSONL logs persist locally. |
| `F2.2.11` result confirmation | **Built** | Success requires exact terminal actuation and explicit LLM-authored rendered success markers. Normal forms also require submit/write transport; a client-side completion requires a material state change and reports its distinct basis. Decoy GET navigation fails. |
| `F2.2.12–F2.3.5` evidence integrity | **Built** | Model-sensing screenshots are transient. Reports retain a compact, labeled proof set around pre-action, selected branch, post-action, terminal result, and final failure boundaries; retained screenshots remain clickable and cumulative across pages. |
| `F2.5.4–F2.5.11` fingerprinting | **Built** | One versioned canonical DOM-fact implementation is used by production, lineage, harnesses, golden regression, and tests. |
| `F3` control-plane UI | **Partial** | Runs, contracts, guidance, sections, choices, four-layer exchanges, scripts, diagnostics, result proof, and local evidence are visible. The API console also renders fetched reports as evidence thumbnails and sectioned form/field summaries. Version/certification browsing remains. |
| `F3.11` headless/headful | **Built** | Both modes use the same production crawler locally. Hosted launch surfaces disable Headful and localhost-target controls, and the hosted API rejects bypass attempts. |
| `F3.12` settings | **Partial** | Typed settings and locked safety boundaries persist; free-form instructions do not yet alter planning. |
| `F3.13` crawl submit boundary | **Built** | The crawl API and API console independently expose `submit: false` traversal and `submit: true` synthetic terminal submission for public and allowed-local targets. Both use only LLM-authored scripts and include result confirmation. |
| `F3.15` option coverage | **Built for one-level envelope** | Probe outcomes, branch-producing choices, populated variants, and selected-branch restoration are reported. |
| `F3.16 / F3.18` traversal/four layers | **Built for generated and retained runs** | State cards expose sensing, semantic proposal, stored script/version/path/hash, deterministic execution/readback, flags, and evidence. |
| `F3.19` API-console report presentation | **Built** | A fetched report shows crawl totals, an ordered human-readable journey derived from the retained LLM-authored script, compact key-moment evidence thumbnails, and forms grouped into sections with field type and critical metadata. Raw report JSON and the declared evidence policy remain available. |
| `F3.19.5` API-console crawl-value prefill | **Built** | Retrieving a schema initializes editable Run API fields from its synthetic crawl-test payload, exposes a reset action, and labels values/files as test data rather than applicant data. |
| `F3.20` private operations dashboard | **Built** | The unlinked `/ops/audit-log` view summarizes login, API, crawl, approval, execution, and normalized LLM latency/outcome telemetry with time/category/severity filters, actor attribution, per-call-type average/p50/p95/max timing, and expandable safe metadata. Hosted access requires an authenticated UI user; API Bearer tokens and direct local audit-data requests are rejected. |
| `F4` local-first ownership | **Built** | The complete local UI/API/browser/artifact path remains. An optional authenticated hosted gateway now consolidates UI and API access without removing local operation. |
| `F4.1.3` localhost opt-in | **Built** | Loopback targets require explicit per-run opt-in. Terminal submission is a separate origin-neutral crawl choice. |
| `F4.6.1` hosted gateway | **Built locally; Heroku release pending** | One public process routes `/api/*`, protects the two operational UIs, serves compiled assets, and starts the API and UI on loopback-only internal ports. |
| `F4.6.2–F4.6.4` authentication | **Built for staging** | Seven individual UI accounts use salted scrypt password hashes and database-backed HttpOnly sessions. Five failures cause a 15-minute principal lock. API clients use a high-entropy Bearer token whose digest, scopes, status, and audit events are stored in PostgreSQL. Tenant-level authorization and production identity-provider integration remain. |
| `F4.6.5–F4.6.7` hosted boundaries/secrets | **Built for staging** | Hosted mode is headless-only, rejects private/loopback targets, treats `/tmp` as cache, and seeds credentials from a Git-ignored local file. Durable object storage for evidence remains. |
| `F4.6.8` operator-only dashboard authorization | **Built** | The dashboard page and data API accept the individual UI login/session boundary and explicitly deny integration Bearer tokens. The route is not linked, but authentication—not URL secrecy—is the access control. |
| `F6.7` unified operational audit | **Built** | Critical login, API, crawl, approval, execution, and normalized LLM call timing/outcome events are actor-aware and append-only in PostgreSQL, with a matching local JSONL fallback. Passwords, prompts, secrets, request bodies, entered values, file bytes, and screenshots are excluded. |
| `F5` model context | **Built for production generation** | Each novel state receives DOM, accessibility, screenshot, sections, guidance, options, history, and failure context with provenance. |
| `F6` observability | **Built** | Health, lifecycle, events, errors, paths, and interrupted-run reconciliation are inspectable. |
| `F7` safety | **Partial** | `submit: false` keeps terminal submission browser-blocked; `submit: true` opens a bounded final-action write window only for the LLM-authored terminal control. CAPTCHA solving, credential entry, and payment remain prohibited and CAPTCHA/login disqualify. Fresh public terminal-submit proof remains. |
| `F8` verification | **Partial** | Production build passes; 80 automated checks pass and one optional PostgreSQL integration check is skipped when its dedicated test URI is absent. The authenticated production smoke suite and blind 37-site local corpus are green. Public D5 remains. |
| `F8.9` execution conformance | **Built — conformance only** | Ground-truth-derived planners test physics, never discovery or flexibility. |
| `F8.9.9–F8.9.9.2` universal test submission capture | **Built** | The console proxy supports all registered public or local testforms sites, dispatcher routing cookies, latest/list/clear semantics, native-name comparison, arrays, filenames, and multi-step aggregation. Arbitrary hosts remain blocked. |
| `F8.9.8 / F8.10.3` oracle isolation | **Built** | Production audit freezes all artifacts before offline answer-key reads and regenerates per-form learning reports afterward. |
| `F8.10.4–F8.10.6` local corpus gate | **Built for supported envelope — 37/37 functional** | 244/244 fields, evidence on 37/37, zero failed runs, and 25/25 verified submissions. Twelve sensitivity-policy/oracle review items remain outside functional traversal. |
| `F9.12` script lineage | **Partial** | Immutable hash-linked `data/generated-scripts/<artifact>/vN` scripts preflight and replay. Canonical D1/N+1 remains. |
| `F9.13` version selection | **Not built** | UI/API cannot browse, pin, or choose an explicit script version. |
| `F9.14` certification | **Not built** | No human-only certification state machine or approved coverage record. |
| `F9.15` crawl/form identity and approval | **Built initial API slice** | Every crawl has a unique crawl ID; every complete published journey gets a new form ID. Form approval pins artifact ID, script version, and source hash. The first approved execution passed 10/10 fields and verified submission. Full coverage certification/version UI remains. |
| `F13` four-tier contract line | **Partial** | Typed contracts and isolated D3 exist; production retained-script replay is not yet routed exclusively through canonical D1/D3. |
| `F14` generation/repair loop | **Partial** | Production has novel-state generation, schema repair, immutable state storage, branch expansion, complete-script assembly, and retained replay. General canonical N+1 lineage remains. |
| `F14.1.1` binding safety | **Built** | Only accepted model-authored actions enter executable scripts; protected authority is rechecked at replay. |
| `F15` execution-based drift | **Not built** | Fault classification, re-crawl/regeneration verdicts, and stale-script enforcement remain. |
| `F16` dynamics | **Built for Phase 1 envelope** | Exactly one same-page level is supported. Cross-page branching has zero supported execution levels: it is detected, recorded, and halted. Unresolved coverage blocks submit. |

## Phase 2 status

| Requirement | Status | Current reality |
| --- | --- | --- |
| `F10` real-data runner | **Partial — first vertical slice works** | The authenticated API returns a typed input JSON Schema, records exact form approval, validates client data, deterministically executes the pinned script, supports dry-run/submit, and reports field/submission failure detail. Full certified coverage, tenant isolation, cancellation, and production security review remain. |
| `F10.12` real uploads | **Partial** | Inline client file objects are validated against captured type/extension and a 5 MB bound, held in memory, uploaded through the pinned script, and read back. Authenticated document references, configurable size/count policy, and wider production evidence masking remain. |
| `F10.13` coverage gate | **Not built** | Execution is not restricted to a human-certified coverage set. |
| `F11` conditional delta consumption | **Not built** | Phase 2 does not consume/enforce expand-only deltas. |
| `F12` masking | **Partial** | Approved execution persists only field keys, redacts event values, does not store input bytes/values, and redacts supplied scalar echoes and visible controls before post-submit model assessment. UI/session and Bearer-token authentication are built; comprehensive leak tests, tenant authorization, token lifecycle operations, and production secret-management review remain. |

## Verified evidence

- Blind 37-site production audit:
  `data/production-corpus-audit/2026-07-28T22-51-54-336Z/summary.json`.
- Post-fix disclosure repeat 1:
  `data/production-corpus-audit/2026-07-28T23-53-15-188Z/summary.json`.
- Post-fix disclosure repeat 2:
  `data/production-corpus-audit/2026-07-28T23-55-02-533Z/summary.json`.
- Current-code headful end-to-end verification:
  `data/runs/run_bf4942b9ce4c41/report.json`; visible Chromium, fresh
  `gpt-5.4-mini` generation, 7/7 populated fields, 8 screenshots, and verified
  loopback submission.
- Approved branch-form execution:
  `data/executions/exec_f0540f9c588e41699bfcf4f50ace4a38/execution.json`;
  form `form_4586281fa99f46b7a33c18aa8cbedba3`, 10/10 supplied
  fields verified, same-page branches selected, and submission verified.
- Fresh three-page crawl and retained-script recrawl:
  `data/runs/run_acc1a2d985a641/report.json` and
  `data/runs/run_b5726b70d73e4b/report.json`; the recrawl produced the distinct
  eligible form `form_4b480feb4b314fa98c126aab662fbd19` while retaining the
  same immutable script hash.
- Approved three-page upload/signature/consent execution:
  `data/executions/exec_e9d96bfeb35d4296a9655b39da874671/execution.json`;
  15/15 fields verified, inline PDF uploaded and read back, terminal HTTP 200,
  and rendered success verified. Execution artifacts contain neither supplied
  scalar values nor file bytes.
- Production build and serialized automated suite: **78 pass, 0 fail, 1
  optional PostgreSQL integration check skipped** on 2026-07-29.
- Authenticated production smoke verification: public landing and health,
  login redirect/page, Basic-to-session UI access, session/Basic/Bearer API
  access, Bearer rejection on human UI, lockout, hosted headful rejection, and
  hosted loopback rejection all passed on 2026-07-29.
- Fingerprint golden verification:
  `data/verification/fingerprint-task1-2026-07-24.json`.
- Gate 0:
  `data/verification/gate0-2026-07-24.json`.
- Gate 1:
  `data/verification/gate1-2026-07-24.json`.
- Gate 2:
  `data/verification/gate2-2026-07-24.json`.
- Gate 3:
  `data/verification/gate3-2026-07-24.json`.
- Gate 4:
  `data/verification/gate4-2026-07-24.json`.

## Immediate next work

Effort 1 in `NEXT_DEV_EFFORT.md` is complete for functional traversal. The
immediate work is Effort 2:

1. **Metadata-policy closure:** human-review the twelve sensitivity/oracle
   disagreements and approve one product taxonomy without weakening masking.
2. **Controlled real-data readiness:** finish canonical D1/D3 production
   cutover, full coverage certification, tenant authorization, execution
   cancellation/timeouts, comprehensive sensitive evidence leak tests,
   durable hosted evidence storage, and a frozen-framework unseen public
   holdout. Typed mapping, crawl-scoped approval, the first approved execution
   slice, staging UI authentication, and development Bearer access now exist.

The current slice can populate and submit an approved crawl-scoped form from
typed client data through an authenticated staging gateway. It is not yet a
production-secure multi-tenant service: coverage certification, tenant
authorization, durable browser-job execution and evidence storage,
comprehensive masking/leak tests, the public D5 attempt, locale variants, and
full drift automation remain release gates.
