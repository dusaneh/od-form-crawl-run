import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SEMANTIC_PROMPT_VERSION,
  SemanticProposalError,
  validateSemanticProposal,
} from "../local/semantic/proposal-schema.mjs";
import {
  classifyProtectedField,
  conspicuouslySyntheticFallback,
  isConspicuouslySynthetic,
  validateProposalSafety,
} from "../local/semantic/proposal-safety.mjs";
import {
  canonicalizeSemanticProposal,
  generateSemanticProposal,
} from "../local/semantic/semantic-generator.mjs";
import { writeSemanticGenerationRecord } from "../local/semantic/semantic-record-store.mjs";
import { reconcileCanonicalProfileKey } from "../local/semantic/canonical-profile.mjs";
import { normalizeReportedField } from "../local/semantic/reporting-taxonomy.mjs";
import {
  generateDynamicsAssessment,
  validateDynamicsAssessment,
} from "../local/semantic/dynamics-assessment.mjs";
import {
  buildTransitionStateDelta,
  contextualDynamicsFallback,
  enforceStateDeltaAssessment,
} from "../local/semantic/state-delta.mjs";
import {
  generateSubmissionResultAssessment,
  validateSubmissionResultAssessment,
  verifyStoredSubmissionResultCriteria,
} from "../local/semantic/submission-result-assessment.mjs";
import {
  assertExecutablePlanSafety,
  choiceProbeCoverageIssues,
  descriptiveSensitivityDecision,
  disclosureBlockedFieldIssues,
  exhaustedDisclosureProgressionIssues,
  fieldActionMetrics,
  generatedFieldActions,
  inferJourneyEntryMode,
  mergeTraversalResults,
  mergeObservedFields,
  pendingDisclosureIssues,
  policySensitivityDecision,
  policySensitiveField,
  radioGroupProposalIssues,
  reportedFieldSensitivity,
  replayAuthorityIssues,
  terminalEligibilityIssues,
  shouldRecordPassiveReadback,
  virtualInventoryFields,
  verifyFixtureSubmissionOutcome,
} from "../local/production-generated-traversal.mjs";
import { expectedDependencyProbeValues } from "../local/traversal-special-rules.mjs";

test("typed state deltas treat cross-page URL reflection as transport evidence", () => {
  const delta = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before: {
      url: "https://example.invalid/intake",
      controls: [],
      sections: [],
      guidance: [],
    },
    after: {
      url: "https://example.invalid/step-2?last_name=FORMWEAVE%20TEST",
      title: "Step 2",
      heading: "Continue",
      controls: [
        { rawType: "tel", visible: true, disabled: false, rawLabel: "Phone" },
      ],
      sections: [],
      guidance: [],
    },
    enteredValues: [
      { fieldKey: "last_name", label: "Last name", value: "FORMWEAVE TEST" },
    ],
  });
  assert.equal(delta.classification, "transport_carry_forward");
  assert.equal(delta.blocking, false);
  assert.equal(delta.terminalAuthorization, "eligible_for_semantic_review");
  assert.deepEqual(delta.surfaces, ["url_query"]);

  const enforced = enforceStateDeltaAssessment(
    {
      schemaVersion: 1,
      assessmentId: "assessment_1",
      transitionKind: "page_advance",
      outcome: "independent",
      confidence: "medium",
      evidence: [],
      rationale: "The next page appears linear.",
    },
    delta,
  );
  assert.equal(enforced.overridden, false);
  assert.equal(enforced.assessment.outcome, "independent");
});

test("typed dynamics fallback retains a page advance after repeated contradictory labels", () => {
  const corrected = contextualDynamicsFallback(
    {
      schemaVersion: 1,
      assessmentId: "assessment_01",
      transitionKind: "page_advance",
      outcome: "cross_page_dependency",
      confidence: "high",
      evidence: ["The displayed value differs from the entered value."],
      rationale: "The different value is an answer echo.",
    },
    {
      transitionKind: "page_advance",
      outcome: "independent",
      issue: "A mismatched value cannot prove an answer echo.",
    },
  );
  assert.equal(corrected.outcome, "independent");
  assert.equal(corrected.confidence, "medium");
  validateDynamicsAssessment(corrected, "page_advance");
});

test("typed state deltas reject a labeled readback that differs from the entered value", () => {
  const before = {
    url: "https://example.invalid/step-1",
    controls: [],
    sections: [],
    guidance: [],
  };
  const after = {
    url: "https://example.invalid/step-2",
    controls: [],
    sections: [],
    guidance: [
      {
        rawText:
          "You told us your household size: 3. Now tell us about recent work.",
      },
    ],
  };
  const stateDelta = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after,
    enteredValues: [
      {
        fieldKey: "household_size",
        label: "Household Size *",
        value: 2,
        sensitive: false,
      },
    ],
  });
  assert.equal(stateDelta.hasReadbackMismatch, true);
  assert.equal(stateDelta.readbackMismatches.length, 1);
  assert.equal(
    Object.hasOwn(stateDelta.readbackMismatches[0], "value"),
    false,
  );
  const assessment = {
    schemaVersion: 1,
    assessmentId: "assessment_mismatched_readback",
    transitionKind: "page_advance",
    outcome: "cross_page_dependency",
    confidence: "high",
    evidence: ["The page says the prior household size was 3."],
    rationale:
      "The tailored sentence is an answer echo and therefore changes the next page.",
  };
  const enforced = enforceStateDeltaAssessment(assessment, stateDelta);
  assert.equal(enforced.overridden, true);
  assert.equal(enforced.assessment.outcome, "independent");
  assert.equal(
    enforced.overrideReason,
    "mismatched_readback_without_dependency_evidence",
  );

  const causalDelta = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after: {
      ...after,
      guidance: [
        {
          rawText:
            "You told us your household size: 3. Because you selected emergency assistance, this page now requires an additional document.",
        },
      ],
    },
    enteredValues: [
      {
        fieldKey: "household_size",
        label: "Household Size *",
        value: 2,
        sensitive: false,
      },
    ],
  });
  assert.equal(causalDelta.hasAnswerConditionedWording, true);
  assert.equal(
    enforceStateDeltaAssessment(assessment, causalDelta).overridden,
    false,
  );
});

test("typed state deltas route rendered reflections to semantic review without deciding meaning", () => {
  const before = {
    url: "https://example.invalid/start",
    title: "Start",
    controls: [],
    sections: [],
    guidance: [],
  };
  const enteredValues = [
    { fieldKey: "case_name", label: "Case name", value: "FORMWEAVE ALPHA" },
  ];
  const editable = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after: {
      url: "https://example.invalid/details",
      heading: "Continue FORMWEAVE ALPHA",
      controls: [
        { rawType: "text", visible: true, disabled: false, rawLabel: "Details" },
      ],
      sections: [],
      guidance: [],
    },
    enteredValues,
  });
  assert.equal(editable.blocking, false);
  assert.equal(
    editable.classification,
    "rendered_reflection_requires_semantic_review",
  );
  assert.equal(editable.semanticReviewRequired, true);
  assert.ok(editable.surfaces.includes("visible_text"));

  const readOnly = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after: {
      url: "https://example.invalid/review",
      heading: "Review FORMWEAVE ALPHA",
      controls: [],
      sections: [],
      guidance: [],
    },
    enteredValues,
  });
  assert.equal(
    readOnly.classification,
    "rendered_reflection_requires_semantic_review",
  );
  assert.equal(readOnly.blocking, false);
});

test("typed state deltas retain sensitive numeric readbacks for masking without calling them dependencies", () => {
  const delta = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before: { url: "https://example.invalid/start", controls: [] },
    after: {
      url: "https://example.invalid/review?income=9999",
      heading: "Review monthly income: $9,999",
      controls: [],
    },
    enteredValues: [
      {
        fieldKey: "monthly_income",
        label: "Monthly income",
        value: "9999",
        sensitive: true,
      },
    ],
  });
  assert.equal(delta.classification, "passive_readback");
  assert.equal(delta.semanticReviewRequired, false);
  assert.equal(delta.blocking, false);
  assert.ok(delta.reflections.some((item) => item.sensitive));
});

test("typed state deltas correct readback-only dependency claims but preserve causal evidence", () => {
  const enteredValues = [
    { fieldKey: "household_size", value: "FORMWEAVE ALPHA" },
  ];
  const before = { url: "https://example.invalid/start", controls: [] };
  const passive = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after: {
      url: "https://example.invalid/review",
      heading: "You told us FORMWEAVE ALPHA. Review your answers.",
      controls: [],
    },
    enteredValues,
  });
  const claimedDependency = {
    schemaVersion: 1,
    assessmentId: "assessment_readback",
    transitionKind: "page_advance",
    outcome: "cross_page_dependency",
    confidence: "high",
    evidence: ["The page repeats FORMWEAVE ALPHA."],
    rationale: "The displayed wording references the prior response.",
  };
  const corrected = enforceStateDeltaAssessment(claimedDependency, passive);
  assert.equal(corrected.overridden, true);
  assert.equal(corrected.assessment.outcome, "independent");

  const causal = buildTransitionStateDelta({
    transitionKind: "page_advance",
    before,
    after: {
      url: "https://example.invalid/details",
      heading:
        "Because you selected FORMWEAVE ALPHA, this explanation is required.",
      controls: [],
    },
    enteredValues,
  });
  assert.equal(causal.hasAnswerConditionedWording, true);
  const preserved = enforceStateDeltaAssessment(claimedDependency, causal);
  assert.equal(preserved.overridden, false);
  assert.equal(preserved.assessment.outcome, "cross_page_dependency");

  const taskBound = enforceStateDeltaAssessment(
    {
      ...claimedDependency,
      rationale:
        "The echoed name identifies the residency record being updated, so the prior answer changes the target of the task.",
    },
    passive,
  );
  assert.equal(taskBound.overridden, false);
  assert.equal(taskBound.assessment.outcome, "cross_page_dependency");
});

