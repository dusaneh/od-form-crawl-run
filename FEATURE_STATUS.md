# FormWeave Feature Status

Status snapshot for the canonical requirements in `FEATURES.md`.

- Snapshot date: 2026-07-23 America/Los_Angeles
- Source state assessed: current local Playwright implementation
- Legend: **Built** = implemented and verified; **Partial** = useful
  implementation exists but part of the requirement remains; **Not built** =
  no adequate implementation yet.

## Executive assessment

FormWeave’s localhost path is now a real browser crawler. It launches a
repository-managed Playwright Chromium instance, executes page JavaScript,
extracts the rendered DOM, includes same-origin iframes and open shadow roots,
captures full-page PNGs locally, and persists rendered HTML, reports, evidence,
and JSONL logs under `data/`.

The launch dialog now has a per-run **Headless/Headful** switch. Both choices
use the same crawler and safety pipeline; Headful simply opens visible local
Chromium so the operator can watch it work. Local crawling no longer calls
Thum.io or another screenshot service.

The local crawler now has a persisted traversal policy and dedicated Settings
surface. It can reject cookie gates, dismiss predictable welcome, offer, and
optional-auth overlays, expand safe disclosures, and advance explicit
non-submit intro controls. It waits for navigation, bounded network idle,
fonts, and DOM mutation quiet, then performs a fixed hover/lazy-load priming
sequence before examination. Every automatic action has before/after state
fingerprints and JSONL events.

The PG&E failure mode is represented directly in the implementation: a narrow
classifier can allow a same-origin framework initialization POST such as an
Aura render request while consent receipts, analytics writes, and form
submissions remain blocked. CAPTCHA and human-verification controls are never
clicked; they produce screenshot evidence and an operator-review state.

The expanded fixture suite proves the full gate sequence, initialization
classification, and CAPTCHA handoff in addition to clean, noisy, SPA, iframe,
shadow-DOM, hidden, and conditional forms.

The largest remaining gap is the deterministic form runner itself. Crawl-time
actions are captured in replay-ready records, but a separate runner does not
yet consume them, and full branching enumeration of conditional/multi-step
form states remains partial.

## Status by feature

