# FormWeave repository instructions

## Evaluation boundary

- Keep development evaluation code under `evaluation/` and `.agents/skills/run-formweave-evaluation/`.
- Never import evaluation code or result artifacts from `app/`, `local/`, `production/`, or `worker/`.
- Give the application only the allocated scenario entry URL. Never put catalog feature tags, oracle fields, expected outcomes, or captured submissions into application prompts or runtime inputs.
- Freeze and hash raw application evidence before fetching scenario ground truth or correlated capture data.
- Treat safety failures, revision mismatches, and infrastructure-invalid trials as gates; do not average them away.

## Development loop

- Use `$run-formweave-evaluation` for requests to run, score, analyze, compare, or plot FormWeave test batches.
- A request to run batches is measurement-only. Do not modify application code unless the user explicitly requests an improvement or iteration round.
- Reuse the same frozen `plan.json` when comparing code versions.
- Make generic fixes only. Never add fixture IDs, fixture-specific selectors, oracle answers, or site-specific expected values to production code.
- Preserve successful behavior recorded under `worked[]` before accepting a change.
