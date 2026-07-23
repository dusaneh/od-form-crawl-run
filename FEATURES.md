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
- `F1.2.1` Redirects, HTTP status, content type, serialized rendered-DOM size,
  and duration are recorded.
- `F1.2.2` Fetches have explicit timeouts and byte limits.
- `F1.2.3` The serialized rendered DOM is retained as HTML for local
  inspection.
- `F1.2.4` Local crawls use Playwright Chromium to execute client-side
  JavaScript before form structure and evidence are captured.
- `F1.3` The crawler discovers relevant same-origin form, intake, application,
  registration, and step links within a bounded crawl.
- `F1.3.1` Discovery depth and page-count limits are explicit.
- `F1.3.2` A discovered page is represented in the run graph and final report.
- `F1.3.3` Same-origin iframe documents and open shadow roots are included in
  rendered-DOM extraction with their origin recorded.
- `F1.3.4` The crawler performs bounded conditional and multi-step form
  exploration by entering obviously synthetic test values and advancing as
  far as possible.
- `F1.3.4.1` Fields are exercised in DOM order with generated values that
  satisfy native type, required, length, range, pattern, and option
  constraints when practical.
- `F1.3.4.2` Selects, radio groups, checkboxes, and switches are actuated
  across a bounded set of safe alternatives so validation and branching logic
  can be observed.
- `F1.3.4.3` Newly revealed conditional controls are rediscovered and
  populated before the crawler attempts to advance.
- `F1.3.4.4` Every attempted field entry records the field identity, proposed
  value, planner source, outcome, state fingerprints, and any locator or
  validation failure.
- `F1.3.4.5` Explicit intermediate Next, Continue, Review, and equivalent
  actions may be activated to reach later form states.
- `F1.3.4.6` Validation and autosave requests caused by an authorized
  synthetic interaction may reach the target even in Dry Run mode.
- `F1.3.4.7` Every observed field exposes a default or test value in the
  machine-readable contract; controls requiring human review are explicitly
  identified instead of silently exercised.
- `F1.4` The crawler extracts observed form structure from page content.
- `F1.4.1` Forms and form actions are recorded.
- `F1.4.2` Controls include label, semantic key, raw control type, selector,
  required state, option count, hidden state, and sensitivity indicator.
- `F1.4.3` Visible fields and hidden/system controls remain distinguishable.
- `F1.4.4` Client-rendered controls may be represented as rendered-DOM
  observations only after Playwright actually observes them; they remain
  distinguishable from raw response HTML and LLM inference.
- `F1.5` Script-driven or otherwise uncertified states are explicitly flagged
  for review.
- `F1.6` The crawler must automatically traverse predictable, low-risk
  obstacles according to a persisted operator policy.
- `F1.6.1` A Settings surface documents and configures the traversal policy,
  and every new run snapshots the policy it used.
- `F1.6.2` Cookie gates prefer rejecting non-essential cookies, with a
  separately configurable accept-only fallback when needed to reveal a public
  form.
- `F1.6.3` Predictable welcome banners, optional offers, and optional
  registration or sign-in prompts may be dismissed without entering values,
  accepting terms, or creating an account.
- `F1.6.4` Safe disclosures and explicit non-submit intro controls outside a
  form may be advanced within a bounded action budget.
- `F1.6.5` State examination waits for DOM content, a bounded network-idle
  attempt, fonts, and a configurable DOM-mutation quiet window.
- `F1.6.5.1` After a predictable gate action, the crawler performs a bounded
  wait for a visible form surface and a final stable-state examination so
  delayed framework initialization cannot race extraction.
- `F1.6.6` A fixed pointer sweep and reversible scroll may prime legitimate
  hover and lazy-load behavior before examination; it must not be represented
  or used as CAPTCHA or bot-detection evasion.
- `F1.6.7` Every automatic action records category, label, strategy,
  timestamp, before/after state fingerprints, outcome, and an append-only
  event.
- `F1.6.8` A deterministic runner must be able to replay captured predictable
  actions while treating nondeterministic observations as conditional events.
- `F1.6.9` Unpredictable ads and popups are observed and captured but are not
  made unconditional replay steps.
