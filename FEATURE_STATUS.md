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

The launch dialog now has independent **Headless/Headful** browser visibility
and **Dry Run/Live** execution switches. Dry Run is the default: it enters
synthetic values, exercises bounded branch options, follows intermediate form
steps, permits interaction-triggered validation/autosave side effects, stores
populated screenshot evidence, and stops before the final submit control. Live
requires an approval checkbox plus the typed confirmation `SUBMIT` before the
API permits a final submission.

The local crawler now has a persisted traversal policy and dedicated Settings
surface. In addition to predictable gates, policy v2 configures synthetic
field entry, branch exercise, intermediate advancement, state and branch
limits, and editable natural-language instructions for the LLM planner. A
deterministic planner provides the same output shape when model planning is
unavailable. Hard safety rules still override the prompt.

The PG&E failure mode is represented directly in the implementation: a narrow
classifier can allow a same-origin framework initialization POST such as an
Aura render request. Short same-origin interaction windows also permit
validation, autosave, and intermediate-step requests. Autonomous writes remain
blocked; CAPTCHA, credentials, file upload, payment, and legal acceptance are
still handed to a person.

The expanded fixture suite proves value entry across native controls,
select/radio/checkbox branching, newly revealed conditional fields,
autosaving, multi-step advancement, populated screenshots, Dry Run final
blocking, and an explicitly approved Live submission to a repository-owned
endpoint. It also retains the gate, SPA, iframe, shadow-DOM, and CAPTCHA cases.

