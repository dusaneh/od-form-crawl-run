# FormWeave experiment framework

This is external development infrastructure for Evaluation Protocol v1. It plans feature-balanced batches, runs the application against correlated test allocations, freezes raw evidence before oracle access, produces a gated 0–100 score, stores evidence-linked qualitative drafts, records immutable experiment events, compares exact cohorts, and renders convergence. The live schemas served by `testforms.dbolab.io/api/v1/schemas/*` are authoritative and are snapshotted into every plan and experiment.

Use the repository skill `$run-formweave-evaluation` for the complete workflow. The tracked default configuration is `evaluation/configs/five-by-three-v1.json`.

Validation:

```powershell
npm --prefix evaluation test
npm --prefix evaluation run validate:spec
npm --prefix evaluation run experiment:plan -- --config evaluation/configs/five-by-three-v1.json
```