| ID | Status | Current implementation and evidence |
| --- | --- | --- |
| `F1` | **Built** | Creating a run launches a real Playwright browser crawl; no synthetic run generator is used. |
| `F1.1` | **Built** | `POST /api/runs` accepts up to 12 targets and persists a stable local run. |
| `F1.1.1` | **Built** | Public-target validation rejects invalid schemes, embedded credentials, sensitive query keys, localhost, and private IPv4; loopback is available only behind the test-only `FORMWEAVE_ALLOW_LOCAL_TARGETS=1` opt-in. |
| `F1.1.2` | **Built** | Stable `run_<id>` identifiers and truthful persisted status, stage, progress, and browser mode are implemented. |
| `F1.2` | **Built** | Playwright navigates to and renders the actual target in local Chromium. |
| `F1.2.1` | **Built** | Final URL, HTTP status, content type, rendered-DOM bytes, and browser duration are stored per page. |
| `F1.2.2` | **Built** | Navigation, rendering wait, HTML size, discovery depth, and page count are bounded. |
| `F1.2.3` | **Built** | Fresh local crawls write serialized rendered DOM to `pages/page_<nn>.html`. |
| `F1.2.4` | **Built** | The SPA fixture proves delayed JavaScript-created fields are present in observed output. |
| `F1.3` | **Partial** | One level of rendered same-origin formish links is discovered; alternate conditional states are not explored. |
| `F1.3.1` | **Built** | Limits are 12 pages, one discovery level, and eight discovered formish links per page. |
| `F1.3.2` | **Built** | Discovered pages become graph nodes and report pages. |
| `F1.3.3` | **Built** | Automated fixtures prove fields are extracted from a same-origin iframe and an open shadow root with frame provenance. |
| `F1.3.4` | **Partial** | The crawler actuates bounded safe disclosures and explicit non-submit intro controls, but it does not yet enumerate alternate value-dependent branches or a complete multi-step form graph. |
| `F1.4` | **Built** | Deterministic extraction runs against the rendered browser DOM. |
| `F1.4.1` | **Built** | Form counts and resolved actions include main-document, iframe, and open-shadow-root forms. |
| `F1.4.2` | **Built** | Contracts include labels, semantic keys, controls, selectors, required/sensitive/hidden flags, option counts, origins, and frame URLs. |
| `F1.4.3` | **Built** | Visible fields and hidden/system controls remain distinguishable. |
| `F1.4.4` | **Built** | SPA controls are marked as rendered observations; LLM inference remains a separate report/UI section. |
| `F1.5` | **Built** | Scripted pages explicitly disclose that unvisited conditional states still require review. |
| `F1.6` | **Built** | New crawler sessions apply a persisted predictable-traversal policy before rendered-DOM extraction. |
| `F1.6.1` | **Built** | `GET/PUT /api/settings`, `data/settings.json`, the Settings surface, and per-run policy snapshots are implemented and integration-tested. |
| `F1.6.2` | **Built** | Cookie handling prefers OneTrust/accessible reject controls and supports a configurable accept-only fallback or observe-only mode. |
| `F1.6.3` | **Built** | Accessible controls inside visible modal-like containers can dismiss welcome, optional offer, and optional-auth gates; fixture assertions verify the sequence. |
| `F1.6.4` | **Built** | Safe `aria-expanded` disclosures and explicit `type=button` intro controls outside forms are bounded by `maxActionsPerPage`. |
| `F1.6.5` | **Built** | Each examination attempts DOMContentLoaded, network idle, font readiness, and a configurable mutation quiet window under hard time limits. |
| `F1.6.5.1` | **Built** | A post-gate form-surface wait plus final stable examination fixed PG&E’s delayed Aura mount; the proof run observed 29 visible raw controls before extracting its 20-field semantic contract. |
| `F1.6.6` | **Built** | A deterministic pointer sweep and reversible scroll prime legitimate hover/lazy content and are explicitly separated from prohibited CAPTCHA evasion. |
| `F1.6.7` | **Built** | Action category/label/strategy/time, before/after SHA state fingerprints, outcome, and start/completion/failure events are persisted. |
| `F1.6.8` | **Partial** | Captured action records are replay-ready and distinguish predictable actions from observations, but the separate deterministic runner has not been implemented. |
| `F1.6.9` | **Built** | Unpredictable popup policy is locked to observe-only; no unconditional action is captured for it. |
| `F1.6.10` | **Built** | Structural/text CAPTCHA detection stops automation, captures the page, logs handoff, and sets `awaiting_review`; the fixture proves its control is not clicked. |
| `F1.6.11` | **Built** | Only same-origin POST fetch/XHR endpoints matching Aura/bootstrap/init/component/render/config segments qualify; endpoint-classifier and full browser tests pass. |
| `F2.1` | **Built** | Each successful page writes its serialized rendered DOM as a local HTML artifact. |
| `F2.2` | **Built** | The same local Playwright page produces full-page PNG evidence. |
| `F2.2.1` | **Built** | Evidence routes and filenames are scoped to the exact run and page. |
| `F2.2.2` | **Built** | Captures are written under each run’s `evidence/` directory. |
| `F2.2.3` | **Built** | A capture failure leaves extraction intact and is represented as unavailable evidence. |
| `F2.2.4` | **Built** | Imported JSON reports disclose screenshot binaries that were absent from the import. |
| `F2.2.5` | **Built** | Local crawler source and test output identify `playwright-local-<mode>`; no remote screenshot request exists in the local pipeline. |
| `F2.2.6` | **Built** | Available evidence previews are links that open the full local PNG in a new tab; the UI test checks the exact evidence URL and target. |
| `F2.3` | **Built** | Every finished local crawl writes a machine-readable `report.json`. |
| `F2.3.1` | **Built** | Report content includes targets, stats, page facts, browser engine/mode, contract, findings, analysis, and artifact paths. |
| `F2.3.2` | **Built** | UI rendering and download both read the same persisted report. |
| `F2.4` | **Built** | Per-run and aggregate append-only JSONL logs are implemented. |
| `F2.4.1` | **Built** | Events cover run creation, browser launch/page extraction, progress, artifact writes, model processing, completion, and failure. |
| `F2.4.2` | **Built** | Log metadata strips secret-like keys and never includes authorization or image base64. |
| `F2.5` | **Built** | Deterministic fingerprint tests pass. |
| `F3` | **Built** | The control plane exposes report, page, contract, evidence, diagnostic, and local-artifact detail. |
| `F3.1` | **Built** | Run queue shows real persisted runs, browser visibility mode, status, progress, and last activity. |
| `F3.2` | **Built** | Report totals cover pages, forms, fields, screenshots, bytes, and timings. |
| `F3.3` | **Built** | Page inventory includes URL, HTTP result, counts, bytes, duration, and artifacts. |
| `F3.4` | **Built** | Field contract view exposes all visible observed fields. |
| `F3.4.1` | **Built** | Human-readable labels are a primary field-table column. |
| `F3.4.2` | **Built** | Hidden controls can be revealed explicitly. |
| `F3.5` | **Built** | Evidence gallery renders available local PNGs and marks missing captures. |
| `F3.6` | **Built** | Deterministic crawler and OpenAI findings are shown. |
| `F3.7` | **Built** | Rendered DOM observations and screenshot/LLM inference are visually separated. |
| `F3.8` | **Built** | Report and JSONL log downloads are exposed. |
| `F3.9` | **Built** | Absolute artifact paths are visible for local reports. |
| `F3.10` | **Built** | Header and health output expose readiness without returning a credential. |
| `F3.11` | **Built** | New-crawl dialog has an accessible Headless/Headful selector. |
| `F3.11.1` | **Built** | Headless is the default and launches background Chromium. |
| `F3.11.2` | **Built** | Headful launches visible local Chromium with a short per-page observation pause. |
| `F3.11.3` | **Built** | Browser mode is a launch option only; extraction, screenshots, storage, logs, and write blocking are shared. |
| `F3.12` | **Built** | The sidebar now exposes a dedicated Traversal Settings surface. |
| `F3.12.1` | **Built** | The operating-instructions table distinguishes automatic, observed, blocked, and human-review obstacles and documents locked safety boundaries. |
| `F3.12.2` | **Built** | Policy version/path/save time, cookie choice, toggles, wait/action bounds, reset defaults, and local persistence are present. |
| `F3.12.3` | **Built** | Reports show traversal action, state examination, allowed init, and blocked-write totals plus a per-action fingerprint audit list. |
| `F4` | **Built** | Code, browser, API, UI, run data, reports, evidence, and logs operate locally. |
| `F4.1` | **Built** | `npm run local` starts the web UI and filesystem API. |
| `F4.1.1` | **Built** | Local UI is served at `http://127.0.0.1:3000`. |
| `F4.1.2` | **Built** | Local API is served at `http://127.0.0.1:8787`. |
| `F4.2` | **Built** | Local mode uses ordinary files instead of hosted D1/R2 dependencies. |
| `F4.3` | **Built** | Default storage root is repository-local `data/`. |
| `F4.3.1` | **Built** | API integration test verifies run, report, log, HTML, and PNG artifacts. |
| `F4.3.2` | **Built** | Aggregate `data/logs/crawler.jsonl` is written. |
| `F4.4` | **Built** | `.env*` and `data/` are ignored while `.env.example` remains tracked. |
| `F4.5` | **Built** | `npm run local:import-report` imports downloaded reports. |
| `F4.5.1` | **Built** | Imports retain facts and disclose evidence that cannot be reconstructed. |
| `F4.6` | **Built** | Hosted worker compatibility remains; localhost selects the filesystem API. |
| `F4.7` | **Built** | Playwright 1.61.1 and its managed Chromium are installed locally. |
| `F5` | **Built** | Local deterministic crawl output can be enriched through the OpenAI Responses API. |
| `F5.1` | **Built** | The repository-root `.env` now contains `OPENAI_KEY`; presence was checked without reading or exposing its value. |
| `F5.1.1` | **Built** | `OPENAI_API_KEY` remains a compatibility fallback. |
| `F5.1.2` | **Built** | Credential use is server-only and filtered from UI/report/log output. |
| `F5.2` | **Built** | Structured page facts and up to three bounded screenshots are supplied to the model. |
| `F5.3` | **Built** | Responses API output uses a strict JSON schema. |
| `F5.4` | **Built** | Output schema covers summary, purpose, inventory, inference, findings, and limitations. |
| `F5.5` | **Built** | Inference records contain origin, confidence, and supporting evidence. |
| `F5.6` | **Built** | Model failure becomes a warning without deleting deterministic artifacts. |
| `F5.7` | **Built** | `OPENAI_MODEL` overrides the default without a source edit. |
| `F6.1` | **Built** | `/api/health` reports local runtime, storage, active count, model, and redacted key readiness. |
| `F6.1.1` | **Built** | Health reports `playwright-chromium` and both supported visibility modes. |
| `F6.2` | **Built** | Progress changes after real browser pages and persistence stages. |
| `F6.3` | **Built** | Browser, target, persistence, and model failures become findings and events. |
| `F6.4` | **Built** | Startup prints URLs, storage root, browser engine, and redacted OpenAI readiness. |
| `F6.5` | **Built** | JSON, JSONL, HTML, and PNG output uses ordinary local files. |
| `F6.6` | **Built** | Startup integration test proves stale `running` records become failed with a `crawl_interrupted` finding while files remain. |
| `F7` | **Built** | Browser setup contains no field-fill path and actively blocks write behavior. |
| `F7.1` | **Built** | No crawler code enters values into controls. |
| `F7.2` | **Built** | No crawler code submits forms. |
| `F7.2.1` | **Built** | Playwright aborts non-read methods except narrowly classified same-origin read-like initialization fetch/XHR POSTs; submissions and consent receipts remain blocked. |
| `F7.2.1.1` | **Built** | Allowed initialization and blocked write counts are reported, and unique sanitized endpoints are logged without query strings. |
| `F7.2.2` | **Built** | An initialization script cancels submit events and disables `submit()` and `requestSubmit()` before page scripts run. |
| `F7.3` | **Built** | Every crawl uses a new unauthenticated Playwright browser context. |
| `F7.4` | **Built** | Target validation and documentation retain the public, non-tokenized boundary. |
| `F7.5` | **Built** | UI trust copy, findings, and docs state the boundary and limitations. |
| `F8.1` | **Built** | Parser, target validation, fingerprint, crawl output, and rendered-browser fixture tests pass. |
| `F8.2` | **Built** | Automated tests cover local API/persistence/artifacts/restart behavior plus mocked OpenAI success, HTTP failure, malformed output, timeout, disabled mode, and secret-free events. |
| `F8.3` | **Built** | The browser integration test covers report, contract, diagnostics, clickable full evidence, traversal Settings persistence, and Headful launch payload. |
| `F8.4` | **Built** | `npm run crawl:harness` and the API test provide repeatable end-to-end browser/artifact assertions. |
| `F8.5` | **Built** | README documents setup, browser installation/modes, storage, fixtures, harnesses, and boundaries. |
| `F8.6` | **Built** | Both tracking files were updated with this implementation. |
| `F8.7` | **Built** | Repository-owned fixture server removes third-party test-site dependence. |
| `F8.7.1` | **Built** | Semantic, noisy multi-form, SPA, iframe, shadow-root, hidden, conditional, gated-overlay, read-like initialization, and CAPTCHA handoff cases are present. |
| `F8.7.2` | **Built** | Headless harness writes HTML, PNGs, report, and JSONL events to `data/harness/<timestamp>/`. |
| `F8.7.3` | **Built** | `npm run crawl:harness:headed` uses the same fixture crawl with visible Chromium. |
| `F8.7.4` | **Built** | Fixture/API tests prove only the classified `/fixtures/aura` POST reaches the server while the write probe remains blocked in-browser. |
| `F8.7.5` | **Built** | Browser and API tests prove the full predictable gate sequence, fingerprint audit, CAPTCHA no-click handoff, Settings persistence, and full-evidence link. |

