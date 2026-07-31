# FormWeave LLM-to-Playwright Script Contract

| Document field | Value |
| --- | --- |
| FormWeave software version | `0.1.0` |
| Document contract version | `1.0` |
| Source revision reviewed | `0821dbf83cad45c898613e18efbee8d2c5553966` |
| Semantic prompt version | `gate2-semantic-state-v4` |
| D1 compiler version | `gate3-d1-compiler-v1` |
| Generated-script interface | `13` |
| Result-envelope schema | `1` |
| Last verified | 2026-07-30 |

This document describes the implemented contract at the source revision above.
It is versioned with FormWeave `0.1.0`; a behavioral change to the model input,
required model output, compiler, or generated-script interface requires this
document to be revised.

## 1. The important architectural distinction

The LLM does **not** return arbitrary Playwright JavaScript.

The implemented flow is:

1. Shared browser sensing renders a live state and creates typed DOM,
   accessibility, screenshot, and history observations.
2. The LLM returns a strict JSON semantic/action proposal. It decides what the
   controls mean, the synthetic values and probes to use, and which observed
   action is progression or terminal submission.
3. Deterministic validators reject unsafe, incomplete, contradictory, or
   schema-invalid proposals.
4. The D1 compiler binds the LLM-selected source facts to observed selectors
   and produces a closed, versioned module.
5. The shared D3 executor uses Playwright to replay that compiled script.

Therefore, “LLM-generated Playwright script” means **LLM-authored decisions
compiled into a restricted Playwright execution module**. Shared code may
validate, canonicalize, compile, and replay those decisions. It may not invent
a click, field choice, progression, or terminal action.

## 2. Model and request configuration

Semantic generation uses the OpenAI Responses API:

```text
POST https://api.openai.com/v1/responses
```

Configuration:

| Setting | Implemented behavior |
| --- | --- |
| API key | `OPENAI_KEY`, falling back to `OPENAI_API_KEY` |
| Model | `OPENAI_SEMANTIC_MODEL`, then `OPENAI_MODEL`, then `gpt-5.4-mini` |
| Storage | `store: false` |
| Screenshot detail | `high` |
| Structured output | Strict JSON Schema |
| Maximum output | 12,000 tokens |
| Timeout | `FORMWEAVE_SEMANTIC_TIMEOUT_MS`, default 360 seconds, capped at 360 seconds |
| Schema repair attempts | Up to 4 |

The system message is:

> You generate auditable form metadata and proposed actions. You never actuate
> sites, never use hidden test knowledge, and never override deterministic
> safety.

The user message contains:

1. The semantic-generation instructions described below.
2. A JSON serialization of the complete observation envelope.
3. The full-page PNG screenshot as a separate `input_image`.
4. On a retry, the deterministic validation error and an instruction to return
   a corrected complete proposal.

## 3. What goes into the LLM

### 3.1 Live observation envelope

Each novel browser state supplies:

```json
{
  "schemaVersion": 1,
  "observedAt": "2026-07-30T20:00:00.000Z",
  "url": "https://example.org/intake",
  "normalizedRoute": "/intake",
  "locale": "en-US",
  "title": "Shelter Intake",
  "heading": "Contact information",
  "controls": [],
  "actions": [],
  "sections": [],
  "guidance": [],
  "challengeSignals": [],
  "accessibilitySnapshot": {},
  "screenshot": {
    "sha256": "…",
    "byteLength": 183421,
    "mediaType": "image/png"
  },
  "priorStates": [],
  "existingContract": null
}
```

The screenshot bytes are not embedded in that JSON. They are attached to the
same model request as a high-detail image. The hash and byte length in the JSON
bind the image to the observation and provenance.

### 3.2 DOM control facts

`controls` contains browser-observed facts, not model inference. Depending on
the element, these include:

- stable fact ID;
- tag and native input type;
- current visibility, enabled/disabled, and required state;
- name, ID, autocomplete, placeholder, pattern, min/max/step and length
  constraints when present;
