# FormWeave crawl learnings — `site_v_slds_branching`

## Blind production run

- Run: `run_98b6c081b9144e`
- Target: `http://localhost:9001/site_v_slds_branching/intake`
- Production status: `completed` — Crawl complete
- Model calls: 6 started, 6 completed, 0 failed
- Evidence PNGs retained: 22
- Field entries verified: 15
- Entry failures: 0
- Branch states: 3
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
- Field inventory coverage: 12/12 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| zip_code | yes | zip_code | match | match | not_sensitive | entered |
| qual_method | yes | qual_method | match | match | non_sensitive_classification_selector | entered |
| income_amount | yes | income_amount | n/a | match | sensitive_policy_pattern | entered |
| fixed_income | yes | fixed_income | n/a | match | non_sensitive_fixed_income_status | entered |
| prog_snap | yes | prog_snap | n/a | match | not_sensitive | entered |
| prog_ssi | yes | prog_ssi | n/a | mismatch | sensitive_model_classification | entered |
| prog_medicaid | yes | prog_medicaid | n/a | mismatch | sensitive_model_classification | entered |
| prog_liheap | yes | prog_liheap | n/a | match | not_sensitive | entered |
| helper_group | yes | helper_group | match | match | not_sensitive | entered |
| worker_id | yes | worker_id | n/a | match | not_sensitive | entered |

## What worked

- 12 expected field(s) were found.
- 22 local screenshot artifact(s) were retained and passed to report analysis where available.
- 6 novel state(s) received completed model proposals.
- 3 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `prog_ssi`, `prog_medicaid`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 21359 bytes
- `page_01_generated_01_choice_probe.png` — 31160 bytes
- `page_01_generated_02_choice_probe.png` — 33244 bytes
- `page_01_generated_03_branch_variant_populated.png` — 34511 bytes
- `page_01_generated_04_choice_probe.png` — 38650 bytes
- `page_01_generated_05_choice_probe.png` — 38650 bytes
- `page_01_generated_06_choice_probe.png` — 38654 bytes
- `page_01_generated_07_branch_variant_populated.png` — 41994 bytes
- `page_01_generated_08_choice_probe.png` — 42102 bytes
- `page_01_generated_09_choice_probe.png` — 42102 bytes
- `page_01_generated_10_choice_probe.png` — 42111 bytes
- `page_01_generated_11_choice_probe.png` — 42111 bytes
- `page_01_generated_12_choice_probe.png` — 42117 bytes
- `page_01_generated_13_choice_probe.png` — 42117 bytes
- `page_01_generated_14_choice_probe.png` — 42121 bytes
- `page_01_generated_15_choice_probe.png` — 42121 bytes
- `page_01_generated_16_choice_probe.png` — 42124 bytes
- `page_01_generated_17_branch_variant_populated.png` — 42124 bytes
- `page_01_generated_18_pre_advance.png` — 41843 bytes
- `page_01_generated_19_selected_branch_populated.png` — 42007 bytes
- `page_01_generated_20_selected_branch_populated.png` — 44778 bytes
- `page_01_generated_21_submitted.png` — 21359 bytes

## Retained sources reviewed

- `data/runs/run_98b6c081b9144e/events.jsonl`
- `data/runs/run_98b6c081b9144e/run.json`
- `data/runs/run_98b6c081b9144e/report.json`
- `localhost-test-sites/site_v_slds_branching/ground_truth.yaml`