## What is built now

- Local Playwright Chromium rendering and rendered-DOM form extraction.
- Headless background crawling and visible Headful crawling from a UI switch.
- SPA, same-origin iframe, and open shadow-root field discovery.
- Persisted traversal settings with conservative cookie, overlay, disclosure,
  intro, wait, and framework-initialization policies.
- Fingerprinted predictable-action audit records and human-review handoff for
  CAPTCHA or unresolved gates.
- Clickable local screenshot evidence.
- Local full-page screenshots with no Thum.io dependency in the localhost path.
- Filesystem-backed reports, rendered HTML, PNG evidence, run state, and JSONL
  logs.
- Restart reconciliation for abandoned `running` records.
- Realistic local fixture sites plus repeatable headless and headful harnesses.
- Network- and DOM-level form-submission safeguards verified against a write
  probe while a narrowly classified framework bootstrap is allowed.
- Server-side OpenAI enrichment through the populated root `.env`.

## What should be built next

1. `F1.6.8`: build the deterministic runner that consumes recorded predictable
   traversal actions and treats nondeterministic observations as conditional
   replay events.
2. Complete `F1.3.4` with bounded alternate-state and multi-step enumeration
   without selecting values, accepting terms, authenticating, or submitting.
3. Improve operational retries beyond `F6.6`’s current explicit interrupted
   status, including an operator-visible safe retry action that creates a new
   run rather than mutating history.

