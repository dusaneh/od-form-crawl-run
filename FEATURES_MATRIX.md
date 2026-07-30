# FormWeave Feature Matrix

Concise implementation index for `FEATURES.md`, `FEATURES_CONTRACT_V2.md`, and
`FEATURES_PHASE2.md`. See `FEATURE_STATUS.md` and `CORPUS_PROGRESS.md` for
evidence and qualifications.

- Snapshot: 2026-07-30, America/Los_Angeles
- **Built**: implemented and verified through the active production path.
- **Partial**: usable implementation exists, but some contract or acceptance
  work remains.
- **Not built**: specified but not adequately implemented.

| Area | Requirement | Status | Current reality |
| --- | --- | --- | --- |
| Phase 1 scope | `F0` | **Partial** | Local LLM generation, immutable retained scripts, deterministic replay, loopback submission, and evidence work. Canonical D1/D3, D5, locale, drift, and certification remain. |
| Crawl execution | `F1` | **Partial** | Production Playwright uses per-state LLM proposals and LLM-authored script replay; current verification found 244/244 expected fields across 37 fixtures with zero failed runs. Canonical D1/D3 routing and public D5 remain. |
| Canonical journey | `F1.1.3 / F1.3.5` | **Partial** | Multi-page journeys accumulate states, fields, actions, and evidence through terminal result. Explicit mid-flow warnings and missing-predecessor coverage remain. |
| Synthetic values and readback | `F1.3.4.1 / F1.3.4.4` | **Built** | Format-plausible synthetic values are entered through exact generated mechanics and verified by browser readback. |
| Question/section model | `F1.4` | **Partial** | First-class guidance, section trees, group legends, option labels, raw controls, and critical flags are retained. Some canonical mappings and policy semantics remain. |
| Browser/API input contract | `F1.4.2.1–F1.4.2.4` | **Built** | Public input schemas retain browser-native formats, native HTML names, option labels, hints, read-only/multiple state, ranges, length/pattern rules, numeric step, and the synthetic payload used by the pinned crawl script; malformed values fail before browser launch. |
| Guidance records | `F1.4.6.1–F1.4.6.6` | **Built for production generation** | Scoped, classified, deduplicated guidance with provenance reaches model input, scripts, reports, and UI. |
| Section tree | `F1.4.7.1–F1.4.7.3` | **Built** | DOM-derived sections retain ordered question membership, guidance references, and unsectioned fallback. |
| Option meaning | `F1.4.8` | **Built** | Group legends and per-option value/label meaning are retained separately. |
| Consent/action semantics | `F1.4.9 / F7.1.1–F7.1.4` | **Partial — origin-neutral implementation built** | Public/local Probe uses the same accepted LLM-script policy for synthetic upload, consent, authorization, terms, review, acknowledgement, and signature modeling while blocking terminal submit. Three-page J verified the local path with all legacy flags false; fresh public proof remains. |
| Predictable obstacles | `F1.6` | **Partial** | Stable waits, scrolling, and pointer priming are generic physics. Disclosures and gates are LLM-authored. Cookie controls are traversal infrastructure and must not enter applicant contracts or API schemas; complete enforcement and broad public-site proof remain. |
| Same-page branching | `F1.7.9 / F16.6–F16.14` | **Built for one level** | Every safe observed choice is probed from a clean baseline, one reveal level is populated/verified, sibling variants are replayed, inactive sibling values are cleared from script-declared controls, and the selected branch is restored before submit. A second reveal level halts. |
| Cross-page branching | `F1.7.10 / F16.8–F16.13` | **Detection-only; execution intentionally unsupported** | Cross-page dependence is assessed after advance. Detected or uncertain cases halt before dependent-page actuation and never submit. Executing alternate cross-page branches is outside the current product scope; K and P verified the detection/halt boundary. |
| Quality floor / partial artifacts | `F1.8` | **Built for current corpus** | Empty false success is rejected; safe halts retain contracts, exchanges, failure history, and screenshots. All 37 full-cohort runs retained evidence. |
| Locale determinism | `F1.9` | **Not built** | Locale pinning, language mismatch detection, locale variants, and locale-separated lineage are absent. |
| Evidence/provenance | `F2` | **Partial** | HTML, JSON, JSONL, model provenance, script plans, sensing captures, populated/branch/transition/result screenshots, upload readback, and result criteria persist locally. Phase 2 sensitive masking remains. |
| Completion verification | `F2.2.11` | **Built** | Crawl submission success requires exact terminal actuation and explicit rendered markers. Normal forms also require submit/write transport; a client-side completion requires a material state change and separately reports that basis. A GET to a confirmation-looking URL is insufficient. |
| Cumulative evidence | `F2.2.12–F2.3.5` | **Built** | Earlier states survive later halts; branch probes, populated variants, selected-branch restoration, transitions, and submitted states are clickable in the UI. |
| Structural fingerprint | `F2.5.4–F2.5.11` | **Built** | One versioned shared module derives canonical DOM facts, normalizes unstable IDs/session noise, and is used by production, harnesses, lineage, and tests. |
| Control-plane UI | `F3` | **Partial** | UI exposes runs, contracts, sections, guidance, option coverage, four-layer exchanges, script version/path/hash, fields, diagnostics, and clickable evidence. The API console also presents fetched-report evidence and sectioned field metadata. Certification/version browsing remain. |
| Traversal settings | `F3.12` | **Partial** | Settings persist and hard boundaries are enforced; free-form operator instructions are not yet an active planning input. |
| Coverage presentation | `F3.15` | **Built for current branch envelope** | Option probes, branch-producing outcomes, populated variants, final selected branch, and explicit unsupported boundaries are reported. |
| Live traversal review | `F3.16 / F3.18` | **Built for generated/replayed states** | Collapsible state cards expose sensing → semantic decision → stored script → execution/readback, with generated versus retained timing and direct evidence links. |
| Completion reporting | `F3.2 / F3.5 / F3.17` | **Built** | UI separates attempts from verified submissions and shows transport facts, rendered markers/confidence, model provenance, and submitted-state screenshots. |
| API-console report presentation | `F3.19` | **Built** | Completed report responses render crawl totals, clickable authenticated evidence thumbnails, and readable forms grouped by section with field types and critical flags; raw JSON remains inspectable. |
| API-console crawl-value prefill | `F3.19.5` | **Built** | The schema call publishes crawler-used synthetic values and initializes editable run fields from them, with reset and test-data labeling. |
| Local-first ownership | `F4` | **Built** | UI, API, Playwright, reports, logs, scripts, fixtures, and configuration still run locally. An optional hosted path is now explicit rather than contradicting local ownership. |
| Loopback opt-in | `F4.1.3` | **Built** | Localhost/127.0.0.0/8 require explicit per-run authority; fixture submission is rejected for public/private-network targets. |
| Hosted gateway | `F4.6.1` | **Built locally; Heroku release pending** | One public process serves the API landing page and assets, protects `/control-plane` and `/api-console`, proxies `/api/*`, and runs API/UI children on loopback-only ports. |
| UI/API authentication | `F4.6.2–F4.6.4` | **Built for staging** | Individual scrypt-hashed accounts, DB sessions, five-attempt/15-minute lockout, audit events, and hashed/scoped Bearer tokens pass production smoke checks. Tenant authorization and external identity-provider integration remain. |
| Hosted safety/storage | `F4.6.5–F4.6.7` | **Partial** | Hosted headful/private-network requests are rejected and bootstrap secrets are Git-ignored. PostgreSQL is durable, but screenshot/object storage and durable browser workers remain. |
| Model enrichment | `F5` | **Built for production generation** | Each novel state supplies bounded screenshot, DOM, accessibility, section, guidance, option, prior-state, and failure context with provenance. Retained replay intentionally makes zero traversal-model calls. |
| Observability | `F6` | **Built** | Health, progress, events, reports, screenshots, scripts, and interrupted-run reconciliation are local and inspectable. |
| Crawl submission boundary | `F3.13 / F7` | **Built; fresh public proof pending** | `submit: false` keeps terminal submission browser-blocked. `submit: true` permits only the exact LLM-authored terminal action with synthetic values for public or allowed-local targets. Interactive CAPTCHA and required login disqualify; payment remains prohibited. |
| Synthetic crawl uploads | `F1.3.4.11 / F3.13.5 / F8.7.8` | **Built locally; public proof pending** | The crawler generates a harmless in-memory file from observed constraints, executes only an LLM-authored upload action, verifies browser readback, and retains non-user-data evidence. Policy/code no longer depend on loopback component flags. |
| Automated tests | `F8` | **Partial** | Production build and 78 automated checks pass, with one optional PostgreSQL integration check skipped without its dedicated test URI. Authenticated production smoke and the blind corpus are green; public D5 remains. |
| Execution-conformance corpus | `F8.9` | **Built — conformance only** | Ground-truth-derived planners validate executor mechanics only and are never flexibility evidence. |
| Test submission capture | `F8.9.9–F8.9.9.2` | **Built** | Registered public/local testforms capture endpoints support latest/list/clear, dispatcher cookies, GET/POST/JS capture semantics, and schema-to-native-name payload comparison across multi-step entries. |
| Scorer-only answer keys | `F8.9.8 / F8.10.3` | **Built** | The 37-site production audit froze every run before any oracle read, then scored offline and refreshed per-form `LEARNINGS.md`. |
| Production corpus acceptance | `F8.10.4–F8.10.6` | **Built for supported envelope** | Current combined post-fix verification is 37/37 functional, 244/244 fields, evidence on 37/37, zero failed runs, and 25/25 verified submissions. Strict exact-oracle parity is 25/37 because twelve sensitivity-policy/oracle disagreements remain for human review. |
| Script lineage/replay | `F9.12` | **Partial — production reuse verified** | Immutable hash-linked `data/generated-scripts/<artifact>/vN` plans preflight and replay with zero traversal-model calls. Canonical Gate-3 D1 and automatic N+1 remain separate. |
| Version selection | `F9.13` | **Not built** | UI/API cannot browse, pin, or select an explicit artifact version. |
| Human certification | `F9.14` | **Not built** | No human-only certification state machine or approved coverage record exists. |
| Crawl/form identity and approval | `F9.15 / F10.14.1` | **Built initial API slice** | Unique crawl IDs and per-crawl form IDs are persisted. Approval pins the exact artifact/script/hash; recrawls create new form IDs and do not inherit approval. |
| Contract line | `F13` | **Partial — blocked by D5** | Typed D2/D8/D6/D7/F13.5 boundaries and one isolated D3 executor exist; production retained replay is not yet routed exclusively through canonical D1/D3. |
| Phase 1 generation loop | `F14` | **Partial** | Novel-state generation, immutable storage, bounded repair, branch expansion, validation replay, and retained zero-LLM replay work in production. Canonical compiler/loader routing and general N+1 lineage remain. |
| Binding safety disposition | `F14.1.1` | **Built** | Only accepted model-authored actions enter executable plans; protected authority is rechecked at assembly and replay. |
| Execution-based drift | `F15` | **Not built** | Runtime fault classification, re-crawl verdicts, staleness, and execution-aware version decisions are absent. |
| Public D5 | `F8.10 / D5` | **Not passed** | The local rehearsal and production corpus are strong, but the frozen-framework unseen public generation/replay/oracle attempt remains. |
| Phase 2 real-data runner | `F10 / F10.14` | **Partial — vertical slice verified** | Crawl returns typed schema; exact form approval, validated input, deterministic dry-run/submit execution, redacted logs, structured result status, and staging authentication work. Coverage certification, tenant authorization, cancellation, public validation, and security hardening remain. |
| Real document uploads | `F10.12` | **Partial** | Inline base64 client files receive type/extension/size preflight, in-memory Playwright upload, and readback verification. Authenticated document references and full masking/leak proof remain. |
| Coverage-gated execution | `F10.13` | **Not built** | Real execution is not restricted to the exact human-certified coverage set. |
| Runner conditional deltas | `F11` | **Not built** | Phase 2 does not consume/enforce expand-only deltas. |
| Sensitive evidence masking | `F12` | **Partial** | Input values/file bytes are not persisted, events redact values, supplied scalar echoes/visible controls are redacted, and authenticated staging transport is implemented. Comprehensive evidence leak tests, tenant authorization, and production secret-management review remain. |

## Current non-D1 planner inventory

These historical planners are retained for mechanics evidence and do not
satisfy D1 or the active production-generation architecture:

| Planner path | Scope | Classification |
| --- | --- | --- |
| `local/recon-scripts/united-way-housing.mjs` | United Way | Hand-authored historical planner |
| `local/recon-scripts/pge-carefera.mjs` | PG&E | Hand-authored historical planner |
| `local/recon-scripts/fixture-suite.mjs` | Loopback fixtures | Hand-authored conformance planner |
| `local/recon-scripts/holdout-fcrb-housing.mjs` | FCR_B | Assisted frozen-framework planner |
| `test-sites/localhost-corpus.mjs` | Local corpus | Ground-truth-derived conformance planner |

The active production path does not import the answer key or use these
planners to decide actions.
