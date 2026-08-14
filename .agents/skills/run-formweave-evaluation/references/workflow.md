# Evaluation workflow

## Default configuration

Use `evaluation/configs/five-by-three-v1.json` unless the user specifies otherwise. It selects five enabled scenarios per batch, three feature-balanced batches, one trial per scenario, headless execution, synthetic submission where safe, and forced-fresh script generation.

## Commands

Create an answer-free frozen plan without running the application:

```powershell
npm --prefix evaluation run experiment:plan -- --config evaluation/configs/five-by-three-v1.json
```

Run the default configuration and start a temporary forced-fresh API if needed:

```powershell
npm --prefix evaluation run experiment:run -- --config evaluation/configs/five-by-three-v1.json --manage-api --candidate <label>
```

Override only the number of batches:

```powershell
npm --prefix evaluation run experiment:run -- --config evaluation/configs/five-by-three-v1.json --batches 3 --manage-api --candidate <label>
```

Restrict a diagnostic run to explicit enabled scenarios:

```powershell
npm --prefix evaluation run experiment:run -- --config evaluation/configs/five-by-three-v1.json --scenarios site_a_shelter/primary,site_j_paginated/primary --manage-api --candidate <label>
```

Rerun the exact frozen cohort after manual development:

```powershell
npm --prefix evaluation run experiment:run -- --plan <prior-run>/plan.json --manage-api --candidate <new-label>
```

After Codex completes semantic analysis in `learnings.json`:

```powershell
npm --prefix evaluation run experiment:finalize -- --run <experiment-directory>
```

Compare exact-plan runs:

```powershell
npm --prefix evaluation run experiment:compare -- --baseline <baseline-directory> --candidate <candidate-directory>
```

Rebuild the registry and convergence plot:

```powershell
npm --prefix evaluation run experiment:registry
```

## Artifacts

Experiments default to `data/evaluation-experiments/runs/<experiment-id>/`:

```text
manifest.json
configuration.json
plan.json
catalog.json
schemas/
score.json
learnings.json
learnings.md
batches/<batch>/<site>/<scenario>/<trial>/
  raw/
  raw-freeze.json
  scoring/ground-truth.json
  scoring/submission.json or submission-missing.json
  scoring/score.json
  cleanup.json
```

The append-only event registry and derived reports live under `data/evaluation-experiments/registry/`:

```text
events.jsonl
runs.json
convergence.json
convergence.svg
```

## Oracle coverage gate

Before freezing a new breadth plan, inspect `GET /api/v1/catalog` and report:

- total catalog scenarios;
- enabled, oracle-backed scenarios;
- disabled scenarios;
- the enabled status of every requested scenario.

Only enabled scenarios can produce valid scored evaluations. Disabled catalog entries may be used to design a future stratified schedule, but mark those batches `waiting_for_oracles` and do not claim they were run. Missing oracle coverage is an evaluation-coverage constraint, not evidence that the application passed or failed that scenario.

## Rolling redo-plus-unseen round

For an authorized development round after breadth batch N:

1. Freeze `requirements/round-N-to-N+1.md` and its machine-readable JSON companion from all completed learnings. Treat batch N failures as the primary development evidence and all earlier `worked[]` items as preservation gates.
2. Select one architectural capability and implement one bounded delta. Record the requirement, feature mappings, immediate parent fingerprint, and best verified baseline fingerprint. Branch from a promoted reconstructable snapshot when available; otherwise label the attempt as repair-on-rejected-provenance.
3. Freeze the exact fix plan, fixed regression plan, and rotating plan before running the candidate.
4. Run the fix plan first without editing application code during measurement. Require material improvement of the target invariant, zero safety loss, zero added invalidity, and no material unrelated scenario loss.
5. If the fix checkpoint fails, finalize it, mark regression and rotating `skipped_fix_checkpoint`, update the backlog and trend, and revise or reject. If it passes, run the same source fingerprint on regression and rotating before promotion.
6. Analyze and finalize all completed experiments, update the requirements backlog, development-run registry, and convergence artifacts.
7. Write `cumulative-trend.json` and `cumulative-trend.md` in the development-run directory. Include every completed or rejected measured candidate, cohort role, source fingerprint, plan/catalog compatibility, valid and invalid trial counts, score, strict and safety rates, cumulative valid-trial aggregates, delta from the run baseline, and delta from the previous candidate. Do not omit regressions, skipped gates, or aborted attempts; mark their disposition instead of scoring nonexistent evidence.

Store requirements under:

```text
data/evaluation-experiments/development-runs/<development-run-id>/requirements/
  round-<N>-to-<N+1>.md
  round-<N>-to-<N+1>.json
```

The document must include source experiments, applicable application features, historical worked invariants, unresolved requirements, prioritized latest-batch requirements, regression matrix, implementation trace, acceptance gates, paired redo result, unseen result, and carry-forward requirements.

The final report for each round must summarize two views:

- **Current bundle:** fix, regression, and rotating results for the unchanged candidate.
- **Run-wide trend:** all prior measured bundles in chronological order, plus cumulative valid-trial score, strict-pass rate, safety-pass rate, invalid count, baseline delta, and whether evidence indicates improvement, flat performance, regression, or insufficient comparability.

Only call a delta paired when plan ID, catalog revision, scenario cohort, and trial count are compatible. Otherwise label it descriptive and preserve the incompatibility reason in the trend artifact.

## Three-batch promotion round

Use batches of seven with distinct roles:

- `fix`: exact inspiring frozen plan; bounded to three candidate attempts before architectural reconsideration;
- `regression`: fixed previously successful capability canaries;
- `rotating`: seen-pool scenarios sampled with replacement using complexity and feature strata plus a recency penalty.

For a new development run without a pending application change, freeze and execute `rotating-01` first as the baseline. Analyze it and create the initial requirements before implementing anything.

Promote only when all three roles pass their gates. Use the fix role as an early checkpoint; run regression and rotating only after it passes, on the unchanged candidate. Run a larger corpus checkpoint after two promotions or before a material architectural promotion. Run a reserved holdout only for milestone candidates and relabel every inspected holdout scenario as seen afterward.

Use at least two fresh-generation trials per scenario for final promotion when cost permits. A frozen-script replay may diagnose runtime changes but remains a separate, non-official measurement lane.

## Comparability

`configurationId` identifies execution settings. `planId` additionally freezes the catalog revision and exact selected scenario batches. Use the same `plan.json` across code versions. Never treat different plan IDs as a paired comparison.

The single 0–100 score weights structure/semantics 35, journey/behavior 25, execution/capture 30, and safety/privacy 10. Always report the separate status. `blocked` and `invalid` override the numeric score.
