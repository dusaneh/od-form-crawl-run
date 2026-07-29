# FormWeave crawl learnings — `site_g_sensitive_nocaptcha`

## Blind production run

- Run: `run_b750bce03d4b45`
- Target: `http://localhost:9001/site_g_sensitive_nocaptcha/intake`
- Production status: `completed` — Crawl complete
- Model calls: 2 started, 2 completed, 0 failed
- Evidence PNGs retained: 7
- Field entries verified: 10
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
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| date_of_birth | yes | date_of_birth | match | match | sensitive_model_classification | entered |
| ssn_last4 | yes | ssn_last4 | match | match | sensitive_model_classification | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| monthly_income | yes | monthly_income | match | match | sensitive_model_classification | entered |
| housing_status | yes | housing_status | match | match | not_sensitive | entered |
| supporting_documents | yes | supporting_documents | match | mismatch | sensitive_file_upload | entered |
| consent_to_share | yes | consent_to_share | match | match | not_sensitive | entered |

## What worked

- 10 expected field(s) were found.
- 7 local screenshot artifact(s) were retained and passed to report analysis where available.
- 2 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `supporting_documents`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 38194 bytes
- `page_01_generated_01_choice_probe.png` — 91529 bytes
- `page_01_generated_02_choice_probe.png` — 91182 bytes
- `page_01_generated_03_choice_probe.png` — 91570 bytes
- `page_01_generated_04_choice_probe.png` — 91193 bytes
- `page_01_generated_05_pre_advance.png` — 95603 bytes
- `page_01_generated_06_submitted.png` — 38194 bytes

## Retained sources reviewed

- `data/runs/run_b750bce03d4b45/events.jsonl`
- `data/runs/run_b750bce03d4b45/run.json`
- `data/runs/run_b750bce03d4b45/report.json`
- `localhost-test-sites/site_g_sensitive_nocaptcha/ground_truth.yaml`

