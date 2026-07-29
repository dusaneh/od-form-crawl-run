# FormWeave crawl learnings — `site_b_legalaid`

## Blind production run

- Run: `run_876c27621daf4f`
- Target: `http://localhost:9001/site_b_legalaid/`
- Production status: `completed` — Crawl complete
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 14
- Field entries verified: 7
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
| email | yes | email | match | match | not_sensitive | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| legal_issue | yes | legal_issue | match | match | non_sensitive_classification_selector | entered |
| income_level | yes | income_level | match | match | sensitive_policy_pattern | entered |
| case_description | yes | case_description | match | match | not_sensitive | entered |

## What worked

- 7 expected field(s) were found.
- 14 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 39457 bytes
- `page_01_generated_01_populated.png` — 82052 bytes
- `page_01_generated_02_post_advance.png` — 61204 bytes
- `page_01_generated_03_choice_probe.png` — 60748 bytes
- `page_01_generated_04_choice_probe.png` — 60551 bytes
- `page_01_generated_05_choice_probe.png` — 60568 bytes
- `page_01_generated_06_choice_probe.png` — 60760 bytes
- `page_01_generated_07_choice_probe.png` — 61209 bytes
- `page_01_generated_08_choice_probe.png` — 61437 bytes
- `page_01_generated_09_choice_probe.png` — 61613 bytes
- `page_01_generated_10_choice_probe.png` — 61422 bytes
- `page_01_generated_11_choice_probe.png` — 61592 bytes
- `page_01_generated_12_pre_advance.png` — 66153 bytes
- `page_01_generated_13_submitted.png` — 39457 bytes

## Retained sources reviewed

- `data/runs/run_876c27621daf4f/events.jsonl`
- `data/runs/run_876c27621daf4f/run.json`
- `data/runs/run_876c27621daf4f/report.json`
- `localhost-test-sites/site_b_legalaid/ground_truth.yaml`

