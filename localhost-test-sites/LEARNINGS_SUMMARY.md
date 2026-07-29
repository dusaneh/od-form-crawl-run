# FormWeave blind production-crawl corpus — 2026-07-25

## Method

All 27 primary localhost forms were exercised through the production
LLM-generation path. Each run received only the live page's DOM, accessibility
facts, screenshots, and prior generated state context. The site-specific
`ground_truth.yaml` was opened only after that site's run reached a terminal
status. Ground truth was used only by the scorer and to write the site's
`LEARNINGS.md`; it was never supplied to generation or replay.

The retained machine-readable batches are:

- `data/production-corpus-audit/2026-07-25T18-25-23-815Z/summary.json`
- `data/production-corpus-audit/2026-07-25T19-01-38-021Z/summary.json`

`site_a_shelter` and `site_i_dynamic_form` were reviewed manually before the
25-site batch. Every one of the 27 site directories now contains a
`LEARNINGS.md`.

## Result

This was useful discovery evidence, not a passing acceptance run.

- 27/27 primary forms were attempted.
- In the original 25-site batch, 13 runs completed and 12 collapsed at the
  artifact quality floor.
- 12 of the 25 batch runs captured every top-level expected field.
- 13 retained traversal evidence; three detected a same-page reveal and three
  produced a verified fixture submission.
- The targeted `site_g_sensitive_nocaptcha` rerun after the durable-partial
  fix retained 10/10 fields, eight verified entries, two screenshots, and a
  safe `could_not_test` halt instead of losing the artifact.
- The corrected `site_i_dynamic_form` run selected branch-revealing values,
  observed seven newly visible controls, retained branch evidence, and made
  zero submission attempts.

No form is being declared certified from this pass. Every site learning file
records its exact run, evidence count, field comparison, flags, and remaining
discrepancies.

## What generalized successfully

- The LLM authored all control actuation in the production path; the framework
  performed deterministic replay and readback only.
- Decoy forms, malformed HTML, nested navigation, interaction-gated rendering,
  invisible score-based protection, and a paginated three-state form were
  handled without site-specific production branches.
- Format-aware synthetic data now uses reserved, valid-looking values such as
  `99999` for postal code, `555` telephone numbers, and
  `example.invalid` addresses. Numeric prompts now request plausible semantic
  ranges instead of generic filler such as `99`.
- Populated/pre-transition screenshots contain the values that were actually
  read back from the controls.
- Terminal submission now requires an observable successful outcome. A submit
  event followed by HTTP 405 is retained as
  `fixture_terminal_submission_unverified`, never as success.
- A required protected or unactuatable field now produces a durable
  `could_not_test` result with the captured contract, successful readbacks,
  logs, and evidence instead of failing the entire artifact quality floor.
- Section membership, guidance references, group legends, and per-option
  labels survive the generated-plan/report merge.

## Highest-priority discrepancies

1. **Cross-page dynamics are unsafe.** `site_k_conditional` and
   `site_p_crosspage_echo` were submitted even though the oracle requires a
   cross-page dependency halt. State-to-state causal discovery and its
   additions-only contract update are still missing.
2. **Reveal does not always mean branch.** `site_u_other_specify` exposed
   companion fields and was conservatively halted as branching. The semantic
   layer must distinguish a normal same-path reveal from mutually exclusive
   behavioral branching.
3. **Protected-field policy is too coarse.** Full SSN, credentials, uploads,
   payment, CAPTCHA, and legal acceptance must remain blocked, but a fixture
   SSN-last-four value needs an explicit safe policy if it is to be actuated.
4. **Challenge/gate halts must be durable artifacts.** The first batch lost
   several CAPTCHA, ambiguous-submit, login, or probe-failure contracts at the
   quality floor. The durable `could_not_test` repair is verified on one
   representative form and should be regression-tested across those classes.
5. **Gated-state looping remains.** `site_l_gated` used 12 model examinations
   without reaching terminality. The generated loop revisited disclosure
   states instead of recognizing completed gate work.
6. **Locator repair remains incomplete.** `site_y_readback_echo` exhausted
   repair for `monthly_income`; styled/hidden choice fixtures also need
   retained failure evidence and closed failure codes.
7. **Structured diagnostics lag facts.** Several forms captured sensitive or
   unmappable controls correctly but omitted the oracle's corresponding
   run-level diagnostic code. File-upload sensitivity is also overclassified
   relative to some fixture oracles.
8. **Variant and negative paths need separate runs.** The primary pass tested
   the baseline `site_s_variants` route, not every server-switched variant or
   alternate safe cross-page route.

## Changes made from this pass

- Fixed the runtime repair crash caused by reassigning an immutable capture.
- Strengthened synthetic postal and numeric-value generation and validation.
- Added outcome-based terminal-submission verification.
- Added visibility-delta sensing after LLM-authored choice actuation.
- Added durable partial artifacts for required generated fields that cannot be
  safely actuated or verified.
- Prevented raw/generated field merge duplication and propagated sections and
  guidance into the final field contract.
- Made report findings derive branch and submission claims from measured
  outcomes.
- Added `test-sites/production-corpus-audit.mjs` and per-form learning output.

## Next acceptance work

The next corpus pass should target the failure classes above rather than chase
an aggregate percentage. It should first rerun the challenge/protected-field
forms to prove durable halts, then implement and test cross-page dependency
discovery, companion-versus-branch classification, and gated-state loop
termination. Only after those are green should this corpus be used as evidence
for canonical D1 reuse or certification.
