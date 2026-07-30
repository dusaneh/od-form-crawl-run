# FormWeave Feature Requirements

This file is the canonical list of accepted product requirements for
FormWeave. Dot notation expresses progressively narrower requirements: each
additional numeric segment identifies a sub-requirement of its parent.
`FEATURES_CONTRACT_V2.md` is the binding architecture and definition contract
for generated scripts, semantic contracts, the executor, and their boundaries.

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
- Every new or amended requirement is checked against the Design principles;
  conflicts are resolved explicitly in the change, never silently.
- The principles and their scars may not be removed or reworded without
  operator sign-off.

## F0. Product scope

- `F0` FormWeave is Phase 1, reconnaissance, of a two-phase form-submission
  system.
- `F0.1` Phase 1 discovers a durable, versioned semantic contract and generates
  an immutable per-form executable script by observing the rendered form,
  applying controlled synthetic perturbations, mapping states and branches,
  and completing an LLM-disabled validation replay up to the verified
  final-submission boundary.
- `F0.2` Phase 1 never infers or enters real applicant data. Public Phase 1
  never submits a form; an explicitly labeled loopback-fixture validation run
  may submit synthetic fixture data solely to prove generated-script
  correctness under `F8.9.1`.
- `F0.3` Phase 1 generates and validates versioned per-form Playwright scripts
  with synthetic data. Phase 2 consumes an existing certified generated script
  and permits real-data submission only after explicit human approval; its
  requirements live in `FEATURES_PHASE2.md`.
- `F0.4` The semantic layer owns meaning, the generated per-form script owns
  live-page mechanics within its semantic contract, and one shared executor
  owns orchestration plus browser physics. The executor performs no
  form-semantic action of its own accord.

## Design principles

1. **A crawl produces a durable, versioned artifact—not a snapshot.** Identity,
   drift, approval, and re-certification are properties of that artifact.
   *Scar: without URL-keyed lineage, the same form re-crawled under a slightly
   different typed name forked into parallel histories and drift detection
   never ran.*
2. **Dynamic forms cannot be characterized by observation alone.** Their
   defining property is showing different fields for different answers;
   looking only ever reveals the default path. Conditional structure is
   discovered by controlled perturbation. *Scar: a branching eligibility form
   was confidently documented as linear for two weeks because nothing ever set
   a value.*
3. **"Could not test" is a distinct outcome from "tested, found nothing"—and it
   fails loud.** *Scar: probe clicks silently timed out on styled controls; zero
   observations were reported as "no branching."*
4. **Attempted is not actuated.** An action counts only when its resulting
   state is read back and verified. *Scar: in the same styled-control incident,
   every click was attempted, none landed, and nothing noticed.*
5. **Fingerprints hash DOM-derived facts only.** Anything a model judged varies
   run to run and registers as false drift. *Scar: model-judged attributes in
   the hash minted false versions and false review-queue entries on
   byte-identical forms.*
6. **Shared code owns browser physics; per-form scripts own sequencing.**
   Shared code must not grow with each new form. *Scar: the predecessor
   required a framework edit plus a full regression run for every new site—the
   exact brittleness this rebuild exists to end.*
7. **Screenshots are a sensing input, not only backward-looking evidence.** The
   model generating metadata sees the full page, tiled when tall, alongside
   the DOM.
8. **Prefer no certifiable artifact over a plausible wrong one.** A failed or
   blocked attempt retains its sensing, logs, partial contract, scripts, and
   closed failure result for diagnosis, but it is never promoted as a valid
   form artifact. A page with no credible form facts may retain only a failed
   attempt bundle. *Scar: a cookie-preference dialog was persisted as a
   0-confidence "form" and sat in the human review queue.*

## F1. Real crawl execution

- `F1` FormWeave must perform real crawls rather than simulate an ideal run.
- `F1.1` A user can start a crawl with one or more public HTTP or HTTPS URLs.
- `F1.1.1` Invalid URLs, embedded credentials, credential-like query
  parameters, and private-network targets are rejected.
- `F1.1.2` A crawl has a stable run ID and truthful queued, running, completed,
  review, or failed status.
- `F1.1.3` A multi-step form crawl starts from the earliest reachable public
  entry state. If the supplied URL is a later step, carries empty or missing
  predecessor values, or otherwise cannot prove predecessor-state provenance,
  the run is labeled `mid_flow_entry`, does not claim whole-form coverage, and
  either returns to an LLM-selected canonical start or continues as an
  explicitly partial journey.
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
- `F1.3.1.1` New Crawl exposes whether related same-origin pages will be
  discovered and discloses the active depth, per-page link cap, same-origin
  restriction, and URL/text terms used by the discovery classifier.
- `F1.3.2` A discovered page is represented in the run graph and final report.
- `F1.3.3` Same-origin iframe documents and open shadow roots are included in
  rendered-DOM extraction with their origin recorded.
- `F1.3.4` The crawler performs bounded conditional and multi-step form
  exploration by entering obviously synthetic test values and advancing as
  far as possible.
- `F1.3.4.1` The form-specific recon script exercises fields in its declared
  sequence with synthetic values that are format-plausible for both raw
  control type and label, including valid-format email, telephone, account,
  whole-dollar, date, range, pattern, length, and enumeration values.
- `F1.3.4.2` Selects, radio groups, checkboxes, and switches are actuated
  across a bounded set of safe alternatives so validation and branching logic
  can be observed.
- `F1.3.4.3` Newly revealed conditional controls are rediscovered and
  populated before the crawler attempts to advance.
- `F1.3.4.4` Every attempted field entry records the field identity, proposed
  value, planner source, outcome, observed runtime state identity before and
  after the attempt per `F13.3`, and any locator or validation failure.
- `F1.3.4.5` Explicit intermediate Next, Continue, Review, and equivalent
  actions may be activated to reach later form states.
- `F1.3.4.6` Validation and autosave requests caused by an authorized
  synthetic interaction may reach the target even in Probe mode.
- `F1.3.4.7` Every observed field exposes a default or test value in the
  machine-readable contract; controls requiring human review are explicitly
  identified instead of silently exercised.
- `F1.3.4.8` Phase 1 uses only conspicuously synthetic values and never
  activates the terminal submit action. Intermediate progression may
  inherently persist partial synthetic state server-side; this is an accepted
  consequence of Option A and is disclosed in the artifact.
- `F1.3.4.9` The generic framework does not decide which form field to fill,
  which branch to test, or which control advances a form. Those decisions are
  declared by the selected per-form recon script; an unknown form may be
  inventoried but remains uncertified until such a script exists.
- `F1.3.4.9.1` GET navigation used solely to render and observe a supplied or
  discovered page is permitted. A click, selection, advance, disclosure,
  consent action, dismissal, or submit may never be selected by a keyword
  list, link-text classifier, hostname branch, or other framework heuristic.
  During generation it must come from a safety-approved model proposal; during
  replay it must come from the exact retained D1 script. Deterministic replay
  is required and does not call the model again.
- `F1.3.4.10` Before any non-observational action is actuated, the system
  writes and validates the state-specific D1 action set that contains it.
  Every field entry, choice probe, disclosure, advance, consent action,
  upload, and terminal action is traceable to exactly one retained script
  instruction; there is no direct model-to-browser action path.
- `F1.3.4.11` On public and local targets equally, Phase 1 validation may
  create a harmless, conspicuously synthetic in-memory test file that
  satisfies observed `accept`, count, and size constraints, actuate only the
  safety-accepted LLM-authored upload instruction, verify the browser file
  list and any page echo, and discard the file bytes after evidence is
  retained. This crawl-time action models upload mechanics and never uses an
  end user's file.
- `F1.3.4.12` A generated action set is not accepted merely because it ran.
  Required field readback, expected state identity/change, branch observations,
  and terminal-boundary classification must pass before the state script is
  validation-green.
- `F1.3.5` Multi-page forms are represented as one ordered form journey rather
  than unrelated crawl-queue pages.
- `F1.3.5.1` The journey retains its entry state, ordered observed states,
  prior entered synthetic values, transition controls, transition method and
  response, final boundary, and any incomplete predecessor or successor.
- `F1.3.5.2` Related-page discovery may inventory a form step, but it may not
  enqueue and separately execute a URL already owned by an active generated
  form journey. Duplicate landing or intermediate URLs are linked to the
  journey rather than generating independent partial scripts.
