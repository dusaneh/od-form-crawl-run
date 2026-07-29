# FormWeave crawl learnings — `site_ah_member_gate`

## Blind production run

- Run: `run_44fe32fbc5214e`
- Target: `http://localhost:9001/site_ah_member_gate/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 3 started, 3 completed, 0 failed
- Evidence PNGs retained: 5
- Field entries verified: 0
- Entry failures: 1
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
| member_id | yes | member_id | match | n/a | not_sensitive | not_attempted |
| passcode | yes | passcode | match | n/a | sensitive_model_classification | not_attempted |

## What worked

- 2 expected field(s) were found.
- 5 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 42566 bytes
- `page_01_generated_01_populated.png` — 20887 bytes
- `page_01_generated_02_post_advance.png` — 42566 bytes
- `page_01_generated_03_choice_probe.png` — 42566 bytes
- `page_01_generated_04_populated.png` — 42566 bytes

## Retained sources reviewed

- `data/runs/run_44fe32fbc5214e/events.jsonl`
- `data/runs/run_44fe32fbc5214e/run.json`
- `data/runs/run_44fe32fbc5214e/report.json`
- `localhost-test-sites/site_ah_member_gate/ground_truth.yaml`

