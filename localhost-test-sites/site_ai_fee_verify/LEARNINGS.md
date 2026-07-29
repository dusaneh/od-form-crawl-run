# FormWeave crawl learnings — `site_ai_fee_verify`

## Blind production run

- Run: `run_0ab7074f977e45`
- Target: `http://localhost:9001/site_ai_fee_verify/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 7
- Field entries verified: 3
- Entry failures: 3
- Branch states: 0
- Submissions: 0 attempted, 0 verified
- Explicit rendered submission confirmation: not attempted

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: not applicable
- Field inventory coverage: 6/6 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| program | yes | program | match | match | not_sensitive | entered |
| card_number | yes | card_number | match | match | sensitive_model_classification | not_attempted |
| card_expiry | yes | card_expiry | match | match | sensitive_model_classification | not_attempted |
| card_cvc | yes | card_cvc | match | match | sensitive_model_classification | not_attempted |

## What worked

- 6 expected field(s) were found.
- 7 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 39359 bytes
- `page_01_generated_01_populated.png` — 18323 bytes
- `page_01_generated_02_post_advance.png` — 34713 bytes
- `page_01_generated_03_choice_probe.png` — 35246 bytes
- `page_01_generated_04_choice_probe.png` — 34713 bytes
- `page_01_generated_05_choice_probe.png` — 35225 bytes
- `page_01_generated_06_populated.png` — 39359 bytes

## Retained sources reviewed

- `data/runs/run_0ab7074f977e45/events.jsonl`
- `data/runs/run_0ab7074f977e45/run.json`
- `data/runs/run_0ab7074f977e45/report.json`
- `localhost-test-sites/site_ai_fee_verify/ground_truth.yaml`

