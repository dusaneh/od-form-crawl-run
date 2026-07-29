# FormWeave per-form production audit

Date: 2026-07-26

## How to read this

- **Located** means the production crawler reached the intended form-bearing
  surface, not merely the site's landing page.
- **Fields** compares the retained contract with post-run ground truth.
- **Actuation** means an LLM-authored action was stored, deterministically
  executed, and read back. File inputs, credentials, payment, CAPTCHA, legal
  acceptance, and other protected actions may intentionally remain
  unactuated.
- **Run result** is measured against the fixture's intended outcome. A correct
  branch or safety abort is success; an unsafe submission is failure even if
  the fixture returned a success page.
- The first blind pass predates the durable-`could_not_test` repair for most
  failed sites. Only the targeted corrective reruns are credited below.

## Plain, noisy, and navigation forms

### `site_a_shelter` — baseline one-page intake

- **Located / fields / actuation:** Yes; all 7/7 expected fields were retained
  and all seven received verified synthetic entries.
- **Special behavior:** The dropdown, optional fields, date, telephone, email,
  and numeric household field were detected. There was no special branch or
  barrier.
- **Run result:** **Partial.** Form filling worked, but the terminal POST
  returned HTTP 405, so the new verifier correctly records one attempted and
  zero verified submissions.
- **Failure / improvement:** The fixture endpoint cannot currently prove
  end-to-end submission; give it a valid success endpoint or same-page success
  state and rerun.
- **Requirements:** **Yes.** Basic discovery/entry is F1/F14, plausible
  synthetic values are F1.3.4/F7.1, evidence is F2, and outcome verification is
  F2.2.11.

### `site_b_legalaid` — per-load session token

- **Located / fields / actuation:** Yes; 7/7 fields were captured and all seven
  entries were verified.
- **Special behavior:** The tokenized page was traversed, but the audit did not
  separately prove replay across a freshly regenerated token. `legal_issue`
  and `case_description` were overclassified as sensitive.
- **Run result:** **Partial.** Field execution succeeded; submission was
  attempted but not verified.
- **Failure / improvement:** Add an explicit regenerate-token replay assertion,
  fix sensitivity semantics, and use a verifiable fixture result state.
- **Requirements:** **Yes.** Session-noise normalization is F2.5; retained
  script replay is F14/F9.12; sensitivity is F1.4/F7.

### `site_d_food` — malformed HTML

- **Located / fields / actuation:** Yes; all 9/9 expected controls were
  recovered from malformed markup and all nine entries were verified.
- **Special behavior:** The important success is resilient locator/extraction
  behavior despite broken HTML.
- **Run result:** **Partial.** The form was populated correctly, but its single
  submission attempt could not be verified.
- **Failure / improvement:** Retain this as a locator regression and add a
  verifiable completion response.
- **Requirements:** **Yes.** Resilient rendered extraction and locator repair
  are F1.2/F1.3.4/F14.

### `site_h_multiservice` — nested navigation maze

- **Located / fields / actuation:** Yes; the crawler found the intake through
  noisy nested navigation, captured 8/8 expected fields, and recorded 11
  verified entries across the visited states.
- **Special behavior:** Deep same-site navigation and unrelated page chrome
  did not prevent form selection.
- **Run result:** **Partial.** Discovery and filling succeeded, but submission
  was unverified.
- **Failure / improvement:** Add a fixture success state and a direct assertion
  that no unrelated form or navigation control was actuated.
- **Requirements:** **Yes.** Same-site discovery scope is F1.3/F3.1, and
  heuristic-free LLM-selected actuation is F13/F14.

### `site_z_interaction_gated` — form appears after trusted interaction

- **Located / fields / actuation:** Yes; pointer/scroll priming exposed the
  delayed form, all 4/4 fields were captured, and all four were verified.
- **Special behavior:** The interaction-gated JavaScript behavior was handled
  successfully without a hostname exception.
- **Run result:** **Partial.** Form execution worked; the terminal result was
  not verified.
- **Failure / improvement:** Preserve this as a browser-physics regression and
  add a verifiable terminal state.
- **Requirements:** **Yes.** Human-like preparation and settled sensing are
  within F1.3/F1.6/F8.7.1.

### `site_ab_decoy_forms` — four forms, only one real intake

- **Located / fields / actuation:** Yes; the real intake won over search and
  newsletter decoys, with 6/6 expected fields captured and executed.
