export const DYNAMICS_ASSESSMENT_SCHEMA_VERSION = 1;
export const DYNAMICS_PROMPT_VERSION = "phase1-dynamics-assessment-v5";

const TRANSITION_KINDS = Object.freeze([
  "same_page_visibility_change",
  "page_advance",
]);

const OUTCOMES = Object.freeze([
  "same_page_branch",
  "same_page_companion",
  "same_page_disclosure",
  "validation_only",
  "cosmetic",
  "independent",
  "cross_page_dependency",
  "uncertain",
]);

function outputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        throw new Error(
          `OpenAI declined dynamics assessment: ${content.refusal}`,
        );
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI returned no dynamics assessment.");
}

function sortedUnique(values) {
  return (
    Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.trim()) &&
    JSON.stringify(values) === JSON.stringify([...new Set(values)].sort())
  );
}

function canonicalizeAssessment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    evidence: Array.isArray(value.evidence)
      ? [...new Set(value.evidence.map((item) => String(item).trim()).filter(Boolean))].sort()
      : value.evidence,
  };
}

export function validateDynamicsAssessment(value, expectedTransitionKind) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dynamics assessment must be an object.");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "assessmentId",
    "confidence",
    "evidence",
    "outcome",
    "rationale",
    "schemaVersion",
    "transitionKind",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Dynamics assessment contains unexpected keys.");
  }
  if (value.schemaVersion !== DYNAMICS_ASSESSMENT_SCHEMA_VERSION) {
    throw new Error("Dynamics assessment schema version is unsupported.");
  }
  if (
    typeof value.assessmentId !== "string" ||
    value.assessmentId.trim() === ""
  ) {
    throw new Error("Dynamics assessment requires an id.");
  }
  if (!TRANSITION_KINDS.includes(value.transitionKind)) {
    throw new Error("Dynamics assessment transition kind is invalid.");
  }
  if (
    expectedTransitionKind &&
    value.transitionKind !== expectedTransitionKind
  ) {
    throw new Error(
      `Dynamics assessment transition kind ${value.transitionKind} does not match ${expectedTransitionKind}.`,
    );
  }
  if (!OUTCOMES.includes(value.outcome)) {
    throw new Error("Dynamics assessment outcome is invalid.");
  }
  if (!["high", "medium", "low"].includes(value.confidence)) {
    throw new Error("Dynamics assessment confidence is invalid.");
  }
  if (!sortedUnique(value.evidence)) {
    throw new Error("Dynamics assessment evidence must be sorted and unique.");
  }
  if (typeof value.rationale !== "string" || value.rationale.trim() === "") {
    throw new Error("Dynamics assessment requires rationale.");
  }
  const allowed =
    value.transitionKind === "same_page_visibility_change"
      ? new Set([
          "same_page_branch",
          "same_page_companion",
          "same_page_disclosure",
          "validation_only",
          "cosmetic",
          "uncertain",
        ])
      : new Set(["independent", "cross_page_dependency", "uncertain"]);
  if (!allowed.has(value.outcome)) {
    throw new Error(
      `Dynamics outcome ${value.outcome} is invalid for ${value.transitionKind}.`,
    );
  }
  return value;
}

const DYNAMICS_JSON_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: {
      type: "integer",
      enum: [DYNAMICS_ASSESSMENT_SCHEMA_VERSION],
    },
    assessmentId: { type: "string" },
    transitionKind: { type: "string", enum: [...TRANSITION_KINDS] },
    outcome: { type: "string", enum: [...OUTCOMES] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
    rationale: { type: "string" },
  },
  required: [
    "schemaVersion",
    "assessmentId",
    "transitionKind",
    "outcome",
    "confidence",
    "evidence",
    "rationale",
  ],
  additionalProperties: false,
};