test("reported sensitivity stays descriptive while runtime policy may be stricter", () => {
  assert.equal(
    reportedFieldSensitivity({ semanticSensitive: false, sensitive: true }),
    false,
  );
  assert.equal(reportedFieldSensitivity({ sensitive: true }), true);
  assert.equal(
    reportedFieldSensitivity({
      key: "monthly_income",
      controlType: "text",
      semanticSensitive: false,
      sensitive: true,
    }),
    true,
  );
  assert.equal(
    reportedFieldSensitivity({
      key: "date_of_birth",
      controlType: "date",
      semanticSensitive: false,
      sensitive: true,
    }),
    true,
  );
  assert.equal(
    reportedFieldSensitivity({
      key: "disability_rating",
      rawLabel: "Disability rating percentage",
      controlType: "number",
      semanticSensitive: true,
      sensitive: true,
    }),
    false,
  );
  assert.equal(
    descriptiveSensitivityDecision({
      key: "disability_rating",
      rawLabel: "Disability rating percentage",
      controlType: "number",
      semanticSensitive: true,
    }).code,
    "descriptive_disability_classification",
  );
});

test("independent semantic review resolves rendered reflection into passive readback evidence", () => {
  assert.equal(
    shouldRecordPassiveReadback(
      { outcome: "independent" },
      {
        classification: "rendered_reflection_requires_semantic_review",
        hasRenderedReflection: true,
        reflections: [{ fieldKey: "case_name", surface: "visible_text" }],
      },
    ),
    true,
  );
  assert.equal(
    shouldRecordPassiveReadback(
      { outcome: "cross_page_dependency" },
      { hasRenderedReflection: true, reflections: [{}] },
    ),
    false,
  );
});

test("canonical profile reconciliation promotes only exact high-confidence identities", () => {
  assert.equal(reconcileCanonicalProfileKey({ key: "first_name" }), "first_name");
  assert.equal(reconcileCanonicalProfileKey({ name: "email_address" }), "email");
  assert.equal(reconcileCanonicalProfileKey({ id: "dob" }), "date_of_birth");
  assert.equal(
    reconcileCanonicalProfileKey({ key: "preferred_language" }),
    "primary_language",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "disability_rating" }),
    "disability_status",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "children_count" }),
    "num_children",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ canonicalProfileKey: "children_count" }),
    "num_children",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "referred_by" }),
    "referral_source",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "address_line_1" }),
    "current_address",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "postal_code" }),
    "zip_code",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "field_0",
      canonicalProfileKey: "unmappable",
      rawIdentity: { name: "first_name", id: "first-name" },
    }),
    "first_name",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "current_situation",
      canonicalProfileKey: "housing_status",
    }),
    "housing_status",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "relationship_status" }),
    "unmappable",
  );
  assert.equal(
    reconcileCanonicalProfileKey({ key: "card_expiry" }),
    "unmappable",
  );
});

test("physical observed-field merging preserves the richest record without duplicate controls", () => {
  const merged = mergeObservedFields([
    {
      stateOrdinal: 1,
      name: "email",
      control: "email",
      selector: "#email",
      selectorCandidates: ["#email"],
      canonicalProfileKey: "unmappable",
      entryStatus: "not_attempted",
      documentOrdinal: 4,
    },
    {
      stateOrdinal: 1,
      name: "email",
      control: "email",
      selector: "#email",
      selectorCandidates: ["#email", "[name=email]"],
      canonicalProfileKey: "email",
      entryStatus: "entered",
      documentOrdinal: 4,
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].entryStatus, "entered");
  assert.equal(merged[0].canonicalProfileKey, "email");
  assert.deepEqual(merged[0].selectorCandidates, ["#email", "[name=email]"]);
});

test("field reporting metrics ignore choice probes and reflect verified entries", () => {
  const actions = [
    ...Array.from({ length: 9 }, (_, index) => ({
      category: "field_entry",
      label: `Field ${index + 1}`,
      outcome: "landed",
    })),
    ...Array.from({ length: 13 }, (_, index) => ({
      category: "choice_probe",
      label: `Option ${index + 1}`,
      outcome: "landed",
    })),
  ];
  assert.deepEqual(fieldActionMetrics(actions), {
    fieldsPlanned: 9,
    fieldsAttempted: 9,
    fieldsVerified: 9,
    attemptedFieldFailures: 0,
  });
});

test("required review confirmations are one-way acceptance controls, not reversible branch probes", () => {
  const review = {
    key: "review_confirm",
    label: "Please confirm the information is correct before submitting",
    rawLabel: "Please confirm the information is correct before submitting",
    controlType: "checkbox",
    required: true,
    actuate: true,
    legalAcceptanceType: "reviewConfirmation",
  };
  assert.deepEqual(expectedDependencyProbeValues(review), []);
  assert.equal(
    classifyProtectedField({
      field: review,
      fact: {
        rawType: "checkbox",
        rawLabel: review.label,
        name: "review_confirm",
      },
    }),
    "legal_acceptance_interaction",
  );
});

test("canonicalization routes ordinary review-checkbox proposals through the typed acceptance boundary", () => {
  const raw = proposal();
  const observed = observation();
  const normalized = canonicalizeSemanticProposal(raw, null, observed);
  const action = normalized.proposal.proposedActions.find(
    (item) => item.proposalId === "action_agree",
  );
  assert.equal(action.kind, "legal_acceptance_interaction");
  assert.equal(action.value, true);
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "typed_acceptance_action_boundary",
    ),
  );
});

test("final reporting taxonomy normalizes aliases, contact sensitivity, and search controls", () => {
  assert.deepEqual(
    normalizeReportedField({
      key: "address",
      name: "address",
      control: "search",
      sensitive: true,
    }),
    {
      key: "address",
      name: "address",
      control: "text",
      sensitive: false,
      canonicalProfileKey: "current_address",
      descriptiveSensitivityDecision: {
        sensitive: false,
        code: "descriptive_non_sensitive_current_address",
        source: "shared_reporting_policy",
        taxonomyVersion: "1.1.0",
        rationale:
          "The canonical field identity has a stable descriptive sensitivity classification.",
      },
    },
  );
  const newsletter = normalizeReportedField({
    key: "newsletter_email",
    control: "email",
    sensitive: true,
  });
  assert.equal(newsletter.canonicalProfileKey, "unmappable");
  assert.equal(newsletter.sensitive, false);
});

test("canonicalization supplies a policy-owned synthetic fallback for unsafe ordinary text", () => {
  const raw = proposal();
  raw.fields.find((item) => item.key === "display_name").testValue = "No";
  raw.proposedActions.find((item) => item.targetKey === "display_name").value = "No";
  const normalized = canonicalizeSemanticProposal(raw, null, observation());
  const action = normalized.proposal.proposedActions.find(
    (item) => item.targetKey === "display_name",
  );
  assert.equal(action.value, "FORMWEAVE TEST");
  assert.equal(
    normalized.proposal.fields.find((item) => item.key === "display_name")
      .testValue,
    "FORMWEAVE TEST",
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "policy_synthetic_text_fallback",
    ),
  );
  assert.equal(
    conspicuouslySyntheticFallback(
      { controlType: "text", key: "provider" },
      { rawType: "text", minLength: "2", maxLength: "40" },
    ),
    "FORMWEAVE TEST",
  );
});

function observation() {
  return {
    schemaVersion: 1,
    observedAt: "2026-07-24T20:00:00.000Z",
    url: "http://127.0.0.1:9001/unknown/",
    normalizedRoute: "/unknown",
    locale: "en-US",
    title: "Unknown form",
    heading: "Application",
    controls: [
      {
        factId: "field_0",
        tag: "input",
        rawType: "text",
        name: "display_name",
        id: "display_name",
        rawLabel: "Display name",
        groupLegend: "",
        description: "Use a test name.",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "Applicant",
        selectorCandidates: ['#display_name', 'input[name="display_name"]'].sort(),
      },
      {
        factId: "field_1",
        tag: "input",
        rawType: "password",
        name: "password",
        id: "password",
        rawLabel: "Password",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: "current-password",
        required: true,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "Applicant",
        selectorCandidates: ["#password", 'input[name="password"]'].sort(),
      },
      {
        factId: "field_2",
        tag: "input",
        rawType: "file",
        name: "document",
        id: "document",
        rawLabel: "Upload document",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: false,
        visible: true,
        disabled: false,
        options: [],
        sectionText: "Applicant",
        selectorCandidates: ["#document", 'input[name="document"]'].sort(),
      },
      {
        factId: "field_3",
        tag: "input",
        rawType: "checkbox",
        name: "agree",
        id: "agree",
        rawLabel: "I agree to the legal terms",
        groupLegend: "",
        description: "",
        placeholder: null,
        autocomplete: null,
        required: true,
        visible: true,
        disabled: false,
        options: [{ value: "on", label: "I agree to the legal terms" }],
        sectionText: "Applicant",
        selectorCandidates: ["#agree", 'input[name="agree"]'].sort(),
      },
    ],
    actions: [
      {
        factId: "action_0",
        tag: "button",
        rawType: "button",
        rawText: "Next",
        visible: true,
        disabled: false,
        href: null,
        selectorCandidates: ["#next"],
        formMethod: "GET",
        formAction: "http://127.0.0.1:9001/unknown/",
      },
    ],
    sections: [{ factId: "section_0", rawText: "Applicant" }],
    guidance: [
      { factId: "guidance_0", rawText: "Use synthetic information." },
    ],
    challengeSignals: [],
    accessibilitySnapshot: "- heading \"Application\"\n- textbox \"Display name\"",
    screenshot: {
      sha256: "a".repeat(64),
      byteLength: 8,
      mediaType: "image/png",
    },
    priorStates: [{ key: "prior_state", description: "Prior" }],
    existingContract: null,
  };
}

function field({
  key,
  rawLabel,
  controlType,
  factId,
  selector,
  testValue,
  options = [],
}) {
  return {
    key,
    rawLabel,
    controlType,
    required: true,
    options,
    sectionKey: "applicant",
    guidanceRefs: ["synthetic_guidance"],
    testValue,
    sensitive: controlType === "password",
    administrative: false,
    resolutionHints: [selector],
    sourceFactIds: [factId],
  };
}