- **Special behavior:** Decoy-form rejection succeeded.
- **Run result:** **Partial.** Correct form selection and entry worked, but the
  submission result was unverified.
- **Failure / improvement:** Add an assertion that decoy controls remain
  untouched and provide a verifiable completion state.
- **Requirements:** **Yes.** Multi-form/decoy coverage is explicitly in
  F8.7.1 and general semantic selection is F14.

## Sensitive, consent, upload, and multi-page forms

### `site_g_sensitive_nocaptcha` — sensitive fields, upload, and consent

- **Located / fields / actuation:** The corrective run retained 10/10 fields
  and verified 8 entries. It entered ordinary and sensitive-format fields,
  selected housing status, and checked consent; SSN last-four and the file
  upload were intentionally not actuated.
- **Special behavior:** Sections, privacy guidance, sensitivity, upload
  constraints, and consent were detected. The upload was marked sensitive
  although the oracle does not classify the control itself that way.
- **Run result:** **Partial but safely useful.** It retained populated evidence
  and halted as `could_not_test` rather than erasing the run.
- **Failure / improvement:** Define an explicit fixture-safe SSN-last-four
  policy, refine upload sensitivity, and only then test verified terminal
  submission.
- **Requirements:** **Yes/partial.** Sensitive/consent metadata is F1.4/F7;
  durable halts are F14.6. Upload execution belongs to F10.12 and is not built.

### `site_j_paginated` — three pages, repeatable group, upload, admin fields

- **Located / fields / actuation:** Yes; all three pages were traversed, 15/15
  fields were retained, 14 non-file values were verified, and the final
  submission was verified.
- **Special behavior:** Progression, server round trips, repeatable-member
  metadata, upload constraints, consent, signature/review controls, and
  staff-facing fields were captured. No document was uploaded.
- **Run result:** **Partial, not a safe pass.** The browser traversed all three
  pages and verified the HTTP terminal result, but later review found the
  complete replay entered consent and signature even though state safety had
  rejected both as protected.
- **Failure / improvement:** Make safety disposition binding through complete
  script assembly/replay, correct upload sensitivity, and add explicit
  repeatable-row/add-another actuation coverage.
- **Requirements:** **Mostly yes.** Multi-state traversal is F1/F13/F14 and
  repeatability/admin/consent metadata is F1.4. Harmless loopback upload
  validation is now F1.3.4.11; real document upload remains future F10.12.

**2026-07-26 manual-run correction:** `run_cf3a45c31cb045` started directly at
page 2 in Probe mode, not at canonical entry in fixture-submit mode. It filled
page 2 and reached page 3, then halted on protected consent/signature, but the
report retained only page-3 totals/evidence. The earlier blind run remains
evidence that browser mechanics reached all three pages, but not that the path
was safely valid. The later run proves canonical-entry detection, journey
aggregation, and prior-state retention are also unreliable and therefore
downgrades the general capability to Partial.

### `site_y_readback_echo` — sensitive value echoed on page two

- **Located / fields / actuation:** The target loaded and two model proposals
  completed, but locator repair exhausted on `monthly_income`; no durable
  fields, entries, or evidence survived the first-pass quality floor.
- **Special behavior:** The cross-page plaintext echo and required screenshot
  masking were not successfully exercised.
- **Run result:** **No.**
- **Failure / improvement:** Fix the income locator/readback path, retain the
  partial state, then verify that the echoed income is detected and masked in
  every stored screenshot.
- **Requirements:** **Partly.** Entry/readback is F1.3.4; real/sensitive
  evidence masking is F12 and is explicitly not built.

## Correctly branching forms

### `site_c_veterans` — one optional same-page branch

- **Located / fields / actuation:** Yes; 7/7 expected fields were retained, six
  entries were verified, and the discharge-status choice exposed a branch.
- **Special behavior:** The VA disability-rating reveal was detected and the
  crawler correctly halted with zero submissions.
- **Run result:** **Yes for discovery safety.**
- **Failure / improvement:** Emit the expected `unmappable_field` and
  `sensitive_field` diagnostics and later enumerate all alternatives through
  the formal F16 loop.
- **Requirements:** **Yes, but incomplete.** Branch discovery is F1.7/F16;
  the current conservative reveal halt is built, while exhaustive F16
  regeneration is not.

### `site_f_veterans_required` — required revealed branch field

