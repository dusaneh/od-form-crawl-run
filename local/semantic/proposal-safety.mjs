import { validateProposalRejection } from "../contracts/runtime-schemas.mjs";
import { validateSemanticProposal } from "./proposal-schema.mjs";

const DIRECT_REJECTIONS = Object.freeze({
  captcha_interaction: "captcha_interaction",
  credential_interaction: "credential_interaction",
  login_interaction: "login_interaction",
  payment_interaction: "payment_interaction",
  upload_interaction: "upload_interaction",
  legal_acceptance_interaction: "legal_acceptance_interaction",
  terminal_submit: "terminal_submission",
});

const LEGAL_ACCEPTANCE_PATTERN =
  /agree|terms|consent|certif|authorize|signature|attest|acknowledge|confirm|review|accurate|correct|complete|declar/i;

function tokens(field, fact) {
  return [
    field?.rawLabel,
    field?.label,
    fact?.rawLabel,
    fact?.name,
    fact?.id,
    fact?.autocomplete,
    fact?.rawType,
    fact?.placeholder,
    fact?.groupLegend,
    fact?.sectionText,
    fact?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function loopbackObservation(observation) {
  try {
    const hostname = new URL(observation.url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

export function fixtureLegalAuthority(field, fact) {
  const fieldTokens = tokens(field, fact);
  if (/signature|signed name|type.*name/.test(fieldTokens)) {
    return "signature";
  }
  if (/review|accurate|correct|complete|certif|attest/.test(fieldTokens)) {
    return "reviewConfirmation";
  }
  if (/acknowledg/.test(fieldTokens)) {
    return "acknowledgement";
  }
  return "consent";
}

export function isLegalAcceptanceField(field, fact = null) {
  return (
    ["checkbox", "switch"].includes(field?.controlType) &&
    LEGAL_ACCEPTANCE_PATTERN.test(tokens(field, fact))
  );
}

export function classifyProtectedField({
  field,
  fact,
  challengeSignals = [],
}) {
  const fieldTokens = tokens(field, fact);
  if (field?.controlType === "file" || fact?.rawType === "file") {
    return "upload_interaction";
  }
  const paymentAutocomplete = /^cc-/i.test(String(fact?.autocomplete || ""));
  const explicitPaymentToken =
    /credit|debit|card number|cardholder|cvv|cvc|routing|bank account|payment/.test(
      fieldTokens,
    );
  const paymentExpiryContext =
    /(?:card|payment).{0,100}(?:expir(?:ation|y)|mm\s*\/\s*yy)|(?:expir(?:ation|y)|mm\s*\/\s*yy).{0,100}(?:card|payment)/.test(
      fieldTokens,
    );
  if (paymentAutocomplete || explicitPaymentToken || paymentExpiryContext) {
    return "payment_interaction";
  }
  if (
    fact?.rawType === "password" ||
    /password|passcode|one[- ]?time code|verification code/.test(
      fieldTokens,
    )
  ) {
    return "credential_interaction";
  }
  if (/log[ -]?in|sign[ -]?in|username/.test(fieldTokens)) {
    return "login_interaction";
  }
  if (
    isLegalAcceptanceField(field, fact)
  ) {
    return "legal_acceptance_interaction";
  }
  if (
    challengeSignals.some((signal) => signal.visible) &&
    /captcha|human|robot|challenge/.test(fieldTokens)
  ) {
    return "captcha_interaction";
  }
  return null;
}

function rejection(action, code, detail) {
  const value = {
    proposalId: action.proposalId,
    code,
    detail,
    observedAt: new Date().toISOString(),
  };
  validateProposalRejection(value);
  return value;
}

const SYNTHETIC_POSTAL_CODES = new Set(["99999", "99999-9999"]);

function normalizedSemanticKey(field) {
  return [field?.key, field?.rawLabel]
    .filter(Boolean)
    .join(" ")
    .trim()
    .toLowerCase();
}

function isReservedStrictPatternValue(text, fact) {
  const pattern = String(fact?.pattern || "").trim();
  if (!pattern) return false;
  let matches = false;
  try {
    matches = new RegExp(`^(?:${pattern})$`).test(text);
  } catch {
    return false;
  }
  if (!matches) return false;
  const compact = text.replace(/[^A-Za-z0-9]/g, "");
  return (
    /^9+$/.test(compact) ||
    /^(?:FW|XX|ZZ)9+$/i.test(compact) ||
    /(?:FORMWEAVE|SYNTHETIC|TEST|EXAMPLE)/i.test(compact)
  );
}

export function isConspicuouslySynthetic(value, field, fact = null) {
  if (typeof value === "boolean" || typeof value === "number" || value === null) {
    return true;
  }
  const text = String(value);
  if (field?.options?.some((option) => option.value === text)) return true;
  const minimumLength = Math.max(0, Number(fact?.minLength || 0));
  const maximumLength = Number(fact?.maxLength || 0);
  if (text.length < minimumLength) return false;
  if (
    Number.isFinite(maximumLength) &&
    maximumLength > 0 &&
    text.length > maximumLength
  ) {
    return false;
  }
  const pattern = String(fact?.pattern || "").trim();
  if (pattern) {
    try {
      if (!new RegExp(`^(?:${pattern})$`).test(text)) return false;
    } catch {
      return false;
    }
  }
  if (field?.controlType === "email") {
    return (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) &&
      /@example\.invalid$/i.test(text)
    );
  }
  if (field?.controlType === "url") {
    try {
      const parsed = new URL(text);
      return (
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.hostname.toLowerCase() === "example.invalid"
      );
    } catch {
      return false;
    }
  }
  if (field?.controlType === "tel") return /555/.test(text);
  if (
    ["date", "datetime-local", "month", "week", "time", "number"].includes(
      field?.controlType,
    )
  ) {
    return true;
  }
  if (
    /^9+$/.test(text.trim()) &&
    /(?:income|amount|account|member|case|household|dollar|rent|fee|cost|expense|number|identifier|social security|ssn|id\b)/i.test(
      normalizedSemanticKey(field),
    )
  ) {
    return true;
  }
  if (
    /(?:^|[_\s-])(?:postal(?:[_\s-]?code)?|zip(?:[_\s-]?code)?)(?:$|[_\s-])/.test(
      normalizedSemanticKey(field),
    )
  ) {
    return SYNTHETIC_POSTAL_CODES.has(text.trim());
  }
  return (
    /formweave|synthetic|test|example/i.test(text) ||
    isReservedStrictPatternValue(text, fact)
  );
}

export function conspicuouslySyntheticFallback(field, fact = null) {
  const controlType = String(field?.controlType || fact?.rawType || "text");
  if (controlType === "email") return "formweave.test@example.invalid";
  if (controlType === "tel") return "2025550199";
  if (controlType === "url") return "https://example.invalid/formweave-test";
  if (!["text", "textarea", "password"].includes(controlType)) return null;
  if (controlType === "password") return null;
  const minimum = Math.max(0, Number(fact?.minLength || 0));
  const maximumValue = Number(fact?.maxLength || 0);
  const maximum = Number.isFinite(maximumValue) && maximumValue > 0
    ? maximumValue
    : Number.POSITIVE_INFINITY;
  const pattern = String(fact?.pattern || "").trim();
  const candidates = ["FORMWEAVE TEST", "FW TEST", "TEST", "FW"];
  for (const candidate of candidates) {
    if (candidate.length < minimum || candidate.length > maximum) continue;
    if (pattern) {
      try {
        if (!new RegExp(`^(?:${pattern})$`).test(candidate)) continue;
      } catch {
        return null;
      }
    }
    if (isConspicuouslySynthetic(candidate, field, fact)) return candidate;
  }
  return null;
}

function selectorSet(observation) {
  return new Set([
    ...observation.controls.flatMap((fact) => fact.selectorCandidates || []),
    ...observation.actions.flatMap((fact) => fact.selectorCandidates || []),
  ]);
}

export function validateProposalSafety({
  proposal,
  observation,
  existingContract = null,
  fixtureAuthorities = null,
}) {
  validateSemanticProposal(proposal, existingContract);
  const acceptedActions = [];
  const unavailableActions = [];
  const rejections = [];
  const fields = new Map([
    ...(existingContract?.fields || []).map((field) => [field.key, field]),
    ...proposal.fields.map((field) => [field.key, field]),
  ]);
  const rawFacts = new Map();
  for (const field of proposal.fields) {
    for (const factId of field.sourceFactIds) {
      const fact = observation.controls.find((item) => item.factId === factId);
      if (fact) rawFacts.set(field.key, fact);
    }
  }
  const observedSelectors = selectorSet(observation);
  const targetSelectors = new Map(
    proposal.mechanics.fieldTargets.map((target) => [
      target.fieldKey,
      target.selectors,
    ]),
  );
  const progressionSelectors = proposal.mechanics.progressionTarget.selectors;
  const protectedFields = proposal.fields
    .map((field) => ({
      fieldKey: field.key,
      code: classifyProtectedField({
        field,
        fact: rawFacts.get(field.key),
        challengeSignals: observation.challengeSignals,
      }),
    }))
    .filter((item) => item.code !== null)
    .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey));

  for (const action of proposal.proposedActions) {
    const directCode = DIRECT_REJECTIONS[action.kind];
    if (directCode === "legal_acceptance_interaction") {
      const field = fields.get(action.targetKey);
      const fact = rawFacts.get(action.targetKey);
      const authority = fixtureLegalAuthority(field, fact);
      const selectors = targetSelectors.get(action.targetKey) || [];
      if (
        field &&
        fact &&
        selectors.length > 0 &&
        selectors.every((selector) => observedSelectors.has(selector)) &&
        isConspicuouslySynthetic(action.value, field, fact)
      ) {
        acceptedActions.push({
          ...action,
          crawlModelingAuthority: authority,
        });
        continue;
      }
    }
    if (directCode === "upload_interaction") {
      const field = fields.get(action.targetKey);
      const fact = rawFacts.get(action.targetKey);
      const selectors = targetSelectors.get(action.targetKey) || [];
      if (
        field?.controlType === "file" &&
        fact?.rawType === "file" &&
        selectors.length > 0 &&
        selectors.every((selector) => observedSelectors.has(selector))
      ) {
        acceptedActions.push({
          ...action,
          value: "[generated harmless upload]",
          crawlModelingAuthority: "upload",
        });
        continue;
      }
    }
    if (directCode) {
      rejections.push(
        rejection(action, directCode, `Action kind ${action.kind} is never automatically actuated.`),
      );
      continue;
    }
    if (action.kind === "advance") {
      if (
        proposal.state.progression.kind !== "advance" ||
        action.targetKey !== proposal.state.progression.key
      ) {
        rejections.push(
          rejection(
            action,
            "ambiguous_progression",
            "The proposal does not match the typed nonterminal progression.",
          ),
        );
        continue;
      }
      if (
        progressionSelectors.length === 0 ||
        progressionSelectors.some((selector) => !observedSelectors.has(selector))
      ) {
        rejections.push(
          rejection(
            action,
            "outside_contract",
            "The progression selector was not present in raw observation facts.",
          ),
        );
        continue;
      }
      acceptedActions.push(action);
      continue;
    }
    if (
      action.kind !== "field_actuation" &&
      action.kind !== "choice_probe"
    ) {
      rejections.push(
        rejection(action, "outside_contract", "Unknown action classification."),
      );
      continue;
    }
    const field = fields.get(action.targetKey);
    const fact = rawFacts.get(action.targetKey);
    if (!field || !fact) {
      rejections.push(
        rejection(
          action,
          "outside_contract",
          "The action target is not linked to an observed contract field.",
        ),
      );
      continue;
    }
    if (
      fact.visible !== true ||
      fact.disabled === true ||
      fact.readOnly === true
    ) {
      rejections.push(
        rejection(
          action,
          "outside_contract",
          "The observed control is hidden, disabled, or read-only and is retained for inventory only; it is not eligible for applicant actuation.",
        ),
      );
      continue;
    }
    const sourceFacts = (field.sourceFactIds || [])
      .map((factId) =>
        observation.controls.find((item) => item.factId === factId),
      )
      .filter(Boolean);
    const observedOptionValues = sourceFacts
      .flatMap((item) => item.options || [])
      .map((option) => String(option.value ?? "").trim())
      .filter(Boolean);
    if (
      fact.actuationEligible === false ||
      (["radio", "select"].includes(field.controlType) &&
        observedOptionValues.length === 0)
    ) {
      unavailableActions.push({
        ...action,
        code:
          fact.actuationEligible === false
            ? "virtual_control_unavailable"
            : "option_values_unavailable",
        detail:
          fact.actuationEligible === false
            ? "The observed semantic control has no verified browser actuator."
            : "The observed enumerated control exposes no selectable non-placeholder values.",
      });
      continue;
    }
    const unsafeCode = classifyProtectedField({
      field,
      fact,
      challengeSignals: observation.challengeSignals,
    });
    if (unsafeCode) {
      rejections.push(
        rejection(
          action,
          unsafeCode,
          "The non-model safety classifier marked the observed target as protected.",
        ),
      );
      continue;
    }
    if (action.kind === "choice_probe") {
      const observedChoiceFacts = (field.sourceFactIds || [])
        .map((factId) =>
          observation.controls.find((item) => item.factId === factId),
        )
        .filter(Boolean);
      const allowedValues = new Set(
        ["checkbox", "switch"].includes(field.controlType)
          ? ["false", "true"]
          : observedChoiceFacts
              .flatMap((item) => item.options || [])
              .filter(
                (option) =>
                  String(option.value ?? "").trim() !== "" &&
                  !/^(?:choose|select|please choose|please select)$/i.test(
                    String(option.label || "").trim(),
                  ),
              )
              .map((option) => String(option.value)),
      );
      if (!allowedValues.has(String(action.value))) {
        rejections.push(
          rejection(
            action,
            "outside_contract",
            "The choice-probe value was not an observed non-placeholder option.",
          ),
        );
        continue;
      }
    }
    const selectors = targetSelectors.get(field.key) || [];
    if (
      selectors.length === 0 ||
      selectors.some((selector) => !observedSelectors.has(selector))
    ) {
      rejections.push(
        rejection(
          action,
          "outside_contract",
          "The field selector was not present in raw observation facts.",
        ),
      );
      continue;
    }
    if (
      action.kind !== "choice_probe" &&
      !isConspicuouslySynthetic(action.value, field, fact)
    ) {
      rejections.push(
        rejection(
          action,
          "unsafe_value",
          "The proposed value is not conspicuously synthetic for this control.",
        ),
      );
      continue;
    }
    acceptedActions.push(action);
  }

  return {
    proposalId: proposal.proposalId,
    acceptedActions,
    unavailableActions,
    rejections,
    protectedFields,
    safe: rejections.length === 0,
    validatedAt: new Date().toISOString(),
  };
}
