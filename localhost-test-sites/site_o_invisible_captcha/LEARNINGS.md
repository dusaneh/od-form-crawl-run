# FormWeave crawl learnings — `site_o_invisible_captcha`

## Blind production run

- Run: `run_c21086975bb74e`
- Target: `http://localhost:9001/site_o_invisible_captcha/`
- Production status: `completed` — Crawl complete
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 8
- Field entries verified: 5
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
- Field inventory coverage: 5/5 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| current_situation | yes | current_situation | match | match | not_sensitive | entered |

## What worked

- 5 expected field(s) were found.
- 8 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 17931 bytes
- `page_01_generated_01_populated.png` — 13302 bytes
- `page_01_generated_02_post_advance.png` — 23642 bytes
- `page_01_generated_03_choice_probe.png` — 23957 bytes
- `page_01_generated_04_choice_probe.png` — 24170 bytes
- `page_01_generated_05_choice_probe.png` — 23900 bytes
- `page_01_generated_06_pre_advance.png` — 29922 bytes
- `page_01_generated_07_submitted.png` — 17931 bytes

## Retained sources reviewed

- `data/runs/run_c21086975bb74e/events.jsonl`
- `data/runs/run_c21086975bb74e/run.json`
- `data/runs/run_c21086975bb74e/report.json`
- `localhost-test-sites/site_o_invisible_captcha/ground_truth.yaml`

