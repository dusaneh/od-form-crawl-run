# FormWeave Feature Requirements

This file is the canonical list of accepted product requirements for
FormWeave. Dot notation expresses progressively narrower requirements: each
additional numeric segment identifies a sub-requirement of its parent.

## Maintenance contract

- Update this file whenever a requirement is added, removed, reworded, or
  reprioritized.
- Update `FEATURE_STATUS.md` in the same change whenever implementation status
  or verification evidence changes.
- Do not silently remove superseded requirements. Mark them as superseded and
  identify the replacement.
- Do not describe demo or synthetic behavior as a completed production
  capability.
- Do not mark a requirement built until it has concrete verification evidence.

## F1. Real crawl execution

- `F1` FormWeave must perform real crawls rather than simulate an ideal run.
- `F1.1` A user can start a crawl with one or more public HTTP or HTTPS URLs.
- `F1.1.1` Invalid URLs, embedded credentials, credential-like query
  parameters, and private-network targets are rejected.
- `F1.1.2` A crawl has a stable run ID and truthful queued, running, completed,
  review, or failed status.
- `F1.2` The crawler fetches the actual returned page content.
- `F1.2.1` Redirects, HTTP status, content type, response size, and duration are
  recorded.
- `F1.2.2` Fetches have explicit timeouts and byte limits.
- `F1.2.3` Returned HTML is retained for local inspection.
- `F1.3` The crawler discovers relevant same-origin form, intake, application,
  registration, and step links within a bounded crawl.
- `F1.3.1` Discovery depth and page-count limits are explicit.
- `F1.3.2` A discovered page is represented in the run graph and final report.
- `F1.4` The crawler extracts observed form structure from page content.
- `F1.4.1` Forms and form actions are recorded.
- `F1.4.2` Controls include label, semantic key, raw control type, selector,
  required state, option count, hidden state, and sensitivity indicator.
- `F1.4.3` Visible fields and hidden/system controls remain distinguishable.
- `F1.4.4` Client-rendered controls that do not exist in returned HTML must not
  be represented as DOM-observed facts.
- `F1.5` Script-driven or otherwise uncertified states are explicitly flagged
  for review.

## F2. Evidence and provenance

- `F2` Every completed crawl must provide inspectable evidence of what happened.
- `F2.1` Each successfully fetched page stores its returned HTML as a separate
  artifact.
- `F2.2` Each page should have screenshot evidence when capture succeeds.
- `F2.2.1` Screenshot evidence is associated with the exact run and page.
- `F2.2.2` Screenshot bytes are stored locally for local crawls.
- `F2.2.3` Screenshot failure must be reported and must not erase successful
  HTML extraction.
- `F2.2.4` Imported reports must not imply that screenshot binaries exist when
  the imported file did not contain them.
- `F2.3` Every crawl produces a complete machine-readable JSON report.
- `F2.3.1` The report includes targets, timestamps, aggregate statistics,
  per-page facts, the full field contract, findings, analysis, and artifact
  paths.
- `F2.3.2` The downloadable report and the report shown in the UI must come from
  the same persisted source.
- `F2.4` Every crawl produces an append-only JSONL event log.
- `F2.4.1` Events cover creation, fetch progress, artifact persistence, LLM
  analysis, completion, and failure.
- `F2.4.2` Logs never contain API keys, authorization headers, or screenshot
  base64 payloads.
- `F2.5` Page fingerprints are derived from observed form facts and are stable
  for equivalent observations.

## F3. Complete and truthful UI

- `F3` The UI must expose the useful crawl output instead of only showing a
  progress animation or thin summary.
- `F3.1` The run queue shows every real local run with current status, progress,
  mode, and last activity.
- `F3.2` The report view shows page, form, field, screenshot, byte, and timing
  totals.
- `F3.3` The report view lists every crawled page with its URL and page-level
  facts.
- `F3.4` The field contract view exposes every visible field.
- `F3.4.1` Labels must be visible, not only semantic keys.
- `F3.4.2` Hidden/system controls remain available through an explicit reveal
  control.
- `F3.5` The evidence view displays locally available screenshots and clearly
  marks missing captures.
