export const SUBMISSION_RESULT_SCHEMA_VERSION = 1;
export const SUBMISSION_RESULT_PROMPT_VERSION =
  "phase1-submission-result-v1";

function outputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        throw new Error(
          `OpenAI declined submission-result assessment: ${content.refusal}`,
        );
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI returned no submission-result assessment.");
}

function normalized(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function visibleCorpus(observation) {
  return normalized(
    [
      observation?.title,
      observation?.heading,
      observation?.bodyText,
      observation?.accessibilitySnapshot,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function canonicalizeAssessment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    markers: Array.isArray(value.markers)
      ? [...new Set(value.markers.map((item) => String(item).trim()).filter(Boolean))].sort()
      : value.markers,
  };
}

export function validateSubmissionResultAssessment(value, observation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Submission-result assessment must be an object.");
  }
  const expectedKeys = [
    "assessmentId",
    "confidence",
    "markers",
    "outcome",
    "rationale",
    "schemaVersion",
  ].sort();
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("Submission-result assessment contains unexpected keys.");
  }
  if (value.schemaVersion !== SUBMISSION_RESULT_SCHEMA_VERSION) {
    throw new Error("Submission-result assessment schema is unsupported.");
  }
  if (
    typeof value.assessmentId !== "string" ||
    value.assessmentId.trim() === ""
  ) {
    throw new Error("Submission-result assessment requires an id.");
  }
  if (!["success", "failure", "unknown"].includes(value.outcome)) {
    throw new Error("Submission-result outcome is invalid.");
  }
  if (!["high", "medium", "low"].includes(value.confidence)) {
    throw new Error("Submission-result confidence is invalid.");
  }
  if (
    !Array.isArray(value.markers) ||
    value.markers.some(
      (marker) => typeof marker !== "string" || marker.trim() === "",
    ) ||
    JSON.stringify(value.markers) !==
      JSON.stringify([...new Set(value.markers)].sort())
  ) {
    throw new Error("Submission-result markers must be sorted and unique.");
  }
  if (typeof value.rationale !== "string" || value.rationale.trim() === "") {
    throw new Error("Submission-result assessment requires rationale.");
  }
  if (value.outcome !== "unknown" && value.markers.length === 0) {
    throw new Error("A success or failure assessment requires visible markers.");
  }
  const corpus = visibleCorpus(observation);
  for (const marker of value.markers) {
    if (!corpus.includes(normalized(marker))) {
      throw new Error(
        `Submission-result marker was not present in rendered facts: ${marker}`,
      );
    }
  }
  return value;
}

export function verifyStoredSubmissionResultCriteria(criteria, observation) {
  try {
    validateSubmissionResultAssessment(criteria, observation);
  } catch (error) {
    return {
      verified: false,
      outcome: "unknown",
      source: "stored_llm_criteria",
      detail: error instanceof Error ? error.message : String(error),
      criteria,
    };
  }
  const verified =
    criteria.outcome === "success" &&
    criteria.confidence === "high" &&
    criteria.markers.length > 0;
  return {
    verified,
    outcome: criteria.outcome,
    source: "stored_llm_criteria",
    detail: verified
      ? "Retained LLM-authored success markers were present in the rendered result."
      : `Retained result criteria classified the rendered outcome as ${criteria.outcome}.`,
    criteria,
  };
}

const SUBMISSION_RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: {
      type: "integer",
      enum: [SUBMISSION_RESULT_SCHEMA_VERSION],
    },
    assessmentId: { type: "string" },
    outcome: {
      type: "string",
      enum: ["success", "failure", "unknown"],
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    markers: {
      type: "array",
      items: { type: "string" },
    },
    rationale: { type: "string" },
  },
  required: [
    "schemaVersion",
    "assessmentId",
    "outcome",
    "confidence",
    "markers",
    "rationale",
  ],
  additionalProperties: false,
};

function promptText(observation) {
  return [
    "Classify the rendered result after a localhost test-form submission.",
    "Use only the supplied post-submit DOM text, accessibility snapshot, screenshot, URL, and transport facts.",
    "Return success only when the rendered page explicitly confirms that the form/application/request was received, submitted, accepted, or completed.",
    "Return failure when the rendered page explicitly says submission failed, was rejected, has errors, or was not received.",
    "Return unknown when there is no explicit visible outcome. HTTP 2xx, a submit event, a URL change, or a changed page alone never proves success.",
    "For success or failure, copy one or more short exact visible text markers from the supplied rendered facts. Markers must be sorted and unique.",
    "Use high confidence only for an explicit visible completion or failure statement.",
    "",
    JSON.stringify(observation),
  ].join("\n");
}

export async function generateSubmissionResultAssessment(
  { observation, screenshot },
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
      promptVersion: SUBMISSION_RESULT_PROMPT_VERSION,
    },
  } = {},
) {
  if (!configuration.configured) {
    throw new Error(
      "Submission-result assessment requires OPENAI_KEY or OPENAI_API_KEY.",
    );
  }
  if (process.env.FORMWEAVE_DISABLE_OPENAI === "1") {
    throw new Error(
      "Submission-result assessment is disabled for this process.",
    );
  }
  const startedAt = Date.now();
  await log("submission_result_assessment_started", {
    url: observation.url,
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
              "You classify rendered form-submission results. You never infer success from transport alone and never actuate a site.",
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: promptText(observation) },
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
            name: "formweave_submission_result",
            strict: true,
            schema: SUBMISSION_RESULT_JSON_SCHEMA,
          },
        },
        max_output_tokens: 2_000,
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
    validateSubmissionResultAssessment(assessment, observation);
    const provenance = {
      generatedAt: new Date().toISOString(),
      model: configuration.model,
      promptVersion: configuration.promptVersion,
      responseId: payload.id || null,
      durationMs: Date.now() - startedAt,
    };
    await log("submission_result_assessment_completed", {
      outcome: assessment.outcome,
      confidence: assessment.confidence,
      assessmentId: assessment.assessmentId,
      durationMs: provenance.durationMs,
    });
    return { assessment, provenance };
  } catch (error) {
    await log("submission_result_assessment_failed", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