- `F1.3.5.3` A halt on a later state preserves and reports every prior state,
  field, action, screenshot, and transition already verified in that journey.
  Final-state failure must not collapse a three-page traversal into a
  one-page-looking report.
- `F1.3.5.4` Starting from a later step is a distinct partial-journey test and
  never substitutes for the canonical entry-to-terminal validation run.
- `F1.4` The crawler extracts observed form structure from page content.
- `F1.4.1` Forms and form actions are recorded.
- `F1.4.2` Every control record includes label, raw DOM name and ID, raw
  control type, resilient selector candidates, DOM-derived required state,
  hidden state, sensitivity indicator, the full `{value, label}` option set,
  consent flag, admin/assisted-completion flag, canonical profile key with
  `unmappable` as a first-class outcome, validation constraints (`pattern`,
  `min`, `max`, `minlength`, and `maxlength`), upload constraints (`accept`,
  maximum size, and maximum file count), repeatable-section membership and its
  add-row control, and any "Other, specify" companion linkage.
- `F1.4.2.1` The client-facing Run API schema is derived from the same observed
  browser facts used by the generated Playwright script. It preserves native
  field name, raw type, option `{value, label}` pairs, placeholder,
  autocomplete, input mode, disabled/read-only/multiple state, numeric step,
  and browser-native date/time encoding rather than dropping them during
  contract publication.
- `F1.4.2.2` Standard JSON Schema keywords are used where semantics align:
  `format` for date, email, and URI; `pattern` for local date-time, month,
  week, and time; `multipleOf` for numeric step; and existing enumeration,
  range, pattern, and length constraints. Browser-specific facts that lack a
  standard keyword remain explicit `x-formweave-*` annotations.
- `F1.4.2.3` Approved execution validates browser-native encodings and
  constraints before launching Chromium. A localized display date such as
  `12/14/1980` does not reach Playwright when the native date value requires
  `1980-12-14`; the API returns a field-specific validation issue instead.
- `F1.4.3` Visible fields and hidden/system controls remain distinguishable.
- `F1.4.4` Client-rendered controls may be represented as rendered-DOM
  observations only after Playwright actually observes them; they remain
  distinguishable from raw response HTML and LLM inference.
- `F1.4.5` Required state is DOM-derived only. Requirements enforced solely by
  runtime validation are unknowable until the field is filled and the
  resulting state is verified; an untested requirement is never reported as
  optional.
- `F1.4.6` Question guidance is modeled separately from the question label.
  Help text, completion directions, examples, eligibility explanations, and
  validation guidance are retained with provenance from `aria-describedby`,
  explicit help relationships, adjacent DOM context, or screenshot inference.
- `F1.4.6.1` Guidance is a first-class record distinct from the question label,
  with its own identity, text, provenance (`aria-describedby`, explicit help
  relationship, adjacent DOM, or screenshot inference), scope, and confidence.
- `F1.4.6.2` Guidance attaches at form, section, or question scope. A long body
  of explanatory text that informs questions is stored once at its correct
  scope and referenced rather than copied onto every field.
- `F1.4.6.3` Guidance is classified as an instruction, eligibility
  explanation, example value, format requirement, legal or privacy notice, or
  deadline or availability notice.
- `F1.4.6.4` Guidance text is supplied to every model-analysis and
  script-generation pass and is available to the Phase 2 runner. Storing
  guidance without supplying it does not satisfy this requirement.
- `F1.4.6.5` Guidance is presented in field-contract and section views beside
  the question or group it informs.
- `F1.4.6.6` The undifferentiated nearby-text blob is superseded by this model.
  Raw nearby text may be retained as provenance for a guidance record but is
  not itself the guidance representation and is not duplicated per field.
- `F1.4.7` Related questions are assigned to explicit section records. A
  section records a stable identity, heading, directions, member-question
  identities, nesting, origin state, and any branch trigger rather than
  repeating an undifferentiated block of nearby text on every field.
- `F1.4.7.1` Sections form an explicit tree. A section records its parent,
  ordered member questions, heading, guidance references, origin state, and
  any branch trigger that reveals it.
- `F1.4.7.2` Section identity is derived from DOM-observable facts such as
  heading or container text and position, never from a model-generated slug.
- `F1.4.7.3` Every question resolves to exactly one section or is explicitly
  recorded as unsectioned. Section membership is available to model passes,
  the UI, and the Phase 2 runner.
- `F1.4.8` Grouped radio and checkbox controls retain both their group legend
  and each option's distinct displayed label and value. A repeated group
  legend may not replace the option meaning in the contract or UI.
- `F1.4.9` Consent-like controls are semantically distinguished as
  informational acknowledgement, accuracy/review confirmation, privacy/data
  sharing consent, terms acceptance, authorization, or electronic signature.
  The classification, governing guidance, requiredness, and actuation policy
  are retained separately; a generic checkbox or typed-name field is not
  automatically treated as legal acceptance.
- `F1.4.9.1` Public Probe may actuate a consent, authorization, terms,
  review-confirmation, or signature field with conspicuously synthetic data
  when the LLM-authored script determines that actuation is required to expose
  fields, validate mechanics, or reach the terminal boundary. This crawl-time
  action models the field; it does not assert consent or sign on behalf of a
  real person. Exact mechanics and readback are retained so a later certified
  API execution can supply the end user's real value.
- `F1.5` Script-driven or otherwise uncertified states are explicitly flagged
  for review.
- `F1.6` The crawler must support predictable, low-risk obstacles according to
  a persisted operator policy, but the policy constrains model proposals and
  generated scripts; it does not select or actuate controls itself.
- `F1.6.1` A Settings surface documents and configures the traversal policy,
  and every new run snapshots the policy it used.
- `F1.6.2` For cookie gates, the semantic layer should prefer rejecting
  non-essential cookies, with a separately configurable accept-only fallback
  when needed to reveal a public form. The chosen control and action are
  retained in D1 before deterministic replay.
- `F1.6.2.1` Cookie banners and consent-management controls are browser/session
  traversal infrastructure, not applicant form questions or form actions.
  They may appear in obstacle events and sensing evidence but are excluded
  from the question contract, generated API input schema, certification
  coverage, and execution payload.
- `F1.6.3` Predictable welcome banners, optional offers, and optional
  registration or sign-in prompts may be dismissed by a safety-approved model
  proposal or retained D1 step without entering values, accepting terms, or
  creating an account.
- `F1.6.4` Safe disclosures and explicit non-submit intro controls outside a
  form may be advanced within a bounded action budget only when the action was
  selected by the model during generation and retained in D1.
- `F1.6.4.1` Reconnaissance examines every safely classifiable disclosure,
  including non-mutating informational disclosures inside forms and
  disclosures in same-origin frames. If an action or state bound prevents
  exhaustive expansion, the artifact records the unexamined controls rather
  than implying complete coverage.
- `F1.6.4.2` While any observed disclosure still contains hidden applicant
  controls, no unrelated advance or terminal action is eligible. The LLM may
  author one `advance` targeting the exact pending disclosure fact; the page
  is then re-sensed before any further progression decision.
- `F1.6.4.3` A disclosure-like control with no hidden applicant controls is
  exhausted or non-substantive and cannot be reused as progression. The
  validator returns that contradiction to the LLM; shared code never chooses
  an alternate control.
- `F1.6.5` State examination waits for DOM content, a bounded network-idle
  attempt, fonts, and a configurable DOM-mutation quiet window.
- `F1.6.5.1` After a predictable gate action, the crawler performs a bounded
  wait for a visible form surface and a final stable-state examination so
  delayed framework initialization cannot race extraction.
- `F1.6.6` A fixed pointer sweep and reversible scroll may prime legitimate
  hover and lazy-load behavior before examination; it must not be represented
  or used as CAPTCHA or bot-detection evasion.
- `F1.6.6.1` Reconnaissance incrementally scrolls the full main document,
  same-origin frames, and relevant nested scroll containers to trigger
  legitimate lazy rendering, intersection observers, and scroll-bound
  instructions. Scrolls are bounded, reversible where practical, audited, and
  followed by a stable-state examination; inaccessible cross-origin frames are
  reported explicitly.
- `F1.6.7` Every automatic action records category, label, strategy,
  timestamp, before/after observed runtime state identity per `F13.3`, outcome,
  and an append-only event. It is recorded as `landed` only after the resulting
  control or page state is read back and verified; attempted is never treated
  as actuated.
