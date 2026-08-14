# FormWeave external evaluation

This directory is development infrastructure, not application runtime code.

Boundary rules:

- `app/`, `local/`, `production/`, and `worker/` must never import `evaluation/`.
- The evaluator may start or call the application through its public process/API
  boundary.
- The application receives only a test scenario entry URL.
- Catalog feature tags stay in the evaluator and are not inserted into prompts.
- Ground truth is fetched only after run artifacts are frozen and hashed.
- Submission capture is read by `evaluation_id`, never by an uncorrelated
  process-global "latest" record.
- Evaluation outputs live under `data/adaptive-corpus/`; production code does
  not read them.

Contents:

- [`experiment/README.md`](./experiment/README.md): Evaluation Protocol v1 multi-batch, scoring, qualitative-analysis, registry, comparison, and convergence framework.
- [`dashboard/`](./dashboard/): read-only evaluation observatory for filtering scores by development run, experiment, batch role, individual test, complexity, category, or scored check. It reads frozen artifacts directly and has no application imports or routes.
- [`configs/five-by-three-v1.json`](./configs/five-by-three-v1.json): tracked default measurement configuration.
- [`spec/TESTFORMS_EVALUATION_PROTOCOL-v1.md`](./spec/TESTFORMS_EVALUATION_PROTOCOL-v1.md): original proposed API and scoring contract; live served v1 schemas are authoritative.
- [`spec/testforms-evaluation.openapi.json`](./spec/testforms-evaluation.openapi.json): OpenAPI 3.1 endpoint definition.
- `spec/*.schema.json`: machine-readable catalog, ground-truth, evaluation,
  and submission schemas.
- [`adaptive/README.md`](./adaptive/README.md): current batch/freeze/score/compare
  legacy localhost experiment harness.

Validation:

```powershell
npm --prefix evaluation run validate:spec
npm --prefix evaluation test
npm --prefix evaluation run experiment:plan -- --config evaluation/configs/five-by-three-v1.json
```

Analytics interface:

```powershell
npm --prefix evaluation run dashboard
```

Then open `http://127.0.0.1:8790`. The server is intentionally contained in
`evaluation/`; it neither starts nor modifies the FormWeave application.
