import { reasoningEffortFor, reasoningRequestFor } from "../llm-reasoning.mjs";

function outputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI returned no structured text output.");
}

const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = new Set([
  "allOf",
  "dependentSchemas",
  "if",
  "not",
  "oneOf",
  "patternProperties",
  "then",
  "else",
  "unevaluatedProperties",
]);

export class StructuredOutputSchemaError extends TypeError {
  constructor(path, keyword) {
    super(
      `Structured output schema is not supported at ${path}: keyword "${keyword}" is unavailable.`,
    );
    this.name = "StructuredOutputSchemaError";
    this.code = "STRUCTURED_OUTPUT_SCHEMA_UNSUPPORTED";
    this.path = path;
    this.keyword = keyword;
  }
}

function inspectStructuredOutputSchema(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectStructuredOutputSchema(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS.has(key)) {
      throw new StructuredOutputSchemaError(`${path}.${key}`, key);
    }
    if (key === "properties" && item && typeof item === "object") {
      for (const [propertyName, propertySchema] of Object.entries(item)) {
        inspectStructuredOutputSchema(
          propertySchema,
          `${path}.properties.${propertyName}`,
        );
      }
      continue;
    }
    inspectStructuredOutputSchema(item, `${path}.${key}`);
  }
}

export function assertProviderStructuredOutputSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("Structured output schema must be an object.");
  }
  inspectStructuredOutputSchema(schema);
  return schema;
}

export function structuredModelConfiguration(modelVariable = "OPENAI_ACTUATOR_MODEL") {
  const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "";
  const callType =
    modelVariable === "OPENAI_SEMANTIC_MODEL" ? "semantic" : "actuator";
  return {
    configured: Boolean(apiKey),
    apiKey,
    callType,
    model:
      process.env[modelVariable] ||
      process.env.OPENAI_SEMANTIC_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.4-mini",
    reasoningEffort: reasoningEffortFor(callType),
  };
}

export async function callStructuredModel({
  name,
  schema,
  system,
  prompt,
  screenshot = null,
  fetchImpl = fetch,
  configuration = structuredModelConfiguration(),
  timeoutMs = 360_000,
  maxOutputTokens = 60_000,
}) {
  assertProviderStructuredOutputSchema(schema);
  if (!configuration.configured) {
    throw new Error("Structured model generation requires OPENAI_KEY or OPENAI_API_KEY.");
  }
  if (process.env.FORMWEAVE_DISABLE_OPENAI === "1") {
    throw new Error("Structured model generation is disabled for this process.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(Number(timeoutMs) || 360_000, 1_000), 360_000),
  );
  try {
    const content = [{ type: "input_text", text: prompt }];
    if (screenshot) {
      content.push({
        type: "input_image",
        image_url: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
        detail: "high",
      });
    }
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.model,
        ...reasoningRequestFor(
          configuration.callType || "actuator",
          configuration.reasoningEffort || "none",
        ),
        store: false,
        input: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema,
          },
        },
        max_output_tokens: maxOutputTokens,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `OpenAI returned HTTP ${response.status}.`,
      );
    }
    if (payload.status === "incomplete") {
      throw new Error(
        `OpenAI structured generation was incomplete: ${payload.incomplete_details?.reason || "unknown reason"}.`,
      );
    }
    return {
      value: JSON.parse(outputText(payload)),
      responseId: payload.id || null,
      model: configuration.model,
      reasoningEffort: configuration.reasoningEffort || "none",
    };
  } finally {
    clearTimeout(timeout);
  }
}