- displayed label, group legend, section text, help text and validation text;
- select/radio/checkbox option labels and raw submitted values;
- generated selector candidates tied to that exact observed element;
- frame information where applicable.

Example:

```json
{
  "factId": "control_0",
  "tag": "input",
  "rawType": "date",
  "name": "dob",
  "id": "dob",
  "rawLabel": "Date of Birth",
  "required": true,
  "visible": true,
  "disabled": false,
  "options": [],
  "selectorCandidates": [
    "#dob",
    "form:nth-of-type(1) input:nth-of-type(3)"
  ]
}
```

### 3.3 Action facts

`actions` contains visible browser facts for buttons, links, submit controls,
disclosure controls, and other candidate actions. Facts include visible text,
HTML semantics, href/type, accessibility state, and selector candidates.

These facts do not authorize a click. The LLM must select one fact and classify
it as an `advance`, `terminal_submit`, or another typed action.

### 3.4 Page meaning and visual context

The request also contains:

- the accessibility snapshot;
- visible section/fieldset/heading structure;
- visible guidance, instructions, warnings, privacy and eligibility text;
- CAPTCHA or challenge signals;
- the screenshot;
- prior generated states;
- the existing expand-only semantic contract;
- runtime validation feedback after a failed proposal or locator check;
- an optional first-level same-page branch scope.

`priorStates` and `existingContract` prevent the model from silently renaming or
redefining already-published fields and states.

### 3.5 What is deliberately not supplied

The generator must not receive:

- localhost fixture ground truth or answer keys;
- expected test results;
- scorer output before generation freezes;
- real applicant data during Phase 1 generation;
- arbitrary filesystem access or secrets;
- permission to actuate the page directly.

## 4. The semantic prompt’s required behavior

The current prompt requires the model to:

- select exactly one journey serving OneDegree's essential-resource access
  mission, prioritizing intake, application, enrollment, service request,
  referral, eligibility, or direct-access registration and using a contact or
  request-information form only as fallback;
- exclude alternate forms and unrelated information, provider,
  administrator, donation, volunteer, newsletter, survey, marketing, or
  general-feedback journeys;
- use only supplied DOM facts, accessibility data, screenshot, prior states,
  existing contract, and runtime feedback;
- return additions only and preserve globally unique stable keys;
- create a field for every visible applicant control;
- preserve exact option labels and raw option values;
- preserve section membership and first-class scoped guidance;
- provide format-valid, conspicuously synthetic test values;
- classify sensitive and administrative fields narrowly;
- classify every proposed operation with a closed action kind;
- open every visible collapsed details, accordion, expando, or disclosure once
  through an exact observed action, then re-sense the resulting state;
- treat cookie controls as session infrastructure, preferring rejection of
  non-essential cookies and never adding them to applicant/API fields;
- generate probes for every safe option of each select, radio group, checkbox,
  and switch so conditional fields can be discovered;
- select exactly one observed progression action for the state;
- distinguish nonterminal advance from terminal submission;
- treat uploads, legal acceptance, CAPTCHA, login, credentials, payment, and
  terminal submission as protected action types;
- copy resolution hints only from observed selector candidates;
- correct rejected proposals using deterministic validation feedback;
- limit a scoped branch proposal to the supplied first-level branch facts.

Important prompt constraints include:

- format validity takes priority over putting words into format-strict inputs;
- numeric values must be plausible for the question, not just HTML-valid;
- a visible submit-looking control is not proof that discovery is complete;
- the model must expose conditional behavior rather than choose values that
  avoid it;
- CAPTCHA, credential, login, and payment actions are classified but remain
  subject to deterministic disqualification/safety rules.
- shared browser physics performs a fixed pointer sweep and bounded reversible
  scrolling of the document, reachable frames, and nested scroll containers
  before novel-state sensing; these are not model-created form actions and are
  never used or described as CAPTCHA evasion.

