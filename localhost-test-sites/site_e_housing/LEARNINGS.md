# FormWeave crawl learnings — `site_e_housing`

## Blind production run

- Run: `run_8fc0d9820b444d`
- Target: `http://localhost:9001/site_e_housing/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 1 started, 1 completed, 0 failed
- Evidence PNGs retained: 4
- Field entries verified: 0
- Entry failures: 0
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
- Field inventory coverage: 11/11 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | legacy/no provenance | missing |
| last_name | yes | last_name | match | match | legacy/no provenance | missing |
| date_of_birth | yes | date_of_birth | match | match | legacy/no provenance | missing |
| ssn | yes | ssn | match | match | legacy/no provenance | missing |
| phone | yes | phone | match | mismatch | legacy/no provenance | missing |
| email | yes | email | match | mismatch | legacy/no provenance | missing |
| monthly_income | yes | monthly_income | match | match | legacy/no provenance | missing |
| current_address | yes | current_address | match | match | legacy/no provenance | missing |
| reason_for_seeking | yes | reason_for_seeking | match | match | legacy/no provenance | missing |
| consent_to_share | yes | consent_to_share | match | match | legacy/no provenance | missing |
| captcha_answer | yes | captcha_answer | match | match | legacy/no provenance | missing |

## What worked

- 11 expected field(s) were found.
- 4 local screenshot artifact(s) were retained and passed to report analysis where available.
- 1 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `phone`, `email`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 89921 bytes
- `page_01_generated_01_populated.png` — 79114 bytes
- `page_01_generated_02_post_advance.png` — 89921 bytes
- `page_01_generated_03_populated.png` — 89921 bytes

## Retained sources reviewed

- `data/runs/run_8fc0d9820b444d/events.jsonl`
- `data/runs/run_8fc0d9820b444d/run.json`
- `data/runs/run_8fc0d9820b444d/report.json`
- `localhost-test-sites/site_e_housing/ground_truth.yaml`

