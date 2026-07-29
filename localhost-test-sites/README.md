# test_sites/ — fixture sites & feature-test harness

Synthetic social-services websites used to verify Builder/Runner behavior
deterministically. Every site is a small static-HTML fixture served by
`server.py`; every crawling *feature* the backend must handle is embedded in at
least one site and wired to an assertable signal.

## Quick start

```bash
# 1. Serve the fixture sites on port 9000
cd test_sites
python server.py                     # uvicorn server:app --port 9000 --reload

# 2. Start the backend on port 8000 AGAINST THE SCRATCH DB (never the .env DB —
#    see "Test dev loop" in the repo CLAUDE.md for the scratch_pg setup)

# 3. Run the harness
python run_feature_tests.py --list                          # inventory (no servers needed)
python run_feature_tests.py --feature consent_gate_detection
python run_feature_tests.py --category branching
python run_feature_tests.py --all --report-dir reports/<name>
```

Harness environment: `TEST_SITES_BASE_URL` (default `http://localhost:9000`),
`BACKEND_BASE_URL` (default `http://localhost:8000`),
`FEATURE_TEST_DATABASE_URL` (scratch Postgres — required for cleanup; the
harness refuses to run if the backend is not isolated on it).

Categories accepted by `--category`: `field_level`, `branching`, `structure`,
`flow`, `uploads`, `gated_content`, `access_barriers`, `malformed_html`,
`drift`, `framework_guards`.

## URL scheme & server switches

- `http://localhost:9000/` — index of all sites (from `registry.yaml`).
- `/{site_id}/` — the site's landing page; `/{site_id}/intake` — the intake form.
- Nested pages up to 4 levels: `/{site_id}/{section}/[{sub}/[{subsub}/]]{page}`.
- **Variant switch** (drift fixtures, primarily `site_s_variants`):
  `GET /{site_id}/variant?n=N` serves `pages/intake.vN.html` at the *same*
  `/intake` URL; `GET /{site_id}/variant?reset` restores v1. Global state —
  drift tests run sequentially and always reset in a `finally`.
- The `/{site_id}/mutation/*` HTTP endpoints are **dead** (shadowed by the
  generic page routes → 404). The mutation engine (`mutation.py` +
  `<site>/mutations.yaml`) is driven in-process by the harness instead.
- `site_b_legalaid` responses embed a per-visit session token (replay-model
  fixture); other sites are stateless.

## Where the deterministic assertion metadata lives

| File | Role |
|---|---|
| `registry.yaml` | Which sites exist + the feature tags the server needs. One-line purpose per site. |
| `FEATURE_MATRIX.yaml` | **The coverage contract.** One entry per feature: the assertable `signal`, `primary_site`, `ground_truth_keys`, `runner_expectation`, `test_id`. The harness fails at startup if matrix↔tests aren't bijective. Also holds `fixture_realism` (which real-world DOM patterns fixtures reproduce). `FEATURE_MATRIX.md` is **generated** — run `python render_feature_matrix.py` after any matrix edit; never hand-edit the `.md`. |
| `<site>/ground_truth.yaml` | Per-site deterministic expectations (all 37 sites have one). See schema below. |
| `<site>/mutations.yaml` | Drift mutations for sites a–g (in-process engine). |
| `FINDINGS.md` | Failure-mode journal; pinned OPEN ITEMS at top. |
| `reports/<run>/` | Pass/fail ground truth for each harness run. |

### ground_truth.yaml schema

Core keys (scored by `scoring.py` / the benchmark):

- `site_id`, `org_name`, `intake_url`, `has_intake_form`, `form_type`,
  `requires_login`, `has_captcha`, `pdf_links`
- `expected_red_flag_codes` — red-flag codes the Builder should raise
- `expected_pages[]` — `page_index`, `is_terminal_submit`,
  `advance_is_server_roundtrip`
- `fields[]` — `name`, `label`, `field_type`, `required`, `is_sensitive`,
  `expected_canonical_key` (null = no canonical mapping), optional
  `expected_options` (asserted verbatim), `conditional: true` for
  JS-revealed fields

Extended keys (read by the feature harness's additive scorers, deliberately
**not** wired into `score_all()`): `expected_abort` (truthy = the Builder is
expected to abort/halt; the value names why — `branching`,
`cross_page_branching`, `probe_actuation_failed`), `expected_form_metadata`,
`expected_sections`, `expected_field_flags`, `expected_captcha_type`,
`expected_other_specify`, `image_challenge`. Keys prefixed `expected_` that no
scorer reads (e.g. `expected_branching`, `expected_absent_field_names`,
`expected_probe_failure_reason`) are deterministic documentation of the
fixture's contract — new tests may assert against them.

