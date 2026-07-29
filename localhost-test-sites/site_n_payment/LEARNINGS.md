# FormWeave crawl learnings — `site_n_payment`

## Blind production run

- Run: `run_6c5f34f9a68340`
- Target: `http://localhost:9001/site_n_payment/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 4
- Field entries verified: 3
- Entry failures: 4
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
- Field inventory coverage: 7/7 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| card_number | yes | card_number | match | match | sensitive_model_classification | not_attempted |
| card_expiry | yes | card_expiry | match | mismatch | sensitive_model_classification | not_attempted |
| card_cvv | yes | card_cvv | match | match | sensitive_model_classification | not_attempted |
| amount | yes | amount | match | mismatch | sensitive_model_classification | not_attempted |

## What worked

- 7 expected field(s) were found.
- 4 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `card_expiry`, `amount`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 43235 bytes
- `page_01_generated_01_populated.png` — 15015 bytes
- `page_01_generated_02_post_advance.png` — 34455 bytes
- `page_01_generated_03_populated.png` — 43235 bytes

## Retained sources reviewed

- `data/runs/run_6c5f34f9a68340/events.jsonl`
- `data/runs/run_6c5f34f9a68340/run.json`
- `data/runs/run_6c5f34f9a68340/report.json`
- `localhost-test-sites/site_n_payment/ground_truth.yaml`

