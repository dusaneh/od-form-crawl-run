# FormWeave crawl learnings — `site_h_multiservice`

## Blind production run

- Run: `run_c65240e533e34e`
- Target: `http://localhost:9001/site_h_multiservice/`
- Production status: `completed` — Crawl complete
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 13
- Field entries verified: 11
- Entry failures: 0
- Branch states: 0
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Submission received; Thank you. Your information has been submitted successfully.)

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: not applicable
- Field inventory coverage: 8/8 (100.0%)
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
| household_size | yes | household_size | match | match | not_sensitive | entered |
| programs | yes | programs | match | mismatch | sensitive_policy_pattern | entered |

## What worked

- 8 expected field(s) were found.
- 13 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `programs`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 40926 bytes
- `page_01_generated_01_populated.png` — 93195 bytes
- `page_01_generated_02_post_advance.png` — 63454 bytes
- `page_01_generated_03_choice_probe.png` — 63454 bytes
- `page_01_generated_04_choice_probe.png` — 63796 bytes
- `page_01_generated_05_choice_probe.png` — 63796 bytes
- `page_01_generated_06_choice_probe.png` — 63853 bytes
- `page_01_generated_07_choice_probe.png` — 63853 bytes
- `page_01_generated_08_choice_probe.png` — 63941 bytes
- `page_01_generated_09_choice_probe.png` — 63941 bytes
- `page_01_generated_10_choice_probe.png` — 63975 bytes
- `page_01_generated_11_pre_advance.png` — 65790 bytes
- `page_01_generated_12_submitted.png` — 40926 bytes

## Retained sources reviewed

- `data/runs/run_c65240e533e34e/events.jsonl`
- `data/runs/run_c65240e533e34e/run.json`
- `data/runs/run_c65240e533e34e/report.json`
- `localhost-test-sites/site_h_multiservice/ground_truth.yaml`