- **Located / fields / actuation:** Yes; 7/7 expected fields were retained and
  six entries were verified before the required conditional field appeared.
- **Special behavior:** The required reveal was detected and correctly caused
  a no-submission branch halt.
- **Run result:** **Yes for discovery safety.**
- **Failure / improvement:** Add the missing structured sensitivity/unmappable
  diagnostics and convert the observed reveal into formal branch-scoped D2/D1
  regeneration.
- **Requirements:** **Yes, partially built.** Required conditional discovery
  is F1.7/F16 and fail-loud behavior is F1.8/F14.6.

### `site_i_dynamic_form` — three independent same-page branches

- **Located / fields / actuation:** Yes; nested navigation reached the form,
  nine base fields were entered, and branch-revealing values exposed seven
  additional visible controls.
- **Special behavior:** Applicant type, housing situation, and veteran status
  reveals were detected; the mutually exclusive `eviction_date` alternative
  was not exercised in the same run.
- **Run result:** **Yes for the required detect-and-abort outcome.** Branch
  evidence was retained and no submission was attempted.
- **Failure / improvement:** Re-baseline and enumerate every option so all
  eight conditional controls and their trigger lineage become a regenerated
  contract.
- **Requirements:** **Yes, partially built.** This is the core F16
  alternative-probe/change-map/regeneration requirement.

## Branching or companion behavior handled incorrectly

### `site_k_conditional` — cross-page wording depends on page-one answer

- **Located / fields / actuation:** Yes; 6/6 fields were captured and executed
  across the pages.
- **Special behavior:** The causal cross-page dependency was **not** detected.
- **Run result:** **No—unsafe false success.** It submitted and verified the
  fixture even though the correct behavior was to halt on cross-page
  branching.
- **Failure / improvement:** Compare each new state's wording/control facts
  with prior entered values, classify probable dependencies before
  terminality, and feed an additions-only delta into regeneration.
- **Requirements:** **Yes, not built.** Cross-state dynamics belong to
  F1.7/F16 and are called out as an open gap.

### `site_p_crosspage_echo` — distinctive prior answer echoed later

- **Located / fields / actuation:** Yes; three values were executed with seven
  evidence states.
- **Special behavior:** The distinctive last-name echo was not recognized as a
  probable dependency.
- **Run result:** **No—unsafe false success.** The fixture was submitted when
  the required outcome was a cross-page-branch halt.
- **Failure / improvement:** Add provenance-aware echo/dependency detection and
  test both `/intake` (must halt) and `/intake_safe` (must continue).
- **Requirements:** **Yes, not built.** This is F16 cross-state semantic
  change detection; sensitive output masking is also related to F12.

### `site_u_other_specify` — “Other” companion fields, not branching

- **Located / fields / actuation:** Yes; 7/7 controls were captured and five
  entries were verified.
- **Special behavior:** Both companion reveals were seen, but the framework
  misclassified a normal same-path “specify other” reveal as branching.
- **Run result:** **No for intended completion.** It halted conservatively and
  made no submission attempt.
- **Failure / improvement:** Represent `otherSpecifyFor` relationships
  explicitly and let the semantic layer distinguish mandatory companion
  completion from mutually exclusive behavioral branching.
- **Requirements:** **Yes, partially specified.** Companion relationships are
  in F1.4 and branch semantics in F16; reliable classification remains open.

### `site_v_slds_branching` — styled labels over invisible Salesforce controls

- **Located / fields / actuation:** The intended intake URL loaded and one
  model proposal completed, but no durable field contract or branch evidence
  survived.
- **Special behavior:** The label-driven SLDS choices and their two branch
  families were not successfully actuated or detected.
- **Run result:** **No.**
- **Failure / improvement:** Generate label-backed locator candidates from raw
  accessibility/DOM facts, verify exact choice readback, retain a loud partial
  artifact, and then detect the resulting visibility changes.
- **Requirements:** **Yes.** Styled-choice actuation and loud failures are
  F1.3.4/F1.8/F14.6; branch discovery is F16.

## Choice controls that must fail loudly

### `site_w_probe_lockout` — all choice actuation strategies fail

- **Located / fields / actuation:** The target loaded and received one model
  proposal, but 0/3 expected fields and no evidence were retained.
- **Special behavior:** The deliberately unactuatable housing group did not
  produce the required `probe_actuation_failed` outcome.