- `F1.6.8` Captured predictable actions are replayable while nondeterministic
  observations remain conditional. A control whose locator never resolves,
  whose options cannot be actuated, or whose resulting state cannot be
  verified yields `could_not_test`, never "no conditional behavior." Each
  choice control is examined from a re-baselined page state because radio
  groups may not return to unselected and revealed state may persist after a
  programmatic uncheck.
- `F1.6.9` Unpredictable ads and popups are observed and captured but are not
  made unconditional replay steps.
- `F1.6.10` CAPTCHA or human-verification gates are detected and captured;
  FormWeave does not click, solve, or bypass them. A form blocked by an
  interactive CAPTCHA is disqualified from crawl certification and execution
  in the current product scope rather than queued for human completion.
- `F1.6.10.1` CAPTCHA classification distinguishes interactive text/image
  challenges, managed challenge widgets, and non-interactive score/badge
  integrations. Non-interactive protection may be observed while traversal
  continues; interactive protection always produces a durable halt.
- `F1.6.10.2` CAPTCHA recognition failure or a later quality-floor failure
  must not erase the sensing screenshot, barrier facts, page metadata, or the
  closed disqualification result.
- `F1.6.10.3` Checkbox/managed "are you human" challenges, image recognition,
  text transcription, arithmetic/knowledge questions, and equivalent
  interactive challenges all produce `disqualified` with reason
  `interactive_captcha`. Generic pointer priming may trigger legitimate page
  rendering but must never be adapted, randomized, or represented as CAPTCHA
  evasion. A passive score/badge integration that presents no gate may be
  recorded while the crawl continues.
- `F1.6.11` Same-origin fetch/XHR POST requests may be allowed when a narrow
  endpoint classifier identifies framework rendering or initialization, or
  during a short interaction-scoped window for field validation, autosave, or
  an authorized intermediate advance.
- `F1.6.11.1` Autonomous writes outside classified initialization or an
  active interaction window remain blocked and logged.
- `F1.6.11.2` An explicitly approved Live final-submit window is scoped to the
  resolved final form-action origin; unrelated origins remain blocked. This is
  a retained Phase 2 foundation and is structurally unreachable from Phase 1.
- `F1.7` Under Option A, Phase 1 owns conditional schema expansion.
- `F1.7.1` A narrowly scoped delta analysis returns only additions between the
  base schema and an observed branch variant, with lineage to the triggering
  field and value.
- `F1.7.2` Delta application is expand-only: it may insert dependent
  sub-elements but may not modify or delete existing observed fields.
- `F1.7.3` Each observed branch variant is represented by a distinct D2 state
  with its own expected D8 identity and trigger lineage. Structural
  fingerprints remain recon artifact/version verdict inputs only.
- `F1.7.4` Conditional phrasing or a distinctive earlier value echoed on a
  later state is flagged as possible cross-page dependence, with
  short/common-value guards to reduce false positives.
- `F1.7.5` Same-page visibility changes are classified as branch variants,
  required companion fields, validation messages, or cosmetic/state-only
  changes. An "Other, specify" companion is populated and remains on the same
  path; it is not automatically treated as a mutually exclusive branch.
- `F1.7.6` Cross-page dependency analysis receives prior entered values,
  prior-state questions and guidance, transition facts, and the newly observed
  page. It detects answer-conditioned wording, answer echoes that change
  question meaning, skipped or added pages, and changed requiredness before a
  terminal action is eligible.
- `F1.7.7` Cross-page detection is verified against paired positive and
  negative controls so a distinctive semantic echo halts while a benign
  progress counter, short generic token, or unrelated repeated text does not.
- `F1.7.7.1` A readback alone does not establish cross-page dependence. A
  claimed echo must reproduce the actual entered value; a different or
  hard-coded value is contradictory evidence and an otherwise ordinary next
  page remains independent unless raw evidence shows changed questions,
  requiredness, or routing.
- `F1.7.8` Discovery cannot declare a form linear, terminal, or complete until
  all safe choice probes and all observed cross-page dependency checks have a
  verified outcome or an explicit `could_not_test` record.
- `F1.7.9` Same-page conditional expansion is supported to exactly one reveal
  level from the page's base visible contract. The LLM authors every option
  probe, the deterministic runner executes and verifies those probes, and the
  semantic layer classifies each resulting visibility delta. First-level
  branch and companion fields are added, populated, evidenced, and included in
  replay. A second conditional reveal beneath an already revealed field is
  detected and halts as `same_page_branch_depth_exceeded`; it is never silently
  flattened into the first level.
- `F1.7.10` Cross-page conditional behavior is detection-only in Phase 1.
  After every intermediate advance, an LLM receives the prior questions,
  guidance, entered synthetic values, transition facts, and new rendered state
  plus screenshot. A detected or uncertain cross-page dependency is retained
  as `cross_page_branching` and halts before any new-page field actuation or
  terminal submission. The crawler does not attempt to execute either branch.
  Cross-page branch execution is intentionally unsupported in the current
  product scope; detection must not be interpreted as traversal support, and
  adding execution requires an explicit future requirements amendment.
- `F1.8` A crawl yielding zero real-form fields, all-failed extraction, or
  floor-level confidence aborts without persisting a certification-eligible
  artifact. It retains a failed-attempt bundle containing sensing, logs,
  partial facts, generated attempts, and a closed failure code so failure does
  not masquerade as "nothing happened."
- `F1.8.1` A blocked cookie preference surface, challenge page, login wall,
  payment wall, or decoy-only page cannot satisfy the artifact quality floor.
- `F1.8.2` A run has an explicit terminal eligibility result separate from
  transport completion. Interactive CAPTCHA and required-login barriers set
  `eligibility.status = disqualified`, retain a closed reason code and
  evidence, and cannot be certified, approved, or submitted. This is distinct
  from `awaiting_review`.

## F1.9. Locale determinism

- `F1.9` Every crawl runs under an explicit, recorded locale. The browser
  context pins `Accept-Language` and related locale and timezone context so
  repeat crawls of the same target render the same language.
- `F1.9.1` The effective locale is recorded in the run, report, and artifact. A
  run whose observed content language does not match the requested locale is
  flagged rather than silently accepted.
- `F1.9.2` Language switchers, locale path segments, and locale query
  parameters are detected and recorded as discovered locale variants of the
  target. They are never traversed implicitly inside a single artifact.
- `F1.9.3` A locale variant is a separate artifact with its own lineage,
  scripts, contract, and fingerprints, never a version of another locale's
  artifact. Labels, option text, and section text differ by locale and are
  fingerprint inputs; treating locale changes as drift would create false
  versions and make label-derived locators unsafe.
- `F1.9.4` Locale-dependent locator strategies are recorded so a script
  authored for one locale is not silently reused for another.

## F2. Evidence and provenance

- `F2` Every completed crawl must provide inspectable evidence of what happened.
- `F2.1` Each successfully rendered page stores its serialized DOM as a separate
  artifact.
- `F2.2` Each examined state has full-page screenshot evidence, tiled when a
  single capture would reduce text below legibility, unless safe capture fails.
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
  sequence, URL, observed runtime state identity per `F13.3`, timestamp, and
  local screenshot artifact.
- `F2.2.9` Initial, populated, choice-probe, first-level
  branch-variant-populated, final-selected-branch-populated, pre-advance,
  post-advance, blocked-final, and submitted states remain distinguishable.
- `F2.2.10` The UI and report semantics distinguish sensing captures used for
  DOM/model context from traversal proof captured before an advance and after a
  verified transition or authorized localhost submission.
- `F2.2.11` A terminal submission is successful only when browser transport
  proof and an explicit rendered application state prove completion. Transport
  proof requires the LLM-authored terminal control to have been actuated plus
  either a browser submit event or a permitted same-origin write request; when
  a navigation/write response is observable it must be successful, and a
  same-page result must have an observable state change. A GET navigation to a
  confirmation-looking URL is never submission proof. On first generated
  validation, the post-submit DOM, accessibility snapshot, screenshot, URL,
  and transport result are sent to the LLM for a typed `success`, `failure`,
  or `unknown` assessment with exact visible markers. A submit event, HTTP 2xx
  alone, an unchanged page, or an unrecognized result is retained as
  attempted-but-unverified evidence and never reported as submission success.
