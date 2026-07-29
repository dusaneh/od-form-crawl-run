# FormWeave crawl learnings — `site_r_edgecases`

## Blind production run

- Run: `run_671fb47604c447`
- Target: `http://localhost:9001/site_r_edgecases/`
- Production status: `completed` — Crawl complete
- Model calls: 3 started, 3 completed, 0 failed
- Evidence PNGs retained: 9
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
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| member_1_name | yes | member_1_name | match | match | not_sensitive | entered |
| member_1_relationship | yes | member_1_relationship | match | match | not_sensitive | entered |
| member_2_name | yes | member_2_name | match | match | not_sensitive | entered |
| member_2_relationship | yes | member_2_relationship | match | match | not_sensitive | entered |
| ssn_full | yes | ssn_full | match | match | sensitive_model_classification | entered |
| preferred_language | yes | preferred_language | match | match | not_sensitive | not_attempted |
| proof_of_income | yes | proof_of_income | match | mismatch | sensitive_file_upload | entered |
| other_documents | yes | other_documents | match | mismatch | sensitive_file_upload | entered |

## What worked

- 10 expected field(s) were found.
- 9 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `proof_of_income`, `other_documents`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 21602 bytes
- `page_01_generated_01_populated.png` — 13148 bytes
- `page_01_generated_02_post_advance.png` — 51273 bytes
- `page_01_generated_03_choice_probe.png` — 51380 bytes
- `page_01_generated_04_choice_probe.png` — 51182 bytes
- `page_01_generated_05_choice_probe.png` — 51285 bytes
- `page_01_generated_06_choice_probe.png` — 51089 bytes
- `page_01_generated_07_pre_advance.png` — 58451 bytes
- `page_01_generated_08_submitted.png` — 21602 bytes

## Retained sources reviewed

- `data/runs/run_671fb47604c447/events.jsonl`
- `data/runs/run_671fb47604c447/run.json`
- `data/runs/run_671fb47604c447/report.json`
- `localhost-test-sites/site_r_edgecases/ground_truth.yaml`

