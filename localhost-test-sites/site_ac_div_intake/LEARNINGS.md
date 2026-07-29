# FormWeave crawl learnings — `site_ac_div_intake`

## Blind production run

- Run: `run_72edf928f81641`
- Target: `http://localhost:9001/site_ac_div_intake/`
- Production status: `completed` — Crawl complete
- Model calls: 3 started, 3 completed, 0 failed
- Evidence PNGs retained: 5
- Field entries verified: 9
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
- Field inventory coverage: 10/10 (100.0%)
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
| email | yes | email | match | match | not_sensitive | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| household_size | yes | household_size | match | match | not_sensitive | entered |
| monthly_income | yes | monthly_income | match | match | sensitive_model_classification | entered |
| ssn_full | yes | ssn_full | match | match | sensitive_model_classification | entered |
| preferred_language | yes | preferred_language | match | match | not_sensitive | not_attempted |
| certify | yes | certify | match | match | not_sensitive | entered |

## What worked

- 10 expected field(s) were found.
- 5 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22124 bytes
- `page_01_generated_01_populated.png` — 21945 bytes
- `page_01_generated_02_post_advance.png` — 54402 bytes
- `page_01_generated_03_pre_advance.png` — 59744 bytes
- `page_01_generated_04_submitted.png` — 22124 bytes

## Retained sources reviewed

- `data/runs/run_72edf928f81641/events.jsonl`
- `data/runs/run_72edf928f81641/run.json`
- `data/runs/run_72edf928f81641/report.json`
- `localhost-test-sites/site_ac_div_intake/ground_truth.yaml`

