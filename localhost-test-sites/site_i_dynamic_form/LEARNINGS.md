# FormWeave crawl learnings — `site_i_dynamic_form`

## Blind production run

- Run: `run_80be408700244c`
- Target: `http://localhost:9001/site_i_dynamic_form/`
- Production status: `completed` — Crawl complete
- Model calls: 11 started, 11 completed, 0 failed
- Evidence PNGs retained: 38
- Field entries verified: 27
- Entry failures: 0
- Branch states: 7
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
- Field inventory coverage: 17/17 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| dob | yes | dob | match | match | sensitive_policy_pattern | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| zip_code | yes | zip_code | match | match | not_sensitive | entered |
| applicant_type | yes | applicant_type | match | match | not_sensitive | entered |
| num_children | yes | num_children | n/a | match | not_sensitive | entered |
| youngest_age | yes | youngest_age | n/a | match | not_sensitive | entered |
| partner_name | yes | partner_name | n/a | match | not_sensitive | entered |
| housing_status | yes | housing_status | match | match | not_sensitive | entered |
| unhoused_months | yes | unhoused_months | n/a | match | not_sensitive | entered |
| current_shelter | yes | current_shelter | n/a | match | not_sensitive | entered |
| eviction_date | yes | eviction_date | n/a | match | not_sensitive | entered |
| is_veteran | yes | is_veteran | match | match | not_sensitive | entered |
| discharge_type | yes | discharge_type | n/a | match | non_sensitive_classification_selector | entered |
| service_branch | yes | service_branch | n/a | mismatch | sensitive_model_classification | entered |

## What worked

- 17 expected field(s) were found.
- 38 local screenshot artifact(s) were retained and passed to report analysis where available.
- 11 novel state(s) received completed model proposals.
- 7 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `service_branch`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 36742 bytes
- `page_01_generated_01_populated.png` — 79893 bytes
- `page_01_generated_02_post_advance.png` — 57528 bytes
- `page_01_generated_03_choice_probe.png` — 57380 bytes
- `page_01_generated_04_choice_probe.png` — 65455 bytes
- `page_01_generated_05_branch_variant_populated.png` — 67741 bytes
- `page_01_generated_06_choice_probe.png` — 62622 bytes
- `page_01_generated_07_branch_variant_populated.png` — 62622 bytes
- `page_01_generated_08_choice_probe.png` — 63532 bytes
- `page_01_generated_09_branch_variant_populated.png` — 64054 bytes
- `page_01_generated_10_choice_probe.png` — 64112 bytes
- `page_01_generated_11_choice_probe.png` — 69587 bytes
- `page_01_generated_12_branch_variant_populated.png` — 69531 bytes
- `page_01_generated_13_choice_probe.png` — 69840 bytes
- `page_01_generated_14_branch_variant_populated.png` — 72019 bytes
- `page_01_generated_15_choice_probe.png` — 67922 bytes
- `page_01_generated_16_branch_variant_populated.png` — 68449 bytes
- `page_01_generated_17_choice_probe.png` — 64389 bytes
- `page_01_generated_18_choice_probe.png` — 64389 bytes
- `page_01_generated_19_choice_probe.png` — 71091 bytes
- `page_01_generated_20_choice_probe.png` — 70844 bytes
- `page_01_generated_21_choice_probe.png` — 71965 bytes
- `page_01_generated_22_choice_probe.png` — 71303 bytes
- `page_01_generated_23_choice_probe.png` — 70812 bytes
- `page_01_generated_24_choice_probe.png` — 71041 bytes
- `page_01_generated_25_choice_probe.png` — 70563 bytes
- `page_01_generated_26_choice_probe.png` — 70597 bytes
- `page_01_generated_27_choice_probe.png` — 70676 bytes
- `page_01_generated_28_choice_probe.png` — 71051 bytes
- `page_01_generated_29_choice_probe.png` — 70971 bytes
- `page_01_generated_30_choice_probe.png` — 70893 bytes
- `page_01_generated_31_choice_probe.png` — 71035 bytes
- `page_01_generated_32_branch_variant_populated.png` — 70359 bytes
- `page_01_generated_33_pre_advance.png` — 85106 bytes
- `page_01_generated_34_selected_branch_populated.png` — 85098 bytes
- `page_01_generated_35_selected_branch_populated.png` — 85223 bytes
- `page_01_generated_36_selected_branch_populated.png` — 85223 bytes
- `page_01_generated_37_submitted.png` — 36742 bytes

## Retained sources reviewed

- `data/runs/run_80be408700244c/events.jsonl`
- `data/runs/run_80be408700244c/run.json`
- `data/runs/run_80be408700244c/report.json`
- `localhost-test-sites/site_i_dynamic_form/ground_truth.yaml`

