---
name: run-formweave-evaluation
description: Run, score, analyze, compare, and report FormWeave development evaluations against the testforms.dbolab.io Evaluation Protocol v1, and derive generic capability requirements or architectural changes from observed failures. Use when the user asks to run test batches, repeat a configuration across code versions, inspect results, compare candidates, preserve learnings, improve the application from evaluation evidence, or examine convergence. Treat plain batch requests as measurement-only and change application code only when explicitly requested.
---

# Run FormWeave Evaluation

Use the external evaluator to measure one frozen application version. Keep test orchestration and oracle data outside the application.

Read [references/workflow.md](references/workflow.md) before executing a run. Read [references/analysis.md](references/analysis.md) before writing or finalizing qualitative learnings.

## Treat fixtures as examples, not specifications

- Treat every test scenario as evidence about a broader capability class. Never turn its labels, selectors, IDs, page order, or incidental markup into application requirements.
- Translate each observed failure into a generic requirement that should hold for unseen sites. State the invariant, failure class, affected boundary, and cross-example tests that would validate it.
- Evaluate whether the current architecture can satisfy the generic requirement reliably. If not, recommend or implement an architectural change when authorized; do not treat the architecture as a fixed excuse for failure.
- Distinguish application limitations from evaluation-method limitations and oracle-coverage limitations. State which one the evidence supports.
- Preserve successful generic capabilities explicitly. A fix is not acceptable merely because its motivating fixture improves.

## Interpret the request

- **Run a batch and analyze it:** use the default tracked configuration, run all configured batches, write semantic learnings, and do not edit application code.
- **Run N batches:** override `--batches N`; keep the remaining configuration fixed. Analyze each result but do not modify code.
- **Run the same configuration again:** pass the prior experiment's `plan.json` so the cohort is exactly comparable.
- **Compare versions:** run the candidate with the baseline plan, finalize both analyses, then compare the experiment directories.
- **Improve or iterate:** only when explicitly requested, select one generic failure cluster after analysis, preserve all `worked[]` invariants, make one bounded change, add regression tests, rerun the same plan, and accept or reject through comparison.

## Run the rolling development cycle

After each newly seen breadth batch is analyzed, use it as the primary evidence for the next authorized development round while retaining every completed prior learning:

1. Aggregate all completed `learnings.json` files, the application feature list, prior requirements, paired comparisons, and development-run history into a preservation review.
2. Write a comprehensive round requirements document under the tracked development run. Give the latest unseen batch priority, but include every prior worked invariant, unresolved generic requirement, architectural implication, positive/negative/structurally different regression, and acceptance criterion.
3. Select one architectural capability and make one bounded implementation delta. Map it to requirement IDs and application feature IDs. Do not combine independent reporting, traversal, generation, safety, or structure changes in one candidate merely because they came from the same batch. Do not implement a fixture-specific label, selector, route, or page order.
4. Start from the latest promoted, reconstructable source snapshot. If only a rejected worktree is available, label the next attempt a repair candidate, record that provenance limitation, keep its new delta to one capability, and require comparison against both its immediate parent and the best verified baseline. Never describe a rejected tree as the accepted baseline.
5. Freeze the exact motivating fix plan, fixed regression plan, and newly selected rotating plan before measurement.
6. Run the unchanged candidate on the fix plan first. Continue to regression and rotating only when the target invariant materially improves, no safety or invalidity gate worsens, no material unrelated loss appears inside the fix cohort, **and retained runtime evidence proves the candidate's changed code path or architectural behavior actually activated on the motivating case**. A score gain without candidate activation is generation variance, not a successful fix. If it misses that checkpoint, stop, finalize the fix evidence, revise or reject the candidate, and record the skipped gates.
7. When the fix checkpoint passes, run the same source fingerprint through regression and rotating. Promotion still requires all three gates; a fix-cohort improvement alone is never sufficient.
8. Finalize qualitative learnings for every completed cohort, judge the candidate from all available evidence, update the comprehensive requirements, then update the development-run and convergence registries.
9. Produce a cumulative trend review for the whole development run, from its first baseline through the current bundle. Report every measured candidate/cohort, including fix-checkpoint rejections and skipped gates, the running valid-trial mean, strict-pass rate, safety-pass rate, invalid count, change from the run baseline, and change from the preceding candidate. Separate formally paired comparisons from descriptive same-scenario or aggregate trends.

When the user asks to proceed to the next development phase, this complete redo-plus-unseen cycle is the default. Never silently skip the requirements document or historical preservation gate.

## Use three seven-scenario batch roles

Keep seven scenarios as the batch unit. Treat a development round as one diagnostic bundle with three separately logged cohorts:

1. **Fix batch:** rerun the exact frozen cohort that inspired the change to measure whether the target behavior improved.
2. **Regression batch:** run a fixed cohort of previously successful, capability-diverse scenarios. Reject any safety regression, invalid trial, strict pass-to-fail change, or material loss even when the mean rises.
3. **Rotating batch:** sample seven previously seen scenarios with replacement, stratified jointly by complexity and catalog feature tags and penalizing recent reuse. Use this as the breadth promotion gate, not as unseen evidence.

