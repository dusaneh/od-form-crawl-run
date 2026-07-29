# FormWeave crawl learnings — `site_p_crosspage_echo`

## Blind production run

- Run: `run_42e83800fe5d4e`
- Target: `http://localhost:9001/site_p_crosspage_echo/`
- Production status: `awaiting_review` — Scripted traversal needs human review
- Model calls: 2 started, 2 completed, 0 failed
- Evidence PNGs retained: 6
- Field entries verified: 2
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
- Field inventory coverage: not specified
- Missing expected red-flag codes: none
- Functional verdict: **pass**
- Metadata-policy verdict: **pass**
- Evaluation verdict: **pass**
- Strict exact-oracle verdict: **pass**

| Expected field | Found | Observed key | Required | Sensitive | Sensitivity basis | Entry |
|---|---:|---|---:|---:|---|---:|

## What worked

- 0 expected field(s) were found.
- 6 local screenshot artifact(s) were retained and passed to report analysis where available.
- 2 novel state(s) received completed model proposals.
- No attempted field entry failed browser readback.

## Discrepancies and changes to consider

- No run-level blocking discrepancy was measured.
- No expected field was missing from the retained contract.
- Requiredness matched for every comparable field.
- Sensitivity matched for every comparable field.
- All expected structured red-flag codes were observed.

## Evidence inventory

- `page_01.png` — 22699 bytes
- `page_01_generated_01_populated.png` — 15643 bytes
- `page_01_generated_02_post_advance.png` — 15847 bytes
- `page_01_generated_03_populated.png` — 17851 bytes
- `page_01_generated_04_post_advance.png` — 22699 bytes
- `page_01_generated_05_populated.png` — 22699 bytes

## Retained sources reviewed

- `data/runs/run_42e83800fe5d4e/events.jsonl`
- `data/runs/run_42e83800fe5d4e/run.json`
- `data/runs/run_42e83800fe5d4e/report.json`
- `localhost-test-sites/site_p_crosspage_echo/ground_truth.yaml`

