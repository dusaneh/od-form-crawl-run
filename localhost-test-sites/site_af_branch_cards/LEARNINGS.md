# FormWeave crawl learnings — `site_af_branch_cards`

## Blind production run

- Run: `run_c992f989489242`
- Target: `http://localhost:9001/site_af_branch_cards/`
- Production status: `completed` — Crawl complete
- Model calls: 10 started, 10 completed, 0 failed
- Evidence PNGs retained: 20
- Field entries verified: 16
- Entry failures: 0
- Branch states: 4
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Submission received; Thank you. Your information has been submitted successfully.)

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: yes
- Field inventory coverage: 11/11 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| zip_code | yes | zip_code | match | match | not_sensitive | entered |
| housing_type | yes | housing_type | match | match | not_sensitive | entered |
| landlord_name | yes | landlord_name | n/a | match | not_sensitive | entered |
| monthly_rent | yes | monthly_rent | n/a | match | not_sensitive | entered |
| mortgage_lender | yes | mortgage_lender | n/a | match | not_sensitive | entered |
| referral_source | yes | referral_source | match | match | not_sensitive | entered |
| referral_other | yes | referral_other | n/a | match | not_sensitive | entered |
| has_children | yes | has_children | match | match | not_sensitive | entered |
| children_count | yes | children_count | n/a | match | not_sensitive | entered |
| school_district | yes | school_district | n/a | match | not_sensitive | entered |

## What worked

- 11 expected field(s) were found.
- 20 local screenshot artifact(s) were retained and passed to report analysis where available.
- 10 novel state(s) received completed model proposals.
- 4 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22677 bytes
- `page_01_generated_01_populated.png` — 15906 bytes
- `page_01_generated_02_post_advance.png` — 33259 bytes
- `page_01_generated_03_choice_probe.png` — 39439 bytes
- `page_01_generated_04_branch_variant_populated.png` — 42164 bytes
- `page_01_generated_05_choice_probe.png` — 35298 bytes
- `page_01_generated_06_branch_variant_populated.png` — 37535 bytes
- `page_01_generated_07_choice_probe.png` — 37753 bytes
- `page_01_generated_08_choice_probe.png` — 37924 bytes
- `page_01_generated_09_choice_probe.png` — 37672 bytes
- `page_01_generated_10_choice_probe.png` — 39555 bytes
- `page_01_generated_11_branch_variant_populated.png` — 40369 bytes
- `page_01_generated_12_choice_probe.png` — 40369 bytes
- `page_01_generated_13_choice_probe.png` — 44117 bytes
- `page_01_generated_14_branch_variant_populated.png` — 45811 bytes
- `page_01_generated_15_pre_advance.png` — 52558 bytes
- `page_01_generated_16_selected_branch_populated.png` — 54372 bytes
- `page_01_generated_17_selected_branch_populated.png` — 54286 bytes
- `page_01_generated_18_selected_branch_populated.png` — 52717 bytes
- `page_01_generated_19_submitted.png` — 22677 bytes

## Retained sources reviewed

- `data/runs/run_c992f989489242/events.jsonl`
- `data/runs/run_c992f989489242/run.json`
- `data/runs/run_c992f989489242/report.json`
- `localhost-test-sites/site_af_branch_cards/ground_truth.yaml`

