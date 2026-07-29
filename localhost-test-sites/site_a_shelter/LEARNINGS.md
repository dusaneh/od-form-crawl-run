# FormWeave crawl learnings — `site_a_shelter`

## Blind production run

- Run: `run_d231cd074fb342`
- Target: `http://localhost:9001/site_a_shelter/`
- Production status: `completed` — Crawl complete
- Model calls: 2 started, 2 completed, 0 failed
- Evidence PNGs retained: 8
- Field entries verified: 7
- Entry failures: 0
- Branch states: 0
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Submission received; Thank you. Your information has been submitted successfully.; submitted successfully)

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: not applicable
- Field inventory coverage: 7/7 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| dob | yes | dob | match | match | sensitive_policy_pattern | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| household_size | yes | household_size | match | match | not_sensitive | entered |
| current_situation | yes | current_situation | match | match | not_sensitive | entered |

## What worked

- 7 expected field(s) were found.
- 8 local screenshot artifact(s) were retained and passed to report analysis where available.
- 2 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 36215 bytes
- `page_01_generated_01_populated.png` — 69846 bytes
- `page_01_generated_02_post_advance.png` — 50946 bytes
- `page_01_generated_03_choice_probe.png` — 50590 bytes
- `page_01_generated_04_choice_probe.png` — 50563 bytes
- `page_01_generated_05_choice_probe.png` — 50658 bytes
- `page_01_generated_06_pre_advance.png` — 52152 bytes
- `page_01_generated_07_submitted.png` — 36215 bytes

## Retained sources reviewed

- `data/runs/run_d231cd074fb342/events.jsonl`
- `data/runs/run_d231cd074fb342/run.json`
- `data/runs/run_d231cd074fb342/report.json`
- `localhost-test-sites/site_a_shelter/ground_truth.yaml`

