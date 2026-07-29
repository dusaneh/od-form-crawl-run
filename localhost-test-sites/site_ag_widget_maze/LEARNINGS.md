# FormWeave crawl learnings — `site_ag_widget_maze`

## Blind production run

- Run: `run_aa12dce984c549`
- Target: `http://localhost:9001/site_ag_widget_maze/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 3 started, 3 completed, 0 failed
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

- Expected abort: `probe_actuation_failed`
- Expected-abort behavior matched: yes
- Expected same-page branch detected: not applicable
- Field inventory coverage: 4/4 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | not_attempted |
| zip_code | yes | zip_code | match | match | not_sensitive | not_attempted |
| income_band | yes | income_band | match | match | sensitive_policy_pattern | not_attempted |
| aid_type | yes | aid_type | match | match | legacy/no provenance | skipped |

## What worked

- 4 expected field(s) were found.
- 4 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 28195 bytes
- `page_01_generated_01_populated.png` — 16831 bytes
- `page_01_generated_02_post_advance.png` — 28195 bytes
- `page_01_generated_03_populated.png` — 28195 bytes

## Retained sources reviewed

- `data/runs/run_aa12dce984c549/events.jsonl`
- `data/runs/run_aa12dce984c549/run.json`
- `data/runs/run_aa12dce984c549/report.json`
- `localhost-test-sites/site_ag_widget_maze/ground_truth.yaml`