function proposal() {
  return {
    schemaVersion: 1,
    proposalId: "proposal_unknown_state",
    state: {
      key: "unknown_state",
      description: "Applicant details",
      kind: "form",
      normalizedRoute: "/unknown",
      visibleControlKeys: [
        "agree_terms",
        "display_name",
        "document",
        "password",
      ],
      sectionKeys: ["applicant"],
      progression: {
        key: "next",
        kind: "advance",
        rationale: "The visible control says Next and is not terminal.",
      },
    },
    fields: [
      field({
        key: "agree_terms",
        rawLabel: "I agree to the legal terms",
        controlType: "checkbox",
        factId: "field_3",
        selector: "#agree",
        testValue: true,
        options: [{ value: "on", label: "I agree to the legal terms" }],
      }),
      field({
        key: "display_name",
        rawLabel: "Display name",
        controlType: "text",
        factId: "field_0",
        selector: "#display_name",
        testValue: "FORMWEAVE TEST",
      }),
      field({
        key: "document",
        rawLabel: "Upload document",
        controlType: "file",
        factId: "field_2",
        selector: "#document",
        testValue: null,
      }),
      field({
        key: "password",
        rawLabel: "Password",
        controlType: "custom",
        factId: "field_1",
        selector: "#password",
        testValue: "FORMWEAVE TEST PASSWORD",
      }),
    ],
    sections: [
      {
        key: "applicant",
        label: "Applicant",
        parentKey: null,
        order: 0,
        guidanceRefs: ["synthetic_guidance"],
        fieldKeys: [
          "agree_terms",
          "display_name",
          "document",
          "password",
        ],
      },
    ],
    guidance: [
      {
        key: "synthetic_guidance",
        scopeKind: "section",
        scopeKey: "applicant",
        kind: "instruction",
        text: "Use synthetic information.",
        sourceFactIds: ["guidance_0"],
      },
    ],
    mechanics: {
      fieldTargets: [
        { fieldKey: "agree_terms", selectors: ["#agree"] },
        { fieldKey: "display_name", selectors: ["#display_name"] },
        { fieldKey: "document", selectors: ["#document"] },
        { fieldKey: "password", selectors: ["#password"] },
      ],
      progressionTarget: {
        key: "next",
        kind: "advance",
        sourceFactId: "action_0",
        selectors: ["#next"],
      },
    },
    proposedActions: [
      {
        proposalId: "action_agree",
        kind: "field_actuation",
        targetKey: "agree_terms",
        value: true,
        rationale: "Exercise the checkbox.",
      },
      {
        proposalId: "action_name",
        kind: "field_actuation",
        targetKey: "display_name",
        value: "FORMWEAVE TEST",
        rationale: "Exercise the text field.",
      },
      {
        proposalId: "action_document",
        kind: "upload_interaction",
        targetKey: "document",
        value: null,
        rationale: "Upload is protected.",
      },
      {
        proposalId: "action_password",
        kind: "field_actuation",
        targetKey: "password",
        value: "FORMWEAVE TEST PASSWORD",
        rationale: "Credential is protected.",
      },
      {
        proposalId: "action_next",
        kind: "advance",
        targetKey: "next",
        value: null,
        rationale: "Advance to the next nonterminal state.",
      },
      {
        proposalId: "action_submit",
        kind: "terminal_submit",
        targetKey: "submit",
        value: null,
        rationale: "Terminal action is protected.",
      },
      {
        proposalId: "action_captcha",
        kind: "captcha_interaction",
        targetKey: "captcha",
        value: null,
        rationale: "CAPTCHA action is protected.",
      },
      {
        proposalId: "action_login",
        kind: "login_interaction",
        targetKey: "login",
        value: null,
        rationale: "Login action is protected.",
      },
      {
        proposalId: "action_payment",
        kind: "payment_interaction",
        targetKey: "payment",
        value: null,
        rationale: "Payment action is protected.",
      },
      {
        proposalId: "action_credential",
        kind: "credential_interaction",
        targetKey: "credential",
        value: null,
        rationale: "Credential action is protected.",
      },
    ],
    rationale: [
      {
        subjectKey: "unknown_state",
        evidence: "Visible controls and Next action are present.",
        confidence: "high",
      },
    ],
  };
}

test("canonicalization makes native select options and values DOM-authoritative", () => {
  const observed = observation();
  observed.controls[0] = {
    ...observed.controls[0],
    tag: "select",
    rawType: null,
    options: [
      { value: "", label: "Select" },
      { value: "1", label: "1" },
      { value: "6+", label: "6+" },
    ],
  };
  const draft = proposal();
  const select = draft.fields.find((item) => item.key === "display_name");
  select.controlType = "select";
  select.options = [
    { value: "", label: "Choose" },
    { value: "1", label: "One" },
    { value: "6", label: "Six or more" },
  ];
  select.testValue = "6+";
  const action = draft.proposedActions.find(
    (item) => item.targetKey === "display_name",
  );
  action.value = "6";

  const normalized = canonicalizeSemanticProposal(draft, null, observed);
  const fieldResult = normalized.proposal.fields.find(
    (item) => item.key === "display_name",
  );
  const actionResult = normalized.proposal.proposedActions.find(
    (item) => item.targetKey === "display_name",
  );
  assert.deepEqual(fieldResult.options, observed.controls[0].options);
  assert.equal(fieldResult.testValue, "6+");
  assert.equal(actionResult.value, "6+");
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "dom_authoritative_select_options",
    ),
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "dom_authoritative_select_test_value",
    ),
  );
});

test("canonicalization replaces an invented select value with an observed safe value", () => {
  const observed = observation();
  observed.controls[0] = {
    ...observed.controls[0],
    tag: "select",
    rawType: null,
    options: [
      { value: "", label: "Select" },
      { value: "bridge", label: "Bridge" },
      { value: "rapid", label: "Rapid" },
    ],
  };
  const draft = proposal();
  const select = draft.fields.find((item) => item.key === "display_name");
  select.controlType = "select";
  select.options = [{ value: "invented", label: "Invented" }];
  select.testValue = "invented";
  const action = draft.proposedActions.find(
    (item) => item.targetKey === "display_name",
  );
  action.value = "invented";

  const normalized = canonicalizeSemanticProposal(draft, null, observed);
  const fieldResult = normalized.proposal.fields.find(
    (item) => item.key === "display_name",
  );
  const actionResult = normalized.proposal.proposedActions.find(
    (item) => item.targetKey === "display_name",
  );
  assert.equal(fieldResult.testValue, "bridge");
  assert.equal(actionResult.value, "bridge");
});

test("targeted semantic repair drafts compose with the prior valid candidate", () => {
  const prior = proposal();
  const correction = structuredClone(prior);
  correction.proposalId = "proposal_targeted_correction";
  correction.fields = prior.fields.filter(
    (item) => item.key === "display_name",
  );
  correction.mechanics.fieldTargets = prior.mechanics.fieldTargets.filter(
    (item) => item.fieldKey === "display_name",
  );
  correction.proposedActions = prior.proposedActions.filter(
    (item) => ["display_name", "next"].includes(item.targetKey),
  );
  correction.fields[0].testValue = "FORMWEAVE TEST REPAIRED";
  correction.proposedActions.find(
    (item) => item.targetKey === "display_name",
  ).value = "FORMWEAVE TEST REPAIRED";
  const observed = observation();
  observed.runtimeValidationFeedback = {
    priorProposalId: prior.proposalId,
    priorProposal: prior,
    issues: [
      {
        targetKey: "display_name",
        problem: "The primary action requires correction.",
      },
    ],
    instruction: "Correct only the listed target.",
  };

  const normalized = canonicalizeSemanticProposal(
    correction,
    null,
    observed,
  );

  assert.equal(normalized.proposal.fields.length, prior.fields.length);
  assert.equal(
    normalized.proposal.mechanics.fieldTargets.length,
    prior.mechanics.fieldTargets.length,
  );
  assert.equal(
    normalized.proposal.fields.find(
      (item) => item.key === "display_name",
    ).testValue,
    "FORMWEAVE TEST REPAIRED",
  );
  assert.ok(
    normalized.proposal.fields.some((item) => item.key === "document"),
  );
  assert.ok(
    normalized.proposal.proposedActions.some(
      (item) => item.targetKey === "document",
    ),
  );
  assert.ok(
    normalized.normalizations.some(
      (item) =>
        item.kind === "compose_targeted_repair_with_prior_candidate",
    ),
  );
  validateSemanticProposal(normalized.proposal);
});

test("Gate 2 proposal validation is typed and expand-only", () => {
  const value = proposal();
  assert.equal(validateSemanticProposal(value), value);
  assert.throws(
    () =>
      validateSemanticProposal(value, {
        fields: [{ key: "display_name" }],
        sections: [],
        guidance: [],
        states: [],
      }),
    SemanticProposalError,
  );
  assert.throws(
    () =>
      validateSemanticProposal({
        ...value,
        state: { ...value.state, visibleControlKeys: ["password", "display_name"] },
      }),
    /sorted and unique/,
  );
});

test("canonicalization drops redundant immutable contract declarations", () => {
  const raw = proposal();
  const existing = {
    fields: [structuredClone(raw.fields.find((item) => item.key === "display_name"))],
    sections: [],
    guidance: [],
    states: [],
  };
  const normalized = canonicalizeSemanticProposal(raw, existing, null);
  assert.equal(
    normalized.proposal.fields.some((item) => item.key === "display_name"),
    false,
  );
  assert.equal(
    normalized.proposal.mechanics.fieldTargets.some(
      (item) => item.fieldKey === "display_name",
    ),
    false,
  );
  assert.equal(
    normalized.proposal.proposedActions.some(
      (item) => item.targetKey === "display_name",
    ),
    false,
  );
  assert.ok(normalized.proposal.state.visibleControlKeys.includes("display_name"));
  assert.doesNotThrow(() =>
    validateSemanticProposal(normalized.proposal, existing),
  );
});

