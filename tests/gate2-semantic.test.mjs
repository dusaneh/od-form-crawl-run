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
  isConspicuouslySynthetic,
  validateProposalSafety,
} from "../local/semantic/proposal-safety.mjs";
import {
  canonicalizeSemanticProposal,
  generateSemanticProposal,
} from "../local/semantic/semantic-generator.mjs";
import { writeSemanticGenerationRecord } from "../local/semantic/semantic-record-store.mjs";
import {
  generateDynamicsAssessment,
  validateDynamicsAssessment,
} from "../local/semantic/dynamics-assessment.mjs";
import {
  generateSubmissionResultAssessment,
  validateSubmissionResultAssessment,
  verifyStoredSubmissionResultCriteria,
} from "../local/semantic/submission-result-assessment.mjs";
import {
  assertExecutablePlanSafety,
  choiceProbeCoverageIssues,
  exhaustedDisclosureProgressionIssues,
  inferJourneyEntryMode,
  mergeTraversalResults,
  pendingDisclosureIssues,
  policySensitivityDecision,
  policySensitiveField,
  replayAuthorityIssues,
  terminalEligibilityIssues,
  verifyFixtureSubmissionOutcome,
} from "../local/production-generated-traversal.mjs";

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

test("LLM-authored choice probes must cover every safe observed option", () => {
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
  const inputText = userContent.find((item) => item.type === "input_text").text;
  assert.match(inputText, /accessibilitySnapshot/);
  assert.match(inputText, /priorStates/);
  assert.match(inputText, /sections/);
  assert.match(inputText, /guidance/);
  assert.match(inputText, /selectorCandidates/);
  assert.match(inputText, /99999/);
  assert.match(inputText, /Format constraints|format and constraints/i);
  assert.match(inputText, /expose conditional behavior rather than avoid it/i);
  assert.doesNotMatch(inputText, /ground_truth|answer_key/i);
  assert.equal(
    userContent.find((item) => item.type === "input_image").detail,
    "high",
  );
  assert.equal(result.provenance.responseId, "resp_test");
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
      fetchImpl: async () => {
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
