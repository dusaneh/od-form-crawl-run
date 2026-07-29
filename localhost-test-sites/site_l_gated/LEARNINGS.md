# FormWeave crawl learnings — `site_l_gated`

## Blind production run

- Run: `run_37da5c96fc874d`
- Target: `http://localhost:9001/site_l_gated/`
- Production status: `completed` — Crawl complete
- Model calls: 7 started, 7 completed, 0 failed
- Evidence PNGs retained: 10
- Field entries verified: 12
- Entry failures: 0
- Branch states: 2
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Application Submitted; Thank you. Your benefits application has been received.)

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
| first_name | yes | site_l_gated_intake_first_name | match | match | not_sensitive | entered |
| last_name | yes | site_l_gated_intake_last_name | match | match | not_sensitive | entered |
| household_size | yes | site_l_gated_intake_v3_household_size | match | match | not_sensitive | entered |
| benefit_type | yes | site_l_gated_intake_v5_benefit_type | match | match | not_sensitive | entered |
| agree_terms | yes | site_l_gated_intake_agree_terms | match | match | not_sensitive | entered |

## What worked

- 5 expected field(s) were found.
- 10 local screenshot artifact(s) were retained and passed to report analysis where available.
- 7 novel state(s) received completed model proposals.
- 2 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 21305 bytes
- `page_01_generated_01_populated.png` — 33243 bytes
- `page_01_generated_02_post_advance.png` — 71074 bytes
- `page_01_generated_03_branch.png` — 76602 bytes
- `page_01_generated_04_branch.png` — 79291 bytes
- `page_01_generated_05_choice_probe.png` — 84608 bytes
- `page_01_generated_06_choice_probe.png` — 84609 bytes
- `page_01_generated_07_choice_probe.png` — 85046 bytes
- `page_01_generated_08_pre_advance.png` — 85308 bytes
- `page_01_generated_09_submitted.png` — 21305 bytes

## Retained sources reviewed

- `data/runs/run_37da5c96fc874d/events.jsonl`
- `data/runs/run_37da5c96fc874d/run.json`
- `data/runs/run_37da5c96fc874d/report.json`
- `localhost-test-sites/site_l_gated/ground_truth.yaml`

