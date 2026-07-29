# FormWeave crawl learnings — `site_m_login_gate`

## Blind production run

- Run: `run_6b534fcc99ed48`
- Target: `http://localhost:9001/site_m_login_gate/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 3 started, 3 completed, 0 failed
- Evidence PNGs retained: 4
- Field entries verified: 0
- Entry failures: 2
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
- Field inventory coverage: 2/2 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| username | yes | username | match | n/a | not_sensitive | not_attempted |
| password | yes | password | match | n/a | sensitive_model_classification | not_attempted |

## What worked

- 2 expected field(s) were found.
- 4 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22538 bytes
- `page_01_generated_01_populated.png` — 18143 bytes
- `page_01_generated_02_post_advance.png` — 22538 bytes
- `page_01_generated_03_populated.png` — 22538 bytes

## Retained sources reviewed

- `data/runs/run_6b534fcc99ed48/events.jsonl`
- `data/runs/run_6b534fcc99ed48/run.json`
- `data/runs/run_6b534fcc99ed48/report.json`
- `localhost-test-sites/site_m_login_gate/ground_truth.yaml`