test("model proposal canonicalization fixes only set ordering and opaque IDs", () => {
  const raw = proposal();
  raw.state.visibleControlKeys = [
    "password",
    "action_0",
    "document",
    "display_name",
    "agree_terms",
    "password",
  ];
  raw.state.sectionKeys = ["applicant", "applicant"];
  raw.proposedActions = raw.proposedActions.map((action) => ({
    ...action,
    proposalId: "duplicate_action_id",
  }));
  const normalized = canonicalizeSemanticProposal(raw);
  assert.deepEqual(normalized.proposal.state.visibleControlKeys, [
    "agree_terms",
    "display_name",
    "document",
    "password",
  ]);
  assert.deepEqual(normalized.proposal.state.sectionKeys, ["applicant"]);
  assert.equal(
    new Set(
      normalized.proposal.proposedActions.map((action) => action.proposalId),
    ).size,
    normalized.proposal.proposedActions.length,
  );
  assert.equal(
    normalized.proposal.proposedActions[0].kind,
    raw.proposedActions[0].kind,
  );
  assert.equal(
    normalized.proposal.proposedActions[0].value,
    raw.proposedActions[0].value,
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "map_contract_field_keys",
    ),
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "deduplicate_opaque_id",
    ),
  );

  const terminalDraft = proposal();
  terminalDraft.state.kind = "form";
  terminalDraft.state.progression.kind = "terminal_submit";
  terminalDraft.mechanics.progressionTarget.kind = "terminal_submit";
  terminalDraft.proposedActions = terminalDraft.proposedActions.filter(
    (action) => action.kind !== "advance",
  );
  const terminal = canonicalizeSemanticProposal(terminalDraft);
  assert.equal(terminal.proposal.state.kind, "terminal");
  assert.ok(
    terminal.normalizations.some(
      (item) => item.kind === "align_with_declared_progression",
    ),
  );
});