The largest remaining gap is the separate deterministic replay runner.
Crawl-time action records now include field values, branches, state IDs, and
fingerprints, but a later run does not yet consume those records. Branch
coverage is deliberately bounded rather than combinatorially exhaustive.

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
| `F1.3` | **Built** | One level of rendered same-origin formish links is discovered, and each page receives bounded value-driven conditional/multi-step exploration. |
| `F1.3.1` | **Built** | Limits are 12 pages, one discovery level, and eight discovered formish links per page. |
| `F1.3.2` | **Built** | Discovered pages become graph nodes and report pages. |
| `F1.3.3` | **Built** | Automated fixtures prove fields are extracted from a same-origin iframe and an open shadow root with frame provenance. |
| `F1.3.4` | **Built** | The crawler populates visible controls, exercises bounded branch alternatives, fills newly revealed fields, and advances intermediate steps until the final-submit boundary or a configured state limit. |
| `F1.3.4.1` | **Built** | Deterministic values cover text, email, phone, URL, date, number/range, ZIP, names, addresses, password, textarea, select, radio, checkbox, and switch controls; the planner may override them within the schema. |
| `F1.3.4.2` | **Built** | Select, radio, checkbox, and switch alternatives are bounded by `maxBranchOptionsPerControl`; the noisy wizard test exercises all four selection paths represented by the fixture. |
| `F1.3.4.3` | **Built** | A post-branch reinspection finds and populates conditional program, dependent, updates, and contact controls before advancement. |
| `F1.3.4.4` | **Built** | Every entry produces an action and event with field key, test value, planner source, before/after fingerprints, status, and error when applicable. |
| `F1.3.4.5` | **Built** | Classified intermediate controls receive guarded submit permission and bounded same-origin write windows; the three-step fixture reaches its review state. |
| `F1.3.4.6` | **Built** | The fixture proves interaction-triggered `/fixtures/autosave` POSTs complete in Dry Run while the final endpoint is not reached. |
| `F1.3.4.7` | **Built** | Observed fields carry test value(s), source, and entry result; inferred fields carry `defaultTestValue`; human-review controls are explicit. |
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
| `F1.6.11` | **Built** | Narrow same-origin framework initialization classification is combined with short action-scoped windows for validation, autosave, and intermediate progression. |
| `F1.6.11.1` | **Built** | Non-read requests outside a classifier or active window are aborted, counted, and logged. |
| `F1.6.11.2` | **Built** | Only the explicitly approved Live final action receives a write window scoped to its resolved form-action origin; Dry Run never does. |
| `F2.1` | **Built** | Each successful page writes its serialized rendered DOM as a local HTML artifact. |
| `F2.2` | **Built** | The same local Playwright page produces full-page PNG evidence. |
| `F2.2.1` | **Built** | Evidence routes and filenames are scoped to the exact run and page. |
| `F2.2.2` | **Built** | Captures are written under each run’s `evidence/` directory. |
| `F2.2.3` | **Built** | A capture failure leaves extraction intact and is represented as unavailable evidence. |
| `F2.2.4` | **Built** | Imported JSON reports disclose screenshot binaries that were absent from the import. |
| `F2.2.5` | **Built** | Local crawler source and test output identify `playwright-local-<mode>`; no remote screenshot request exists in the local pipeline. |
| `F2.2.6` | **Built** | Available evidence previews are links that open the full local PNG in a new tab; the UI test checks the exact evidence URL and target. |
| `F2.2.7` | **Built** | Populated, branch, and pre-advance screenshots are captured before the crawler moves to the next state. |
| `F2.2.8` | **Built** | Persisted state records contain sequence, kind, URL, timestamp, fingerprint, visible-field count, entered values, and a local PNG route/artifact. |
| `F2.2.9` | **Built** | State kinds distinguish initial, populated, branch, pre/post advance, blocked final, and submitted evidence. |
| `F2.3` | **Built** | Every finished local crawl writes a machine-readable `report.json`. |
| `F2.3.1` | **Built** | Report content includes targets, stats, page facts, browser engine/mode, contract, findings, analysis, and artifact paths. |
| `F2.3.2` | **Built** | UI rendering and download both read the same persisted report. |
| `F2.4` | **Built** | Per-run and aggregate append-only JSONL logs are implemented. |
| `F2.4.1` | **Built** | Events cover run creation, browser launch/page extraction, progress, artifact writes, model processing, completion, and failure. |
| `F2.4.2` | **Built** | Log metadata strips secret-like keys and never includes authorization or image base64. |
| `F2.5` | **Built** | Deterministic fingerprint tests pass. |
| `F3` | **Built** | The control plane exposes report, page, contract, evidence, diagnostic, and local-artifact detail. |
| `F3.1` | **Built** | Run queue shows real persisted runs, browser visibility mode, status, progress, and last activity. |
| `F3.2` | **Built** | Report totals cover pages, forms, fields, page/state screenshots, entered fields, failures, branch states, submissions, bytes, and timings. |
| `F3.3` | **Built** | Page inventory includes URL, HTTP result, counts, bytes, duration, and artifacts. |
| `F3.4` | **Built** | Field contract view exposes all visible observed fields plus their generated test values and entry result. |
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
| `F3.12.4` | **Built** | Settings expose synthetic entry, branch exercise, intermediate advancement, state limits, and branch-option limits. |
| `F3.12.5` | **Built** | The policy editor persists natural-language agent instructions and clearly lists the deterministic hard-safety overrides. |
| `F3.13` | **Built** | New-crawl UI and API accept `dry_run` or `live` as distinct execution modes. |
| `F3.13.1` | **Built** | Dry Run is the default and is verified to reach a populated final boundary without issuing the fixture final POST. |
| `F3.13.2` | **Built** | Live launch stays disabled until both approval controls are satisfied; the API independently rejects unapproved Live requests. |
| `F3.13.3` | **Built** | Mode and final outcome are persisted in run/report data and shown in trust copy, badges, findings, action history, and submission metrics. |
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
| `F5.4` | **Built** | Output schema covers summary, purpose, inventory, inference with synthetic defaults, findings, and limitations. |
| `F5.5` | **Built** | Inference records contain origin, confidence, supporting evidence, and `defaultTestValue`. |
| `F5.6` | **Built** | Model failure becomes a warning without deleting deterministic artifacts. |
| `F5.7` | **Built** | `OPENAI_MODEL` overrides the default without a source edit. |
| `F5.8` | **Built** | The configured Responses API planner receives the persisted instructions and visible control/action metadata, then returns a strict field/branch/advance plan. |
| `F5.8.1` | **Built** | Deterministic planning is used when OpenAI is absent, disabled, times out, fails, or proposes unknown control IDs. |
| `F5.8.2` | **Built** | Field/action safety classification and Dry/Live enforcement override planner output for protected operations. |
| `F6.1` | **Built** | `/api/health` reports local runtime, storage, active count, model, and redacted key readiness. |
| `F6.1.1` | **Built** | Health reports `playwright-chromium` and both supported visibility modes. |
| `F6.2` | **Built** | Progress changes after real browser pages and persistence stages. |
| `F6.3` | **Built** | Browser, target, persistence, and model failures become findings and events. |
| `F6.4` | **Built** | Startup prints URLs, storage root, browser engine, and redacted OpenAI readiness. |
| `F6.5` | **Built** | JSON, JSONL, HTML, and PNG output uses ordinary local files. |
| `F6.6` | **Built** | Startup integration test proves stale `running` records become failed with a `crawl_interrupted` finding while files remain. |
| `F7` | **Built** | Execution is synthetic-data-first with an enforced Dry/Live final-submit boundary. |
| `F7.1` | **Built** | Test-value generators use conspicuously synthetic names, `.invalid` emails, 555 phones, and fixture-safe numeric/address values. |
| `F7.1.1` | **Built** | Credentials, payment, files, CAPTCHA, and legal/terms acceptance are hard-classified for human review. |
| `F7.2` | **Built** | Dry Run records and screenshots the completed final state without clicking the final action. |
| `F7.2.1` | **Built** | Validation, autosave, branch, and intermediate writes are allowed only in short same-origin action windows. |
| `F7.2.2` | **Built** | Live final submission requires UI confirmation and independent API validation. |
| `F7.2.3` | **Built** | Other non-read requests are aborted; an approved Live final window permits only the resolved form-action origin. |
| `F7.2.3.1` | **Built** | Initialization, interaction writes, blocked writes, and submission attempt/success counts are logged and reported. |
| `F7.2.4` | **Built** | Submit guards install before site scripts and release only through a short classified action permit. |
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
| `F8.7.4` | **Built** | Fixture/API tests prove classified `/fixtures/aura` and interaction-scoped `/fixtures/autosave` requests complete while autonomous `/fixtures/write-probe` and Dry Run final submission do not. |
| `F8.7.5` | **Built** | Browser and API tests prove the full predictable gate sequence, fingerprint audit, CAPTCHA no-click handoff, Settings persistence, and full-evidence link. |
| `F8.7.6` | **Built** | Browser tests prove synthetic entry, branches, revealed fields, intermediate steps, populated state evidence, Dry Run blocking, and repository-owned Live submission. |

