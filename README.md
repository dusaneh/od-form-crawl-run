# FormWeave

FormWeave is a read-only crawler and evidence control plane for public web
forms. A crawl fetches the submitted URL, follows a bounded set of same-origin
form-related links, extracts the controls returned in HTML, stores screenshot
evidence, and produces a downloadable JSON report.

## What a crawl does

- validates public HTTP/HTTPS targets and rejects private-network,
  credential-bearing, and tokenized URLs
- fetches up to 12 pages with timeouts, byte limits, redirects, and an explicit
  crawler user agent
- discovers one level of same-origin form/intake/application links
- extracts forms, actions, input types, labels, selectors, required flags,
  option counts, and potentially sensitive field indicators
- fingerprints observed form facts so later crawls can be compared
- captures a fresh unauthenticated screenshot without entering values
- persists run state in D1 and screenshot/report artifacts in R2
- records truthful completion and failure findings; progress comes from crawl
  work rather than a timer

The crawler never fills a field and never submits a form.

## Current execution boundary

Field extraction uses the HTML returned to the crawler. Screenshot evidence is
browser-rendered through the public Thum.io URL API and stored privately in R2.
Pages containing client-side scripts are explicitly flagged for review because
script-driven conditional states are not certified by this runtime.

Do not crawl private, authenticated, personalized, or tokenized URLs.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The local app uses simulated D1 and R2 bindings declared by `vite.config.ts`.

## Validation

```bash
npm test
npm run lint
```

`npm test` builds the production worker and runs parser, fingerprint, target
validation, and crawl-output tests.

## Production storage

`.openai/hosting.json` declares the logical `DB` and `EVIDENCE` bindings.
Production deployment wiring is owned by Sites.
