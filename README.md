# FormWeave

FormWeave is a local-first, read-only crawler and evidence control plane for
public web forms. A crawl opens the submitted URL in local Playwright Chromium,
follows a bounded set of same-origin form-related links, extracts controls from
the rendered DOM, stores local screenshot evidence, and produces a complete
JSON report.

The crawler never fills a field and never submits a form.

## Feature tracking

- `FEATURES.md` is the canonical dot-notated requirements list.
- `FEATURE_STATUS.md` records what is built, partial, or not built, with
  verification evidence and the next implementation priorities.

Both files must be updated alongside relevant product changes.

## Run everything locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npx playwright install chromium
npm run local
```

This starts:

- web UI: `http://127.0.0.1:3000`
- local crawler API: `http://127.0.0.1:8787`
- health/config summary: `http://127.0.0.1:8787/api/health`

The local API reads `.env` from the repository root. OpenAI enrichment prefers
`OPENAI_KEY` and also accepts the standard `OPENAI_API_KEY` environment name:

```dotenv
OPENAI_KEY=your-key-here
# Optional override. The default is gpt-5.6.
OPENAI_MODEL=gpt-5.6
```

The key is used only by the server-side Responses API request. It is not sent
to the browser, written to reports, or included in logs.

The **New crawl** dialog has a browser visibility switch:

- **Headless** runs local Chromium in the background and is the default.
- **Headful** opens local Chromium so you can watch every crawled page render.

Both modes use the same rendered-DOM extraction, local screenshot, logging,
persistence, and read-only safety pipeline.

You can also run the two processes separately:

```bash
npm run local:api
npm run local:web
```

## Local data and logs

All new local crawl state is written beneath `data/`, which is intentionally
git-ignored:

```text
data/
  logs/
    crawler.jsonl
  runs/
    run_<id>/
      run.json
      report.json
      events.jsonl
      pages/
        page_01.html
      evidence/
        page_01.png
```

`run.json` drives the queue and progress UI. `report.json` is the complete
deterministic crawl plus optional OpenAI analysis. `events.jsonl` is the
per-run audit log. Returned HTML and screenshot bytes are kept as separate,
inspectable files.

To import an existing downloaded FormWeave report:

```bash
npm run local:import-report -- C:\path\to\report.json
```

Downloaded reports do not contain screenshot binaries, so imported runs retain
all JSON findings but correctly mark their original screenshots unavailable.
Rerun the target locally to create new local screenshot evidence.

## What a crawl does

- validates public HTTP/HTTPS targets and rejects private-network,
  credential-bearing, and tokenized URLs
- renders up to 12 pages in a fresh local Chromium context with timeouts, byte
  limits, and redirect handling
- discovers one level of same-origin form/intake/application links
- executes client-side JavaScript and extracts the rendered main document,
  same-origin iframe documents, and open shadow roots
- extracts forms, actions, input types, labels, selectors, required flags,
  option counts, hidden controls, frame origins, and potentially sensitive
  field indicators
- fingerprints observed form facts so later crawls can be compared
- captures a fresh unauthenticated full-page screenshot from the same
  Playwright page without entering values
- blocks non-read browser requests, submit events, and programmatic form-submit
  APIs
- stores rendered HTML, screenshot, report, run state, and JSONL events locally
- optionally sends crawl facts and up to three screenshots to the OpenAI
  Responses API for structured, clearly separated visual inference

## Evidence boundary

Field extraction is deterministic and uses the DOM actually rendered by local
Playwright Chromium. Screenshot capture is also local and uses the same
unauthenticated browser page; the localhost pipeline does not call Thum.io or
another screenshot service. OpenAI analysis uses the configured server-side
key and is explicitly labeled as inference in the UI.

JavaScript-created initial state is observed. Alternate conditional or
multi-step states are not yet explored automatically, so scripted pages still
carry a limitation finding.

Do not crawl private, authenticated, personalized, or tokenized URLs.

## Validation

```bash
npm test
npm run lint
```

`npm test` builds the app and runs parser, fingerprint, target-validation,
rendered-browser, local API, persistence, restart-reconciliation, and artifact
tests.

## Local crawl fixtures and harness

The repository includes intentionally varied pages under `test-sites/`:
semantic HTML, noisy pages with unrelated forms, delayed SPA rendering,
same-origin iframe forms, open shadow-DOM forms, and hidden/conditional fields.
They contain a write probe so tests can prove that attempted POST traffic is
blocked before it reaches the site.

Run the complete fixture crawl in the background:

```bash
npm run crawl:harness
```

Watch the same crawl in visible Chromium:

```bash
npm run crawl:harness:headed
```

Both commands write inspectable HTML, screenshots, `report.json`, and
`events.jsonl` beneath `data/harness/<timestamp>/`. To serve the fixture pages
for manual inspection, run `npm run fixtures` and open
`http://127.0.0.1:4179/fixtures/start`.

The narrower automated commands are:

```bash
npm run test:crawler
npm run test:api
npm run test:ui
npm run test:openai
```

## Hosted compatibility

The Cloudflare/Sites worker remains in the repository for hosted compatibility.
It persists production run state in D1 and report/evidence artifacts in R2.
The localhost UI automatically selects the filesystem API at
`127.0.0.1:8787`; the hosted UI continues using same-origin worker routes.