- `F2.2.11.1` A successful first validation stores the LLM-authored result
  markers in the immutable form script. Deterministic replay checks those
  retained markers against the new rendered result without calling the LLM.
  A rendered failure marker produces a confirmed failed submission, not a
  success; missing or contradictory markers produce
  `terminal_submission_unverified`.
- `F2.2.11.2` An explicitly authorized loopback fixture whose terminal action
  is entirely client-side may lack a browser submit event and network write.
  It counts as successful only when the exact LLM-authored terminal control
  was actuated, the rendered application state materially changed, and a
  fresh high-confidence LLM result assessment identifies explicit success
  markers. The report records this verification basis separately from
  transport proof. This exception does not authorize public or Phase 2
  submission.
- `F2.2.12` Every state attempt retains a sensing image and, when any value was
  entered, a populated or failure-boundary image. Protected required fields,
  locator exhaustion, CAPTCHA, ambiguous terminality, and validation failure
  are evidence-producing outcomes rather than reasons to discard screenshots.
- `F2.2.13` Multi-page evidence remains ordered under one journey and includes
  the state before and after every verified transition. Evidence counts and
  UI nodes are cumulative across the journey even when the final state halts.
- `F2.2.14` Loopback file-upload evidence records generated filename,
  non-sensitive size/type facts, browser readback, and page echo without
  retaining file content. Phase 2 masking rules continue to govern real files.
- `F2.3` Every crawl produces a complete machine-readable JSON report.
- `F2.3.1` The report includes targets, timestamps, aggregate statistics,
  per-page facts, the full field contract, findings, analysis, and artifact
  paths.
- `F2.3.2` The downloadable report and the report shown in the UI must come from
  the same persisted source.
- `F2.3.3` Report totals are computed from the union of all retained journey
  states, not only the browser page present when traversal returns.
- `F2.3.4` A report records whether the target began at canonical entry or
  mid-flow, the selected execution boundary, related-page discovery setting,
  coverage denominator, and exact halt reason.
- `F2.3.5` A later-state `could_not_test` report lists both completed prior
  coverage and remaining untested states; it never visually resembles a
  one-page complete crawl.
- `F2.4` Every crawl produces an append-only JSONL event log.
- `F2.4.1` Events cover creation, fetch progress, artifact persistence, LLM
  analysis, completion, and failure.
- `F2.4.2` Logs never contain API keys, authorization headers, or screenshot
  base64 payloads.
- `F2.5` Structural fingerprints hash only normalized URL, field name or ID,
  raw DOM input type, the literal `required` attribute, option values for
  enumerations with at least two options, section DOM text, state count, and
  upload presence.
- `F2.5.1` Fingerprints never include entered values, model inference,
  generated slugs or IDs, sensitivity judgments, semantic keys, headings,
  action labels, or undifferentiated body text.
- `F2.5.2` Session tokens and consent-framework DOM are stripped before
  fingerprinting.
- `F2.5.3` Fingerprint input is persisted beside its digest so drift decisions
  are inspectable.
- `F2.5.4` Exactly one fingerprint implementation exists. Production runs, the
  drift harness, the corpus harness, and every test path call it. A second or
  simplified hash function is a defect, not an acceptable test double.
- `F2.5.5` The fingerprint consumes a typed facts record produced by shared
  extraction. A per-form script may declare which forms and controls are in
  the artifact's scope; it may not supply, transform, or extend hash inputs.
  Scope is script-declared while identity facts remain DOM-derived, preserving
  Design principle 5 and preventing script edits from registering as site
  drift.
- `F2.5.6` Fact ordering is canonical and deterministically sorted before
  hashing so DOM reordering cannot change the digest.
- `F2.5.7` Normalization strips values unstable by construction, including
  framework-generated element IDs and name tokens, session and CSRF tokens,
  consent-framework DOM, and per-render nonces. Generated-ID patterns are
  maintained in one documented list used by the single implementation.
- `F2.5.8` Every stored digest records the fingerprint algorithm version
  alongside its inputs.
- `F2.5.9` A fingerprint-algorithm change is an explicit versioned event.
  Digests produced under different algorithm versions are never compared as
  site drift; comparison across a version boundary requires an explicit
  re-baseline.
- `F2.5.10` The fingerprint module is change-gated. Any modification must pass
  a golden regression that re-fingerprints the stored corpus and diffs against
  retained digests; unexplained digest changes block the change.
- `F2.5.11` The fingerprint module exposes no target-specific branches.
  Site-specific behavior belongs in per-form scripts and cannot reach the
  hash.

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
- `F3.5.1` The evidence view presents verified traversal proof separately from
  sensing-only page captures and does not imply that an unactuated page capture
  proves successful form completion.
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
  initialization, and blocked-write counts plus the per-action observed-state
  identity audit trail.
- `F3.12.4` Settings expose bounded field entry, branch exercise,
  intermediate advancement, state-evidence, and branch-option controls.
- `F3.12.5` Settings contain editable natural-language instructions for the
  traversal planner and explain which safety decisions remain deterministic.
- `F3.12.5.1` Editable traversal instructions must be consumed by the declared
  planning or script-generation path and their effect must be attributable in
  the resulting plan. Persisting unused instruction text does not satisfy this
  requirement.
- `F3.13` The public Phase 1 new-crawl UI provides one execution mode: Probe.
  A separately labeled loopback-fixture validation boundary is available only
  after the localhost test opt-in and is never presented as public Live mode.
- `F3.13.1` Phase 1 exposes Probe mode: it enters synthetic values, exercises
  branches, permits narrowly authorized validation/autosave/intermediate
  side effects, captures the completed state, and never activates the final
  submit control.
- `F3.13.2` The previous Phase 1 Live mode is superseded by the approved-live
  mode specified in `FEATURES_PHASE2.md` F10; it is not exposed by the Phase 1
  UI or API.
- `F3.13.3` Run status, report facts, findings, actions, and UI trust copy
  truthfully identify Phase 1 Probe mode, accepted intermediate side effects,
  and the blocked terminal action.
- `F3.13.4` The launch UI validates a supplied multi-page URL and warns when it
  appears to be an intermediate step. The operator can choose the detected
  canonical entry or deliberately continue with a clearly labeled partial
  journey.
- `F3.13.5` Loopback fixture-submit mode separately authorizes terminal
  submission solely so test fixtures can verify the terminal result. Upload,
  consent, acknowledgement, review-confirmation, and signature modeling are
  ordinary LLM-authored crawl actions available on public and local targets
  equally and do not require per-component fixture flags. They use only
  conspicuously synthetic crawl values. Terminal submission remains governed
  separately by the execution boundary.
- `F3.13.6` Probe, loopback fixture validation, and future approved-live modes
  show distinct badges throughout launch, live traversal, evidence, report,
  and download views.
- `F3.14` The run view renders the state graph explicitly.
- `F3.14.1` Examined states are nodes and verified gate, branch, and advance
  actions are directed edges.
- `F3.14.2` Halted nodes display their closed failure code, and every node
  opens its associated full or tiled screenshot evidence.
- `F3.14.3` Branch edges display the triggering field/value and variant
  observed state identity.
- `F3.14.4` Multi-page state nodes remain visible after a later halt, including
  verified fields, transition evidence, and script/model exchanges from each
  earlier state.
- `F3.14.5` A mid-flow entry node is visibly incomplete and shows missing
  predecessor coverage rather than occupying the first position as if it were
  the canonical start.
- `F3.15` The run UI exposes a behavioral coverage matrix that distinguishes
  discovered, attempted, actuated, verified, branch-producing, untested, and
  human-review outcomes for every question and option.
- `F3.15.1` Pipeline progress is visually distinct from behavioral coverage
  and certification; a completed pipeline may not be presented as 100%
  behavioral coverage.
- `F3.15.2` The UI presents question help, section membership, option meaning,
  tested branch combinations, page transitions, and known gaps without
  requiring the operator to reconstruct them from raw JSON or screenshots.
- `F3.15.3` Choice coverage is option-by-option. For every non-placeholder
  radio, checkbox, select, and switch value it shows discovered, attempted,
  actuated, read-back verified, state-changing, companion-revealing,
  branch-producing, failed, protected, or untested status.
- `F3.16` The run UI provides a live, state-by-state traversal console while a
  crawl is running and preserves the same review surface after completion.
- `F3.16.1` Each state is collapsible and summarizes its kind, description,
  observed state identity, visible controls, field-verification progress,
  evidence time, and overall verified, active, review, or failed status.
