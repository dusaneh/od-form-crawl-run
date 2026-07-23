# FormWeave Feature Status

Status snapshot for requirements in `FEATURES.md`.

- Snapshot date: 2026-07-22 America/Los_Angeles
- Source commit assessed: `ef93057`
- Legend: **Built** = implemented and verified; **Partial** = useful
  implementation exists but the requirement is not complete; **Not built** =
  no adequate implementation yet.

## Executive assessment

FormWeave is now a working local-first crawler rather than a synthetic UI
demo. A verified local proof run fetched real HTML, extracted seven fields,
stored returned HTML and a PNG screenshot, wrote eight audit events, generated
a JSON report, and completed structured OpenAI analysis. The supplied hosted
report was imported and the UI correctly exposes its 2 pages, 9 forms, 69
visible fields, and 66 hidden controls.

The most important remaining gap is browser-rendered crawling. Deterministic
extraction currently operates on returned HTML, while screenshot capture is
delegated to Thum.io. JavaScript-generated controls and conditional
multi-step states are therefore flagged but not fully explored or certified.

## Status by feature

| ID | Status | Current implementation and evidence |
| --- | --- | --- |
| `F1` | **Built** | Crawl creation triggers real server-side network fetches; no synthetic run generator is used. |
| `F1.1` | **Built** | Local `POST /api/runs` accepts up to 12 public targets and persists a real run. |
| `F1.1.1` | **Built** | `validateTargetUrl` rejects invalid schemes, credentials, sensitive query keys, localhost, and private IPv4 targets. |
| `F1.1.2` | **Built** | Stable `run_<id>` identifiers and persisted status/stage/progress are implemented. |
| `F1.2` | **Built** | `worker/crawler.ts` performs actual fetches with redirect handling and captures response facts. |
| `F1.2.1` | **Built** | HTTP result, final URL, content type, bytes, and duration are stored per page. |
| `F1.2.2` | **Built** | Fetch and screenshot requests have timeouts; HTML and image sizes are bounded. |
| `F1.2.3` | **Built** | Fresh local crawls write `pages/page_<nn>.html`. |
| `F1.3` | **Partial** | One level of same-origin formish links is discovered. General navigation and rendered-state discovery are not implemented. |
| `F1.3.1` | **Built** | Limits are 12 pages and one discovery level. |
| `F1.3.2` | **Built** | Discovered pages become nodes and report pages. |
| `F1.4` | **Partial** | Returned-HTML form extraction is implemented; browser-rendered DOM extraction is not. |
| `F1.4.1` | **Built** | Form counts and resolved actions are recorded. |
| `F1.4.2` | **Built** | Field contracts include labels, keys, controls, selectors, flags, options, and origins. |
| `F1.4.3` | **Built** | Visible and hidden controls are retained separately. |
| `F1.4.4` | **Built** | AI-inferred controls are stored and rendered separately from observed DOM fields. |
| `F1.5` | **Built** | Pages containing scripts receive a dynamic-review finding. |
| `F2.1` | **Built** | Fresh local runs persist returned HTML. Imported JSON reports cannot reconstruct HTML that was not included. |
| `F2.2` | **Partial** | Screenshot bytes are persisted locally, but rendering currently depends on the external Thum.io service. |
| `F2.2.1` | **Built** | Evidence routes and filenames are run/page scoped. |
| `F2.2.2` | **Built** | Successful captures are written under each run’s `evidence/` directory. |
| `F2.2.3` | **Built** | Capture failures leave HTML extraction intact and are reflected as unavailable evidence. |
| `F2.2.4` | **Built** | Imported reports explicitly disclose missing screenshot binaries. |
| `F2.3` | **Built** | Every finished local crawl writes `report.json`. |
| `F2.3.1` | **Built** | The report contains targets, stats, pages, contract, findings, analysis, and artifact paths. |
| `F2.3.2` | **Built** | UI report rendering and download both read the same local `report.json`. |
| `F2.4` | **Built** | Per-run and aggregate JSONL logging are implemented. |
| `F2.4.1` | **Built** | Verified proof run recorded creation through OpenAI completion and crawl completion. |
| `F2.4.2` | **Built** | Logging filters secret-like metadata keys and never logs request authorization or image base64. |
| `F2.5` | **Built** | Deterministic fingerprint tests pass. |
| `F3` | **Built** | The report tab exposes substantially more than progress and top-line counters. |
| `F3.1` | **Built** | Local run queue displays real persisted runs and progress. |
| `F3.2` | **Built** | Report totals include pages, forms, fields, locally available screenshots, source-reported screenshots, bytes, and timings. |
| `F3.3` | **Built** | Page inventory includes URL, HTTP status, form/field counts, bytes, duration, and artifact availability. |
| `F3.4` | **Built** | The contract view exposes all visible fields. |
| `F3.4.1` | **Built** | Human-readable labels are a primary table column. |
| `F3.4.2` | **Built** | Hidden controls can be revealed explicitly. |
| `F3.5` | **Built** | Evidence gallery renders available local images and marks unavailable captures. |
| `F3.6` | **Built** | Deterministic and OpenAI findings are visible. |
| `F3.7` | **Built** | Screenshot-inferred controls have a distinct section, confidence, and evidence. |
| `F3.8` | **Built** | Report and JSONL log downloads are exposed. |
| `F3.9` | **Built** | Absolute local artifact paths appear in the report view. |
| `F3.10` | **Built** | Header and health API expose readiness without revealing a credential. |
| `F4` | **Built** | The codebase, web app, crawler API, run data, reports, evidence, and logs operate locally. |
| `F4.1` | **Built** | `npm run local` starts both processes. |
| `F4.1.1` | **Built** | Local UI verified with HTTP 200 at `http://localhost:3000`. |
| `F4.1.2` | **Built** | API verified online at `http://127.0.0.1:8787`. |
| `F4.2` | **Built** | Local mode uses ordinary files rather than D1 or R2. |
| `F4.3` | **Built** | Default storage root is `C:\pp2\FCR\data`. |
| `F4.3.1` | **Built** | Verified proof-run directory contains run, report, log, HTML, and PNG artifacts. |
| `F4.3.2` | **Built** | Aggregate `data/logs/crawler.jsonl` is written. |
| `F4.4` | **Built** | `.env*` and `data/` are ignored; `.env.example` is intentionally tracked. |
| `F4.5` | **Built** | `npm run local:import-report` imports downloaded reports. |
| `F4.5.1` | **Built** | The supplied report was imported with an explicit missing-binary limitation. |
| `F4.6` | **Built** | Hosted worker compatibility remains while localhost selects the filesystem API. |
| `F5` | **Built** | A real proof crawl completed OpenAI enrichment. |
| `F5.1` | **Partial** | Code prefers root `.env` `OPENAI_KEY`, but the current repository `.env` is empty. |
| `F5.1.1` | **Built** | The running service successfully uses the existing `OPENAI_API_KEY` fallback. |
| `F5.1.2` | **Built** | Credential remains server-side; a source scan found no key-like secret committed. |
| `F5.2` | **Built** | Crawl facts and up to three bounded screenshots are supplied to the model. |
| `F5.3` | **Built** | Responses API output uses a strict JSON schema. |
| `F5.4` | **Built** | Verified output includes summary, purpose, inventory, inference, findings, and limitations. |
| `F5.5` | **Built** | Inference records include origin URL, confidence, and evidence. |
| `F5.6` | **Built** | Analysis failure becomes a warning while deterministic artifacts remain. |
| `F5.7` | **Built** | `OPENAI_MODEL` overrides the default model. |
| `F6.1` | **Built** | `/api/health` returns local runtime, storage, model, key readiness, and active count. |
| `F6.2` | **Built** | Progress updates occur after real crawl batches and persistence stages. |
| `F6.3` | **Built** | Fetch, worker, and LLM failures become findings and log events. |
| `F6.4` | **Built** | Local startup prints both URLs, artifact root, key source name, and model without the key value. |
| `F6.5` | **Built** | JSON, JSONL, HTML, and PNG artifacts are ordinary files. |
| `F6.6` | **Not built** | A process restart preserves files but does not resume or explicitly reconcile an in-progress crawl. |
| `F7` | **Built** | Current crawler has no field-actuation or submit implementation. |
| `F7.1` | **Built** | No code path fills controls. |
| `F7.2` | **Built** | No code path submits forms. |
| `F7.3` | **Built** | Screenshot service receives only the public URL and no user session. |
| `F7.4` | **Built** | Target validation and documentation state the supported public boundary. |
| `F7.5` | **Built** | Trust strip, report limitations, and findings communicate the boundary. |
| `F8.1` | **Built** | Four automated parser/security/output tests pass. |
| `F8.2` | **Not built** | Local API, filesystem persistence, and OpenAI error paths lack automated tests. |
| `F8.3` | **Not built** | UI report/evidence/contract behavior was manually browser-verified but lacks automated integration tests. |
| `F8.4` | **Partial** | A real smoke crawl was completed and inspected, but it is not yet a repeatable automated test command. |
| `F8.5` | **Built** | `README.md` documents local setup, storage, import, safety, and external boundaries. |
| `F8.6` | **Built** | These tracking files now exist; ongoing compliance begins with this change. |

