# FormWeave crawl learnings — `site_s_variants`

## Blind production run

- Run: `run_cf34912989fc47`
- Target: `http://localhost:9001/site_s_variants/`
- Production status: `completed` — Crawl complete
- Model calls: 3 started, 3 completed, 0 failed
- Evidence PNGs retained: 8
- Field entries verified: 4
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
- Field inventory coverage: 4/4 (100.0%)
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
| housing_status | yes | housing_status | match | match | not_sensitive | entered |

## What worked

- 4 expected field(s) were found.
- 8 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 19668 bytes
- `page_01_generated_01_populated.png` — 16147 bytes
- `page_01_generated_02_post_advance.png` — 18806 bytes
- `page_01_generated_03_choice_probe.png` — 19073 bytes
- `page_01_generated_04_choice_probe.png` — 19174 bytes
- `page_01_generated_05_choice_probe.png` — 19068 bytes
- `page_01_generated_06_pre_advance.png` — 24955 bytes
- `page_01_generated_07_submitted.png` — 19668 bytes

## Retained sources reviewed

- `data/runs/run_cf34912989fc47/events.jsonl`
- `data/runs/run_cf34912989fc47/run.json`
- `data/runs/run_cf34912989fc47/report.json`
- `localhost-test-sites/site_s_variants/ground_truth.yaml`