- `F3.16.2` Fields render in form-like sections with their displayed label,
  control type, entry/readback status, and expandable metadata. Required,
  conditional, administrative, consent, upload, sensitive, and failed fields
  receive distinct visible treatment without exposing full applicant values.
- `F3.16.3` Concerning state and field flags are red; neutral provenance and
  descriptive metadata are visually subordinate. A verified field and state
  visibly progress to green only after actuation and browser readback.
- `F3.16.4` The traversal console updates from locally persisted live crawl
  events and remains useful for historical runs that predate live-state
  telemetry by reconstructing states from stored evidence.
- `F3.17` For every run and target, the UI states whether traversal was driven
  by a D1 generated script, a hand-authored script, or observation only.
  Pipeline completion and hand-scripted traversal are never presented as
  autonomous generation capability.
- `F3.18` For every generated traversal state, the traversal UI exposes the
  actual exchange between browser sensing, the semantic layer, the stored
  generated-script role, and deterministic executor/physics results.
- `F3.18.1` The sensing exchange shows observed control, action, section, and
  guidance counts; accessibility and prior-contract context; screenshot hash;
  and a link to the screenshot supplied to the model.
- `F3.18.2` The semantic exchange shows model and prompt provenance, proposal
  identity, duration, attempts, typed field/action counts, progression, and
  deterministic safety accept/reject results.
- `F3.18.3` The generated-script exchange shows script version and hashes,
  retained location, per-field selectors and synthetic values, typed actions,
  safety disposition, and the one typed progression.
- `F3.18.4` The executor/physics exchange shows attempted, verified, skipped,
  and failed field counts; observed state identity; progression or submission
  outcome; and links to sensing, populated, transition, and submission
  evidence.
- `F3.18.5` Architectural-role labels do not certify a run-local pilot as the
  canonical D1/D3 implementation. Missing provenance is disclosed rather than
  reconstructed as if it had been retained.
- `F3.18.6` A retained replay presents the original immutable semantic/script
  provenance beside the current run's sensing, readback, transition, and
  evidence results. It explicitly distinguishes zero traversal-generation
  calls from any separate optional post-crawl report-analysis call.

## F4. Local-first operation and ownership

- `F4` The complete application must run on localhost so the user owns the
  code, runtime, logs, and artifacts.
- `F4.1` One command starts the local web UI and crawler API.
- `F4.1.1` The local web UI is available at `http://localhost:3000`.
- `F4.1.2` The local API is available at `http://127.0.0.1:8787`.
- `F4.1.3` A crawl can explicitly opt into loopback test targets from the
  launch UI. The opt-in permits only `localhost`, `*.localhost`, `::1`, and
  `127.0.0.0/8`; it does not widen access to other private-network targets.
- `F4.1.3.1` Ordinary product crawls of localhost targets follow the same
  generated-script boundary as public targets. Production crawl, generation,
  and execution code must not import, read, or derive planners from fixture
  ground truth. Until a current D1 script exists, the run is labeled
  observation-only rather than silently using an answer-key-derived planner.
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
- `F4.6` Local-first ownership does not prohibit an explicitly configured
  hosted deployment. The complete local path remains available, while a
  hosted staging or production path may run the UI, API, Playwright browser,
  and PostgreSQL in infrastructure controlled by the operator.
- `F4.6.1` A hosted web process exposes one public port. A production gateway
  routes `/api/*` to the crawler API and serves the public landing page plus
  the protected `/control-plane` and `/api-console` UIs.
- `F4.6.2` Hosted UI access requires an individual database-backed account.
  Passwords are stored only as salted, resource-intensive one-way hashes;
  plaintext passwords are never stored in the database. Successful login
  creates a database-backed, `HttpOnly`, `SameSite` session with a bounded
  lifetime.
- `F4.6.3` Repeated failed authentication is rate-limited and locks the
  principal for a configurable period. The default is five failures followed
  by a fifteen-minute lockout, and every success, failure, and lock event is
  auditable without retaining the submitted credential.
- `F4.6.4` Hosted API access requires a high-entropy Bearer token over TLS.
  Only a digest and non-secret prefix are stored server-side. Tokens have
  explicit scopes, can be disabled or expired, and are independently
  rotatable. HTTP Basic may be enabled for staging administration but is not
  the preferred client API mechanism.
- `F4.6.5` Hosted mode is headless-only and rejects loopback and
  private-network crawl targets even if a client requests local-target
  authority. Headful browsing and localhost fixtures remain local-workstation
  capabilities.
- `F4.6.6` Hosted state is PostgreSQL-authoritative. Ephemeral filesystem
  storage is cache-only; durable screenshots and other binary evidence require
  a durable object-store adapter before a multi-dyno production release.
- `F4.6.7` Bootstrap credentials may be generated into an explicitly
  Git-ignored local access file and seeded from a trusted workstation.
  Plaintext credentials, API tokens, `.env` files, and authorization headers
  must never be committed, placed in platform configuration as a bundle, or
  written to application logs.
- `F4.7` Local browser binaries are installed and managed through Playwright;
  local crawling does not require a remote browser or screenshot account.

## F5. OpenAI enrichment

- `F5` Local crawls can use an OpenAI model to enrich deterministic crawl facts.
- `F5.1` The preferred credential is `OPENAI_KEY` in the repository-root
  `.env` file.
- `F5.1.1` `OPENAI_API_KEY` may be supported as a compatibility fallback.
- `F5.1.2` The credential is server-only and must never be returned to the UI,
  committed, or logged.
- `F5.2` Full-page screenshots, tiled when a single image would reduce
  legibility, are standard sensing input alongside the rendered DOM for every
  analysis and metadata-generation pass. Bounding is permitted only as a
  documented cost control for exceptionally tall pages; archiving the same
  captures as evidence is secondary.
- `F5.3` The model returns schema-constrained structured JSON.
- `F5.4` Model output includes a summary, apparent page purpose, form
  inventory, conservative inferred controls, default synthetic test values,
  findings, and limitations.
- `F5.5` Inferred controls include origin, confidence, supporting evidence,
  and a default synthetic test value.
- `F5.6` An LLM failure does not invalidate or delete the deterministic crawl
  report.
- `F5.7` The selected model is configurable without a source-code change.
- `F5.8` When configured, an LLM may classify observed controls, propose
  format-plausible synthetic values, identify possible dependencies, and
  propose form-specific sequencing metadata from persisted operator
  instructions. It does not direct generic shared traversal at runtime.
- `F5.8.1` If the LLM is unavailable, disabled, times out, or returns unusable
  identifiers, the run retains deterministic observations but is not certified
  as having a complete form-specific actuation script.
- `F5.8.2` Hard enforcement overrides prompt output for CAPTCHA, credentials,
  file upload, legal acceptance, payment, Probe terminal blocking, and the
  absence of Phase 2 approved-live authority.

## F6. Operational transparency

- `F6` The user must be able to determine what the system is doing and where
  its outputs live.
- `F6.1` A health endpoint reports local runtime, storage root, active crawl
  count, model name, and whether a credential is configured.
- `F6.1.1` Health output reports the active browser engine and supported
  Headless/Headful modes.
- `F6.2` Progress is driven by actual crawl work rather than a cosmetic timer.
- `F6.3` Every Phase 1 failure uses one code from the closed set
  `fetch_failed`, `locator_unresolved`, `actuation_unverified`,
  `could_not_test`, `advance_no_navigation`, `challenge_detected`,
  `login_or_payment_detected`, `drift_fingerprint`, or `quality_floor`, and
  includes before/after observed runtime state identity per `F13.3` plus
  attached screenshot evidence. `drift_fingerprint` is a recon verdict; its
  digest is not used as runtime state identity or progression proof.
- `F6.3.1` Phase 2 adds `validation_blocked`, `type_mismatch`, and
  `drift_undeclared_required`; Phase 1 does not emit those runner-only codes.
- `F6.4` The local service prints startup URLs, artifact root, and redacted
  OpenAI readiness to the terminal.
- `F6.5` Reports and logs remain readable with ordinary filesystem and text
  tools; no proprietary viewer is required.
- `F6.6` In-progress work should recover or be marked interrupted after an
  unexpected local process restart.

## F7. Guarded Phase 1 execution boundary

