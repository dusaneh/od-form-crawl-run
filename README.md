# FormWeave

FormWeave is a local Playwright crawler, execution-physics framework, and
evidence control plane for public web forms.

**Current capability boundary:** Novel form states receive LLM semantic
proposals, safety-approved actions compile into immutable per-form scripts,
and Playwright deterministically validates/replays those scripts. Public D5,
full coverage certification, authentication/tenant isolation, locale support,
and automated execution-based drift remain release gates. The local API now
supports crawl-scoped form approval and approved dry-run or submit execution;
it is an initial local vertical slice, not yet a production multi-user API.

The UI, API, browser, reports, rendered HTML, screenshots, lineages, tests,
fixtures, and logs run on this machine. Optional OpenAI analysis is the only
remote product dependency.

## Requirements and status

- `FEATURES.md` is the canonical Phase 1 requirements file.
- `FEATURES_CONTRACT_V2.md` is the binding semantic-layer/generated-script/
  executor architecture and definition contract.
- `FEATURE_STATUS.md` is the current built/partial/not-built assessment.
- `FEATURES_PHASE2.md` covers the later real-data runner, approved-live
  execution, coverage gating, uploads, and evidence masking. Script generation
  and semantic expansion are Phase 1 requirements F14 and F16.

Phase 2 requirements are not Phase 1 implementation claims.

## Start locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npx playwright install chromium
npm run local
```

This starts:

- UI: `http://127.0.0.1:3000`
- local crawler API: `http://127.0.0.1:8787`
- health: `http://127.0.0.1:8787/api/health`

The repository-root `.env` can enable optional OpenAI enrichment:

```dotenv
OPENAI_KEY=your-key-here
# Optional model override
OPENAI_MODEL=gpt-5.4-mini
OPENAI_SEMANTIC_MODEL=gpt-5.4-mini
```

`OPENAI_API_KEY` is also accepted as a compatibility fallback. The credential
is read only by the local API and is filtered from UI data, reports, and logs.

The New crawl dialog has a browser switch:

- **Headless** runs Chromium in the background.
- **Headful** opens Chromium locally so the crawl can be watched.

For local test sites, enable **Allow localhost test sites for this run** in the
same dialog. That per-run opt-in permits only localhost/`*.localhost`, `::1`,
and `127.0.0.0/8`; other private-network targets remain blocked.

Both use the same browser physics, network guard, extraction, screenshots,
logs, and filesystem persistence.

Public targets use **Probe** and never activate a terminal submit control.
Explicitly allowed loopback fixtures also expose a separately labeled
submission-conformance mode. Intermediate `Next` actions may make same-origin
POST requests after a form-specific planner classifies them as nonterminal.
Validation, autosave, and intermediate round-trips can therefore leave partial
server-side state even though the final submission is blocked.

## Architecture

The production crawl path follows the Contract v2 boundary: rendered sensing
feeds schema-constrained semantic proposals; non-model safety admits or
rejects each action; accepted mechanics are retained in an immutable
form-specific script; and deterministic Playwright replay executes only those
stored mechanics. Retained replay intentionally has no semantic model call.

- `local/recon-scripts/` contains legacy hand-authored planners. Their manual
  version integers are not D1 generated-script versions.
- `local/semantic/` owns novel-state sensing, typed proposals, provenance, and
  non-model proposal safety.
- `local/compiler/` owns the closed D1 source template, immutable compilation,
  restricted loader, and isolated localhost replay worker.
- `local/contracts/` and `local/executor/` own D2/D4 storage and the one D3
  execution/physics path.
- `local/form-traversal.mjs` executes a script's declared plan, verifies
  locator uniqueness and readback, re-baselines branch probes, captures state
  evidence, and enforces the terminal boundary.
- `local/playwright-crawler.mjs` owns fresh browser contexts, target/network
  policy, predictable gates, page discovery, rendered extraction, and event
  collection.
- `local/server.mjs` owns the localhost API, quality gate, persistence,
  lineages, optional OpenAI enrichment, approval, execution, and artifact
  routes.
- `local/form-registry.mjs` owns crawl-scoped form IDs and exact script-pinned
  approval records.
- `local/approved-execution.mjs` runs an approved script with client data while
  keeping raw values and file bytes out of persisted records and logs.

## Local artifacts and logs

New crawl state is written beneath the git-ignored `data/` directory:

