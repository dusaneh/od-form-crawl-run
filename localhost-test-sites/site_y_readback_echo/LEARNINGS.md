# FormWeave crawl learnings — `site_y_readback_echo`

## Blind production run

- Run: `run_20cb732711b548`
- Target: `http://localhost:9001/site_y_readback_echo/intake`
- Production status: `completed` — Crawl complete
- Model calls: 5 started, 5 completed, 0 failed
- Evidence PNGs retained: 7
- Field entries verified: 3
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
- Field inventory coverage: 3/3 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| monthly_income | yes | monthly_income | match | match | sensitive_policy_pattern | entered |
| confirm_accurate | yes | confirm_accurate | match | match | not_sensitive | entered |

## What worked

- 3 expected field(s) were found.
- 7 local screenshot artifact(s) were retained and passed to report analysis where available.
- 5 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22501 bytes
- `page_01_generated_01_populated.png` — 21347 bytes
- `page_01_generated_02_post_advance.png` — 17382 bytes
- `page_01_generated_03_choice_probe.png` — 17382 bytes
- `page_01_generated_04_choice_probe.png` — 17520 bytes
- `page_01_generated_05_pre_advance.png` — 17520 bytes
- `page_01_generated_06_submitted.png` — 22501 bytes

## Retained sources reviewed

- `data/runs/run_20cb732711b548/events.jsonl`
- `data/runs/run_20cb732711b548/run.json`
- `data/runs/run_20cb732711b548/report.json`
- `localhost-test-sites/site_y_readback_echo/ground_truth.yaml`