test("canonicalization removes dangling state section references", () => {
  const raw = proposal();
  raw.state.sectionKeys = ["applicant", "missing_section"];

  const normalized = canonicalizeSemanticProposal(raw);

  assert.deepEqual(normalized.proposal.state.sectionKeys, ["applicant"]);
  assert.ok(
    normalized.normalizations.some(
      (item) =>
        item.kind === "drop_unknown_section_references" &&
        item.path === "$.state.sectionKeys",
    ),
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("canonicalization fails closed when an observed terminal submit is called advance", () => {
  const raw = proposal();
  const observed = observation();
  observed.actions[0] = {
    ...observed.actions[0],
    rawType: "submit",
    rawText: "Submit Request",
    formMethod: "POST",
  };

  const normalized = canonicalizeSemanticProposal(raw, null, observed);

  assert.equal(normalized.proposal.state.kind, "terminal");
  assert.equal(normalized.proposal.state.progression.kind, "terminal_submit");
  assert.equal(
    normalized.proposal.mechanics.progressionTarget.kind,
    "terminal_submit",
  );
  assert.equal(
    normalized.proposal.proposedActions.find(
      (action) => action.targetKey === raw.state.progression.key,
    ).kind,
    "terminal_submit",
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "align_with_observed_terminal_submit",
    ),
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("canonicalization merges duplicate model fields for one observed radio group", () => {
  const raw = proposal();
  const observed = observation();
  observed.controls.push(
    {
      factId: "field_4",
      tag: "input",
      rawType: "radio",
      name: "services_for",
      id: "services_for_self",
      rawLabel: "Myself",
      required: false,
      options: [{ value: "Myself", label: "Myself" }],
      selectorCandidates: [
        "#services_for_self",
        'input[name="services_for"][type="radio"]',
      ],
    },
    {
      factId: "field_5",
      tag: "input",
      rawType: "radio",
      name: "services_for",
      id: "services_for_other",
      rawLabel: "Someone else",
      required: false,
      options: [{ value: "Someone else", label: "Someone else" }],
      selectorCandidates: [
        "#services_for_other",
        'input[name="services_for"][type="radio"]',
      ],
    },
  );
  raw.fields.push(
    field({
      key: "services_for",
      rawLabel: "Myself",
      controlType: "radio",
      factId: "field_4",
      selector: "#services_for_self",
      testValue: true,
      options: [{ value: "Myself", label: "Myself" }],
    }),
    field({
      key: "services_for",
      rawLabel: "Someone else",
      controlType: "radio",
      factId: "field_5",
      selector: "#services_for_other",
      testValue: false,
      options: [{ value: "Someone else", label: "Someone else" }],
    }),
  );
  raw.mechanics.fieldTargets.push(
    { fieldKey: "services_for", selectors: ["#services_for_self"] },
    { fieldKey: "services_for", selectors: ["#services_for_other"] },
  );
  raw.sections[0].fieldKeys.push("services_for");
  raw.state.visibleControlKeys.push("services_for");
  raw.proposedActions.push({
    proposalId: "action_services_for",
    kind: "field_actuation",
    targetKey: "services_for",
    value: true,
    rationale: "Choose one observed radio option.",
  });

  const normalized = canonicalizeSemanticProposal(raw, null, observed);
  const radio = normalized.proposal.fields.find(
    (candidate) => candidate.key === "services_for",
  );

  assert.deepEqual(radio.sourceFactIds, ["field_4", "field_5"]);
  assert.deepEqual(radio.options, [
    { value: "Myself", label: "Myself" },
    { value: "Someone else", label: "Someone else" },
  ]);
  assert.equal(radio.testValue, "Myself");
  assert.deepEqual(
    normalized.proposal.mechanics.fieldTargets.find(
      (target) => target.fieldKey === "services_for",
    ).selectors,
    ['input[name="services_for"][type="radio"]'],
  );
  assert.equal(
    normalized.proposal.proposedActions.find(
      (action) => action.targetKey === "services_for",
    ).value,
    "Myself",
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "merge_observed_radio_group",
    ),
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("canonicalization completes a partially modeled radio group from observed options", () => {
  const raw = proposal();
  const observed = observation();
  const options = [
    ["field_4", "Flyer", "Flyer"],
    ["field_5", "Friend", "Friend"],
    ["field_6", "gf_other_choice", "Other"],
  ];
  for (const [factId, value, label] of options) {
    observed.controls.push({
      factId,
      tag: "input",
      rawType: "radio",
      name: "input_16",
      id: `${factId}_id`,
      rawLabel: label,
      groupLegend: "How did you hear about us?",
      required: true,
      visible: true,
      options: [{ value, label }],
      selectorCandidates: [
        `#${factId}_id`,
        'input[name="input_16"][type="radio"]',
      ],
    });
  }
  raw.fields.push(
    field({
      key: "referral_source",
      rawLabel: "How did you hear about us?",
      controlType: "radio",
      factId: "field_4",
      selector: "#field_4_id",
      testValue: "Flyer",
      options: [
        { value: "Flyer", label: "Flyer" },
        { value: "Friend", label: "Friend" },
      ],
    }),
  );
  raw.fields.at(-1).sourceFactIds.push("field_5");
  raw.mechanics.fieldTargets.push({
    fieldKey: "referral_source",
    selectors: ["#field_4_id"],
  });
  raw.sections[0].fieldKeys.push("referral_source");
  raw.state.visibleControlKeys.push("referral_source");
  raw.proposedActions.push({
    proposalId: "action_referral_source",
    kind: "field_actuation",
    targetKey: "referral_source",
    value: "Flyer",
    rationale: "Choose one observed referral source.",
  });

  const normalized = canonicalizeSemanticProposal(raw, null, observed);
  const radio = normalized.proposal.fields.find(
    (candidate) => candidate.key === "referral_source",
  );

  assert.deepEqual(radio.sourceFactIds, ["field_4", "field_5", "field_6"]);
  assert.deepEqual(radio.options, [
    { value: "Flyer", label: "Flyer" },
    { value: "Friend", label: "Friend" },
    { value: "gf_other_choice", label: "Other" },
  ]);
  assert.equal(radio.rawLabel, "How did you hear about us?");
  assert.equal(radio.testValue, "Flyer");
  assert.deepEqual(
    normalized.proposal.mechanics.fieldTargets.find(
      (target) => target.fieldKey === "referral_source",
    ).selectors,
    ['input[name="input_16"][type="radio"]'],
  );
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "complete_observed_radio_group",
    ),
  );
  assert.deepEqual(
    radioGroupProposalIssues(normalized.proposal, observed),
    [],
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("canonicalization merges one raw radio group even when option fields use different semantic keys", () => {
  const raw = proposal();
  const observed = observation();
  const options = [
    ["radio_housed", "housing_yes", "yes", "I am housed"],
    ["radio_unhoused", "housing_no", "no", "I am unhoused"],
    ["radio_unsure", "housing_unsure", "unsure", "I am not sure"],
  ];
  for (const [factId, key, value, label] of options) {
    observed.controls.push({
      factId,
      tag: "input",
      rawType: "radio",
      name: "housing_status",
      id: factId,
      rawLabel: label,
      groupLegend: "What is your current housing situation?",
      required: true,
      visible: true,
      options: [{ value, label }],
      selectorCandidates: [
        `#${factId}`,
        'input[name="housing_status"][type="radio"]',
      ],
    });
    raw.fields.push(
      field({
        key,
        rawLabel: label,
        controlType: "radio",
        factId,
        selector: `#${factId}`,
        testValue: value,
        options: [{ value, label }],
      }),
    );
    raw.mechanics.fieldTargets.push({ fieldKey: key, selectors: [`#${factId}`] });
    raw.sections[0].fieldKeys.push(key);
    raw.state.visibleControlKeys.push(key);
    raw.proposedActions.push({
      proposalId: `action_${key}`,
      kind: "field_actuation",
      targetKey: key,
      value,
      rationale: "Choose the observed radio option.",
    });
  }

  const normalized = canonicalizeSemanticProposal(raw, null, observed);
  const radio = normalized.proposal.fields.find(
    (candidate) => candidate.key === "housing_yes",
  );

  assert.deepEqual(radio.sourceFactIds, [
    "radio_housed",
    "radio_unhoused",
    "radio_unsure",
  ]);
  assert.deepEqual(radio.options, [
    { value: "yes", label: "I am housed" },
    { value: "no", label: "I am unhoused" },
    { value: "unsure", label: "I am not sure" },
  ]);
  assert.equal(
    normalized.proposal.fields.some(
      (candidate) => ["housing_no", "housing_unsure"].includes(candidate.key),
    ),
    false,
  );
  assert.equal(
    normalized.proposal.mechanics.fieldTargets.filter(
      (target) => target.fieldKey === "housing_yes",
    ).length,
    1,
  );
  assert.deepEqual(radioGroupProposalIssues(normalized.proposal, observed), []);
  assert.ok(
    normalized.normalizations.some(
      (item) => item.kind === "merge_observed_radio_group_by_raw_name",
    ),
  );
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("canonicalization removes action controls, unsafe references, and model-authored probes", () => {
  const raw = proposal();
  raw.fields[1].guidanceRefs.push("invented_guidance");
  raw.sections[0].guidanceRefs.push("invented_guidance");
  raw.fields.push(
    field({
      key: "submit",
      rawLabel: "",
      controlType: "text",
      factId: "field_submit",
      selector: "#submit",
      testValue: "FORMWEAVE TEST",
    }),
  );
  raw.sections[0].fieldKeys.push("submit");
  raw.state.visibleControlKeys.push("submit");
  raw.mechanics.fieldTargets.push({
    fieldKey: "submit",
    selectors: ["#submit"],
  });
  raw.proposedActions.push(
    {
      proposalId: "action_submit_as_field",
      kind: "field_actuation",
      targetKey: "submit",
      value: "FORMWEAVE TEST",
      rationale: "Incorrectly treat submit as a field.",
    },
    {
      proposalId: "probe_name",
      kind: "choice_probe",
      targetKey: "display_name",
      value: "FORMWEAVE TEST",
      rationale: "Model-authored probes are ignored.",
    },
  );
  const observed = observation();
  observed.controls.push({
    factId: "field_submit",
    tag: "input",
    rawType: "submit",
    id: "submit",
    rawLabel: "",
    selectorCandidates: ["#submit"],
  });

  const normalized = canonicalizeSemanticProposal(raw, null, observed);

  assert.equal(
    normalized.proposal.fields.some((candidate) => candidate.key === "submit"),
    false,
  );
  assert.equal(
    normalized.proposal.proposedActions.some(
      (action) => action.proposalId === "action_submit_as_field",
    ),
    false,
  );
  assert.equal(
    normalized.proposal.proposedActions.some(
      (action) => action.kind === "choice_probe",
    ),
    false,
  );
  assert.equal(
    normalized.proposal.proposedActions.some(
      (action) => action.proposalId === "action_submit",
    ),
    true,
  );
  assert.deepEqual(normalized.proposal.fields[1].guidanceRefs, [
    "synthetic_guidance",
  ]);
  assert.deepEqual(normalized.proposal.sections[0].guidanceRefs, [
    "synthetic_guidance",
  ]);
  assert.doesNotThrow(() => validateSemanticProposal(normalized.proposal));
});

test("non-model safety accepts crawl-safe uploads and rejects disallowed protected actions", () => {
  const result = validateProposalSafety({
    proposal: proposal(),
    observation: observation(),
  });
  assert.deepEqual(
    result.acceptedActions.map((action) => action.proposalId),
    ["action_name", "action_document", "action_next"],
  );
  assert.deepEqual(
    result.rejections.map((item) => item.code).sort(),
    [
      "captcha_interaction",
      "credential_interaction",
      "credential_interaction",
      "legal_acceptance_interaction",
      "login_interaction",
      "payment_interaction",
      "terminal_submission",
    ].sort(),
  );
  assert.equal(result.safe, false);
});

test("non-model safety inventories disabled controls without actuating them", () => {
  const proposed = proposal();
  const observed = observation();
  const displayNameFact = observed.controls.find(
    (control) => control.factId === "field_0",
  );
  displayNameFact.visible = true;
  displayNameFact.disabled = true;

  const result = validateProposalSafety({
    proposal: proposed,
    observation: observed,
  });

  assert.ok(
    result.rejections.some(
      (item) =>
        item.proposalId === "action_name" && item.code === "outside_contract",
    ),
  );
  assert.equal(
    result.acceptedActions.some((item) => item.proposalId === "action_name"),
    false,
  );
});

test("an optional empty choice inventory is unavailable without rejecting safe siblings", () => {
  const proposed = proposal();
  proposed.fields = [
    proposed.fields.find((item) => item.key === "display_name"),
    {
      ...field({
        key: "preferred_language",
        rawLabel: "Preferred language",
        controlType: "select",
        factId: "field_empty_select",
        selector: "#preferred_language",
        testValue: "FW",
        options: [],
      }),
      required: false,
    },
  ];
  proposed.sections[0].fieldKeys = ["display_name", "preferred_language"];
  proposed.state.visibleControlKeys = ["display_name", "preferred_language"];
  proposed.mechanics.fieldTargets = [
    { fieldKey: "display_name", selectors: ["#display_name"] },
    { fieldKey: "preferred_language", selectors: ["#preferred_language"] },
  ];
  proposed.proposedActions = [
    proposed.proposedActions.find((item) => item.proposalId === "action_name"),
    {
      proposalId: "action_preferred_language",
      kind: "field_actuation",
      targetKey: "preferred_language",
      value: "FW",
      rationale: "Exercise the observed select if it has a real option.",
    },
    proposed.proposedActions.find((item) => item.proposalId === "action_next"),
  ];
  const observed = observation();
  observed.controls = [
    observed.controls.find((item) => item.factId === "field_0"),
    {
      factId: "field_empty_select",
      tag: "select",
      rawType: null,
      name: "preferred_language",
      id: "preferred_language",
      rawLabel: "Preferred language",
      required: false,
      visible: true,
      disabled: false,
      readOnly: false,
      options: [],
      selectorCandidates: ["#preferred_language"],
    },
  ];

  const result = validateProposalSafety({ proposal: proposed, observation: observed });

  assert.equal(result.safe, true);
  assert.deepEqual(
    result.acceptedActions.map((item) => item.proposalId),
    ["action_name", "action_next"],
  );
  assert.deepEqual(
    result.unavailableActions.map((item) => ({
      proposalId: item.proposalId,
      code: item.code,
    })),
    [{
      proposalId: "action_preferred_language",
      code: "option_values_unavailable",
    }],
  );
  assert.deepEqual(result.rejections, []);
});

test("input-less semantic controls are retained as non-actuated structural fields", () => {
  const fields = virtualInventoryFields(
    {
      controls: [{
        factId: "virtual_field_0",
        rawType: "custom",
        name: "satisfaction",
        id: "satisfaction",
        rawLabel: "How satisfied are you?",
        required: false,
        visible: true,
        disabled: false,
        readOnly: false,
        options: [
          { value: "1", label: "1 star" },
          { value: "5", label: "5 stars" },
        ],
        selectorCandidates: ["#satisfaction"],
        documentOrdinal: 14,
        virtual: true,
        actuationEligible: false,
      }],
    },
    new Set(),
    0,
  );

  assert.equal(fields.length, 1);
  assert.equal(fields[0].controlType, "custom");
  assert.equal(fields[0].actuate, false);
  assert.equal(fields[0].skipReason, "virtual_control_unavailable");
  assert.equal(fields[0].documentOrdinal, 14);
  assert.deepEqual(fields[0].options.map((item) => item.value), ["1", "5"]);
  assert.deepEqual(
    terminalEligibilityIssues({ states: [{ fields }] }),
    [],
  );
  assert.deepEqual(
    terminalEligibilityIssues({
      states: [{ fields: [{ ...fields[0], required: true }] }],
    }).map((issue) => issue.code),
    ["required_control_unavailable"],
  );
});

test("government identifiers are sensitive data, not login credentials", () => {
  assert.equal(
    classifyProtectedField({
      field: {
        key: "ssn_last4",
        rawLabel: "Last 4 Digits of Social Security Number",
        controlType: "text",
      },
      fact: {
        rawType: "text",
        name: "ssn_last4",
        rawLabel: "Last 4 Digits of Social Security Number",
      },
    }),
    null,
  );
  assert.equal(
    classifyProtectedField({
      field: {
        key: "account_password",
        rawLabel: "Password",
        controlType: "custom",
      },
      fact: { rawType: "password", name: "password" },
    }),
    "credential_interaction",
  );
});

test("payment protection covers autocomplete and sibling-section expiration fields", () => {
  assert.equal(
    classifyProtectedField({
      field: { key: "expires", rawLabel: "Expiration", controlType: "text" },
      fact: {
        rawType: "text",
        rawLabel: "Expiration (MM/YY)",
        autocomplete: "cc-exp",
      },
    }),
    "payment_interaction",
  );
  assert.equal(
    classifyProtectedField({
      field: { key: "expires", rawLabel: "Expiration", controlType: "text" },
      fact: {
        rawType: "text",
        rawLabel: "Expiration (MM/YY)",
        sectionText: "Processing fee Card Number Expiration Security Code",
      },
    }),
    "payment_interaction",
  );
  assert.equal(
    classifyProtectedField({
      field: {
        key: "benefit_expiration",
        rawLabel: "Benefit expiration date",
        controlType: "date",
      },
      fact: {
        rawType: "date",
        rawLabel: "Benefit expiration date",
        sectionText: "Eligibility dates",
      },
    }),
    null,
  );
});

test("opaque semantic keys cannot turn ordinary fields into CAPTCHA actions", () => {
  assert.equal(
    classifyProtectedField({
      field: {
        key: "site_o_invisible_captcha_first_name",
        rawLabel: "First Name",
        controlType: "text",
      },
      fact: {
        rawType: "text",
        name: "first_name",
        id: "first_name",
        rawLabel: "First Name",
      },
      challengeSignals: [
        {
          visible: true,
          text: "This site is protected by reCAPTCHA v3.",
        },
      ],
    }),
    null,
  );
});

test("reserved all-nine values are conspicuously synthetic for currency text fields", () => {
  const rentField = {
    key: "monthly_rent",
    rawLabel: "Monthly rent (whole dollars)",
    controlType: "text",
    options: [],
  };
  assert.equal(isConspicuouslySynthetic("9999", rentField), true);
  assert.equal(isConspicuouslySynthetic("2500", rentField), false);
});

test("synthetic consent modeling is accepted for public and local crawl scripts", () => {
  const value = proposal();
  value.proposedActions = value.proposedActions.map((action) =>
    action.proposalId === "action_agree"
      ? { ...action, kind: "legal_acceptance_interaction" }
      : action,
  );
  const localResult = validateProposalSafety({
    proposal: value,
    observation: observation(),
  });
  assert.deepEqual(
    localResult.acceptedActions.find(
      (action) => action.proposalId === "action_agree",
    ),
    {
      ...value.proposedActions.find(
        (action) => action.proposalId === "action_agree",
      ),
      crawlModelingAuthority: "consent",
    },
  );
  const publicResult = validateProposalSafety({
    proposal: value,
    observation: {
      ...observation(),
      url: "https://example.test/unknown/",
    },
  });
  assert.deepEqual(
    publicResult.acceptedActions.find(
      (action) => action.proposalId === "action_agree",
    ),
    {
      ...value.proposedActions.find(
        (action) => action.proposalId === "action_agree",
      ),
      crawlModelingAuthority: "consent",
    },
  );
});

test("synthetic upload modeling is accepted for public and local crawl scripts", () => {
  const localResult = validateProposalSafety({
    proposal: proposal(),
    observation: observation(),
  });
  assert.deepEqual(
    localResult.acceptedActions.find(
      (action) => action.proposalId === "action_document",
    ),
    {
      ...proposal().proposedActions.find(
        (action) => action.proposalId === "action_document",
      ),
      value: "[generated harmless upload]",
      crawlModelingAuthority: "upload",
    },
  );

  const publicObservation = {
    ...observation(),
    url: "https://example.test/unknown/",
  };
  const publicResult = validateProposalSafety({
    proposal: proposal(),
    observation: publicObservation,
  });
  assert.deepEqual(
    publicResult.acceptedActions.find(
      (item) => item.proposalId === "action_document",
    ),
    {
      ...proposal().proposedActions.find(
        (action) => action.proposalId === "action_document",
      ),
      value: "[generated harmless upload]",
      crawlModelingAuthority: "upload",
    },
  );
});

test("retained protected component actions require fresh authority in every crawl mode", () => {
  const plan = {
    fields: [
      {
        key: "consent",
        selectors: ["#consent"],
        actuate: true,
        safetyAuthority: "accepted_model_action:fixture_consent",
      },
      {
        key: "signature",
        selectors: ["#signature"],
        actuate: true,
        safetyAuthority: "accepted_model_action:fixture_signature",
      },
      {
        key: "document",
        selectors: ["#document"],
        actuate: true,
        safetyAuthority: "accepted_model_action:fixture_upload",
      },
    ],
  };
  assert.deepEqual(
    replayAuthorityIssues(plan, "probe", {
      consent: true,
      signature: true,
      upload: true,
    }),
    [],
  );
  assert.deepEqual(
    replayAuthorityIssues(plan, "fixture_submit", {
      consent: true,
      signature: false,
      upload: true,
    }).map((issue) => issue.targetKey),
    ["signature"],
  );
  assert.deepEqual(
    replayAuthorityIssues(plan, "fixture_submit", {
      consent: true,
      signature: true,
      upload: true,
    }),
    [],
  );
});

test("rejected safety dispositions cannot enter an executable generated plan", () => {
  assert.throws(
    () =>
      assertExecutablePlanSafety({
        fields: [
          {
            key: "consent",
            actuate: true,
            safetyAuthority: "explicit_loopback_fixture_legal_override",
          },
        ],
      }),
    /attempted to compile rejected action consent/,
  );
  assert.doesNotThrow(() =>
    assertExecutablePlanSafety({
      fields: [
        {
          key: "safe_name",
          actuate: true,
          safetyAuthority: "accepted_model_action",
        },
        {
          key: "consent",
          actuate: false,
          safetyAuthority: "protected_not_actuated",
        },
      ],
    }),
  );
});

test("partial generated journeys retain prior states, fields, and evidence", () => {
  const result = mergeTraversalResults(
    {
      actions: [{ label: "First name" }],
      evidence: [{ id: "state_1" }],
      observedFields: [{ key: "first_name" }],
      fieldsEntered: 1,
      entryFailures: 0,
      journeyUrls: ["http://localhost/page-1"],
      journeyComplete: true,
    },
    {
      actions: [{ label: "Consent" }],
      evidence: [{ id: "state_2" }],
      observedFields: [{ key: "consent" }],
      fieldsEntered: 0,
      entryFailures: 1,
      certificationStatus: "could_not_test",
      finalSubmission: "not_requested",
      journeyUrls: ["http://localhost/page-2"],
      journeyComplete: false,
      haltReason: "Protected required field.",
    },
  );
  assert.deepEqual(
    result.evidence.map((item) => item.id),
    ["state_1", "state_2"],
  );
  assert.deepEqual(
    result.observedFields.map((item) => item.key),
    ["first_name", "consent"],
  );
  assert.equal(result.fieldsEntered, 1);
  assert.equal(result.entryFailures, 1);
  assert.equal(result.journeyComplete, false);
  assert.equal(result.haltReason, "Protected required field.");
});

test("pre-actuation reporting never invents one failure per planned field", () => {
  const plan = {
    proposalId: "proposal_reporting",
    scriptVersion: 1,
    fields: [
      { key: "field_01", label: "Field 01", rationale: "Observed field." },
      { key: "field_02", label: "Field 02", rationale: "Observed field." },
    ],
  };
  assert.deepEqual(generatedFieldActions(plan, [], "state_01"), []);

  const attempted = generatedFieldActions(
    plan,
    [
      {
        field: plan.fields[0],
        outcome: {
          verified: false,
          failureCode: "actuation_unverified",
          detail: "Readback did not verify.",
        },
      },
    ],
    "state_01",
  );
  assert.equal(attempted.length, 1);
  assert.equal(attempted[0].label, "Field 01");
  assert.equal(attempted[0].failureCode, "actuation_unverified");
});

test("visible progress labels distinguish canonical and mid-flow entry", () => {
  assert.equal(
    inferJourneyEntryMode({
      heading: "Step 1 of 3 — Contact",
      sections: [],
      guidance: [],
    }).mode,
    "canonical",
  );
  assert.deepEqual(
    inferJourneyEntryMode({
      heading: "Household",
      sections: [],
      guidance: [{ rawText: "Step 2 / 3" }],
    }),
    {
      mode: "mid_flow",
      detail: "Visible progress reports step 2 of 3.",
      currentStep: 2,
      totalSteps: 3,
    },
  );
});

test("pending disclosures block both nonterminal and terminal progression", () => {
  const disclosureObservation = {
    actions: [
      {
        factId: "action_disclosure",
        visible: true,
        disclosureControl: true,
        disclosureExpanded: false,
        blockedControlFactIds: ["field_hidden"],
        rawText: "Additional information",
        selectorCandidates: ["#details > summary"],
      },
    ],
  };
  for (const kind of ["advance", "terminal_submit"]) {
    const issues = pendingDisclosureIssues(
      {
        state: {
          progression: {
            key: "continue",
            kind,
          },
        },
      },
      disclosureObservation,
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].type, "pending_disclosure");
    assert.deepEqual(
      issues[0].pendingDisclosures[0].blockedControlFactIds,
      ["field_hidden"],
    );
  }
  const disclosureAdvance = pendingDisclosureIssues(
    {
      state: {
        progression: {
          key: "open_details",
          kind: "advance",
        },
      },
      mechanics: {
        progressionTarget: {
          sourceFactId: "action_disclosure",
        },
      },
    },
    disclosureObservation,
  );
  assert.deepEqual(disclosureAdvance, []);
});

test("collapsed informational disclosures are explored before unrelated progression", () => {
  const issues = pendingDisclosureIssues(
    {
      state: {
        progression: {
          key: "submit_application",
          kind: "terminal_submit",
        },
      },
      mechanics: {
        progressionTarget: {
          sourceFactId: "action_submit",
        },
      },
    },
    {
      actions: [
        {
          factId: "action_terms",
          visible: true,
          disclosureControl: true,
          disclosureExpanded: false,
          blockedControlFactIds: [],
          rawText: "Read eligibility and submission terms",
          selectorCandidates: ["#terms"],
        },
      ],
    },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "pending_disclosure");
});

test("fields behind the selected disclosure are deferred to the re-sensed state", () => {
  const issues = disclosureBlockedFieldIssues(
    {
      state: {
        progression: { key: "open_details", kind: "advance" },
        visibleControlKeys: ["visible_name", "hidden_need"],
      },
      fields: [
        { key: "visible_name", sourceFactIds: ["field_visible"] },
        { key: "hidden_need", sourceFactIds: ["field_hidden"] },
      ],
      mechanics: {
        progressionTarget: { sourceFactId: "action_disclosure" },
      },
    },
    {
      actions: [
        {
          factId: "action_disclosure",
          disclosureControl: true,
          disclosureExpanded: false,
          blockedControlFactIds: ["field_hidden"],
        },
      ],
    },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "field_blocked_by_pending_disclosure");
  assert.equal(issues[0].targetKey, "hidden_need");
});

test("an exhausted disclosure cannot be reused as a progression action", () => {
  const issues = exhaustedDisclosureProgressionIssues(
    {
      state: {
        progression: {
          key: "show_more",
          kind: "advance",
        },
      },
      mechanics: {
        progressionTarget: {
          sourceFactId: "action_show_more",
        },
      },
    },
    {
      actions: [
        {
          factId: "action_show_more",
          visible: true,
          disclosureControl: true,
          disclosureExpanded: true,
          blockedControlFactIds: [],
          rawText: "Show more options",
          selectorCandidates: ["#show-more"],
        },
      ],
    },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "exhausted_disclosure_progression");
});

test("format-strict postal values use a reserved synthetic code without invalid text", () => {
  const postalField = {
    key: "postal_code",
    rawLabel: "ZIP code",
    controlType: "text",
    options: [],
  };
  assert.equal(isConspicuouslySynthetic("99999", postalField), true);
  assert.equal(isConspicuouslySynthetic("99999-9999", postalField), true);
  assert.equal(isConspicuouslySynthetic("98402", postalField), false);
  assert.equal(
    isConspicuouslySynthetic("FORMWEAVE TEST", postalField),
    false,
  );
  const strictReferenceField = {
    key: "fixture_reference",
    rawLabel: "Fixture reference",
    controlType: "text",
    options: [],
  };
  const strictReferenceFact = { pattern: "[A-Z]{2}[0-9]{4}" };
  assert.equal(
    isConspicuouslySynthetic(
      "FW9999",
      strictReferenceField,
      strictReferenceFact,
    ),
    true,
  );
  assert.equal(
    isConspicuouslySynthetic(
      "AB1234",
      strictReferenceField,
      strictReferenceFact,
    ),
    false,
  );
});

test("synthetic email authority requires a browser-valid reserved address", () => {
  const emailField = {
    key: "email",
    rawLabel: "Email Address",
    controlType: "email",
    options: [],
  };
  assert.equal(
    isConspicuouslySynthetic("FORMWEAVE TEST@example.invalid", emailField),
    false,
  );
  assert.equal(
    isConspicuouslySynthetic("formweave.test@example.invalid", emailField),
    true,
  );
  assert.equal(
    conspicuouslySyntheticFallback(emailField),
    "formweave.test@example.invalid",
  );
});

test("canonical reconciliation uses exact identity plus option context", () => {
  assert.equal(
    reconcileCanonicalProfileKey({ key: "num_children" }),
    "num_children",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "current_situation",
      label: "Current Situation",
      options: [
        { value: "unhoused", label: "Currently unhoused" },
        { value: "housed", label: "Currently housed" },
      ],
    }),
    "housing_status",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "current_situation",
      label: "Current Situation",
      options: [{ value: "working", label: "Currently working" }],
    }),
    "unmappable",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "aid_type",
      label: "Type of Help Needed",
      options: [
        { value: "rent", label: "Rent" },
        { value: "food", label: "Food" },
      ],
    }),
    "services_requested",
  );
  assert.equal(
    reconcileCanonicalProfileKey({
      key: "unmapped_field",
      label: "Unmapped field",
      options: 3,
    }),
    "unmappable",
  );
});

test("numeric-looking text fields accept reserved all-nine values and narrow sensitive policy", () => {
  assert.equal(
    isConspicuouslySynthetic(
      "9999",
      {
        key: "monthly_income",
        rawLabel: "Monthly Household Income (whole dollars)",
        controlType: "text",
        options: [],
      },
      { pattern: "" },
    ),
    true,
  );
  assert.equal(
    policySensitiveField(
      {
        key: "monthly_income",
        rawLabel: "Monthly Household Income",
        controlType: "text",
        sensitive: false,
      },
      null,
    ),
    true,
  );
  assert.equal(
    policySensitiveField(
      {
        key: "first_name",
        rawLabel: "First Name",
        controlType: "text",
        sensitive: false,
      },
      null,
    ),
    false,
  );
  assert.equal(
    policySensitiveField(
      {
        key: "qualification_method",
        rawLabel: "Qualification Method (Choose One)",
        controlType: "radio",
        sensitive: true,
      },
      null,
    ),
    false,
    "A method selector is not itself a financial value.",
  );
  assert.equal(
    policySensitiveField(
      {
        key: "fixed_income",
        rawLabel: "I am currently on a fixed income",
        controlType: "checkbox",
        sensitive: false,
      },
      null,
    ),
    false,
  );
  assert.deepEqual(
    policySensitivityDecision(
      {
        key: "monthly_income",
        rawLabel: "Monthly Household Income",
        controlType: "text",
        sensitive: false,
      },
      null,
    ),
    {
      sensitive: true,
      code: "sensitive_policy_pattern",
      source: "shared_policy",
      rationale:
        "Observed field identity matches the shared sensitive-data policy.",
    },
  );
  assert.equal(
    policySensitivityDecision(
      {
        key: "supporting_document",
        rawLabel: "Supporting document",
        controlType: "file",
        sensitive: false,
      },
      null,
    ).code,
    "sensitive_file_upload",
  );
});

test("runtime validation feedback can replace the captured generation input", async () => {
  const source = await readFile(
    new URL("../local/production-generated-traversal.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /let captured = await captureNovelStateInput/);
  assert.doesNotMatch(source, /const captured = await captureNovelStateInput/);
});

test("fixture submission requires a successful response or an observed same-page result", () => {
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: true,
      navigationStatus: 405,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/form",
      beforeBody: "Application",
      afterBody: '{"detail":"Method Not Allowed"}',
    }).verified,
    false,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: true,
      navigationStatus: 200,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/confirmation",
      beforeBody: "Application",
      afterBody: "Received",
    }).verified,
    true,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: false,
      writeRequestObserved: true,
      navigationStatus: 200,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/confirmation",
      beforeBody: "Application",
      afterBody: "Application submitted",
    }).verified,
    true,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: false,
      writeRequestObserved: false,
      navigationStatus: 200,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/form",
      beforeBody: "Application",
      afterBody: "Application",
    }).verified,
    false,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: false,
      writeRequestObserved: false,
      navigationStatus: 200,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/confirmation",
      beforeBody: "Application",
      afterBody: "Application submitted",
    }).verified,
    false,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: true,
      navigationStatus: null,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/form",
      beforeBody: "Application",
      afterBody: "Application received",
    }).verified,
    true,
  );
  assert.equal(
    verifyFixtureSubmissionOutcome({
      clicked: true,
      submitEventObserved: true,
      navigationStatus: null,
      beforeUrl: "http://localhost/form",
      afterUrl: "http://localhost/form",
      beforeBody: "Application",
      afterBody: "Application",
    }).verified,
    false,
  );
});