Fields on abort sites are inventory-for-reference: the crawl aborts before a
config exists, so they are never scored; the assertable signal is the abort
itself (event + no persisted config).

## Site catalog

Legend for "expected outcome": **config** = Builder emits a config and the auto
dry run completes; **abort** = Builder aborts WITHOUT persisting a config;
**halt+flag** = Builder emits a config but raises a blocking red flag and the
Runner pre-flight blocks.

| Site | Org | Features | Expected outcome |
|---|---|---|---|
| `site_a_shelter` | Hope House Shelter | baseline | config; `sensitive_field` (DOB) |
| `site_b_legalaid` | Community Legal Aid Society | session_token | config; replay-model validation |
| `site_c_veterans` | Veterans Resource Center | conditional_fields | support one-level same-page branch; probe, generate, populate, verify, and submit fixture |
| `site_d_food` | Food For All Community Pantry | malformed_html | config despite locator stress |
| `site_e_housing` | Safe Harbor Housing Alliance | captcha, sensitive_fields | **halt** — `interactive_captcha`, zero fields captured |
| `site_f_veterans_required` | Veterans Resource Center (Disability) | conditional_fields | support one-level same-page branch; required revealed field must verify before submit |
| `site_g_sensitive_nocaptcha` | Community Support Services | sensitive_fields, sections, file_upload, consent | config; end-to-end dry run; 4 fieldset sections, multi-file upload, consent outside sections |
| `site_h_multiservice` | Pacific Community Services | nested_navigation | config; nav-depth fixture, flat form |
| `site_i_dynamic_form` | Northwest Family Resources | nested_navigation, dynamic_form_fields | support all three independent one-level same-page branches |
| `site_j_paginated` | Riverside Community Services | pagination, file_upload, consent, sections, multiple_rows, admin_fields | config; 3 steps, terminal only on p3, repeatable rows (max 5), admin fields |
| `site_k_conditional` | Cascade Mobility Services | pagination, cross_page_branching | **abort** — cross-page conditional phrasing (high confidence) |
| `site_l_gated` | Summit Benefits Access | scroll_gated_consent, accordion, details, iframe, sections, consent | config; prepare_page must scroll/expand/recurse iframe, not click fake expander |
| `site_m_login_gate` | Gateway Housing Network | login_required | **halt+flag** — `login_required`; Runner pre-flight blocks |
| `site_n_payment` | Meridian Transitional Housing | payment_field | **halt+flag** — `payment_field` (blocking) |
| `site_o_invisible_captcha` | Harbor Point Outreach | invisible_captcha | config; `captcha_type=invisible`, Builder proceeds |
| `site_p_crosspage_echo` | Riverbend Services | cross_page_branching, echo_false_positive | `/intake`: **abort** — echoed value (medium). `/intake_safe`: config — short/numeric echoes must NOT trigger |
| `site_q_ambiguous_submit` | Cornerstone Assistance | ambiguous_submit | config; `ambiguous_submit` flag OR fail-safe terminal-without-advance (LLM variance, 2 attempts) |
| `site_r_edgecases` | Anchor Family Services | heading_sections, repeatable_false_positive, missing_options, failed_extract, unmappable_full_ssn, file_upload | config; h3-fallback sections, no false repeatable, `missing_options` + `failed_extract`, full SSN unmappable |
| `site_s_variants` | Lakeshore Aid Society | drift_variants | v2 add-optional → non-critical; v3 add-required → critical halt; v4 reorder → cosmetic, no version bump |
| `site_t_challenges` | Northgate Relief Center | interactive_captcha, vision_escalation | **halt** — both `/intake` (text math) and `/intake_image` (image CAPTCHA → vision escalation); never solve |
| `site_u_other_specify` | Lakeside Community Resources | other_specify | config; "Other, specify" companions captured as conditional (`is_specify_field`), NOT branching |
| `site_v_slds_branching` | Bayshore Utility Assistance | conditional_fields, slds_controls | support one-level branching behind SLDS label-interception controls (BR-1 regression) |
| `site_w_probe_lockout` | Harborview Aid Network | probe_lockout | **abort** — `probe_actuation_failed`; must NOT certify linear |
| `site_x_hidden_choice` | Crestline Community Fund | hidden_native_choice | **abort** — `probe_actuation_failed` (reason `locators_unresolved`) |
| `site_y_readback_echo` | Meadowbrook Housing Trust | readback_echo | config; step-2 screenshot must contain a black mask over the echoed income |
| `site_z_interaction_gated` | Sierra Vista Energy Fund | interaction_gated_js | config; form appears only after prepare_page's interaction nudge |
| `site_ab_decoy_forms` | Foothill Family Alliance | decoy_forms | config; intake form must out-rank 3 decoy widget forms; no `s`/`nl_email` field captured |
| `site_ac_div_intake` | Riverstone Family Center | div_form, ambiguous_submit, sensitive_fields, heading_sections, missing_options, failed_extract, unmappable_full_ssn | config; div-built application (no `<form>`), two `type=button` controls, h2 sections, empty select, no-input star widget, full SSN |
| `site_ad_wizard_links` | Blue Spruce Employment Alliance | link_navigation, pagination, multiple_rows, repeatable_false_positive, admin_fields, echo_false_positive | config; 3 steps advanced via `<a>` links (steps 1–2 have no `<form>`), add-row jobs (cap 4), fixed 2-slot references, staff questions on step 3 |
| `site_ae_deep_portal` | Cedar Valley Community Portal | nested_navigation, decoy_forms, sections, file_upload, consent | config; application 4 nav levels deep; 3 widget forms around the real one; 2-file/5MB upload; consent outside fieldsets |
| `site_af_branch_cards` | Harvest Hill Assistance Fund | conditional_fields, slds_controls, other_specify | one-level same-page reveals behind SLDS-style cards; landlord field required when visible; "Other" reveals a specify box |
| `site_ag_widget_maze` | Foxglove Relief Collective | probe_lockout, hidden_native_choice | **abort** — `probe_actuation_failed`; one group swallows all pointer events, the other's native radios never render |
| `site_ah_member_gate` | Ironwood Veterans Outreach | login_required, session_token, div_form | **halt+flag** — `login_required`; div-modal sign-in (no `<form>`), fresh per-visit `_session` value |
| `site_ai_fee_verify` | Sunrise Transitional Services | payment_field, invisible_captcha, interactive_captcha, vision_escalation | `/intake`: **halt+flag** — `payment_field`, `captcha_type=invisible`. `/intake_challenge`: `interactive_captcha` (text question + data: img challenge) |
| `site_aj_patience_portal` | Willowbrook Senior Aid | interaction_gated_js, table_layout, scroll_gated_consent, iframe, details, accordion | config; form revealed on first interaction; table-row layout; iframe scroll unlocks disabled consent; required field in closed `<details>` |
| `site_ak_flow_dependent` | Aspen Grove Housing Cooperative | malformed_html, cross_page_branching, echo_positive | `/intake`: **abort** — step 1 malformed, step 2 phrased around the step-1 answer. `/intake_echo`: step 2 repeats the step-1 last name verbatim |
| `site_al_ledger_drift` | Maple Union Resource Exchange | drift_variants, readback_echo, sensitive_fields, pagination | config; step 2 echoes entered income as display text (no pure-black styling); v2 +optional, v3 +required, v4 reorder at the same URL |