- `F7` Public and local Phase 1 traversal use the same synthetic-data and
  generated-script rules and are structurally incapable of terminal
  submission. A separately labeled loopback-fixture validation boundary may
  exercise terminal submission under `F8.9.1`; it confers no terminal
  authority on public or other private-network targets.
- `F7.1` The crawler may enter only obviously synthetic or fixture-safe test
  values; real user data is neither required nor inferred.
- `F7.1.1` Required login/credential entry and interactive CAPTCHA disqualify
  the form in the current product scope and are never populated. Payment
  controls remain prohibited. Public and local Probe may populate upload,
  consent, authorization, terms, review-confirmation, acknowledgement, and
  signature controls only with synthetic crawl values through an
  LLM-authored, safety-validated script.
- `F7.1.2` Crawl-time special-component actuation is origin-neutral. A harmless
  generated upload, synthetic consent, review confirmation, acknowledgement,
  or synthetic signature may run on public or local targets when the exact
  LLM-authored action was stored and safety-validated and no end-user data or
  file is involved. Legacy per-component fixture flags confer no additional
  public or execution authority.
- `F7.1.3` Credential entry, payment entry, and CAPTCHA solving remain
  prohibited even on loopback fixtures. Those fixtures validate detection,
  classification, evidence, and durable disqualification/halt behavior
  instead. Required login and interactive CAPTCHA do not enter an
  approval-waiting state.
- `F7.1.4` Consent policy is category-specific and preserves the distinction
  between crawl-time modeling and real execution. Public Probe may exercise
  every consent/signature category with conspicuously synthetic values when
  needed for discovery or mechanical verification, but it remains unable to
  perform terminal submission. Phase 2 substitutes the end user's real value
  only through a certified script and an authorized execution.
- `F7.2` Probe mode never activates a control classified as the terminal
  submit action.
- `F7.2.1` The terminal submit stays blocked at the browser layer. An
  intermediate advance round-trip, including a POST, is permitted only after
  the form-specific script's terminality decision and deterministic
  corroboration establish that the selected control is not terminal. A state
  with two or more submit-typed controls and no corroborating progress
  indicator is ambiguous and halts rather than advancing. This permission is
  narrow and explicit; the write classifier is not widened implicitly.
- `F7.2.1.1` Intermediate validation, autosave, and advance round-trips may
  leave partial synthetic state server-side. This inherent Option A side
  effect is accepted and disclosed; the terminal browser-layer block remains
  the pollution guard.
- `F7.2.2` The previous Phase 1 Live behavior is superseded by Phase 2
  approved-live mode. Public Phase 1 cannot open the final-submit window; the
  separately labeled loopback-fixture validation window in `F8.9.1` is
  test-only authority and cannot be reused for public or real-data execution.
- `F7.2.3` Browser requests using methods other than GET, HEAD, or OPTIONS are
  blocked before they reach the target server except as allowed by
  `F1.6.11`; the final-action exception is retained internally for future
  Phase 2 use but is unreachable from Phase 1.
- `F7.2.3.1` Allowed initialization, interaction-scoped writes, blocked
  autonomous writes, and submission attempts are counted and logged with
  sanitized endpoints.
- `F7.2.4` Submit events and programmatic form submission APIs are guarded
  before site scripts execute and are released in Phase 1 only for a
  corroborated intermediate action.
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
  human-verification handoff. They also include the four wild failure scars:
  styled-label pointer interception with a hidden input, a probe-defeating
  JavaScript choice widget, interaction-gated delayed JavaScript that renders
  only after the first trusted input, and decoy/widget forms preceding the
  real form in document order.
- `F8.7.2` A headless harness writes its report, rendered HTML, screenshots,
  and events below local `data/harness/`.
- `F8.7.3` A headful harness runs the same fixtures and assertions while
  showing the local browser.
- `F8.7.4` Automated assertions prove that classified initialization,
  validation, and autosave writes can complete while autonomous writes and
  Probe terminal submissions remain blocked.
- `F8.7.5` Automated assertions prove predictable gates are traversed and
  fingerprinted, CAPTCHA controls are not clicked, Settings persist, and
  screenshot evidence links open the full local image.
- `F8.7.6` Repository-owned fixtures and tests prove value entry, select/radio/
  checkbox branching, conditional-field discovery, intermediate advancement,
  per-state populated screenshots, Probe terminal blocking, and loud
  `could_not_test` outcomes.
- `F8.7.7` Production-path fixture tests prove that every non-placeholder
  choice value is independently probed from a clean baseline and receives an
  option-level outcome. Selecting one convenient value is insufficient.
- `F8.7.8` Production-path tests cover public/local origin-neutral generated
  file upload and readback, consent-category classification, synthetic consent
  and signature actuation without legacy component flags, and the continued
  prohibition on credentials, payment, CAPTCHA solving, and terminal public
  submission.
- `F8.7.9` A multi-page regression starts at canonical entry, halts on its
  final state, and proves all earlier fields, scripts, transitions, and
  screenshots remain in the report. A companion regression starts at page 2
  and proves `mid_flow_entry` is displayed and cannot be scored as whole-form
  coverage.
- `F8.8` The live harness contains form-specific, non-submitting recon scripts
  for the United Way Housing Navigation and PG&E CARE/FERA forms and can run
  either headless or headful.
- `F8.8.1` Live harness reports and screenshots are stored under local
  `data/live-harness/`; no live harness target is submitted.
- `F8.9` A separate localhost-corpus harness consumes the user-provided
  `ground_truth.yaml` files instead of hard-coding a reduced duplicate of the
  expected behavior.
- `F8.9.1` The corpus harness and an explicit product-UI test mode may use
  `fixture_submit` solely for explicitly authorized loopback fixtures. The
  crawler rejects that mode for every non-loopback target, and the UI keeps it
  disabled until the localhost opt-in is selected.
- `F8.9.2` Local fixture submission records pre-submit values, the terminal
  action, submit-event telemetry, post-submit evidence, and a
  `fixture_submitted` certification. Ordinary Probe remains terminally blocked.
- `F8.9.3` The corpus covers all 27 primary sites plus the image-CAPTCHA and
  cross-page dependency detection/halt fixtures in both headless and
  user-visible headful modes, with HTML, screenshots, reports, events, and a
  machine-readable summary stored locally. Cross-page alternate paths are not
  executed.
- `F8.9.4` Corpus scripts own site-specific actuation and halt decisions. The
  shared framework supplies browser physics, bounded waits, write guards,
  evidence capture, and structural verification.
- `F8.9.5` A drift harness switches the local variant server through baseline,
  identical, optional-addition, required-addition, and cosmetic-reorder cases,
  resets it in a `finally` boundary, and verifies value-independent structural
  fingerprints and critical-required-field detection.
- `F8.9.5.1` The drift harness exercises the same production fingerprint,
  lineage update, semantic-delta, and version-decision code used by normal UI
  runs. A separate test-only hash is insufficient evidence for production
  drift behavior.
- `F8.9.7` Framework flexibility is tested with a previously unseen holdout
  corpus while shared browser-physics code is frozen. New targets may add or
  generate per-form scripts, but passing the holdout may not require
  target-specific branches in shared traversal code.
- `F8.9.6` Interactive text and image CAPTCHAs halt without being solved;
  explicitly invisible score-based protection that requires no user action is
  recorded without being misclassified as an interactive barrier.
- `F8.9.8` Ground truth and answer keys are scorer-only inputs. Production
  crawling, semantic generation, D1 compilation/loading, and execution cannot
  import or read them. An isolated generation test proves the answer-key path
  is inaccessible before the first model call; a separate scorer may read it
  only after generation artifacts are frozen, and must verify those artifacts
  remain byte-for-byte unchanged while scoring.
- `F8.9.9` Every registered test site exposes the same per-site submission
  capture API: latest submission, newest-first retained list, clear, and
  direct submit. Verification supports POST bodies, GET wizard-step captures,
  and JavaScript submit endpoints; files compare by filename, repeated values
  may be arrays, and multi-page verification uses the retained list rather
  than assuming the latest entry contains every step.
- `F8.9.9.1` The API console may proxy capture reads only to the documented
  testforms hosts or a local `/site_*` fixture. Dispatcher deployments obtain
  the testforms routing cookie before the capture call. Arbitrary public or
  private targets remain forbidden.
- `F8.9.9.2` The API console compares Run API semantic keys to captured native
  HTML names using the published `x-formweave-native-name` mapping and reports
  matched, missing, and differing fields across retained submissions.