## What is built now

- Local Playwright Chromium rendering and rendered-DOM form extraction.
- Headless background crawling and visible Headful crawling from a UI switch.
- Dry Run synthetic traversal and explicitly confirmed Live final submission
  from a separate UI switch.
- SPA, same-origin iframe, and open shadow-root field discovery.
- Persisted traversal settings with conservative cookie, overlay, disclosure,
  intro, field-entry, branch, advance, wait, network, and agent-instruction
  policies.
- Synthetic default/test values, per-field entry outcomes, bounded
  select/radio/checkbox branching, conditional-field discovery, and
  multi-step progression.
- Fingerprinted predictable-action audit records and human-review handoff for
  CAPTCHA or unresolved gates.
- Clickable local screenshot evidence for every captured populated and branch
  state, including the values present at capture time.
- Local full-page screenshots with no Thum.io dependency in the localhost path.
- Filesystem-backed reports, rendered HTML, PNG evidence, run state, and JSONL
  logs.
- Restart reconciliation for abandoned `running` records.
- Realistic local fixture sites plus repeatable headless and headful harnesses.
- Network- and DOM-level submission guards verified against autonomous write
  probes while classified bootstrap, validation, autosave, intermediate, and
  approved fixture Live actions are allowed.
- Server-side OpenAI enrichment through the populated root `.env`.

## What should be built next

1. `F1.6.8`: build the deterministic runner that consumes recorded predictable
   traversal actions and treats nondeterministic observations as conditional
   replay events.
2. Add branch-path restoration and combination planning beyond the current
   per-control bounded alternatives, without turning coverage into an
   unbounded Cartesian product.
3. Improve operational retries beyond `F6.6`’s current explicit interrupted
   status, including an operator-visible safe retry action that creates a new
   run rather than mutating history.

## Verification recorded for this snapshot

- `npm test`: production build and all 14 automated tests passed.
- `npm run lint`: passed.
- Traversal/settings unit coverage proves policy bounds, locked CAPTCHA
  handoff, state/branch bounds, narrow initialization classification, and
  query-free endpoint logging.
- Rendered fixture coverage passes 9/9 clean/noisy/SPA/iframe/shadow/gated/
  CAPTCHA pages, then separately proves an 18-state Dry Run traversal with 13
  successful field entries, eight branch states, zero entry failures, and a
  blocked final action.
- The repository-owned Live fixture reaches the third form state, issues one
  approved final submission, captures submitted-state evidence, and never
  reaches the autonomous write probe.
- `npm run crawl:harness` passed 9/9 fixture pages with 38 visible fields, nine
  page screenshots, 46 populated/branch/advance screenshots, zero field-entry
  failures, 51 expected initialization/autosave requests, and zero unexpected
  writes. Artifacts are under
  `data/harness/2026-07-23T17-55-19Z/`.
- API integration covers policy GET/PUT/persistence, immutable CAPTCHA
  behavior, unapproved-Live rejection, awaiting-review status,
  report/HTML/page-and-state PNG/events, CORS including PUT, interaction write
  counts, and restart reconciliation.
- UI integration passes report, generated test-value contract, diagnostics,
  full-image evidence link, Settings edit/save, Headful Dry Run launch, and
  gated Headless Live launch payloads.
- OpenAI path: four mocked success/failure/timeout/disabled tests passed; the
  live PG&E proof also completed `gpt-5.6` analysis with the configured
  `OPENAI_KEY`.
- Live localhost health: UI `127.0.0.1:3000` and API `127.0.0.1:8787` are
  online, storage is `C:\pp2\FCR\data`, Playwright reports Headless/Headful
  support, traversal policy v2 is active, and OpenAI is ready.
- PG&E proof run `run_7f0016c4358342`: completed in headless Chromium after
  rejecting non-necessary cookies, blocking the external OneTrust consent
  receipt, allowing three same-origin Aura initialization requests, waiting
  for 29 visible raw controls, and extracting a 20-visible-field/29-total
  semantic contract. That historical proof predates synthetic traversal; new
  runs now enter generated values and capture each populated state while Dry
  Run still blocks the final action.
