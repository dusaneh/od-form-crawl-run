import { openAIConfiguration } from "./openai-analysis.mjs";
import {
  branchTestValues,
  classifyFieldSafety,
  deterministicTestValue,
} from "./test-values.mjs";

const FINAL_ACTION =
  /\b(?:submit|send application|send request|apply now|complete application|finish application|place order|make payment|pay now|sign and submit|confirm submission)\b/i;
const INTERMEDIATE_ACTION =
  /\b(?:next|continue|review|proceed|save and continue|get started|start|begin)\b/i;

const plannerSchema = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          controlId: { type: "string" },
          action: {
            type: "string",
            enum: ["fill", "select", "check", "skip", "review"],
          },
          testValue: { type: "string" },
          classification: {
            type: "string",
            enum: ["deterministic", "conditional", "human_review"],
          },
          rationale: { type: "string" },
        },
        required: [
          "controlId",
          "action",
          "testValue",
          "classification",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
    branchControlIds: {
      type: "array",
      items: { type: "string" },
    },
    advance: {
      type: "object",
      properties: {
        controlId: { type: "string" },
        classification: {
          type: "string",
          enum: ["intermediate", "final", "review", "none"],
        },
        rationale: { type: "string" },
      },
      required: ["controlId", "classification", "rationale"],
      additionalProperties: false,
    },
  },
  required: ["fields", "branchControlIds", "advance"],
  additionalProperties: false,
};

function outputText(response) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error(`OpenAI declined traversal planning: ${content.refusal}`);
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI returned no traversal plan.");
}

function deterministicAction(descriptor, index) {
  const safety = classifyFieldSafety(descriptor);
  const type = descriptor.type;
  if (safety.classification === "human_review") {
    return {
      controlId: descriptor.controlId,
      action: "review",
      testValue: "",
      classification: "human_review",
      rationale: safety.reason,
    };
  }
  return {
    controlId: descriptor.controlId,
    action:
      type === "select" || type === "radio"
        ? "select"
        : ["checkbox", "switch"].includes(type)
          ? "check"
          : "fill",
    testValue: deterministicTestValue(descriptor, index),
    classification: "deterministic",
    rationale: safety.reason,
  };
}

function deterministicAdvance(advances) {
  const candidate =
    advances.find((item) => INTERMEDIATE_ACTION.test(item.label)) ||
    advances.find((item) => FINAL_ACTION.test(item.label)) ||
    advances[0];
  if (!candidate) {
    return {
      controlId: "",
      classification: "none",
      rationale: "No visible advance control was found.",
    };
  }
  return {
    controlId: candidate.controlId,
    classification: FINAL_ACTION.test(candidate.label)
      ? "final"
      : INTERMEDIATE_ACTION.test(candidate.label)
        ? "intermediate"
        : candidate.submitLike
          ? "review"
          : "intermediate",
    rationale: `Classified from the visible action label “${candidate.label}”.`,
  };
}

export function deterministicTraversalPlan(controls, advances, settings) {
  return {
    source: "deterministic",
    fields: controls.map(deterministicAction),
    branchControlIds: controls
      .filter(
        (control) =>
          branchTestValues(
            control,
            settings.maxBranchOptionsPerControl
          ).length > 1 &&
          classifyFieldSafety(control).classification !== "human_review"
      )
      .map((control) => control.controlId),
    advance: deterministicAdvance(advances),
  };
}

function validatePlan(plan, controls, advances, fallback) {
  const controlIds = new Set(controls.map((control) => control.controlId));
  const advanceIds = new Set(advances.map((advance) => advance.controlId));
  const llmFields = new Map(
    (plan.fields || [])
      .filter((field) => controlIds.has(field.controlId))
      .map((field) => [field.controlId, field])
  );
  const fields = fallback.fields.map((field) => {
    const proposed = llmFields.get(field.controlId);
    if (!proposed) return field;
    const descriptor = controls.find(
      (control) => control.controlId === field.controlId
    );
    const safety = classifyFieldSafety(descriptor);
    if (safety.classification === "human_review") {
      return {
        ...field,
        action: "review",
        testValue: "",
        classification: "human_review",
        rationale: safety.reason,
      };
    }
    return {
      ...proposed,
      testValue: String(proposed.testValue || field.testValue).slice(0, 500),
    };
  });
  const branchControlIds = [...new Set(plan.branchControlIds || [])].filter(
    (controlId) =>
      controlIds.has(controlId) &&
      fallback.branchControlIds.includes(controlId)
  );
  const advance =
    plan.advance &&
    (!plan.advance.controlId || advanceIds.has(plan.advance.controlId))
      ? plan.advance
      : fallback.advance;
  return {
    source: "llm",
    fields,
    branchControlIds,
    advance,
  };
}

export async function planFormTraversal(
  controls,
  advances,
  settings,
  log = async () => {}
) {
  const fallback = deterministicTraversalPlan(controls, advances, settings);
  const configuration = openAIConfiguration();
  if (
    !configuration.configured ||
    process.env.FORMWEAVE_DISABLE_OPENAI === "1" ||
    !controls.length
  ) {
    return fallback;
  }

  const controller = new AbortController();
  const configuredTimeout = Number.parseInt(
    process.env.FORMWEAVE_AGENT_TIMEOUT_MS || "45000",
    10
  );
  const timeoutMs = Math.max(1_000, Math.min(configuredTimeout, 120_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  await log(
    "form_agent_started",
    "Asking the traversal agent to classify controls and propose synthetic values.",
    {
      model: configuration.model,
      controls: controls.length,
      advances: advances.length,
    }
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
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
              "You plan synthetic form traversal. Propose test values and classify actions, but never override the hard safety boundary. Use only supplied control IDs.",
          },
          {
            role: "user",
            content: [
              settings.agentInstructions,
              "Return one field decision for every supplied control.",
              "Use obviously synthetic values. Never use a real person, credential, payment instrument, signature, uploaded file, or CAPTCHA answer.",
              JSON.stringify({
                controls: controls.slice(0, 150).map((control) => ({
                  controlId: control.controlId,
                  label: control.label,
                  type: control.type,
                  required: control.required,
                  options: (control.options || []).slice(0, 20),
                  autocomplete: control.autocomplete,
                  pattern: control.pattern,
                  min: control.min,
                  max: control.max,
                  minLength: control.minLength,
                  maxLength: control.maxLength,
                })),
                advances: advances.slice(0, 30),
              }),
            ].join("\n\n"),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "formweave_traversal_plan",
            strict: true,
            schema: plannerSchema,
          },
        },
        max_output_tokens: 6_000,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `OpenAI returned HTTP ${response.status}.`
      );
    }
    const plan = validatePlan(
      JSON.parse(outputText(payload)),
      controls,
      advances,
      fallback
    );
    await log("form_agent_completed", "Traversal agent plan accepted.", {
      model: configuration.model,
      durationMs: Date.now() - startedAt,
      fields: plan.fields.length,
      branches: plan.branchControlIds.length,
      advance: plan.advance.classification,
    });
    return plan;
  } catch (error) {
    await log(
      "form_agent_failed",
      error instanceof Error ? error.message : "Traversal planning failed.",
      {
        model: configuration.model,
        durationMs: Date.now() - startedAt,
        fallback: "deterministic",
      }
    );
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