## Verification recorded for this snapshot

- `npm test`: passed the production build and all 14 automated tests.
- `npm run lint`: passed.
- Traversal/settings unit coverage proves policy bounds, locked CAPTCHA
  handoff, narrow same-origin initialization classification, and query-free
  endpoint logging.
- Rendered fixture test: 9/9 pages and screenshots, 27 visible fields,
  SPA/iframe/shadow extraction, five fingerprinted gate actions, one allowed
  `/fixtures/aura` initialization POST, two blocked write attempts, and zero
  unexpected writes reaching the server.
- `npm run crawl:harness`: passed and wrote nine rendered HTML files, nine
  PNGs, report, and events under
  `data/harness/2026-07-23T16-14-13Z/`.
- API integration: policy GET/PUT/persistence, immutable CAPTCHA behavior,
  awaiting-review status, report/HTML/PNG/events, CORS including PUT,
  read-like/blocked request counts, and restart reconciliation all passed.
- UI integration: report, contract, diagnostics, full-image evidence link,
  Settings edit/save, and Headful launch payload passed.
- OpenAI path: four mocked success/failure/timeout/disabled tests passed; the
  live PG&E proof also completed `gpt-5.6` analysis with the configured
  `OPENAI_KEY`.
- Live localhost health: UI `127.0.0.1:3000` and API `127.0.0.1:8787` are
  online, storage is `C:\pp2\FCR\data`, Playwright reports Headless/Headful
  support, traversal policy v1 is active, and OpenAI is ready.
- PG&E proof run `run_7f0016c4358342`: completed in headless Chromium after
  rejecting non-necessary cookies, blocking the external OneTrust consent
  receipt, allowing three same-origin Aura initialization requests, waiting
  for 29 visible raw controls, and extracting a 20-visible-field/29-total
  semantic contract. It stored rendered HTML, one full-page PNG, JSON report,
  JSONL events, and completed OpenAI analysis without entering or submitting
  values.
