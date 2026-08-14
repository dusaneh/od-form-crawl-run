# Evaluation Observatory

This is a read-only development interface over frozen FormWeave evaluation artifacts. It is deliberately separate from application runtime code: the dashboard imports only evaluator modules and reads only `data/evaluation-experiments`.

Run it from the workspace root:

```powershell
npm --prefix evaluation run dashboard
```

Open `http://127.0.0.1:8790`. Set `FORMWEAVE_DASHBOARD_PORT` or pass a port as the final command argument to use another port.

The interface supports:

- development-run and whole-history views;
- fix, regression, rotating, and other batch-role filters;
- overall, strict, safety, four category, and individual-check score lenses;
- test-level complexity filtering and score-versus-complexity plots;
- per-site aggregate ranking for the selected score lens;
- per-site score timelines across every experiment containing that site;
- candidate trajectory, batch-role aggregates, and trial-level evidence tables.

`data.mjs` is the single read model. It joins the experiment registry, each frozen `score.json` and `plan.json`, and development-run execution ledgers. `server.mjs` rebuilds that model on every API request, so newly finalized experiments appear after a browser refresh without copying data into application storage.