- `F3.6` The diagnostics view shows structured crawler and LLM findings.
- `F3.7` The UI separates deterministic DOM observations from screenshot/LLM
  inference.
- `F3.8` The UI exposes downloadable reports and logs.
- `F3.9` The UI displays the local artifact paths for the selected run.
- `F3.10` The UI reports whether the local crawler and LLM configuration are
  ready without exposing secrets.

## F4. Local-first operation and ownership

- `F4` The complete application must run on localhost so the user owns the
  code, runtime, logs, and artifacts.
- `F4.1` One command starts the local web UI and crawler API.
- `F4.1.1` The local web UI is available at `http://localhost:3000`.
- `F4.1.2` The local API is available at `http://127.0.0.1:8787`.
- `F4.2` Local operation does not require a hosted database or object store.
- `F4.3` Local run state and artifacts are stored below the repository-local
  `data/` directory by default.
- `F4.3.1` Each run has its own directory containing `run.json`,
  `report.json`, `events.jsonl`, returned HTML, and screenshot evidence.
- `F4.3.2` An aggregate crawler log is stored under `data/logs/`.
- `F4.4` Local data and secrets are excluded from Git.
- `F4.5` Existing downloaded FormWeave reports can be imported into the local
  run history.
- `F4.5.1` Import preserves report facts and discloses any evidence that cannot
  be reconstructed from the download.
- `F4.6` Hosted compatibility may remain, but localhost is the primary
  development and inspection path.

## F5. OpenAI enrichment

- `F5` Local crawls can use an OpenAI model to enrich deterministic crawl facts.
- `F5.1` The preferred credential is `OPENAI_KEY` in the repository-root
  `.env` file.
- `F5.1.1` `OPENAI_API_KEY` may be supported as a compatibility fallback.
- `F5.1.2` The credential is server-only and must never be returned to the UI,
  committed, or logged.
- `F5.2` The model receives structured crawl facts and a bounded number of
  screenshot inputs.
- `F5.3` The model returns schema-constrained structured JSON.
- `F5.4` Model output includes a summary, apparent page purpose, form inventory,
  conservative inferred controls, findings, and limitations.
- `F5.5` Inferred controls include origin, confidence, and supporting evidence.
- `F5.6` An LLM failure does not invalidate or delete the deterministic crawl
  report.
- `F5.7` The selected model is configurable without a source-code change.

## F6. Operational transparency

- `F6` The user must be able to determine what the system is doing and where
  its outputs live.
- `F6.1` A health endpoint reports local runtime, storage root, active crawl
  count, model name, and whether a credential is configured.
- `F6.2` Progress is driven by actual crawl work rather than a cosmetic timer.
- `F6.3` Failures include actionable messages in the run findings and event
  log.
- `F6.4` The local service prints startup URLs, artifact root, and redacted
  OpenAI readiness to the terminal.
- `F6.5` Reports and logs remain readable with ordinary filesystem and text
  tools; no proprietary viewer is required.
- `F6.6` In-progress work should recover or be marked interrupted after an
  unexpected local process restart.

## F7. Read-only safety boundary

- `F7` Crawling is read-only by construction.
- `F7.1` The crawler never enters form values.
- `F7.2` The crawler never submits a form.
- `F7.3` Screenshots use a fresh unauthenticated public-page context.
- `F7.4` Private, authenticated, personalized, and tokenized targets are outside
  the supported boundary.
- `F7.5` The UI and report state the safety boundary and known limitations.

## F8. Quality and maintainability

- `F8` The implementation must remain inspectable, testable, and documented.
- `F8.1` Parser, fingerprint, target-validation, and crawl-output behavior have
  automated tests.
- `F8.2` The local filesystem API, persistence, and OpenAI failure paths have
  automated tests.
- `F8.3` The browser UI has automated integration coverage for report,
  contract, evidence, and diagnostics rendering.
- `F8.4` A repeatable real end-to-end smoke test verifies HTML, screenshot,
  report, logs, and optional LLM analysis.
- `F8.5` Setup, environment variables, storage layout, import behavior, and
  execution boundaries are documented.
- `F8.6` `FEATURES.md` and `FEATURE_STATUS.md` are updated with every relevant
  product change.
