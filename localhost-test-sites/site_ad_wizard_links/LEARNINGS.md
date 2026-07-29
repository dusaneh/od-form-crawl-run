# FormWeave crawl learnings — `site_ad_wizard_links`

## Blind production run

- Run: `run_4eaea73948b146`
- Target: `http://localhost:9001/site_ad_wizard_links/`
- Production status: `completed` — Crawl complete
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 17
- Field entries verified: 11
- Entry failures: 0
- Branch states: 0
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Enrollment Submitted; Thank you. A Blue Spruce coach will contact you within five business days.)

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: not applicable
- Field inventory coverage: 11/11 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| household_size | yes | household_size | match | match | not_sensitive | entered |
| job_1_employer | yes | job_1_employer | match | match | not_sensitive | entered |
| job_1_months | yes | job_1_months | match | match | not_sensitive | entered |
| reference_1_name | yes | reference_1_name | match | match | not_sensitive | entered |
| reference_2_name | yes | reference_2_name | match | match | not_sensitive | entered |
| referral_source | yes | referral_source | match | match | not_sensitive | entered |
| staff_helper | yes | staff_helper | match | match | not_sensitive | entered |
| applicant_signature | yes | applicant_signature | match | match | not_sensitive | entered |
| review_confirm | yes | review_confirm | match | match | not_sensitive | entered |

## What worked

- 11 expected field(s) were found.
- 17 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 16248 bytes
- `page_01_generated_01_populated.png` — 17449 bytes
- `page_01_generated_02_post_advance.png` — 18837 bytes
- `page_01_generated_03_populated.png` — 21437 bytes
- `page_01_generated_04_post_advance.png` — 29309 bytes
- `page_01_generated_05_populated.png` — 31436 bytes
- `page_01_generated_06_post_advance.png` — 34211 bytes
- `page_01_generated_07_choice_probe.png` — 34682 bytes
- `page_01_generated_08_choice_probe.png` — 34289 bytes
- `page_01_generated_09_choice_probe.png` — 34238 bytes
- `page_01_generated_10_choice_probe.png` — 34262 bytes
- `page_01_generated_11_choice_probe.png` — 34262 bytes
- `page_01_generated_12_choice_probe.png` — 34358 bytes
- `page_01_generated_13_choice_probe.png` — 34358 bytes
- `page_01_generated_14_choice_probe.png` — 34428 bytes
- `page_01_generated_15_pre_advance.png` — 36475 bytes
- `page_01_generated_16_submitted.png` — 16248 bytes

## Retained sources reviewed

- `data/runs/run_4eaea73948b146/events.jsonl`
- `data/runs/run_4eaea73948b146/run.json`
- `data/runs/run_4eaea73948b146/report.json`
- `localhost-test-sites/site_ad_wizard_links/ground_truth.yaml`