- `F8.10` Generated-script capability is scored only with strict separation:
  generation sees the website but not ground truth; a separate scorer loads
  hidden ground truth only after the generated script is frozen. Human
  authoring or shared-code changes mark the result assisted or failed.
- `F8.10.1` The existing ground-truth-constructed localhost corpus is labeled
  **execution conformance** everywhere and is never evidence of discovery,
  generation, or framework flexibility.
- `F8.10.2` The D5 vertical slice on at least one unseen public target is the
  first generation gate, before any other generation-adjacent feature work.
- `F8.10.3` A repeatable blind localhost production-crawl audit runs every
  fixture through the same model-generation path used by the UI, freezes the
  run before reading its site-specific ground truth, then writes retained
  machine-readable results plus a `LEARNINGS.md` in each form directory.
  Ground truth may score a frozen run but may never plan, prompt, generate,
  repair, or replay it.
- `F8.10.4` The production localhost corpus passes only when every fixture
  reaches its ground-truth outcome with a durable artifact: end-to-end
  completion for linear fixtures, verified branch halt for branching fixtures,
  verified human/protected-action halt for barriers, and closed
  `could_not_test` for deliberately unactuatable controls.
- `F8.10.5` Corpus scoring separately reports form-location coverage,
  field-contract recall, requiredness and sensitivity accuracy, field
  actuation/readback, option-probe coverage, same-page and cross-page dynamics,
  special-component detection, evidence completeness, and verified terminal
  outcome. No aggregate score may hide a safety-critical failure.
- `F8.10.6` The following are release-blocking regressions: submitting after a
  missed cross-page dependency; losing prior-page evidence after a later halt;
  reporting an unverified submit as success; treating an untested choice as
  linear; discarding CAPTCHA/login/payment/ambiguous-terminal evidence;
  treating an "Other, specify" companion as a branch; claiming complete
  coverage from a mid-flow URL; or compiling/replaying any action that the
  safety layer rejected or classified as protected.

## F9. Drift, identity, and versioning

- `F9` Durable artifact identity is keyed by normalized public URL, never by an
  operator-typed name.
- `F9.1` Re-crawling a known normalized URL compares the new structural and
  variant fingerprints against the stored lineage.
- `F9.2` An unchanged fingerprint touches the lineage's last-observed time
  without creating a version or new review request.
- `F9.3` A structural change creates version `N+1` in the same lineage and
  requires review.
- `F9.4` A cosmetic-only change creates no version.
- `F9.5` A new variant fingerprint whose base structure matches is an expansion
  of the existing artifact rather than a rebuild.
- `F9.6` Every durable version records its normalized URL, predecessor,
  observed fingerprints, probe-script version, policy version, evidence
  references, creation time, and certification state.
- `F9.7` A `drift_fingerprint` or `quality_floor` halt cannot silently replace
  the last certified artifact.
- `F9.8` Fingerprint identity is stable under generated DOM IDs, control
  reordering, session-specific framework markup, and changes on separately
  discovered forms. Each independently executable form has its own lineage.
- `F9.9` A detected change stores and displays a semantic delta identifying
  added, removed, or changed fields, options, requirements, sections, and
  transitions; a bare hash mismatch is not sufficient for review.
- `F9.10` Artifact versions and recon-script source versions are reproducible.
  The exact script source or immutable source revision used by a version is
  retained, and script changes cannot silently reuse an existing version.
- `F9.11` Artifact identity is keyed by normalized public URL and locale.
- `F9.12` Script versioning applies to D1/D4 generated scripts: immutable
  retained source, source hash, generation provenance, and linkage to the
  artifact/schema and fingerprint-algorithm versions. A manual integer on a
  hand-authored planner does not satisfy this requirement.
- `F9.12.1` A generated script version increments automatically whenever its
  source changes or a contract expansion requires regeneration; the system
  enforces this rather than trusting a declared integer.
- `F9.12.2` Every artifact version retains the immutable generated script source
  and provenance sufficient to reproduce the exact executable.
- `F9.12.3` A generated script change cannot silently reuse a script version;
  artifact/schema version, fingerprint-algorithm version, and script version
  remain linked but never interchangeable.
- `F9.12.4` Production retains complete generated form scripts in an immutable
  local version registry. Automatic reuse requires compatible script-interface
  version, verified source hash, matching canonical route, successful
  first-state selector resolution, and current safety-policy acceptance for
  every action; otherwise no retained action occurs and generation begins from
  fresh sensing. Legacy component flags do not gate synthetic crawl modeling.
- `F9.13` The API and UI accept an explicit artifact version to execute or
  inspect. Version selection is reproducible; absent an explicit selection,
  the current certified version is used and the resolved version is recorded.
- `F9.13.1` Lineage, version list, semantic deltas between versions, and each
  version's certification state are browsable in the UI.
- `F9.14` Certification is human sign-off on machine-assembled evidence. The
  system assembles the field contract, guidance and section model, coverage
  matrix, branch map, state evidence, and diagnostics; a person decides.
  Self-certification by the crawler or a model does not exist.
- `F9.14.1` Artifact certification states are `observed`, `certified`,
  `superseded`, and `revoked`. Transitions record actor, timestamp, artifact
  version, and the evidence set reviewed.
- `F9.14.2` `observed` to `certified` requires human approval. A new structural
  version moves its predecessor to `superseded`. A `drift_fingerprint`,
  `quality_floor`, or failed re-verification moves an artifact to `revoked`.
- `F9.14.3` Certification records per-question and per-option coverage at the
  moment of approval so later execution can determine what the approval
  actually covered.
- `F9.14.4` A revoked or superseded artifact version is retained and
  inspectable; it is never deleted or overwritten.
- `F9.15` Crawl identity, crawl-scoped form identity, and durable artifact
  lineage are distinct. Every crawl receives a unique `crawlId`. Every
  complete, published form journey produced by that crawl receives a new
  opaque `formId`, including when the same URL is crawled again. The durable
  artifact lineage may remain the same when recon detects no structural
  change.
- `F9.15.1` A `formId` pins its source crawl, target, exact generated-script
  artifact ID, immutable script version, source hash, execution eligibility,
  and client input schema. It never silently follows a newer crawl or script.
- `F9.15.2` The crawl report returns each `formId`, its input JSON Schema,
  eligibility/disqualification reasons, exact script identity, and approval
  and run endpoint paths.
- `F9.15.3` Approval and execution APIs accept `formId`, not a raw URL or a
  mutable "latest" alias. Recrawling creates a new approval target and never
  inherits an earlier crawl-scoped approval.
- `F9.15.4` Approval records decision, actor, time, notes, and the pinned
  artifact ID, script version, and source hash. A disqualified form or a
  script-identity mismatch fails closed.

## F13. Semantic/script/executor contract line

- `F13` Semantics are standardized above the script by the semantic layer;
  mechanics are resolved inside the script against the live page; physics and
  orchestration sit below in the executor.
- `F13.1` The D2 semantic contract is the only vocabulary crossing the line.
  Progression actions are typed `advance` or `terminal_submit`, never free-form
  clicks. Each state has exactly one progression action and the contract has
  exactly one terminal state.
- `F13.2` A D1 generated script re-resolves every contract field against the
  current DOM on every run. Generation-time strategies are hints, not truth.
  Resolution, actuation, or verification failure yields a closed failure code;
  the script never guesses, invents, renames, or acts outside its contract.
- `F13.3` The D3 executor owns orchestration and the physics toolbox, interprets
  typed actions, confirms progression only through observed state identity and
  change as defined below, halts ambiguous terminals, excludes Back and Cancel,
  enforces safety, and performs no form-semantic action of its own accord.
- `F13.3.1` Runtime state identity is a visibility-aware, contract-relative,
  mechanically derived record containing: the normalized route; the
  canonically sorted set of currently visible D2 contract-control keys; and
  the one currently visible D2 progression-action key and typed kind
  (`advance` or `terminal_submit`).
- `F13.3.2` A contract control is visible for state identity only when it is
  connected and applicant-visible under shared DOM, layout, ARIA, frame, and
  shadow-root visibility rules. Disabled-but-visible controls remain in the
  identity. Entered values, validation text, enabled state, body text,
  transient/generated DOM IDs, and non-contract controls do not.
- `F13.3.3` Every D2 state declares its expected runtime identity. Contract
  validation rejects two states with the same expected identity.
