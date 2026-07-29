# FormWeave crawl learnings — `site_f_veterans_required`

## Blind production run

- Run: `run_df7ed0b4a4f94d`
- Target: `http://localhost:9001/site_f_veterans_required/`
- Production status: `completed` — Crawl complete
- Model calls: 6 started, 6 completed, 0 failed
- Evidence PNGs retained: 21
- Field entries verified: 9
- Entry failures: 0
- Branch states: 2
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
- Field inventory coverage: 7/7 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| branch_of_service | yes | branch_of_service | match | match | not_sensitive | entered |
| discharge_status | yes | discharge_status | match | match | not_sensitive | entered |
| disability_rating | yes | disability_rating | n/a | mismatch | sensitive_policy_pattern | entered |
| service_start_year | yes | service_start_year | match | match | not_sensitive | entered |
| current_housing | yes | current_housing | match | match | not_sensitive | entered |

## What worked

- 7 expected field(s) were found.
- 21 local screenshot artifact(s) were retained and passed to report analysis where available.
- 6 novel state(s) received completed model proposals.
- 2 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `disability_rating`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 39799 bytes
- `page_01_generated_01_populated.png` — 86513 bytes
- `page_01_generated_02_post_advance.png` — 53687 bytes
- `page_01_generated_03_choice_probe.png` — 53292 bytes
- `page_01_generated_04_choice_probe.png` — 53320 bytes
- `page_01_generated_05_choice_probe.png` — 53760 bytes
- `page_01_generated_06_choice_probe.png` — 53394 bytes
- `page_01_generated_07_choice_probe.png` — 53688 bytes
- `page_01_generated_08_choice_probe.png` — 53607 bytes
- `page_01_generated_09_choice_probe.png` — 53056 bytes
- `page_01_generated_10_choice_probe.png` — 53151 bytes
- `page_01_generated_11_choice_probe.png` — 53274 bytes
- `page_01_generated_12_choice_probe.png` — 52764 bytes
- `page_01_generated_13_choice_probe.png` — 68052 bytes
- `page_01_generated_14_branch_variant_populated.png` — 68317 bytes
- `page_01_generated_15_choice_probe.png` — 67212 bytes
- `page_01_generated_16_branch_variant_populated.png` — 67212 bytes
- `page_01_generated_17_choice_probe.png` — 53060 bytes
- `page_01_generated_18_pre_advance.png` — 71044 bytes
- `page_01_generated_19_selected_branch_populated.png` — 70804 bytes
- `page_01_generated_20_submitted.png` — 39799 bytes

## Retained sources reviewed

- `data/runs/run_df7ed0b4a4f94d/events.jsonl`
- `data/runs/run_df7ed0b4a4f94d/run.json`
- `data/runs/run_df7ed0b4a4f94d/report.json`
- `localhost-test-sites/site_f_veterans_required/ground_truth.yaml`

