# FormWeave crawl learnings — `site_aj_patience_portal`

## Blind production run

- Run: `run_19197d60bb6246`
- Target: `http://localhost:9001/site_aj_patience_portal/`
- Production status: `completed` — Crawl complete
- Model calls: 5 started, 5 completed, 0 failed
- Evidence PNGs retained: 10
- Field entries verified: 5
- Entry failures: 0
- Branch states: 1
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
- Metadata-policy verdict: **needs_review**
- Evaluation verdict: **pass_with_policy_review**
- Strict exact-oracle verdict: **needs_changes**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|
| full_name | yes | full_name | match | match | not_sensitive | entered |
| phone | yes | phone | match | match | not_sensitive | entered |
| birth_year | yes | birth_year | match | mismatch | not_sensitive | entered |
| mobility_needs | yes | mobility_needs | match | mismatch | not_sensitive | entered |
| preferred_time | yes | preferred_time | match | match | legacy/no provenance | skipped |
| agree_terms | yes | agree_terms | match | match | not_sensitive | entered |

## What worked

- 6 expected field(s) were found.
- 10 local screenshot artifact(s) were retained and passed to report analysis where available.
- 5 novel state(s) received completed model proposals.
- 1 conditional branch state(s) were measured.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity mismatches: `birth_year`, `mobility_needs`.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 19510 bytes
- `page_01_generated_01_populated.png` — 16326 bytes
- `page_01_generated_02_post_advance.png` — 49670 bytes
- `page_01_generated_03_branch.png` — 48331 bytes
- `page_01_generated_04_choice_probe.png` — 52056 bytes
- `page_01_generated_05_choice_probe.png` — 52405 bytes
- `page_01_generated_06_choice_probe.png` — 52385 bytes
- `page_01_generated_07_choice_probe.png` — 52542 bytes
- `page_01_generated_08_pre_advance.png` — 52385 bytes
- `page_01_generated_09_submitted.png` — 19510 bytes

## Retained sources reviewed

- `data/runs/run_19197d60bb6246/events.jsonl`
- `data/runs/run_19197d60bb6246/run.json`
- `data/runs/run_19197d60bb6246/report.json`
- `localhost-test-sites/site_aj_patience_portal/ground_truth.yaml`