- `F13.3.4` An `advance` is confirmed only when the post-action identity differs
  from the pre-action identity and matches exactly one declared successor
  state. A different but undeclared identity is form-change suspicion, not
  confirmed progression; an unchanged identity is `advance_no_navigation`.
- `F13.3.5` Runtime state identity is not a structural fingerprint and is never
  used for artifact versioning or recon drift verdicts. F2.5 fingerprints are
  computed and compared during recon only.
- `F13.3.6` Every D8 identity used for arrival matching or progression
  confirmation is captured only after the shared D3 settle routine reports a
  stable state. A pre-settle observation is diagnostic only and may not
  satisfy a declared state.
- `F13.3.7` Repeated semantic states whose visible contract controls and
  progression action produce the same D8 identity are intentionally
  unrepresentable in Contract v2. Add-another/repeating-member loops that
  revisit such an identity fail loudly as `repeated_state_unrepresentable`;
  they are never silently treated as confirmed progression.
- `F13.4` The executor can invoke a script for one state with any subset of
  inputs. Unsupplied fields report `unattempted`; a missing required value
  surfaces as `validation_blocked` at progression and is attributed to the
  missing input.
- `F13.5` Every invocation returns a result envelope containing per-field
  `{key, attempted, resolved, entered, verified, failure_code, detail}`, state
  outcome, progression attempt and state-change confirmation, observed state
  identity, and evidence references.
- `F13.6` Recon probing, validation replay, scheduled probing, and real-data
  execution use the same script and executor code path.

## F14. Generated-script loop

- `F14` A target without a current D1 generated script runs agentic recon with
  the LLM in the loop at each novel state.
- `F14.1` A safety layer validates every model proposal before action. Rejected
  proposals are recorded and never silently patched.
- `F14.1.1` Safety disposition is binding across state compilation, complete
  script assembly, validation replay, and fixture submission. Only accepted
  actions may enter executable D1. A rejected or protected upload, consent,
  signature, credential, payment, CAPTCHA, or terminal instruction cannot
  reappear as an ordinary field action or be marked verified by later replay.
- `F14.2` Generation writes a D1 script and D2 contract to disk with
  generated-at time, model identity, prompt version, source hash, source
  artifact version, and the linked D4 version triplet.
- `F14.3` Generation completes only after immediate validation replay passes
  with the LLM disabled. Failing scripts are retained as evidence and are never
  certification-eligible.
- `F14.4` Synthetic-data script generation is a Phase 1 deliverable. Phase 2
  consumes an existing certified generated script with real data, approval, and
  submission authority; Phase 2 does not introduce generation.
- `F14.5` A target without a generated script is prominently observed-only
  (`script_missing`), and capability language describes only what occurred.
- `F14.6` If a generated state cannot safely actuate or verify a required
  field, the run retains the observed contract, successful readbacks, model
  exchange, logs, and screenshots as a durable `could_not_test` artifact.
  Failure of one required action must not erase already collected evidence.
- `F14.7` Generation has a bounded repair-to-green loop. A failed schema
  proposal, unsafe or format-invalid test value, unresolved/ambiguous locator,
  failed browser readback, unexpected state identity, or progression failure
  is returned to the model with structured failure history and fresh sensing;
  each revised action set is written as a new immutable attempt before replay.
- `F14.7.1` Repair stops only when the state validates green, a configured
  attempt/time budget is exhausted, or a protected/human-review boundary is
  reached. Exhaustion yields a durable closed-code artifact; it never silently
  accepts the last attempt.
- `F14.7.2` Repair history distinguishes confidently wrong semantics from
  uncertain capture and records which failure signal caused each change. It
  never receives scorer ground truth.
- `F14.7.3` Repair feedback is cumulative: constraints fixed in earlier
  attempts remain mandatory even when absent from the newest issue list.
  Repair may change the model proposal, but it may not silently discard
  already-valid fields, protected-action classifications, choice coverage, or
  disclosure sequencing.
- `F14.8` Each novel state produces its own retained script action set, and the
  ordered action sets are assembled into one complete form script with stable
  state and transition identities. A run-local script is explicitly
  noncanonical until immutable D1 allocation and LLM-disabled validation
  replay pass.
- `F14.9` Immediate validation replay starts from the canonical form entry and
  replays the entire accumulated script, not merely the final state or the URL
  where generation stopped.
- `F14.10` A partial or repaired run retains every superseded proposal, safety
  result, generated source hash, executor result, and evidence reference so
  the four-layer exchange is auditable state by state.

## F15. Execution-based drift detection

- `F15` Day-to-day drift detection is execution verification, not digest
  comparison. Fingerprints are computed and compared during recon only.
- `F15.1` Every failure is classified before drift action as input-data fault,
  environment fault, or form-change suspicion. Input-data faults never trigger
  re-crawl or mint a version; environment faults receive bounded retry.
- `F15.2` Form-change suspicion triggers automatic re-crawl. A changed recon
  digest creates a new artifact version plus regeneration; an unchanged digest
  identifies a script defect and creates a script-only version increment.
- `F15.3` During real-data execution, form-change suspicion halts before any
  further entry on that state.
- `F15.4` Execution verification cannot detect changes that do not impede the
  script, including optional fields and changed wording. Each target has a
  configurable re-probe interval and becomes stale before approved-live
  execution when overdue.

## F16. Dynamics discovery and expand-only contract evolution

- `F16` The executor enumerates each value of each choice field using D7 probe
  directives and re-baselines between fields. Unverified actuation,
  unresolvable locators, and unactuatable option sets yield `could_not_test`,
  never “no conditional behavior.”
- `F16.1` Under a probe directive, the script returns only a D6 raw
  before/after control-set observation with zero interpretation.
- `F16.2` The executor aggregates raw observations into a change-map and sends
  that map to the semantic layer.
- `F16.3` The semantic layer returns additions only, with triggering
  field/value lineage and branch-scoped visibility and requiredness. The system
  rejects any modification or deletion of an existing contract entry.
- `F16.4` Contract expansion regenerates the affected state's script,
  increments script version, and requires a fresh validation replay.
- `F16.5` A later variant whose base structure matches follows expansion; a
  variant whose base structure does not match follows the F15 drift path.
- `F16.6` Exhaustive safe choice probing covers every non-placeholder option
  of every select, radio group, checkbox group, and switch. Each option is
  tested from a clean state baseline, and the D6 result records whether it was
  actuated, read back, state-changing, companion-revealing, branch-producing,
  protected, failed, or untested.
- `F16.7` A same-page visibility delta is sent to the semantic layer with raw
  trigger and control-set facts. The semantic result explicitly classifies
  required companion fields, mutually exclusive branches, validation-only
  changes, and cosmetic changes before traversal decides whether to continue
  or halt.
- `F16.8` Multi-page dynamics use the accumulated journey context. After every
  advance, D6 records the new visible contract and page text facts, and the
  semantic layer evaluates causal dependence on prior answers before any
  terminal action becomes eligible.
- `F16.9` Cross-page detection has paired positive/negative replay: distinctive
  answer-conditioned wording or echoes must be detected, while benign short,
  numeric, progress, generic, readback-only, and mismatched-value echoes must
  not create false branches.
- `F16.10` Choice and cross-page probing cannot submit the form. Terminal
  fixture validation becomes eligible only after required option coverage and
  dependency checks are complete or explicitly `could_not_test`.
- `F16.11` Any discovered addition regenerates the affected state script and
  complete form script, increments the script version, and requires
  canonical-entry repair-to-green replay before the artifact can be reviewed
  for certification.
- `F16.12` Every safe choice option is represented by an explicit
  LLM-authored `choice_probe` instruction. Shared code may validate that the
  instruction covers observed raw option values and may replay it, but it may
  not invent an option or select a branch based on labels or keywords.
- `F16.13` Phase 1's supported dynamics envelope is one level of same-page
  conditional expansion and zero levels of cross-page conditional execution.
  The terminal-eligibility record is false when option coverage is incomplete,
  same-page depth exceeds one, or any cross-page assessment is detected,
  uncertain, failed, protected, or untested.
- `F16.13.1` Cross-page conditional execution is out of scope, not pending
  implementation within the current envelope. The crawler may observe an
  ordinary linear next page, but once progression is determined or suspected
  to depend on an earlier answer it records the dependency and halts without
  actuating that dependent page.
