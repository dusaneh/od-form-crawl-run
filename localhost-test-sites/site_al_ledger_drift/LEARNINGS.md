# FormWeave crawl learnings — `site_al_ledger_drift`

## Blind production run

- Run: `run_cc762bbfae5d4a`
- Target: `http://localhost:9001/site_al_ledger_drift/`
- Production status: `completed` — Crawl complete
- Model calls: 5 started, 5 completed, 0 failed
- Evidence PNGs retained: 9
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
| full_name | yes | site_al_ledger_drift_intake_step1_full_name | match | match | not_sensitive | entered |
| monthly_income | yes | site_al_ledger_drift_intake_step1_monthly_income | match | match | sensitive_policy_pattern | entered |
| confirm_accurate | yes | confirm_accurate | match | match | not_sensitive | entered |

## What worked

- 3 expected field(s) were found.
- 9 local screenshot artifact(s) were retained and passed to report analysis where available.
- 5 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 24277 bytes
- `page_01_generated_01_populated.png` — 18346 bytes
- `page_01_generated_02_post_advance.png` — 18589 bytes
- `page_01_generated_03_populated.png` — 20107 bytes
- `page_01_generated_04_post_advance.png` — 21305 bytes
- `page_01_generated_05_choice_probe.png` — 21305 bytes
- `page_01_generated_06_choice_probe.png` — 21440 bytes
- `page_01_generated_07_pre_advance.png` — 21440 bytes
- `page_01_generated_08_submitted.png` — 24277 bytes

## Retained sources reviewed

- `data/runs/run_cc762bbfae5d4a/events.jsonl`
- `data/runs/run_cc762bbfae5d4a/run.json`
- `data/runs/run_cc762bbfae5d4a/report.json`
- `localhost-test-sites/site_al_ledger_drift/ground_truth.yaml`

