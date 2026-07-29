# FormWeave crawl learnings — `site_ak_flow_dependent`

## Blind production run

- Run: `run_dad6b5fab7b34a`
- Target: `http://localhost:9001/site_ak_flow_dependent/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 3 started, 3 completed, 0 failed
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
- Field inventory coverage: 5/5 (100.0%)
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| first_name | yes | site_ak_flow_dependent_intake_step1_first_name | match | match | not_sensitive | not_attempted |
| last_name | yes | site_ak_flow_dependent_intake_step1_last_name | match | match | not_sensitive | not_attempted |
| heat_source | yes | site_ak_flow_dependent_intake_step1_heat_source | match | match | not_sensitive | not_attempted |
| monthly_electric_bill | yes | monthly_electric_bill | n/a | match | legacy/no provenance | missing |
| utility_provider | yes | utility_provider | n/a | match | legacy/no provenance | missing |

## What worked

- 5 expected field(s) were found.
- 9 local screenshot artifact(s) were retained and passed to report analysis where available.
- 3 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 26918 bytes
- `page_01_generated_01_populated.png` — 20822 bytes
- `page_01_generated_02_post_advance.png` — 46868 bytes
- `page_01_generated_03_choice_probe.png` — 46823 bytes
- `page_01_generated_04_choice_probe.png` — 46915 bytes
- `page_01_generated_05_choice_probe.png` — 47240 bytes
- `page_01_generated_06_populated.png` — 50414 bytes
- `page_01_generated_07_post_advance.png` — 26918 bytes
- `page_01_generated_08_populated.png` — 26918 bytes

## Retained sources reviewed

- `data/runs/run_dad6b5fab7b34a/events.jsonl`
- `data/runs/run_dad6b5fab7b34a/run.json`
- `data/runs/run_dad6b5fab7b34a/report.json`
- `localhost-test-sites/site_ak_flow_dependent/ground_truth.yaml`