The exact current prompt is implemented in
`local/semantic/semantic-generator.mjs` in `promptText()`. The strict output
schema is implemented in `local/semantic/proposal-schema.mjs`.

## 5. What must come out of the LLM

The response must be one JSON object with no additional properties:

```json
{
  "schemaVersion": 1,
  "proposalId": "proposal_contact_state_v1",
  "state": {
    "key": "contact_information",
    "description": "Applicant contact information",
    "kind": "form",
    "normalizedRoute": "/intake",
    "visibleControlKeys": ["date_of_birth", "first_name"],
    "sectionKeys": ["contact"],
    "progression": {
      "key": "continue_to_household",
      "kind": "advance",
      "rationale": "The visible Continue control advances to the next step."
    }
  },
  "fields": [
    {
      "key": "first_name",
      "rawLabel": "First Name",
      "controlType": "text",
      "required": true,
      "options": [],
      "sectionKey": "contact",
      "guidanceRefs": [],
      "testValue": "FORMWEAVE TEST",
      "sensitive": false,
      "administrative": false,
      "resolutionHints": ["#first-name"],
      "sourceFactIds": ["control_0"]
    },
    {
      "key": "date_of_birth",
      "rawLabel": "Date of Birth",
      "controlType": "date",
      "required": true,
      "options": [],
      "sectionKey": "contact",
      "guidanceRefs": ["dob_help"],
      "testValue": "1980-12-14",
      "sensitive": false,
      "administrative": false,
      "resolutionHints": ["#dob"],
      "sourceFactIds": ["control_1"]
    }
  ],
  "sections": [
    {
      "key": "contact",
      "label": "Contact Information",
      "parentKey": null,
      "order": 0,
      "guidanceRefs": [],
      "fieldKeys": ["date_of_birth", "first_name"]
    }
  ],
  "guidance": [
    {
      "key": "dob_help",
      "scopeKind": "question",
      "scopeKey": "date_of_birth",
      "kind": "help",
      "text": "Enter your date of birth.",
      "sourceFactIds": ["guidance_0"]
    }
  ],
  "mechanics": {
    "fieldTargets": [
      {
        "fieldKey": "date_of_birth",
        "selectors": ["#dob"]
      },
      {
        "fieldKey": "first_name",
        "selectors": ["#first-name"]
      }
    ],
    "progressionTarget": {
      "key": "continue_to_household",
      "kind": "advance",
      "sourceFactId": "action_0",
      "selectors": ["form:nth-of-type(1) button:nth-of-type(1)"]
    }
  },
  "proposedActions": [
    {
      "proposalId": "fill_first_name",
      "kind": "field_actuation",
      "targetKey": "first_name",
      "value": "FORMWEAVE TEST",
      "rationale": "Required visible text field."
    },
    {
      "proposalId": "fill_date_of_birth",
      "kind": "field_actuation",
      "targetKey": "date_of_birth",
      "value": "1980-12-14",
      "rationale": "Required native date field; Playwright uses ISO date input."
    },
    {
      "proposalId": "advance_contact",
      "kind": "advance",
      "targetKey": "continue_to_household",
      "value": null,
      "rationale": "Observed Continue control is nonterminal."
    }
  ],
  "rationale": [
    {
      "subjectKey": "continue_to_household",
      "evidence": "The page says Step 1 of 3 and the control is labeled Continue.",
      "confidence": "high"
    }
  ]
}
```

Required top-level collections are:

| Property | Required meaning |
| --- | --- |
| `state` | Stable state identity, visible contract, and progression meaning |
| `fields` | Semantic field definitions, options, test values, sensitivity, provenance |
| `sections` | Ordered grouping and field membership |
| `guidance` | Form-, section-, or question-scoped explanatory records |
| `mechanics` | DOM-fact-bound targets selected by the model |
| `proposedActions` | Typed decisions; never a claim that an action already occurred |
| `rationale` | Evidence and confidence supporting important interpretations |

