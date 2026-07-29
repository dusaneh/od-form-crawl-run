# FormWeave crawl learnings — `site_ae_deep_portal`

## Blind production run

- Run: `run_60d85beca52c44`
- Target: `http://localhost:9001/site_ae_deep_portal/`
- Production status: `completed` — Crawl complete
- Model calls: 10 started, 10 completed, 0 failed
- Evidence PNGs retained: 13
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
| household_size | yes | household_size | match | match | not_sensitive | entered |
| num_children | yes | num_children | match | match | not_sensitive | entered |
| proof_docs | yes | proof_docs | match | mismatch | sensitive_file_upload | entered |
| agree_share | yes | agree_share | match | match | not_sensitive | entered |

## What worked

- 7 expected field(s) were found.
- 13 local screenshot artifact(s) were retained and passed to report analysis where available.
- 10 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `proof_docs`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 33649 bytes
- `page_01_generated_01_populated.png` — 23394 bytes
- `page_01_generated_02_post_advance.png` — 15753 bytes
- `page_01_generated_03_populated.png` — 15753 bytes
- `page_01_generated_04_post_advance.png` — 16790 bytes
- `page_01_generated_05_populated.png` — 16790 bytes
- `page_01_generated_06_post_advance.png` — 18110 bytes
- `page_01_generated_07_populated.png` — 18110 bytes
- `page_01_generated_08_post_advance.png` — 21415 bytes
- `page_01_generated_09_populated.png` — 21415 bytes
- `page_01_generated_10_post_advance.png` — 51375 bytes
- `page_01_generated_11_pre_advance.png` — 56863 bytes
- `page_01_generated_12_submitted.png` — 33649 bytes

## Retained sources reviewed

- `data/runs/run_60d85beca52c44/events.jsonl`
- `data/runs/run_60d85beca52c44/run.json`
- `data/runs/run_60d85beca52c44/report.json`
- `localhost-test-sites/site_ae_deep_portal/ground_truth.yaml`