- `F1.6.10` CAPTCHA or human-verification gates are detected, captured, and
  handed to a person; FormWeave does not click, solve, or bypass them.
- `F1.6.11` Same-origin fetch/XHR POST requests may be allowed when a narrow
  endpoint classifier identifies framework rendering or initialization, or
  during a short interaction-scoped window for field validation, autosave, or
  an authorized intermediate advance.
- `F1.6.11.1` Autonomous writes outside classified initialization or an
  active interaction window remain blocked and logged.
- `F1.6.11.2` An explicitly approved Live final-submit window is scoped to the
  resolved final form-action origin; unrelated origins remain blocked.

## F2. Evidence and provenance

- `F2` Every completed crawl must provide inspectable evidence of what happened.
- `F2.1` Each successfully rendered page stores its serialized DOM as a separate
  artifact.
- `F2.2` Each page should have screenshot evidence when capture succeeds.
- `F2.2.1` Screenshot evidence is associated with the exact run and page.
- `F2.2.2` Screenshot bytes are stored locally for local crawls.
- `F2.2.3` Screenshot failure must be reported and must not erase successful
  HTML extraction.
- `F2.2.4` Imported reports must not imply that screenshot binaries exist when
  the imported file did not contain them.
- `F2.2.5` Local screenshot capture uses the same local Playwright page and
  must not depend on a third-party screenshot service.
- `F2.2.6` Every available screenshot preview in the UI opens the full local
  evidence image when clicked.
- `F2.2.7` The crawler captures a screenshot after values have been entered in
  each populated or branch state and before it moves forward.
- `F2.2.8` State evidence records the entered synthetic values, state kind,
  sequence, URL, fingerprint, timestamp, and local screenshot artifact.
- `F2.2.9` Initial, populated, branch, pre-advance, post-advance,
  blocked-final, and submitted states remain distinguishable.
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
- `F3.11` The new-crawl UI provides a Headless/Headful browser visibility
  switch.
- `F3.11.1` Headless mode runs Chromium in the background and is the default.
- `F3.11.2` Headful mode opens visible local Chromium so the operator can
  watch pages render.
- `F3.11.3` Both visibility modes use the same extraction, screenshot,
  persistence, logging, and safety pipeline.
- `F3.12` The UI provides a dedicated traversal Settings surface.
- `F3.12.1` Settings explain what is automatic, observed only, or requires
  human review.
- `F3.12.2` Settings persist locally and show the policy version, local path,
  saved time, recommended defaults, and bounded wait/action controls.
- `F3.12.3` Reports expose automatic-action, state-examination, allowed
  initialization, and blocked-write counts plus the per-action fingerprint
  audit trail.
- `F3.12.4` Settings expose bounded field entry, branch exercise,
  intermediate advancement, state-evidence, and branch-option controls.
- `F3.12.5` Settings contain editable natural-language instructions for the
  traversal planner and explain which safety decisions remain deterministic.
- `F3.13` The new-crawl UI provides a Dry Run/Live execution-mode switch.
- `F3.13.1` Dry Run is the default; it enters synthetic values, exercises
  branches, permits validation/autosave side effects, advances intermediate
  steps, captures the completed state, and never activates the final submit
  control.
- `F3.13.2` Live mode performs the same traversal and may activate the final
  submit control only after an explicit approval checkbox and typed
  confirmation.
- `F3.13.3` Run status, report facts, findings, actions, and UI trust copy
  truthfully identify the selected execution mode and final-submit outcome.

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
  `report.json`, `events.jsonl`, rendered HTML, and screenshot evidence.
- `F4.3.2` An aggregate crawler log is stored under `data/logs/`.
- `F4.4` Local data and secrets are excluded from Git.
- `F4.5` Existing downloaded FormWeave reports can be imported into the local
  run history.
- `F4.5.1` Import preserves report facts and discloses any evidence that cannot
  be reconstructed from the download.
- `F4.6` Hosted compatibility may remain, but localhost is the primary
  development and inspection path.
- `F4.7` Local browser binaries are installed and managed through Playwright;
  local crawling does not require a remote browser or screenshot account.

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
- `F5.4` Model output includes a summary, apparent page purpose, form
  inventory, conservative inferred controls, default synthetic test values,
  findings, and limitations.
