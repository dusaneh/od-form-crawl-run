# FormWeave crawl learnings — `site_k_conditional`

## Blind production run

- Run: `run_73ed6eb0c75742`
- Target: `http://localhost:9001/site_k_conditional/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 2 started, 2 completed, 0 failed
- Evidence PNGs retained: 9
- Field entries verified: 3
- Entry failures: 0
- Branch states: 0
- Submissions: 0 attempted, 0 verified
- Explicit rendered submission confirmation: not attempted

The production crawl reached a terminal run status before this site's
`ground_truth.yaml` was opened. Oracle data was used only for the comparison
below and was never supplied to semantic generation or deterministic replay.

## Ground-truth comparison

- Expected abort: `cross_page_branching`
- Expected-abort behavior matched: yes
- Expected same-page branch detected: not applicable
- Field inventory coverage: 6/6 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | site_k_conditional_intake_p1_first_name | match | match | not_sensitive | not_attempted |
| last_name | yes | site_k_conditional_intake_p1_last_name | match | match | not_sensitive | not_attempted |
| drives | yes | site_k_conditional_intake_p1_drives | match | match | not_sensitive | not_attempted |
| transit_pass | yes | transit_pass | n/a | match | legacy/no provenance | missing |
| nearest_stop | yes | nearest_stop | n/a | match | legacy/no provenance | missing |
| appointment_notes | yes | appointment_notes | n/a | match | legacy/no provenance | missing |

## What worked

- 6 expected field(s) were found.
- 9 local screenshot artifact(s) were retained and passed to report analysis where available.
- 2 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 43618 bytes
- `page_01_generated_01_populated.png` — 35454 bytes
- `page_01_generated_02_post_advance.png` — 28681 bytes
- `page_01_generated_03_choice_probe.png` — 28529 bytes
- `page_01_generated_04_choice_probe.png` — 29209 bytes
- `page_01_generated_05_choice_probe.png` — 29261 bytes
- `page_01_generated_06_populated.png` — 32091 bytes
- `page_01_generated_07_post_advance.png` — 43618 bytes
- `page_01_generated_08_populated.png` — 43618 bytes

## Retained sources reviewed

- `data/runs/run_73ed6eb0c75742/events.jsonl`
- `data/runs/run_73ed6eb0c75742/run.json`
- `data/runs/run_73ed6eb0c75742/report.json`
- `localhost-test-sites/site_k_conditional/ground_truth.yaml`