function promptText(input) {
  return [
    "Classify one observed form transition using only the supplied rendered facts and screenshot.",
    "This is semantic classification only. Do not propose or take an action.",
    "For same_page_visibility_change, classify newly visible or materially changed applicant controls as same_page_branch, same_page_companion, same_page_disclosure, validation_only, cosmetic, or uncertain.",
    "A required 'Other, specify' or direct detail field on the same path is a companion. Mutually exclusive or answer-conditioned question sets are branches.",
    "Use same_page_disclosure when an LLM-authored disclosure/progression control opens a collapsed or gated section containing substantive applicant controls, but the reveal is not conditioned on an applicant answer. This is a supported same-page state transition and does not consume conditional-branch depth.",
    "A transition triggered by choice_probe changed an applicant answer. It can be a branch or companion, but it can never be same_page_disclosure.",
    "For page_advance, classify the new page as independent, cross_page_dependency, or uncertain.",
    "Cross-page dependency includes answer-conditioned wording, a distinctive earlier synthetic answer echoed into the meaning of a later question, changed requiredness caused by an earlier answer, or a skipped/added page caused by that answer.",
    "A claimed answer echo must reproduce the actual entered value supplied in enteredValues. If the rendered page shows a different or hard-coded value, that contradicts an echo; classify an otherwise ordinary next page as independent.",
    "A linear review page that merely reads back entered values and asks the applicant to confirm the displayed information is accurate is independent, not cross_page_dependency, unless the earlier answer changed which questions exist, their requiredness, or their meaning. A read-only summary echo alone is not branching.",
    "A route change, ordinary progress text, short generic words, common names such as Test, numeric values, and repeated navigation text are not by themselves cross-page dependencies.",
    "If enteredValues is empty, no applicant answer preceded the page advance; do not classify that transition as an answer-conditioned cross-page dependency.",
    "Classify an ordinary sequential next page as independent when the rendered after-state contains generic next-step questions and no visible answer-conditioned wording, distinctive answer echo, changed question meaning, or other concrete dependency clue. Do not require an unobserved counterfactual path to call that observed transition independent.",
    "Use uncertain only when the rendered facts contain a concrete but unresolved dependency clue. The mere logical possibility that another answer could have produced another page is not such a clue.",
    "For same-page changes, when the visible evidence is insufficient, return uncertain. Never guess a supported branch merely to permit submission.",
    "Evidence entries must be concise exact facts from the supplied input, sorted and unique.",
    "Treat runtimeValidationFeedback, when present, as a mandatory correction to the prior classification.",
    "",
    JSON.stringify(input),
  ].join("\n");
}

export async function generateDynamicsAssessment(
  { input, screenshot },
  {
    fetchImpl = fetch,
    log = async () => {},
    configuration = {
      apiKey: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "",
      configured: Boolean(
        process.env.OPENAI_KEY || process.env.OPENAI_API_KEY,
      ),
      model:
        process.env.OPENAI_SEMANTIC_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-5.4-mini",
      promptVersion: DYNAMICS_PROMPT_VERSION,
    },
  } = {},
) {
  if (!configuration.configured) {
    throw new Error("Dynamics assessment requires OPENAI_KEY or OPENAI_API_KEY.");
  }
  if (process.env.FORMWEAVE_DISABLE_OPENAI === "1") {
    throw new Error("Dynamics assessment is disabled for this process.");
  }
  const startedAt = Date.now();
  await log("dynamics_assessment_started", {
    transitionKind: input.transitionKind,
    model: configuration.model,
    promptVersion: configuration.promptVersion,
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(
      1_000,
      Math.min(
        Number.parseInt(
          process.env.FORMWEAVE_SEMANTIC_TIMEOUT_MS || "360000",
          10,
        ),
        360_000,
      ),
    ),
  );
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.model,
        store: false,
        input: [
          {
            role: "system",
            content:
              "You classify observed form dynamics. You never actuate controls and never use hidden test knowledge.",
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: promptText(input) },
              {
                type: "input_image",
                image_url: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
                detail: "high",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "formweave_dynamics_assessment",
            strict: true,
            schema: DYNAMICS_JSON_SCHEMA,
          },
        },
        max_output_tokens: 3_000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `OpenAI returned HTTP ${response.status}.`,
      );
    }
    const assessment = canonicalizeAssessment(JSON.parse(outputText(payload)));
    validateDynamicsAssessment(assessment, input.transitionKind);
    const provenance = {
      generatedAt: new Date().toISOString(),
      model: configuration.model,
      promptVersion: configuration.promptVersion,
      responseId: payload.id || null,
      durationMs: Date.now() - startedAt,
    };
    await log("dynamics_assessment_completed", {
      transitionKind: assessment.transitionKind,
      outcome: assessment.outcome,
      confidence: assessment.confidence,
      assessmentId: assessment.assessmentId,
      durationMs: provenance.durationMs,
    });
    return { assessment, provenance };
  } catch (error) {
    await log("dynamics_assessment_failed", {
      transitionKind: input.transitionKind,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