test("deterministic choice probes must cover every safe observed option", () => {
  const base = {
    state: { key: "benefit_state" },
    progression: {
      kind: "terminal_submit",
      key: "submit",
    },
    fields: [
      {
        key: "program",
        label: "Program",
        controlType: "select",
        options: [
          { value: "", label: "Choose one" },
          { value: "housing", label: "Housing" },
          { value: "energy", label: "Energy" },
        ],
        actuate: true,
        selectors: ["#program"],
        probeValues: ["energy"],
      },
    ],
    choiceCoverage: [],
    samePageBranchDepth: 0,
    crossPageAssessment: null,
  };
  assert.deepEqual(
    choiceProbeCoverageIssues(base).map((issue) => issue.targetKey),
    ["program"],
  );
  const covered = {
    ...base,
    fields: [
      {
        ...base.fields[0],
        probeValues: ["energy", "housing"],
      },
    ],
    choiceCoverage: [
      {
        fieldKey: "program",
        value: "energy",
        status: "verified",
      },
      {
        fieldKey: "program",
        value: "housing",
        status: "verified",
      },
    ],
  };
  assert.deepEqual(choiceProbeCoverageIssues(covered), []);
  assert.deepEqual(terminalEligibilityIssues({ states: [covered] }), []);
  const revealedWithoutVariantScript = {
    ...covered,
    choiceCoverage: covered.choiceCoverage.map((row, index) =>
      index === 0
        ? { ...row, classification: "same_page_branch" }
        : row,
    ),
  };
  assert.deepEqual(
    terminalEligibilityIssues({
      states: [revealedWithoutVariantScript],
    }).map((issue) => issue.code),
    ["same_page_branch_variant_missing"],
  );
  const withVariantScript = {
    ...revealedWithoutVariantScript,
    choiceCoverage: revealedWithoutVariantScript.choiceCoverage.map(
      (row, index) =>
        index === 0
          ? {
              ...row,
              variantPlan: {
                variantOnly: true,
                state: { key: "program_energy_variant" },
                fields: [],
                choiceCoverage: [],
                samePageBranchDepth: 1,
                progression: { kind: "advance" },
              },
            }
          : row,
    ),
  };
  assert.deepEqual(
    terminalEligibilityIssues({ states: [withVariantScript] }),
    [],
  );
});