Full per-feature expectations (signals, detectors, test ids) are in
`FEATURE_MATRIX.yaml`; per-site field-level expectations are in each
`<site>/ground_truth.yaml`. When they disagree with observed behavior, the
matrix + ground truth are the contract — file the discrepancy in `FINDINGS.md`.

## Adding a site or feature

1. Create `site_<letter>_<slug>/pages/` with at least `intake.html`; register it
   in `registry.yaml` (features + one-line `tests` purpose).
2. Write its `ground_truth.yaml` (schema above). Abort sites still get a field
   inventory, marked reference-only.
3. Add a feature entry to `FEATURE_MATRIX.yaml` with `test_id: t_<feature_id>`,
   implement the assertion in `run_feature_tests.py` (the harness startup check
   enforces the bijection), then `python render_feature_matrix.py`.
4. Record the real-world DOM pattern the fixture reproduces under
   `fixture_realism` in the matrix — a live-site failure is only "resolved" with
   a reproducing fixture AND a grep-audit of the pattern class (CLAUDE.md rule 4).

## Other tools in this directory

- `run_benchmark.py` — end-to-end Builder benchmark with field-recall scoring
  (`scoring.py`) against ground truth; branching aborts score as valid when
  `expected_abort` is truthy.
- `form_report.py` — per-site "form autopsy" reports (`--report-dir` adds these
  to harness runs).
- `run_acceptance_tests.py`, `run_validation.py`, `aggregate_runs.py` — legacy /
  aggregate tooling predating the feature harness.
- `feature_tests/test_framework_guards.py` — pytest units for framework-level
  guards (no crawl needed); folded into harness results.
