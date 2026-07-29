# FormWeave crawl learnings — `site_u_other_specify`

## Blind production run

- Run: `run_adade3be32d248`
- Target: `http://localhost:9001/site_u_other_specify/`
- Production status: `completed` — Crawl complete
- Model calls: 7 started, 7 completed, 0 failed
- Evidence PNGs retained: 17
- Field entries verified: 9
- Entry failures: 0
- Branch states: 2
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
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | first_name | match | match | not_sensitive | entered |
| last_name | yes | last_name | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| referral_source | yes | referral_source | match | match | not_sensitive | entered |
| referral_other | yes | referral_other | match | match | not_sensitive | entered |
| accommodation | yes | accommodation | match | match | non_sensitive_accommodation_request | entered |
| accommodation_other | yes | accommodation_other | match | match | non_sensitive_accommodation_request | entered |

## What worked

- 7 expected field(s) were found.
- 17 local screenshot artifact(s) were retained and passed to report analysis where available.
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

- `page_01.png` — 27269 bytes
- `page_01_generated_01_populated.png` — 20480 bytes
- `page_01_generated_02_post_advance.png` — 41353 bytes
- `page_01_generated_03_choice_probe.png` — 41720 bytes
- `page_01_generated_04_choice_probe.png` — 41724 bytes
- `page_01_generated_05_choice_probe.png` — 41732 bytes
- `page_01_generated_06_choice_probe.png` — 44900 bytes
- `page_01_generated_07_branch_variant_populated.png` — 45340 bytes
- `page_01_generated_08_choice_probe.png` — 41731 bytes
- `page_01_generated_09_choice_probe.png` — 41359 bytes
- `page_01_generated_10_choice_probe.png` — 41389 bytes
- `page_01_generated_11_choice_probe.png` — 46231 bytes
- `page_01_generated_12_branch_variant_populated.png` — 46368 bytes
- `page_01_generated_13_pre_advance.png` — 54507 bytes
- `page_01_generated_14_selected_branch_populated.png` — 54842 bytes
- `page_01_generated_15_selected_branch_populated.png` — 54842 bytes
- `page_01_generated_16_submitted.png` — 27269 bytes

## Retained sources reviewed

- `data/runs/run_adade3be32d248/events.jsonl`
- `data/runs/run_adade3be32d248/run.json`
- `data/runs/run_adade3be32d248/report.json`
- `localhost-test-sites/site_u_other_specify/ground_truth.yaml`