test("special traversal rules exempt numeric and calendar-month selects from dependency probes", () => {
  const numericYear = {
    fields: [
      {
        key: "birth_year",
        label: "Year",
        controlType: "select",
        options: [
          { value: "", label: "Select" },
          { value: "year-2025", label: "2025" },
          { value: "year-2026", label: "2026" },
        ],
        actuate: true,
        selectors: ["#birth-year"],
        probeValues: [],
      },
    ],
  };
  assert.deepEqual(choiceProbeCoverageIssues(numericYear), []);
  assert.deepEqual(
    expectedDependencyProbeValues(numericYear.fields[0]),
    [],
  );

  const namedMonth = {
    fields: [
      {
        key: "dob_mm",
        label: "Date of birth",
        controlType: "select",
        options: [
          { value: "", label: "Choose one" },
          { value: "jan", label: "January" },
          { value: "feb", label: "February" },
        ],
        actuate: true,
        selectors: ["#dob-mm"],
        probeValues: [],
      },
    ],
  };
  assert.deepEqual(choiceProbeCoverageIssues(namedMonth), []);
  assert.deepEqual(
    expectedDependencyProbeValues(namedMonth.fields[0]),
    [],
  );

  const nonNumericBranch = {
    fields: [
      {
        key: "program",
        label: "Program",
        controlType: "select",
        options: [
          { value: "housing", label: "Housing" },
          { value: "energy", label: "Energy" },
        ],
        actuate: true,
        selectors: ["#program"],
        probeValues: [],
      },
    ],
  };
  assert.deepEqual(
    choiceProbeCoverageIssues(nonNumericBranch).map(
      (issue) => issue.targetKey,
    ),
    ["program"],
  );
  assert.deepEqual(
    expectedDependencyProbeValues(nonNumericBranch.fields[0]),
    ["housing", "energy"],
  );
});

test("terminal eligibility rejects unsupported same-page depth and cross-page uncertainty", () => {
  const issues = terminalEligibilityIssues({
    states: [
      {
        state: { key: "page_one" },
        fields: [],
        choiceCoverage: [],
        samePageBranchDepth: 2,
        progression: { kind: "advance" },
        crossPageAssessment: {
          outcome: "uncertain",
        },
      },
    ],
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      "same_page_branch_depth_exceeded",
      "cross_page_dependency_unverified",
    ],
  );
  assert.deepEqual(
    terminalEligibilityIssues({
      states: [
        {
          state: { key: "same_page_parent" },
          fields: [],
          choiceCoverage: [],
          samePageBranchDepth: 1,
          progression: {
            kind: "advance",
            dynamicContinuation: true,
          },
          crossPageAssessment: null,
        },
      ],
    }),
    [],
    "A same-page parent state does not itself perform the intermediate advance.",
  );
});

