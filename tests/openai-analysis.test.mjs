import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCrawl } from "../local/openai-analysis.mjs";

const page = {
  finalUrl: "https://forms.example.test/apply",
  title: "Fixture application",
  heading: "Apply",
  httpStatus: 200,
  forms: 1,
  hasScripts: true,
  fields: [
    {
      key: "email",
      label: "Email",
      control: "email",
      required: true,
      sensitive: true,
      hidden: false,
      options: 0,
    },
  ],
  formActions: ["https://forms.example.test/submit"],
  screenshot: new Uint8Array([1, 2, 3]),
  screenshotContentType: "image/png",
};

const validAnalysis = {
  summary: "A fixture application form.",
  pagePurpose: "Collect an application.",
  visibleForms: ["Fixture application"],
  inferredFields: [
    {
      label: "Household member name",
      control: "text",
      required: false,
      sensitive: true,
      confidence: "medium",
      evidence: "The review screenshot shows an additional household member section.",
      originUrl: "https://forms.example.test/apply",
      defaultTestValue: "Taylor Test",
    },
  ],
  keyFindings: [
    {
      tone: "success",
      title: "Observed form",
      detail: "One rendered form was observed.",
    },
  ],
  limitations: ["Submission was not tested."],
};

async function withMockedOpenAI(fetchImplementation, callback) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_KEY;
  const originalFallback = process.env.OPENAI_API_KEY;
  const originalDisabled = process.env.FORMWEAVE_DISABLE_OPENAI;
  const originalTimeout = process.env.FORMWEAVE_OPENAI_TIMEOUT_MS;
  process.env.OPENAI_KEY = "test-only-key";
  delete process.env.OPENAI_API_KEY;
  delete process.env.FORMWEAVE_DISABLE_OPENAI;
  globalThis.fetch = fetchImplementation;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_KEY;
    else process.env.OPENAI_KEY = originalKey;
    if (originalFallback === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalFallback;
    if (originalDisabled === undefined) delete process.env.FORMWEAVE_DISABLE_OPENAI;
    else process.env.FORMWEAVE_DISABLE_OPENAI = originalDisabled;
    if (originalTimeout === undefined) delete process.env.FORMWEAVE_OPENAI_TIMEOUT_MS;
    else process.env.FORMWEAVE_OPENAI_TIMEOUT_MS = originalTimeout;
  }
}

test("OpenAI success returns schema-constrained analysis and redacted events", async () => {
  let request;
  const logs = [];
  await withMockedOpenAI(
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(validAnalysis),
                },
              ],
            },
          ],
        }),
      };
    },
    async () => {
      const result = await analyzeCrawl([page], async (kind, message, metadata) => {
        logs.push({ kind, message, metadata });
      });
      assert.equal(result.status, "completed");
      assert.equal(result.summary, validAnalysis.summary);
      assert.equal(
        result.inferredFields[0].defaultTestValue,
        "Taylor Test"
      );
      assert.equal(request.url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(request.options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.equal(
        body.input[1].content.filter((item) => item.type === "input_image").length,
        1
      );
      assert.ok(logs.some((entry) => entry.kind === "openai_analysis_completed"));
      assert.ok(
        logs.every((entry) => !JSON.stringify(entry).includes("test-only-key"))
      );
    }
  );
});

test("OpenAI HTTP and malformed-output failures preserve a usable deterministic result", async () => {
  await withMockedOpenAI(
    async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Fixture rate limit" } }),
    }),
    async () => {
      const result = await analyzeCrawl([page], async () => {});
      assert.equal(result.status, "failed");
      assert.match(result.error, /Fixture rate limit/);
      assert.match(result.limitations[0], /deterministic crawl report/i);
    }
  );

  await withMockedOpenAI(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "{not-json" }],
          },
        ],
      }),
    }),
    async () => {
      const result = await analyzeCrawl([page], async () => {});
      assert.equal(result.status, "failed");
      assert.match(result.error, /JSON|position|property/i);
    }
  );
});

test("OpenAI timeout is bounded and reported without throwing", async () => {
  await withMockedOpenAI(
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Request aborted", "AbortError")),
          { once: true }
        );
      }),
    async () => {
      process.env.FORMWEAVE_OPENAI_TIMEOUT_MS = "10";
      const result = await analyzeCrawl([page], async () => {});
      assert.equal(result.status, "failed");
      assert.match(result.error, /aborted/i);
    }
  );
});

test("disabled OpenAI skips the network call", async () => {
  await withMockedOpenAI(
    async () => {
      throw new Error("fetch should not be called");
    },
    async () => {
      process.env.FORMWEAVE_DISABLE_OPENAI = "1";
      const result = await analyzeCrawl([page], async () => {});
      assert.equal(result.status, "skipped");
      assert.match(result.limitations[0], /disabled/i);
    }
  );
});
