# Blind production corpus progress

## Current verified position

The latest full-cohort production audit is:

`data/production-corpus-audit/2026-07-28T22-51-54-336Z/summary.json`

It ran all 37 localhost fixtures through the production API, fresh
`gpt-5.4-mini` semantic generation, Playwright actuation, evidence capture,
reporting, and loopback-only completion verification. Every run and generated
artifact froze before the offline scorer opened any `ground_truth.yaml`.

That full run was 36/37 functionally green. Its only miss was
`site_l_gated`, where disclosure sequencing was nondeterministic. The shared
disclosure contract was fixed, then the site passed twice consecutively:

- `data/production-corpus-audit/2026-07-28T23-53-15-188Z/summary.json`
- `data/production-corpus-audit/2026-07-28T23-55-02-533Z/summary.json`

The current result is therefore a full 36/37 frozen cohort plus two independent
post-fix passes for the one prior miss. It is intentionally not described as a
single post-fix 37-site run.

## Measured result

| Measure | Original 25-site baseline | Previous comparable result | Current expanded corpus |
| --- | ---: | ---: | ---: |
| Expected fields captured | 85/155 (54.8%) | 129/155 (83.2%) | 244/244 (100%) |
| Sites with screenshot evidence | 13/25 (52%) | 20/25 (80%) | 37/37 (100%) |
| Outright failed runs | 12/25 | 5/25 | 0/37 |
| Functional blocking discrepancies | 21/25 | 10/25 | 0/37 |
| Strict exact-oracle passes | 0/25 | 5/25 | 25/37 (67.6%) |
| Verified fixture submissions | not comparable | not comparable | 25/25 attempted |
| Automated tests | not comparable | not comparable | 71/71 |

Additional current facts:

- 391 evidence captures across the combined current verification;
- 150 model calls in the full 37-site cohort;
- zero branch-execution misses;
- zero unsafe conditional submissions;
- zero remaining known upload failures in the supported loopback envelope.

The denominator expanded from 25 sites and 155 fields to 37 sites and 244
fields. The current score is therefore broader as well as higher.

### Added AC-AL cohort

The ten fixtures `site_ac_div_intake` through `site_al_ledger_drift` are
automatically discovered from the test-site directory and were included in the
blind production audit above:

| Measure | AC-AL result |
| --- | ---: |
| Functional expected outcomes | 10/10 |
| Expected fields captured | 65/65 |
| Evidence captures | 99 |
| Failed production runs | 0 |
| Verified submissions | 6/6 attempted |
| Strict exact-oracle passes | 8/10 |

The two non-strict results are sensitivity-metadata reviews on
`site_ae_deep_portal` and `site_aj_patience_portal`; both were functionally
correct. Ground truth was read only by the offline scorer after all ten run
artifacts had frozen.

## How to read 25/37 strict versus 37/37 functional

Twelve forms are functionally correct but differ from their scorer oracle on
sensitivity metadata:

| Form | Fields requiring policy review |
| --- | --- |
| `site_ae_deep_portal` | `proof_docs` |
| `site_aj_patience_portal` | `birth_year`, `mobility_needs` |
| `site_c_veterans` | `disability_rating` |
| `site_e_housing` | `phone`, `email` |
| `site_f_veterans_required` | `disability_rating` |
| `site_g_sensitive_nocaptcha` | `supporting_documents` |
| `site_h_multiservice` | `programs` |
| `site_i_dynamic_form` | `service_branch` |
| `site_j_paginated` | `supporting_document` |
| `site_n_payment` | `card_expiry`, `amount` |
| `site_r_edgecases` | `proof_of_income`, `other_documents` |
| `site_v_slds_branching` | `prog_ssi`, `prog_medicaid` |

These are not missing fields, failed entries, failed traversals, or false
submission claims. Some oracles are internally inconsistent with their own
comments. They require a human product-policy decision; production privacy
treatment will not be weakened to manufacture a higher strict score.

## What this effort closed

- **LLM-authored traversal:** novel-state actions come from the model and are
  stored before deterministic replay; shared code does not choose actions from
  labels, keywords, hostnames, or fixture identities.
- **Field discovery:** 244/244 expected fields were found.
- **Field entry:** supported fields receive format-plausible synthetic values
  with exact browser readback.
- **Same-page dynamics:** one level of option-driven branching is probed from
  clean baselines, populated, verified, and reported.
- **Cross-page dynamics:** dependence is detected and halts before unsupported
  dependent execution or submission.
- **Disclosures and gates:** pending disclosures block unrelated progression;
  exhausted disclosures cannot be reused as progression.
- **Uploads:** harmless loopback files are generated generically from observed
  constraints, attached only by LLM-authored actions, and verified by readback.
- **CAPTCHA and protected boundaries:** interactive challenges halt with
  retained evidence; passive challenges do not create false blockers.
- **Completion proof:** exact terminal actuation plus rendered success evidence
  is required; transport proof is required except for the separately reported
  client-side loopback result contract.
- **Reporting:** every site retains screenshots, fields, state exchanges,
  actions, readbacks, failure history, and terminal-result criteria.
- **Oracle isolation:** ground truth is unavailable during crawling and
  generation and is read only after frozen artifacts exist.

## Remaining work

The local supported Phase 1 functional envelope is green. The next effort is
not another fixture-specific patch cycle. It is the controlled real-data
boundary:

1. human-approve the sensitivity taxonomy and reconcile the twelve oracle
   disagreements;
2. route production artifacts exclusively through canonical D1/D3 with
   automatic N+1 lineage;
3. add UI/API version inspection, explicit pinning, and human certification;
4. add a typed semantic-key real-user payload with complete preflight;
5. enforce exact certified coverage in non-submitting `dry-run`;
6. mask real sensitive values in screenshots, logs, reports, and model
   exchanges; and
7. pass a frozen-framework unseen holdout without shared-code or hostname
   exceptions.

Production public submission, real-document upload, locale variants, and full
execution-based drift automation remain later safety gates.