test("dynamics assessment is typed and preserves cross-page detection", async () => {
  let dynamicsRequest;
  const assessment = {
    schemaVersion: 1,
    assessmentId: "assessment_cross_page_1",
    transitionKind: "page_advance",
    outcome: "cross_page_dependency",
    confidence: "high",
    evidence: [
      "New question says: Because you said you do not drive",
      "Prior value vehicle_access=no",
    ].sort(),
    rationale:
      "The later question is explicitly conditioned on the earlier answer.",
  };
  assert.equal(
    validateDynamicsAssessment(assessment, "page_advance"),
    assessment,
  );
  assert.throws(
    () =>
      validateDynamicsAssessment(
        { ...assessment, outcome: "same_page_branch" },
        "page_advance",
      ),
    /invalid for page_advance/,
  );
  assert.equal(
    validateDynamicsAssessment(
      {
        schemaVersion: 1,
        assessmentId: "assessment_disclosure_1",
        transitionKind: "same_page_visibility_change",
        outcome: "same_page_disclosure",
        confidence: "high",
        evidence: ["A collapsed required-information section became visible."],
        rationale:
          "An authored disclosure opened substantive controls without depending on an applicant answer.",
      },
      "same_page_visibility_change",
    ).outcome,
    "same_page_disclosure",
  );
  const result = await generateDynamicsAssessment(
    {
      input: {
        transitionKind: "page_advance",
        before: { heading: "Step 1" },
        after: {
          heading: "Step 2",
          guidance: [
            "Because you said you do not drive, answer the following.",
          ],
        },
      },
      screenshot: Buffer.from("png"),
    },
    {
      configuration: {
        configured: true,
        apiKey: "test-key",
        model: "test-model",
        promptVersion: "test-dynamics",
      },
      fetchImpl: async (_url, init) => {
        dynamicsRequest = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            id: "resp_dynamics",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(assessment),
                  },
                ],
              },
            ],
          }),
        };
      },
    },
  );
  assert.equal(result.assessment.outcome, "cross_page_dependency");
  const dynamicsPrompt = dynamicsRequest.input[1].content.find(
    (item) => item.type === "input_text",
  ).text;
  assert.match(dynamicsPrompt, /Do not require an unobserved counterfactual/i);
  assert.match(dynamicsPrompt, /concrete but unresolved dependency clue/i);
});

test("submission success requires explicit LLM-authored rendered markers", async () => {
  const observation = {
    url: "http://localhost/confirmation",
    title: "Application complete",
    heading: "Submission received",
    bodyText:
      "Submission received. Your synthetic application was accepted.",
    accessibilitySnapshot:
      '- heading "Submission received"\n- text "Your synthetic application was accepted."',
  };
  const assessment = {
    schemaVersion: 1,
    assessmentId: "submission_result_1",
    outcome: "success",
    confidence: "high",
    markers: ["Submission received"],
    rationale: "The rendered page explicitly confirms receipt.",
  };
  assert.equal(
    validateSubmissionResultAssessment(assessment, observation),
    assessment,
  );
  assert.equal(
    verifyStoredSubmissionResultCriteria(assessment, observation).verified,
    true,
  );
  assert.equal(
    verifyStoredSubmissionResultCriteria(assessment, {
      ...observation,
      heading: "Application",
      bodyText: "Application",
      accessibilitySnapshot: "",
    }).verified,
    false,
  );
  const result = await generateSubmissionResultAssessment(
    {
      observation,
      screenshot: Buffer.from("png"),
    },
    {
      configuration: {
        configured: true,
        apiKey: "test-key",
        model: "test-model",
        promptVersion: "test-submission",
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          id: "resp_submission",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(assessment),
                },
              ],
            },
          ],
        }),
      }),
    },
  );
  assert.equal(result.assessment.outcome, "success");

  const failureObservation = {
    ...observation,
    title: "Synthetic submission failed",
    heading: "Submission failed",
    bodyText:
      "Submission failed. The fixture rejected the synthetic submission. Nothing was received.",
    accessibilitySnapshot:
      '- heading "Submission failed"\n- text "Nothing was received."',
  };
  const failureAssessment = {
    schemaVersion: 1,
    assessmentId: "submission_result_failure",
    outcome: "failure",
    confidence: "high",
    markers: ["Submission failed"],
    rationale: "The rendered page explicitly reports failure.",
  };
  assert.equal(
    validateSubmissionResultAssessment(
      failureAssessment,
      failureObservation,
    ),
    failureAssessment,
  );
  assert.equal(
    verifyStoredSubmissionResultCriteria(
      failureAssessment,
      failureObservation,
    ).verified,
    false,
  );
});

test("semantic model input contains live sensing context and records provenance", async () => {
  const value = proposal();
  let requestBody;
  const events = [];
  const result = await generateSemanticProposal(
    {
      observation: observation(),
      screenshot: Buffer.from("png-bytes"),
    },
    {
      configuration: {
        configured: true,
        apiKey: "test-only-key",
        model: "test-model",
        promptVersion: SEMANTIC_PROMPT_VERSION,
      },
      log: async (kind, detail) => events.push({ kind, detail }),
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            id: "resp_test",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  { type: "output_text", text: JSON.stringify(value) },
                ],
              },
            ],
          }),
        };
      },
    },
  );
  const userContent = requestBody.input[1].content;
  assert.deepEqual(requestBody.reasoning, { effort: "none" });
  const inputText = userContent.find((item) => item.type === "input_text").text;
  assert.match(inputText, /accessibilitySnapshot/);
  assert.match(inputText, /priorStates/);
  assert.match(inputText, /sections/);
  assert.match(inputText, /guidance/);
  assert.match(inputText, /selectorCandidates/);
  assert.match(inputText, /99999/);
  assert.match(inputText, /Format constraints|format and constraints/i);
  assert.match(inputText, /expose conditional behavior rather than avoid it/i);
  assert.match(inputText, /Do not propose choice_probe actions/i);
  assert.match(
    inputText,
    /Every visible collapsed details, accordion, expando/i,
  );
  assert.match(inputText, /Cookie and consent-management banners are session traversal infrastructure/i);
  assert.match(inputText, /fixed pointer sweep/i);
  assert.match(inputText, /generated per-site handler must implement and verify/i);
  assert.match(inputText, /never describe preparation as CAPTCHA/i);
  assert.match(inputText, /serves OneDegree's resource-access mission/i);
  assert.match(
    inputText,
    /intake\/application\/enrollment\/service-request\/referral\/eligibility/i,
  );
  assert.match(inputText, /contact or request-information form/i);
  assert.match(inputText, /do not explore alternate forms/i);
  assert.match(inputText, /not permission for heuristic page discovery/i);
  assert.doesNotMatch(inputText, /ground_truth|answer_key/i);
  assert.equal(
    userContent.find((item) => item.type === "input_image").detail,
    "high",
  );
  assert.equal(result.provenance.responseId, "resp_test");
  assert.equal(result.provenance.reasoningEffort, "none");
  assert.equal(result.provenance.promptVersion, SEMANTIC_PROMPT_VERSION);
  assert.deepEqual(
    events.map((event) => event.kind),
    [
      "semantic_generation_started",
      "semantic_proposal_canonicalized",
      "semantic_generation_completed",
    ],
  );
});

test("schema-invalid model drafts are retained and repaired once", async () => {
  const valid = proposal();
  const invalid = {
    ...valid,
    state: { ...valid.state, normalizedRoute: "not-a-route" },
  };
  const events = [];
  const requestBodies = [];
  let calls = 0;
  const result = await generateSemanticProposal(
    { observation: observation(), screenshot: Buffer.from("png-bytes") },
    {
      configuration: {
        configured: true,
        apiKey: "test-only-key",
        model: "test-model",
        promptVersion: SEMANTIC_PROMPT_VERSION,
      },
      log: async (kind, detail) => events.push({ kind, detail }),
      fetchImpl: async (_url, init) => {
        requestBodies.push(JSON.parse(init.body));
        calls += 1;
        return {
          ok: true,
          json: async () => ({
            id: `resp_${calls}`,
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(calls === 1 ? invalid : valid),
                  },
                ],
              },
            ],
          }),
        };
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.provenance.attempts, 2);
  assert.equal(result.provenance.rejectedDrafts.length, 1);
  assert.ok(
    events.some((event) => event.kind === "semantic_proposal_schema_rejected"),
  );
  const repairedPrompt = requestBodies[1].input[1].content.find(
    (item) => item.type === "input_text",
  ).text;
  assert.match(repairedPrompt, /Correct only the invalid path/i);
  assert.match(repairedPrompt, /Prior canonical proposal:/i);
});

test("semantic generation records are immutable and retain safety/provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "formweave-gate2-"));
  const args = {
    dataRoot: root,
    runId: "gate2_record",
    observation: observation(),
    screenshot: Buffer.from("png-bytes"),
    proposal: proposal(),
    provenance: {
      generatedAt: "2026-07-24T20:00:00.000Z",
      model: "test-model",
      promptVersion: SEMANTIC_PROMPT_VERSION,
      responseId: "resp_test",
      durationMs: 10,
      screenshotSha256: "a".repeat(64),
      sourceUrl: "http://127.0.0.1:9001/unknown/",
    },
    safety: { safe: false, acceptedActions: [], rejections: [] },
    events: [{ kind: "semantic_generation_completed" }],
  };
  const recordPath = await writeSemanticGenerationRecord(args);
  assert.equal(
    JSON.parse(await readFile(path.join(recordPath, "provenance.json"), "utf8"))
      .promptVersion,
    SEMANTIC_PROMPT_VERSION,
  );
  await assert.rejects(
    () => readFile(path.join(recordPath, "sensing.png")),
    /ENOENT/,
  );
  await assert.rejects(() => writeSemanticGenerationRecord(args));
});

test("D3 executor and physics modules cannot import semantic generation", async () => {
  const source = await Promise.all(
    [
      "local/executor/executor.mjs",
      "local/executor/physics-toolbox.mjs",
      "local/executor/state-identity.mjs",
    ].map((file) => readFile(path.resolve(file), "utf8")),
  ).then((parts) => parts.join("\n"));
  assert.doesNotMatch(source, /semantic-generator|proposal-safety|openai|responses/i);
});

test("production crawl server cannot import localhost answer-key planners", async () => {
  const source = await readFile(path.resolve("local/server.mjs"), "utf8");
  assert.doesNotMatch(
    source,
    /localhost-corpus|loadGroundTruthCorpus|createCorpusReconScript|ground_truth/i,
  );
});