```text
data/
  settings.json
  logs/
    crawler.jsonl
  generated-scripts/
    form_<url-hash>/
      latest.json
      v1/
        generated.mjs
        manifest.json
        source.sha256
  lineages/
  forms/
    form_<crawl-scoped-id>/
      form.json
      approval_<id>.json
  executions/
    exec_<id>/
      execution.json
      events.jsonl
  runs/
    run_<id>/
      run.json
      report.json
      events.jsonl
      pages/
        page_01.html
      evidence/
        page_01.png
        page_01_state_01.png
        page_01_state_02.png
      generated/
        semantic-generation/
        state-plans/
        form-script/
```

`run.json` drives queue/progress state. `report.json` is the deterministic
report plus optional OpenAI inference. `events.jsonl` is the per-run audit log.
HTML and PNG files are ordinary local artifacts. Evidence thumbnails in the
UI link to the full image. Safety-approved complete form scripts are published
as immutable, hash-verified versions under `data/generated-scripts/`. A later
run may select a compatible retained version only after route, first-state
selector, interface-version, source-hash, and fresh protected-authority
preflight. The report labels fresh generation separately from retained replay
and counts traversal-model calls for the current run.

Import an existing JSON report with:

```bash
npm run local:import-report -- C:\path\to\report.json
```

Downloaded reports do not contain their original screenshot bytes. An import
retains the JSON facts and marks unavailable images honestly.

## What a Phase 1 probe does

- validates public HTTP/HTTPS targets and rejects credentials, private
  networks, and token-like sensitive query parameters, with the explicit
  loopback-only test-site opt-in described above
- opens each target in a fresh unauthenticated local Chromium context
- executes JavaScript and inspects the rendered document, same-origin frames,
  and open shadow roots
- applies conservative predictable gates such as rejecting nonessential
  cookies and closing clearly optional overlays
- performs deterministic load, font, network-idle-attempt, mutation-quiet,
  pointer, and reversible-scroll preparation before state examination
- extracts raw field identity, selector candidates, type, literal required
  source, option values/labels, group legends, scoped guidance, DOM-derived
  section membership, validation, upload, consent, repeatability,
  form/section context, and provenance
- asks the LLM semantic layer to propose fields and actions for each novel
  state, safety-validates and stores those actions, then replays only the
  retained form-specific script
- uses format-plausible synthetic values and verifies every action by exact
  locator resolution plus browser readback
- re-baselines bounded branch probes and records `could_not_test` when a safe,
  predictable baseline cannot be established
- allows short same-origin write windows only for classified field
  interactions and nonterminal advances; cross-origin writes remain blocked
- senses disabled controls, CAPTCHA gates, and the terminal action without
  solving CAPTCHA or activating submit
- captures entered values before movement plus initial, branch,
  pre/post-advance, and blocked-final screenshots
- sends bounded full/tiled screenshots to optional OpenAI analysis as sensing
  input, not merely as an archive
- stores report JSON, rendered HTML, PNG evidence, events, and lineage locally

Structural fingerprints intentionally exclude entered values, page body text,
headings, generated semantic keys, and cross-origin frames.

## Crawl, approval, and run API

The API is documented as six small, standalone contracts matching the client
workflow:

- [`openapi-crawl-start.json`](./openapi-crawl-start.json): kick off a crawl;
- [`openapi-crawl-status.json`](./openapi-crawl-status.json): check a crawl;
- [`openapi-crawl-artifacts.json`](./openapi-crawl-artifacts.json): get the
  report, form schema, and screenshot evidence;
- [`openapi-form-approval.json`](./openapi-form-approval.json): approve or
  reject a crawled form;
- [`openapi-form-run.json`](./openapi-form-run.json): kick off a form run;
- [`openapi-execution-status.json`](./openapi-execution-status.json): check a
  form run.

For a concise end-to-end example covering crawl, status, report/evidence,
schema, approval, dry run or live submission, and result polling, see
[`API_QUICKSTART.md`](./API_QUICKSTART.md).

OpenAPI tags organize generated documentation and clients; they do not cause
runtime logging or authorization. Declarations under `components` are reused
with `$ref`; callers still pass actual IDs in URL paths.

1. `POST /api/runs` with `urls`, `browserMode`, and optional localhost test
   authority.
2. Poll `GET /api/runs/{crawlId}` and fetch
   `GET /api/runs/{crawlId}/report`.
3. Read `formDefinitions[].formId` and `inputSchema`. Every recrawl creates a
   new `formId`, even when the URL and retained script hash are unchanged.
