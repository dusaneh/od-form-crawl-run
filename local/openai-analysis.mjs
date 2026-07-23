const analysisSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A concise, factual summary of the forms and user journey found.",
    },
    pagePurpose: {
      type: "string",
      description: "The apparent purpose of the crawled pages.",
    },
    visibleForms: {
      type: "array",
      items: { type: "string" },
      description: "Human-readable names or descriptions of visible forms.",
    },
    inferredFields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          control: { type: "string" },
          required: { type: "boolean" },
          sensitive: { type: "boolean" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          evidence: {
            type: "string",
            description: "What in the screenshot or crawl facts supports the inference.",
          },
          originUrl: { type: "string" },
          defaultTestValue: {
            type: "string",
            description:
              "An obviously synthetic value suitable for exercising this inferred field.",
          },
        },
        required: [
          "label",
          "control",
          "required",
          "sensitive",
          "confidence",
          "evidence",
          "originUrl",
          "defaultTestValue",
        ],
        additionalProperties: false,
      },
    },
    keyFindings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tone: {
            type: "string",
            enum: ["success", "warning", "danger", "info"],
          },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["tone", "title", "detail"],
        additionalProperties: false,
      },
    },
    limitations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "summary",
    "pagePurpose",
    "visibleForms",
    "inferredFields",
    "keyFindings",
    "limitations",
  ],
  additionalProperties: false,
};

function outputText(response) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error(`OpenAI declined the analysis: ${content.refusal}`);
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI returned no analysis text.");
}

function pageFacts(pages) {
  return pages.map((page) => ({
    url: page.finalUrl,
    title: page.title,
    heading: page.heading,
    httpStatus: page.httpStatus,
    forms: page.forms,
    hasScripts: page.hasScripts,
    fields: page.fields.slice(0, 250).map((field) => ({
      key: field.key,
      label: field.label,
      control: field.control,
      required: field.required,
      sensitive: field.sensitive,
      hidden: field.hidden,
      options: field.options,
      defaultTestValue: field.testValue || "",
      testValues: field.testValues || [],
      entryStatus: field.entryStatus || "not_attempted",
    })),
    formActions: page.formActions,
    stateEvidence: (page.stateEvidence || []).map((state) => ({
      id: state.id,
      kind: state.kind,
      label: state.label,
      fingerprint: state.fingerprint,
      fieldsVisible: state.fieldsVisible,
      values: state.values,
    })),
    finalSubmission: page.finalSubmission || "not_requested",
  }));
}

export function openAIConfiguration() {
  const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || "";
  return {
    apiKey,
    configured: Boolean(apiKey),
    keySource: process.env.OPENAI_KEY
      ? "OPENAI_KEY"
      : process.env.OPENAI_API_KEY
        ? "OPENAI_API_KEY"
        : "none",
    model: process.env.OPENAI_MODEL || "gpt-5.6",
  };
}

export async function analyzeCrawl(pages, log) {
  const configuration = openAIConfiguration();
  if (!configuration.configured || process.env.FORMWEAVE_DISABLE_OPENAI === "1") {
    return {
      status: "skipped",
      model: configuration.model,
      summary: "",
      pagePurpose: "",
      visibleForms: [],
      inferredFields: [],
      keyFindings: [],
      limitations: [
        configuration.configured
          ? "OpenAI analysis was disabled for this process."
          : "No OPENAI_KEY or OPENAI_API_KEY was available to the local service.",
      ],
    };
  }

  const successfulPages = pages.filter((page) => !page.error);
  const content = [
    {
      type: "input_text",
      text: [
        "Analyze this synthetic form traversal.",
        "Treat DOM-extracted fields as observed facts.",
        "Use screenshots only to identify visible controls or structure that rendered-DOM extraction missed.",
        "Use the recorded state evidence and entry outcomes to report what was actually filled, branched, advanced, blocked, or submitted.",
        "For every inferred field, return an obviously synthetic defaultTestValue that could exercise it; use example.invalid for email and URL domains.",
        "Do not duplicate DOM fields in inferredFields unless the screenshot adds materially different information.",
        "Keep inferredFields conservative and state uncertainty in evidence.",
        "",
        JSON.stringify(pageFacts(successfulPages)),
      ].join("\n"),
    },
  ];

  for (const page of successfulPages.slice(0, 3)) {
    if (!page.screenshot || page.screenshot.byteLength > 5_000_000) continue;
    const mimeType = page.screenshotContentType || "image/png";
    content.push({
      type: "input_image",
      image_url: `data:${mimeType};base64,${Buffer.from(page.screenshot).toString("base64")}`,
      detail: "high",
    });
  }

  const controller = new AbortController();
  const configuredTimeout = Number.parseInt(
    process.env.FORMWEAVE_OPENAI_TIMEOUT_MS || "120000",
    10
  );
  const timeoutMs = Math.max(10, Math.min(configuredTimeout, 300_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  await log("openai_analysis_started", "Analyzing crawl facts and screenshots.", {
    model: configuration.model,
    screenshots: content.filter((item) => item.type === "input_image").length,
  });

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
              "You are a form-traversal analyst. Separate observed DOM facts, recorded synthetic interactions, and screenshot inference, and produce audit-ready structured output.",
          },
          { role: "user", content },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "formweave_crawl_analysis",
            strict: true,
            schema: analysisSchema,
          },
        },
        max_output_tokens: 4_000,
      }),
      signal: controller.signal,
    });

    const payload = await response.json();
    if (!response.ok) {
      const message =
        payload?.error?.message || `OpenAI returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    if (payload.status === "incomplete") {
      throw new Error(
        `OpenAI analysis was incomplete: ${payload.incomplete_details?.reason || "unknown reason"}.`
      );
    }

    const parsed = JSON.parse(outputText(payload));
    await log("openai_analysis_completed", "Structured OpenAI analysis stored.", {
      model: configuration.model,
      durationMs: Date.now() - startedAt,
      inferredFields: parsed.inferredFields.length,
    });
    return {
      status: "completed",
      model: configuration.model,
      ...parsed,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI analysis failed unexpectedly.";
    await log("openai_analysis_failed", message, {
      model: configuration.model,
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "failed",
      model: configuration.model,
      summary: "",
      pagePurpose: "",
      visibleForms: [],
      inferredFields: [],
      keyFindings: [],
      limitations: ["The deterministic crawl report is still complete and usable."],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