Closed action kinds are:

```text
field_actuation
choice_probe
advance
terminal_submit
captcha_interaction
login_interaction
payment_interaction
credential_interaction
upload_interaction
legal_acceptance_interaction
```

## 6. Deterministic validation and repair

Before compilation, FormWeave:

1. Canonically sorts set-like arrays and removes duplicates.
2. Makes DOM-observed native type and requiredness authoritative.
3. Compiles selectors from the exact declared source facts.
4. Enforces first-level branch scope when present.
5. Validates the strict semantic-proposal schema.
6. Validates action safety and coverage.
7. Rejects locators not tied to the declared observed facts.

Schema-invalid model output is sent back to the model with the precise error,
up to four attempts. Runtime locator or transition failures may trigger a fresh
state proposal with structured failure history and new sensing. Deterministic
code does not repair a failed proposal by inventing a different action.

## 7. What the compiler generates

The compiler produces three immutable, related artifacts:

1. A D2 semantic contract: fields, sections, guidance, states, transitions, test
   values, and expected runtime state identities.
2. A D1 descriptor: version pins, allowed/protected fields, selectors, and
   state progression mechanics.
3. A small generated JavaScript module that contains the descriptor and exposes
   the restricted runtime.

Example descriptor:

```json
{
  "interfaceVersion": 1,
  "compilerVersion": "gate3-d1-compiler-v1",
  "artifactId": "form_0123456789abcdef01234567",
  "contractVersion": 1,
  "scriptVersion": 1,
  "fingerprintAlgorithmVersion": "recon-only",
  "allowedSyntheticFieldKeys": ["date_of_birth", "first_name"],
  "protectedFieldKeys": [],
  "fields": {
    "first_name": { "selectors": ["#first-name"] },
    "date_of_birth": { "selectors": ["#dob"] }
  },
  "states": {
    "contact_information": {
      "progression": {
        "key": "continue_to_household",
        "kind": "advance",
        "selectors": ["form:nth-of-type(1) button:nth-of-type(1)"]
      }
    }
  }
}
```

The generated source is intentionally simple:

```js
import { createGeneratedD1Runtime } from "<allowlisted-runtime-module>";

export const D1_INTERFACE_VERSION = 1;
export const descriptor = Object.freeze(/* encoded compiled descriptor */);

export function createRuntime(options) {
  return createGeneratedD1Runtime(descriptor, options);
}
```

The closed template forbids dynamic imports, `require`, `eval`,
`new Function`, `process`, and `globalThis`. A source hash, contract hash,
model, prompt version, script version, and parent script version are stored in
the manifest.

## 8. Generated-script construction input

The compiled module is instantiated with runtime dependencies:

```js
const runtime = generatedModule.createRuntime({
  page,                 // a Playwright Page owned by FormWeave
  contract,             // the exact pinned D2 contract
  evidenceSink,         // optional evidence persistence callback
  allowReadLikePost     // narrowly scoped intermediate-round-trip policy
});
```

The generated script does not receive an API key, ground truth, arbitrary
browser object, database access, or permission to choose new controls.

## 9. Generated-script execution input

The primary state execution call is:

```js
await runtime.execute({
  scriptVersion: 1,
  contractVersion: 1,
  stateKey: "contact_information",
  inputs: {
    first_name: "Ann",
    date_of_birth: "1980-12-14"
  },
  directive: {
    progressionPermission: "allowed"
  },
  mode: "real_data"
});
```

The exact structured properties are:

| Property | Requirement |
| --- | --- |
| `scriptVersion` | Must equal the loaded immutable script version |
| `contractVersion` | Must equal the script’s pinned contract version |
| `stateKey` | Must name a state in the pinned D2 contract |
| `inputs` | Object keyed by semantic field key; values are scalar field values |
| `directive` | `null`, simple progression permission, or a typed choice-probe directive |
| `mode` | `probe`, `validation_replay`, `fixture`, or `real_data` |