4. `POST /api/forms/{formId}/approval` with `decision`, `actor`, and optional
   `notes`. Approval pins the exact artifact ID, script version, and source
   hash.
5. `POST /api/forms/{formId}/runs` with `data`, mandatory `submit`, and
   optional `browserMode`.
6. Poll `GET /api/executions/{executionId}` for verified field counts,
   submission outcome, failure code, and detail.

`data` is keyed by the returned input schema. File fields accept an object with
`filename`, `contentType`, and `contentBase64`. `submit: false` fills and
verifies without the terminal action; `submit: true` explicitly opens the
bounded terminal-action window. Raw supplied values and file bytes are not
written to `execution.json` or `events.jsonl`.

`PATCH /api/runs/{runId}` with `request_review` is a deprecated status-only
action. It marks a run `awaiting_review` and appends an event, but there is no
review queue, reviewer assignment, approval, certification, or UI workflow
behind it.

## Tests and harnesses

Run the complete verification gate:

```bash
npm test
npm run lint
npx tsc --noEmit
```

Run the repository-owned noisy fixture crawl:

```bash
npm run crawl:harness
npm run crawl:harness:headed
```

Run the user-provided 27-site localhost **execution-conformance** corpus after starting
`localhost-test-sites/start-test-server.bat`:

```bash
npm run corpus:harness
npm run corpus:harness:headed
npm run corpus:harness -- --extended
npm run corpus:drift
```

`--extended` also exercises the image-only CAPTCHA and the safe cross-page
negative path. Corpus artifacts are stored under
`data/localhost-corpus/<timestamp>/`. Ground truth constructs these planners
and later scores them, so the result is never evidence of discovery,
generation, or flexibility. `fixture_submit` is hard-limited to explicitly
allowed loopback URLs and is available through a separately labeled product-UI
test option; it is never available for public targets.

Run the Gate 2 semantic-generation check separately:

```bash
npm run gate2:localhost
npm run gate2:score -- --run <absolute-generation-run-directory>
```

The first command discovers and observes live localhost pages in a restricted
worker that must fail an answer-key read probe before any model call. It writes
unscored immutable inputs, screenshots, proposals, provenance, and safety
decisions under `data/gate2-localhost/<timestamp>/`; it does not actuate model
proposals. Only after that command finishes may the separate scorer read the
corresponding ground truth. The scorer hashes generation artifacts before and
after scoring and fails if any changed. This validates Gate 2 proposal quality
and isolation, not generated D1 execution or conditional traversal.

Compile and replay the frozen Gate 2 proposals through the restricted D1 path:

```bash
npm run gate3:localhost -- --gate2-run <absolute-gate2-run-directory>
npm run gate3:score -- --run <absolute-gate3-run-directory>
```

The Gate 3 worker also runs with answer-key read permission denied. It emits
immutable D2 contracts, generated D1 source, D4 manifests, source hashes,
execution envelopes, and screenshots, then runs each script through the one
D3 executor with the model absent. The second command is the only Gate 3
process that reads ground truth; it runs after freeze and verifies no artifact
changed. Gate 3 currently covers compilation, restricted loading, and
single-state replay. Conditional choice enumeration, repair-to-green replay,
and automatic N+1 allocation after contract expansion remain Gate 4 work.

Run the two required live public targets:

```bash
npm run live:harness
npm run live:harness:headed
npm run live:harness -- --target=pge
npm run live:harness -- --target=united_way
```

Harness artifacts are stored under `data/harness/<timestamp>/` or
`data/live-harness/<timestamp>/`. The live harness asserts that no terminal
submission is attempted or succeeds.

Serve fixture pages for manual inspection with:

```bash
npm run fixtures
```

Then open `http://127.0.0.1:4179/fixtures/start`.

## Safety boundary

Use FormWeave only on public, non-personalized pages you are authorized to
test. Never provide real applicant data.

Public Phase 1 recon cannot submit or accept consequential legal terms.
Explicitly selected loopback conformance tests may submit synthetic fixture
data and may actuate typed acknowledgement, consent, review-confirmation, or
signature controls, or attach a generated harmless test file, only when the
operator grants each matching authority for that run. Retained scripts do not
retain those authorities. FormWeave does not solve CAPTCHA, enter credentials,
provide payment details, attach real files, or upload to public targets; those
conditions are sensed, captured, and reported for human review.