Use a staged decision. First run the exact motivating fix cohort. If the targeted capability does not materially improve, or safety, invalidity, or an unrelated canary worsens, reject or revise without spending the regression and rotating cohorts. Record those cohorts as `skipped_fix_checkpoint` rather than omitting them. If the checkpoint passes, run both remaining roles on the identical source fingerprint before deciding whether to promote. Allow at most two additional bounded candidates before reconsidering the requirement or architecture.

For every candidate, predeclare an **activation witness**: a log event, typed artifact, state transition, or other retained runtime evidence produced only when the changed behavior runs. Check that witness before attributing any score delta to the candidate. Record activation counts by scenario in the post-run requirements. Zero activation makes the fix result causally inconclusive even when the score improves; activation on unrelated scenarios alone does not validate the motivating requirement.

A new development run with no pending fix starts with a rotating baseline batch, then derives its first requirements. Reserve never-inspected scenarios for occasional milestone holdout measurements only. Once a holdout result influences development, move that scenario into the seen pool.

Do not claim that reuse prevents overfitting to the entire corpus. Reuse detects forgetting and structural brittleness; only untouched scenarios or hidden structural variants measure genuine generalization.

Before promoting a major candidate, use multiple fresh-generation trials to estimate model variance. Keep a diagnostic replay lane with frozen generated artifacts when possible to separate runtime-code regressions from generation variance; do not mix replay diagnostics into the official fresh-generation score.

After two promoted candidates, or before promoting a material architectural change, run a larger corpus-wide checkpoint. Treat it as a milestone estimate of corpus performance, not as permission to tune directly to every individual failure. Move any inspected holdout into the seen pool.

## Convert evidence into development requirements

For every development or validation run:

1. Identify the concrete symptom from frozen evidence.
2. Infer the generic capability requirement without fixture-specific details.
3. Decide whether the failure is local implementation, architecture, evaluator, oracle, or generation variance.
4. If architecture is implicated, describe the architectural change and why local patches will remain brittle.
5. Define positive, negative, and structurally different regression examples before implementation.
6. Record the requirement and preservation invariants in `learnings.json`, even when the run was nominally validation.
7. Do not implement newly discovered requirements during a frozen measurement. Carry them into the next explicitly authorized development iteration.
8. Link each round requirements document, implementation candidate, redo experiment, unseen experiment, and resulting learnings in the tracked development-run registry.

## Run the measurement

1. Check `git status` and record—not discard—existing user changes.
2. Audit catalog coverage before planning: report total, enabled, disabled, and whether the requested batch is fully oracle-backed. Never describe a disabled scenario as runnable or scoreable.
3. Create or reuse a frozen plan. Never fetch ground truth manually before the runner freezes raw evidence.
4. Run `npm --prefix evaluation run experiment:run` with the tracked configuration and `--manage-api` when no forced-fresh API is already running.
5. Treat `blocked` as a safety failure and `invalid` as unusable evidence regardless of the numeric score.
6. Inspect `score.json`, `learnings.json`, cited reports, and screenshots.
7. Replace draft causes with evidence-backed semantic analysis. Include what worked, what failed, unknowns, preservation invariants, generic requirements, architectural implications, cross-test patterns, and recommendations.
8. Set `analysisStatus` to `complete` and run the finalize command. This validates evidence links and records analysis in the registry.
9. Report catalog oracle coverage plus the configuration ID, plan ID, code fingerprint, batches, trials, overall score, status, safety rate, invalid trials, leading learnings, and artifact paths.
10. Report the run-wide cumulative trend, not only the latest step. Include regressions and rejected candidates so the history cannot imply monotonic improvement by omission. Store the machine-readable and Markdown trend artifacts with the tracked development run and link them from its registry entry.

## Preserve validity

- Do not expose feature tags or oracle content to the application.
- Do not modify frozen raw artifacts.
- Do not compare different plan IDs, catalog revisions, cohorts, or trial counts.
- Do not use `--allow-reuse` for measured results.
- Do not hide infrastructure-invalid trials.
- Do not make fixture-specific changes.
- Do not call a requirement generic merely because it avoids a literal selector; validate behavior across different structures and controls.
- Do not modify code during a measurement-only request.
- Do not accept a candidate solely from average improvement on the fix batch.
- Do not accept or credit a candidate when its predeclared activation witness is absent from the motivating case.
- Do not let an infrastructure-invalid pair, a strict pass-to-fail change, or one large scenario loss be averaged away.
- Preserve a reconstructable source snapshot or commit for every promoted candidate; a dirty-tree fingerprint alone proves identity but not recoverability.

## Stop and report

Stop before development changes when safety failed, more than 20% of trials are invalid, revisions changed, or evidence is insufficient. For a fixed number of batches, stop after that number. For improvement rounds, stop at the user's limit or after two accepted comparable runs improve by less than 0.5 points without strict-pass improvement.

Use the registry's `runs.json`, `convergence.json`, and `convergence.svg` for longitudinal reporting. A plot is meaningful only within one configuration ID and compatible plan series.

For a development-run trend spanning different cohort roles or revised catalog revisions, label the view descriptive. Never combine it with a formally paired delta. Show both the latest bundle and the cumulative history; a high fix-cohort score alone is not evidence that the application improved across the run.
