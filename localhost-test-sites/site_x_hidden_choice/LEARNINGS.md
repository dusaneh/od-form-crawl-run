# FormWeave crawl learnings — `site_x_hidden_choice`

## Blind production run

- Run: `run_bc1ccd938ed441`
- Target: `http://localhost:9001/site_x_hidden_choice/intake`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 2 started, 2 completed, 0 failed
- Evidence PNGs retained: 2
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
- Field inventory coverage: 3/3 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | not_attempted |
| zip_code | yes | zip_code | match | match | not_sensitive | not_attempted |
| contact_channel | yes | contact_channel | match | match | legacy/no provenance | skipped |

## What worked

- 3 expected field(s) were found.
- 2 local screenshot artifact(s) were retained and passed to report analysis where available.
- 2 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22284 bytes
- `page_01_generated_01_populated.png` — 22284 bytes

## Retained sources reviewed

- `data/runs/run_bc1ccd938ed441/events.jsonl`
- `data/runs/run_bc1ccd938ed441/run.json`
- `data/runs/run_bc1ccd938ed441/report.json`
- `localhost-test-sites/site_x_hidden_choice/ground_truth.yaml`