- **Run result:** **No.**
- **Failure / improvement:** Preserve the observed contract before probing and
  translate exhausted actuation/readback into a durable closed-code
  `could_not_test` halt.
- **Requirements:** **Yes.** F1.8, F14.6, and F16 explicitly require loud
  unverified-probe outcomes rather than certifying linear behavior.

### `site_x_hidden_choice` — hidden radios behind custom widget

- **Located / fields / actuation:** The target loaded and received one model
  proposal, but 0/3 expected fields and no evidence were retained.
- **Special behavior:** The unresolved hidden/custom contact-channel widget
  did not produce the required `probe_actuation_failed` record.
- **Run result:** **No.**
- **Failure / improvement:** Retain raw widget/control facts, let the model
  author a widget-facing locator when evidence supports one, and otherwise
  halt durably with the closed failure code.
- **Requirements:** **Yes.** Custom controls and fail-loud probe behavior are
  F1.3/F1.8/F14.6/F16.

## Access and human-verification barriers

### `site_e_housing` — sensitive form behind interactive CAPTCHA

- **Located / fields / actuation:** The target loaded and two model calls
  completed, but no fields, entries, screenshots, or CAPTCHA diagnostic were
  retained.
- **Special behavior:** Interactive CAPTCHA, full SSN, consent, and other
  sensitive metadata were not successfully represented in the final artifact.
- **Run result:** **No.**
- **Failure / improvement:** Detect the challenge before generation/actuation,
  retain a sensing screenshot plus conservative field/barrier inventory, and
  return a durable human-handoff result.
- **Requirements:** **Yes.** CAPTCHA handoff is F1.6/F8.9.6; sensitive and
  unmappable metadata is F1.4/F7; durable halt is F14.6.

### `site_m_login_gate` — credentials before intake

- **Located / fields / actuation:** The login surface loaded, but its username
  and password controls were not retained and no credentials were entered.
- **Special behavior:** Avoiding credential entry was safe, but the expected
  `login_required` diagnostic and durable evidence were missing.
- **Run result:** **No as an artifact, safe as non-actuation.**
- **Failure / improvement:** Convert protected-login classification into a
  retained blocker contract and human-handoff result rather than a
  quality-floor failure.
- **Requirements:** **Yes.** Credential blocking is F7/F14.1 and durable
  protected-state reporting is F14.6.

### `site_n_payment` — application fee and card controls

- **Located / fields / actuation:** The payment form loaded; no card or
  ordinary fields were actuated, but no durable 7-field contract survived.
- **Special behavior:** Avoiding payment entry was correct, yet the expected
  `payment_field` diagnostic was missing; one of two model calls failed.
- **Run result:** **No as an artifact, safe as non-actuation.**
- **Failure / improvement:** Recognize and retain payment controls from sensing
  facts, emit the closed blocker code, preserve screenshots, and halt before
  any card entry.
- **Requirements:** **Yes.** Payment blocking is F7/F14.1 and durable blocker
  retention is F14.6.

### `site_o_invisible_captcha` — score badge without interactive challenge

- **Located / fields / actuation:** Yes; 5/5 fields were captured and all five
  entries were verified.
- **Special behavior:** The invisible score-based CAPTCHA was correctly treated
  as non-interactive, so traversal continued.
- **Run result:** **Partial.** Negative-control CAPTCHA handling passed, but the
  terminal submission result was unverified.
- **Failure / improvement:** Retain an explicit `captcha_kind=invisible`
  diagnostic and add a verifiable fixture result.
- **Requirements:** **Yes.** The interactive-versus-invisible distinction is
  explicitly F8.9.6.

### `site_t_challenges` — text and image human-verification challenges

- **Located / fields / actuation:** The text-challenge route loaded and two
  model calls completed, but no durable evidence or
  `interactive_captcha` diagnostic survived. The image route was not part of
  this primary pass.
- **Special behavior:** Neither the retained text-challenge halt nor separate
  vision-based recognition of `/intake_image` was proven.
- **Run result:** **No.**
- **Failure / improvement:** Recognize both challenge variants from sensing,
  never solve or click them, and retain screenshots plus a durable handoff
  artifact.
- **Requirements:** **Yes.** Challenge recognition/handoff is F1.6/F8.9.6 and
  screenshot-as-sensing is F2/F5.

## Gated, ambiguous, edge-case, and drift forms

### `site_l_gated` — scroll unlock, accordion, details, iframe notice

