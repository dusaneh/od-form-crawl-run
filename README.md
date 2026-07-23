# FormWeave

FormWeave is a local-first, read-only crawler and evidence control plane for
public web forms. A crawl fetches the submitted URL, follows a bounded set of
same-origin form-related links, extracts the controls returned in HTML, stores
screenshot evidence, and produces a complete JSON report.

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
- fetches up to 12 pages with timeouts, byte limits, redirects, and an explicit
  crawler user agent
- discovers one level of same-origin form/intake/application links
- extracts forms, actions, input types, labels, selectors, required flags,
  option counts, hidden controls, and potentially sensitive field indicators
- fingerprints observed form facts so later crawls can be compared
- captures a fresh unauthenticated screenshot without entering values
- stores the returned HTML, screenshot, report, run state, and JSONL events
  locally
- optionally sends crawl facts and up to three screenshots to the OpenAI
  Responses API for structured, clearly separated visual inference

## Evidence boundary

Field extraction is deterministic and uses the HTML returned to the crawler.
Screenshot capture currently uses the public Thum.io URL rendering service; the
resulting image bytes are downloaded into the local run directory. OpenAI
analysis uses the configured server-side key and is explicitly labeled as
inference in the UI. Pages containing client-side scripts are flagged for
review because conditional runtime states are not functionally certified.

Do not crawl private, authenticated, personalized, or tokenized URLs.

## Validation

```bash
npm test
npm run lint
```

`npm test` builds the production worker and runs parser, fingerprint, target
validation, and crawl-output tests. A local end-to-end crawl can be inspected
through the UI, API, and the files under `data/runs/<run-id>/`.

## Hosted compatibility

The Cloudflare/Sites worker remains in the repository for hosted compatibility.
It persists production run state in D1 and report/evidence artifacts in R2.
The localhost UI automatically selects the filesystem API at
`127.0.0.1:8787`; the hosted UI continues using same-origin worker routes.
