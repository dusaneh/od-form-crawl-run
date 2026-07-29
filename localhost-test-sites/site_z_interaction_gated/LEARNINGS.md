# FormWeave crawl learnings — `site_z_interaction_gated`

## Blind production run

- Run: `run_c158e5097b5140`
- Target: `http://localhost:9001/site_z_interaction_gated/intake`
- Production status: `completed` — Crawl complete
- Model calls: 4 started, 4 completed, 0 failed
- Evidence PNGs retained: 5
- Field entries verified: 4
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
- Field inventory coverage: 4/4 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| zip_code | yes | zip_code | match | match | not_sensitive | entered |
| contact_pref | yes | contact_pref | match | match | non_sensitive_classification_selector | entered |
| agree_terms | yes | agree_terms | match | match | not_sensitive | entered |

## What worked

- 4 expected field(s) were found.
- 5 local screenshot artifact(s) were retained and passed to report analysis where available.
- 4 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22623 bytes
- `page_01_generated_01_choice_probe.png` — 24500 bytes
- `page_01_generated_02_choice_probe.png` — 24502 bytes
- `page_01_generated_03_pre_advance.png` — 26339 bytes
- `page_01_generated_04_submitted.png` — 22623 bytes

## Retained sources reviewed

- `data/runs/run_c158e5097b5140/events.jsonl`
- `data/runs/run_c158e5097b5140/run.json`
- `data/runs/run_c158e5097b5140/report.json`
- `localhost-test-sites/site_z_interaction_gated/ground_truth.yaml`