- **Located / fields / actuation:** The site loaded and the LLM examined 12
  apparent states, but the loop never retained the five expected fields or
  useful evidence.
- **Special behavior:** The combined scroll-to-enable consent, accordion,
  `<details>`, iframe scroll surface, and dangerous navigational expander were
  not completed as a coherent script.
- **Run result:** **No.**
- **Failure / improvement:** Track already-completed gate actions in state
  identity, distinguish disclosure from navigation, settle after each
  LLM-authored action, and retain partial evidence if progress stalls.
- **Requirements:** **Yes.** Expandables, nested scrolling, iframes, safe
  obstacle traversal, waits, and evidence are F1.3/F1.6/F2/F14.

### `site_q_ambiguous_submit` — two submit-typed controls, no progress cue

- **Located / fields / actuation:** The target loaded and four model proposals
  completed, but no 4-field contract or evidence survived.
- **Special behavior:** No unsafe submission occurred, but the required
  `ambiguous_submit` diagnostic was not retained.
- **Run result:** **No as an artifact, conservatively safe in behavior.**
- **Failure / improvement:** Make the terminality ambiguity decision a durable
  result with populated evidence and halt before either submit-typed control.
- **Requirements:** **Yes.** The ambiguous-terminal rider is F7.2.1 and durable
  partial reporting is F14.6.

### `site_r_edgecases` — headings, fixed rows, empty select, SSN, custom widget

- **Located / fields / actuation:** The target loaded and three model proposals
  completed, but 0/10 expected fields and no screenshots survived.
- **Special behavior:** Heading-derived sections, non-repeatable member rows,
  missing select options, full SSN blocking, custom widgets, and prose-only
  upload rules were not successfully retained.
- **Run result:** **No.**
- **Failure / improvement:** Preserve extraction before actuation, emit
  `missing_options`/`failed_extract`/sensitive/unmappable codes, and retain
  prose-derived upload constraints and section membership.
- **Requirements:** **Yes.** Sections/guidance/options/uploads/custom controls
  are F1.4; loud extraction failures are F1.8/F14.6.

### `site_s_variants` — same URL with structural and cosmetic variants

- **Located / fields / actuation:** The base variant succeeded with 4/4 fields
  captured and executed.
- **Special behavior:** The v2 optional-addition, v3 required-addition, and v4
  cosmetic reorder were not exercised in this production-generation pass.
- **Run result:** **Partial.** Baseline form execution worked, but submission
  was unverified and this run says nothing about drift correctness.
- **Failure / improvement:** Run all four server variants through the shared
  production fingerprint/lineage path, assert no bump for reorder, expansion
  for optional addition, and halt/review for required addition.
- **Requirements:** **Yes, partially built.** Fingerprints are F2.5, drift and
  versions are F9/F15, and the production lineage decision path remains
  partial.

## Overall answer

- **Form location/navigation:** Strong on ordinary pages, nested navigation,
  decoy forms, interaction-gated rendering, and the three-page fixture.
- **Field detection:** Strong on the successful ordinary runs, but the original
  quality floor erased all useful contract output for 11 still-unrepaired
  blocker/edge fixtures.
- **Field execution:** Reliable when the generated locator was safe and
  ordinary; weak on protected fields, custom widgets, hidden/styled choices,
  and one income readback.
- **Unique metadata:** Consent, sections, guidance, options, sensitive fields,
  uploads, repeatability, admin fields, and some branches were detected in
  successful runs. Structured diagnostic codes and causal cross-page dynamics
  remain inconsistent.
- **End-to-end success:** No linear fixture currently proves a clean, safe,
  complete generated-script pass. `site_j_paginated` is the strongest
  three-page mechanics result, but its older replay violated safety
  dispositions and its newer partial run lost earlier-state reporting.
  `site_c_veterans`, `site_f_veterans_required`, and `site_i_dynamic_form`
  correctly achieved their required branch-detect-and-halt outcome. Many
  otherwise well-filled fixtures are partial because their terminal result
  could not be verified.
- **Requirements coverage:** The fixture behaviors are overwhelmingly already
  represented in `FEATURES.md`. The principal gaps are implementation gaps,
  especially F14.6–F14.10 durable repair/replay, F16 conditional/cross-state
  discovery, F15 production drift decisions, F1.3.4.11 fixture upload,
  F10.12 real-document upload, and F12 masking—not missing requirements.
