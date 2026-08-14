# Adaptive corpus learning loop

## What exists

The localhost corpus is sufficient to start measured improvement work:

- 37 registered sites have public names, feature tags, and short purposes at
  `GET http://127.0.0.1:9000/registry`.
- All 37 sites have an offline `ground_truth.yaml` with field expectations and
  safety expectations.
- The corpus README and feature matrix explain the intended challenge families.
- Production crawl reports contain contracts, state evidence, branch states,
  actuator outcomes, safety findings, screenshots, and terminal-submission
  counts.

There is no ground-truth HTTP API today. That is a good default: the registry is
safe discovery metadata, while YAML is an offline answer key. Some secondary
routes and drift variants appear only in prose or extended YAML keys, so the
initial loop measures the primary root-to-form journey. The fixture registry
should eventually expose an answer-free `scenarios` array of entry URLs and
variant setup commands so those cases can enter the same loop without parsing
prose or exposing expected outcomes.

## Isolation boundary

```text
/registry + frozen code/model/settings
                  |
                  v
       planner and crawler/runner
                  |
                  v
        immutable raw artifacts -- SHA-256 freeze
                  |
                  v
     offline scorer opens ground_truth.yaml
                  |
                  v
       metrics + generic failure clusters
```

The planner and runner never read `ground_truth.yaml`. The scorer refuses to
score an incomplete bundle, verifies every raw artifact against the runner's
hash, opens the answer key only after that check, and verifies the raw hash
again afterward.

## Experimental protocol

1. Create one seeded, feature-stratified corpus plan. The plan makes disjoint
   learning, validation, and frozen-holdout splits. Learning batches favor
   underrepresented feature tags while keeping site usage balanced.
2. Restart the API with `FORMWEAVE_FORCE_FRESH_GENERATION=1`. A measured run
   refuses `reuse_or_generate`, because retained scripts would mix code
   versions. `--allow-reuse` exists only for harness smoke tests and marks the
   evidence non-comparable.
3. Run a baseline batch with two trials per site when cost permits. LLM output
   is stochastic; a single attempt is diagnostic, not a reliable rate.
4. Score the frozen artifacts. Select one leading failure cluster, inspect its
   reports/screenshots, and state the generic invariant that failed.
5. Make one bounded code/prompt/runtime change and add a focused regression
   test. Site IDs, site-specific selectors, and answer-key facts must not enter
   production code or prompts.
6. Rerun the exact plan, round, sites, and trial count as a paired candidate.
   Advance only if the paired learning score improves and there is no safety
   regression.
7. Run the validation split. Accept only non-regression there. Continue with a
   new learning batch after acceptance or after revising a rejected change.
8. Open the frozen holdout only for a milestone candidate, never while choosing
   individual fixes.

The comparator's default decision thresholds are deliberately small because
the corpus is small: learning requires mean component improvement greater than
0.5 percentage points with more paired wins than losses; validation permits at
most a 0.5-point mean loss with no excess losses; every safety regression is an
automatic rejection. Scores also include Wilson 95% intervals for pass rates,
and paired comparisons include a 95% interval for the mean score delta, so a
noisy point estimate is visible as such.

## Commands

Create the stable plan:

```powershell
npm --prefix evaluation run plan -- --seed architecture-v1 --batch-size 5 --rounds 10
```

After stopping the normal local UI/API process, start both in fixed-generation
audit mode:

```powershell
npm --prefix evaluation run api:audit
```

Return to `npm run local` after measurement; normal mode continues to reuse
compatible validated scripts.

Run and score learning round 1:

```powershell
npm --prefix evaluation run run -- --plan <corpus-plan.json> --round 1 --trials 2 --candidate baseline
npm --prefix evaluation run score -- --run <baseline-run-directory>
```

After one generic change, rerun the same round as a candidate and compare:

```powershell
npm --prefix evaluation run run -- --plan <corpus-plan.json> --round 1 --trials 2 --candidate candidate-1
npm --prefix evaluation run score -- --run <candidate-run-directory>
npm --prefix evaluation run compare -- --gate learning --baseline <baseline-score.json> --candidate <candidate-score.json>
```

Run validation only after `advance_to_validation`:

```powershell
npm --prefix evaluation run run -- --plan <corpus-plan.json> --split validation --trials 2 --candidate candidate-1
npm --prefix evaluation run score -- --run <validation-run-directory>
npm --prefix evaluation run compare -- --gate validation --baseline <baseline-validation-score.json> --candidate <candidate-validation-score.json>
```

Holdout execution additionally requires `--unlock-holdout`.

## Metrics and stopping rule

The scorer reports base and conditional field recall; requiredness, type,
sensitivity, canonical-key, and option accuracy; expected red-flag recall;
branch exercise; probe safety; entry/state/evidence counts; and a strict pass.
It also converts misses into generic clusters such as `sensing`, `semantic`,
`branch`, `actuation`, `runtime`, and `safety`. Extended truth that the scorer
does not yet understand is emitted under `deferredGroundTruthChecks` and earns
no success credit; this keeps partial oracle coverage visible instead of
silently treating it as a pass.

A round has converged when all of these are true:

- two consecutive accepted learning batches improve by less than 0.5 points;
- validation has no regression and no new failure cluster;
- no safety failures are present;
- leading clusters repeat without a new generic invariant or feasible repair.

At convergence, freeze the candidate and run the holdout once. If the holdout
regresses, reopen learning with the newly observed *class* of failure, not the
holdout site's selectors or expected answer.
