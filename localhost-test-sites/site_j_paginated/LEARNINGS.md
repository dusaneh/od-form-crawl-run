# FormWeave crawl learnings — `site_j_paginated`

## Blind production run

- Run: `run_3a991e55258a45`
- Target: `http://localhost:9001/site_j_paginated/`
- Production status: `completed` — Crawl complete
- Model calls: 6 started, 6 completed, 0 failed
- Evidence PNGs retained: 26
- Field entries verified: 15
- Entry failures: 0
- Branch states: 0
- Submissions: 1 attempted, 1 verified
- Explicit rendered submission confirmation: yes
- Rendered submission outcome(s): success via fresh_llm_assessment (Application Submitted; Thank you. Your intake application has been received.)

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: no
- Expected-abort behavior matched: not applicable
- Expected same-page branch detected: not applicable
- Field inventory coverage: 15/15 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | site_j_paginated_intake_first_name | match | match | not_sensitive | entered |
| last_name | yes | site_j_paginated_intake_last_name | match | match | not_sensitive | entered |
| dob | yes | site_j_paginated_intake_date_of_birth | match | match | sensitive_model_classification | entered |
| phone | yes | site_j_paginated_intake_phone_number | match | match | not_sensitive | entered |
| household_size | yes | site_j_paginated_intake_p2_household_size | match | match | not_sensitive | entered |
| current_situation | yes | site_j_paginated_intake_p2_current_situation | match | match | not_sensitive | entered |
| member_name | yes | site_j_paginated_intake_p2_member_name_0 | match | match | not_sensitive | entered |
| member_relationship | yes | site_j_paginated_intake_p2_member_relationship_0 | match | match | not_sensitive | entered |
| supporting_document | yes | site_j_paginated_intake_p2_supporting_document | match | mismatch | sensitive_file_upload | entered |
| email | yes | site_j_paginated_intake_p3_email_address | match | match | not_sensitive | entered |
| assistance | yes | site_j_paginated_intake_p3_assistance | match | match | not_sensitive | entered |
| referral_source | yes | site_j_paginated_intake_p3_referral_source | match | match | not_sensitive | entered |
| signature | yes | site_j_paginated_intake_p3_signature | match | match | not_sensitive | entered |
| review_confirm | yes | site_j_paginated_intake_p3_review_confirm | match | match | not_sensitive | entered |
| consent | yes | site_j_paginated_intake_p3_consent | match | match | not_sensitive | entered |

## What worked

- 15 expected field(s) were found.
- 26 local screenshot artifact(s) were retained and passed to report analysis where available.
- 6 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `supporting_document`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 34979 bytes
- `page_01_generated_01_populated.png` — 46683 bytes
- `page_01_generated_02_post_advance.png` — 36358 bytes
- `page_01_generated_03_populated.png` — 39550 bytes
- `page_01_generated_04_post_advance.png` — 62234 bytes
- `page_01_generated_05_choice_probe.png` — 61874 bytes
- `page_01_generated_06_choice_probe.png` — 61848 bytes
- `page_01_generated_07_choice_probe.png` — 61938 bytes
- `page_01_generated_08_choice_probe.png` — 61937 bytes
- `page_01_generated_09_choice_probe.png` — 61186 bytes
- `page_01_generated_10_choice_probe.png` — 61286 bytes
- `page_01_generated_11_choice_probe.png` — 61736 bytes
- `page_01_generated_12_populated.png` — 62784 bytes
- `page_01_generated_13_post_advance.png` — 70497 bytes
- `page_01_generated_14_choice_probe.png` — 70885 bytes
- `page_01_generated_15_choice_probe.png` — 71249 bytes
- `page_01_generated_16_choice_probe.png` — 70958 bytes
- `page_01_generated_17_choice_probe.png` — 71432 bytes
- `page_01_generated_18_choice_probe.png` — 72034 bytes
- `page_01_generated_19_choice_probe.png` — 71340 bytes
- `page_01_generated_20_choice_probe.png` — 71343 bytes
- `page_01_generated_21_choice_probe.png` — 71610 bytes
- `page_01_generated_22_choice_probe.png` — 71610 bytes
- `page_01_generated_23_choice_probe.png` — 71932 bytes
- `page_01_generated_24_pre_advance.png` — 73638 bytes
- `page_01_generated_25_submitted.png` — 34979 bytes

## Retained sources reviewed

- `data/runs/run_3a991e55258a45/events.jsonl`
- `data/runs/run_3a991e55258a45/run.json`
- `data/runs/run_3a991e55258a45/report.json`
- `localhost-test-sites/site_j_paginated/ground_truth.yaml`