A typed choice-probe directive has this shape:

```json
{
  "schemaVersion": 1,
  "stateKey": "housing",
  "fieldKey": "housing_status",
  "value": "rent",
  "progressionPermission": "forbidden"
}
```

`runtime.defaultInputs(stateKey)` returns the approved synthetic `testValue`
map for safe, non-protected fields in that state. Real-data execution supplies
client values by the same semantic field keys.

Native browser formats remain authoritative at actuation time. For example, an
HTML `input[type=date]` is filled through Playwright with `YYYY-MM-DD`, even if
the browser visually displays `MM/DD/YYYY`.

## 10. Generated-script execution output

Every state execution returns a validated result envelope:

```json
{
  "schemaVersion": 1,
  "invocationId": "invoke_1234",
  "artifactId": "form_0123456789abcdef01234567",
  "versions": {
    "artifact": 1,
    "contract": 1,
    "fingerprintAlgorithm": "recon-only",
    "script": 1
  },
  "stateKey": "contact_information",
  "fieldResults": [
    {
      "key": "first_name",
      "status": "verified",
      "attempted": true,
      "resolved": true,
      "entered": true,
      "verified": true,
      "failureCode": null,
      "detail": null
    },
    {
      "key": "date_of_birth",
      "status": "verified",
      "attempted": true,
      "resolved": true,
      "entered": true,
      "verified": true,
      "failureCode": null,
      "detail": null
    }
  ],
  "stateOutcome": "completed",
  "progression": {
    "kind": "advance",
    "outcome": "confirmed",
    "attempted": true,
    "confirmed": true,
    "failureCode": null,
    "beforeIdentity": {
      "normalizedRoute": "/intake",
      "visibleControlKeys": ["date_of_birth", "first_name"],
      "progression": {
        "key": "continue_to_household",
        "kind": "advance"
      }
    },
    "afterIdentity": {
      "normalizedRoute": "/intake/household",
      "visibleControlKeys": ["household_size"],
      "progression": {
        "key": "continue_to_review",
        "kind": "advance"
      }
    },
    "matchedSuccessorStateKey": "household"
  },
  "observedStateIdentity": {
    "normalizedRoute": "/intake/household",
    "visibleControlKeys": ["household_size"],
    "progression": {
      "key": "continue_to_review",
      "kind": "advance"
    }
  },
  "evidenceRefs": [
    "evidence://run_123/contact_information/before_advance.png"
  ],
  "faultClass": null
}
```

Field statuses are `unattempted`, `verified`, or `failed`. Closed field failure
codes include:

```text
locator_unresolved
actuation_unverified
could_not_test
validation_blocked
type_mismatch
drift_undeclared_required
```

Progression is independently reported as not attempted, confirmed, blocked, or
failed, with before/after visibility-aware state identity and a matched
successor state. This prevents a click or HTTP response alone from being
reported as successful traversal.

Terminal submission is additionally controlled by the crawl/run boundary. A
script may identify the terminal action while a dry run blocks it. An
authorized submission must actuate that exact retained LLM-authored action and
then satisfy the stored rendered-result success criteria.

## 11. Source-of-truth implementation files

| Responsibility | File |
| --- | --- |
| Live DOM/accessibility/screenshot sensing | `local/semantic/novel-state-input.mjs` |
| Model request, prompt, retries and provenance | `local/semantic/semantic-generator.mjs` |
| Strict model output schema | `local/semantic/proposal-schema.mjs` |
| Deterministic action safety | `local/semantic/proposal-safety.mjs` |
| D2 contract and D1 descriptor compilation | `local/compiler/d1-compiler.mjs` |
| Closed generated JavaScript template | `local/compiler/d1-source.mjs` |
| Restricted generated runtime | `local/executor/generated-d1-runtime.mjs` |
| Playwright execution and result production | `local/executor/executor.mjs` |
| Runtime input/output validation | `local/contracts/runtime-schemas.mjs` |
