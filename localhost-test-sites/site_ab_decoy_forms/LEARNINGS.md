# FormWeave crawl learnings — `site_ab_decoy_forms`

## Blind production run

- Run: `run_9b927ddd30f44b`
- Target: `http://localhost:9001/site_ab_decoy_forms/intake`
- Production status: `completed` — Crawl complete
- Model calls: 5 started, 5 completed, 0 failed
- Evidence PNGs retained: 9
- Field entries verified: 6
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
- Field inventory coverage: 6/6 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| current_address | yes | current_address | match | match | not_sensitive | entered |
| zip_code | yes | zip_code | match | match | not_sensitive | entered |
| email | yes | email | match | match | not_sensitive | entered |
| household_size | yes | household_size | match | match | not_sensitive | entered |
| agree_terms | yes | agree_terms | match | match | not_sensitive | entered |

## What worked

- 6 expected field(s) were found.
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

- `page_01.png` — 25620 bytes
- `page_01_generated_01_choice_probe.png` — 30375 bytes
- `page_01_generated_02_choice_probe.png` — 30478 bytes
- `page_01_generated_03_choice_probe.png` — 30489 bytes
- `page_01_generated_04_choice_probe.png` — 30452 bytes
- `page_01_generated_05_choice_probe.png` — 30458 bytes
- `page_01_generated_06_choice_probe.png` — 30534 bytes
- `page_01_generated_07_pre_advance.png` — 34363 bytes
- `page_01_generated_08_submitted.png` — 25620 bytes

## Retained sources reviewed

- `data/runs/run_9b927ddd30f44b/events.jsonl`
- `data/runs/run_9b927ddd30f44b/run.json`
- `data/runs/run_9b927ddd30f44b/report.json`
- `localhost-test-sites/site_ab_decoy_forms/ground_truth.yaml`