## What is built now

- Real public-page fetching and bounded same-origin discovery.
- Deterministic HTML form extraction and stable field contracts.
- Localhost UI plus a filesystem-backed local API.
- Per-run JSON, JSONL, returned HTML, screenshots, and artifact paths.
- Full report UI, field labels, hidden-control reveal, evidence, diagnostics,
  downloads, and local paths.
- Structured OpenAI screenshot/fact analysis with clearly separated inference.
- Import of existing downloaded FormWeave reports.
- Read-only safety validation, documentation, and core parser tests.

## What should be built next

1. `F1.3` and `F1.4`: add a local browser-rendered crawl engine that evaluates
   JavaScript, extracts the rendered DOM, and explores bounded conditional or
   multi-step states without submitting forms.
2. `F2.2`: replace the Thum.io dependency with local browser screenshot capture
   so collection as well as storage is local.
3. `F8.2`: add automated tests for local API routing, filesystem persistence,
   redaction, interrupted work, and OpenAI success/failure behavior.
4. `F8.3` and `F8.4`: add browser integration tests and a repeatable real smoke
   test command with artifact assertions.
5. `F6.6`: reconcile interrupted `running` records at startup and support safe
   retry or resume.
6. `F5.1`: populate the repository-root `.env` with `OPENAI_KEY` if that exact
   credential source is required; the file is currently empty and the verified
   runtime is using `OPENAI_API_KEY`.

## Verification recorded for this snapshot

- `npm test`: passed, 4 tests.
- `npm run lint`: passed.
- Local web endpoint: HTTP 200.
- Local API health: online with OpenAI configured.
- Proof run `run_7791a477cb444f`: completed, 1 page, 1 form, 7 observed
  fields, 1 local screenshot, returned HTML, 8 JSONL events, completed OpenAI
  analysis.
- Imported run `run_5e078109994d46`: 2 pages, 9 forms, 69 visible fields;
  original screenshot binaries unavailable because they were not part of the
  downloaded JSON.
- Browser console during report verification: no warnings or errors.