- `F5.5` Inferred controls include origin, confidence, supporting evidence,
  and a default synthetic test value.
- `F5.6` An LLM failure does not invalidate or delete the deterministic crawl
  report.
- `F5.7` The selected model is configurable without a source-code change.
- `F5.8` When configured, an LLM planner may classify visible controls,
  propose synthetic values, identify branch controls, and distinguish
  intermediate from final actions from the persisted operator instructions.
- `F5.8.1` A deterministic planner provides the same schema when the LLM is
  unavailable, disabled, times out, or returns unusable control identifiers.
- `F5.8.2` Hard enforcement overrides prompt output for CAPTCHA, credentials,
  file upload, legal acceptance, payment, Dry Run final blocking, and Live
  approval.

## F6. Operational transparency

- `F6` The user must be able to determine what the system is doing and where
  its outputs live.
- `F6.1` A health endpoint reports local runtime, storage root, active crawl
  count, model name, and whether a credential is configured.
- `F6.1.1` Health output reports the active browser engine and supported
  Headless/Headful modes.
- `F6.2` Progress is driven by actual crawl work rather than a cosmetic timer.
- `F6.3` Failures include actionable messages in the run findings and event
  log.
- `F6.4` The local service prints startup URLs, artifact root, and redacted
  OpenAI readiness to the terminal.
- `F6.5` Reports and logs remain readable with ordinary filesystem and text
  tools; no proprietary viewer is required.
- `F6.6` In-progress work should recover or be marked interrupted after an
  unexpected local process restart.

## F7. Guarded execution boundary

- `F7` Form traversal is synthetic-data-first and final submission is governed
  by the selected execution mode.
- `F7.1` The crawler may enter only obviously synthetic or fixture-safe test
  values; real user data is neither required nor inferred.
- `F7.1.1` Credentials, payment controls, file uploads, CAPTCHA, and legal or
  terms acceptance require human review and are not automatically populated.
- `F7.2` Dry Run never activates a control classified as the final submit
  action.
- `F7.2.1` Dry Run may activate controls and allow network side effects needed
  for field validation, autosave, branching, and intermediate progression.
- `F7.2.2` Live mode may activate the final submit action only after explicit
  per-run approval and typed confirmation.
- `F7.2.3` Browser requests using methods other than GET, HEAD, or OPTIONS are
  blocked before they reach the target server except as allowed by
  `F1.6.11`, or to the resolved form-action origin during the explicitly
  approved Live final-submit window.
- `F7.2.3.1` Allowed initialization, interaction-scoped writes, blocked
  autonomous writes, and submission attempts are counted and logged with
  sanitized endpoints.
- `F7.2.4` Submit events and programmatic form submission APIs are guarded
  before site scripts execute and are released only for a classified
  intermediate action or approved Live final action.
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
- `F8.7` Repository-owned test sites exercise realistic form implementation
  variation and page noise without depending on third-party websites.
- `F8.7.1` Fixtures include clean semantic HTML, multiple unrelated forms,
  noisy page chrome, delayed SPA rendering, same-origin iframe forms, open
  shadow-DOM forms, hidden controls, conditional fields, predictable consent
  and overlay gates, classified framework initialization, and a
  human-verification handoff.
- `F8.7.2` A headless harness writes its report, rendered HTML, screenshots,
  and events below local `data/harness/`.
- `F8.7.3` A headful harness runs the same fixtures and assertions while
  showing the local browser.
- `F8.7.4` Automated assertions prove that classified initialization,
  validation, and autosave writes can complete while autonomous writes and
  Dry Run final submissions remain blocked.
- `F8.7.5` Automated assertions prove predictable gates are traversed and
  fingerprinted, CAPTCHA controls are not clicked, Settings persist, and
  screenshot evidence links open the full local image.
- `F8.7.6` Repository-owned fixtures and tests prove value entry, select/radio/
  checkbox branching, conditional-field discovery, intermediate advancement,
  per-state populated screenshots, Dry Run final blocking, and explicitly
  approved Live submission.
