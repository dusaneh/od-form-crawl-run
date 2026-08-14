import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LLM_REASONING_PROFILE,
  activeLlmReasoningProfile,
  normalizeLlmReasoningProfile,
  reasoningRequestFor,
  withLlmReasoningProfile,
} from "../local/llm-reasoning.mjs";
import { callStructuredModel } from "../local/semantic/structured-model.mjs";

test("reasoning defaults remain none for every LLM call type", () => {
  assert.deepEqual(normalizeLlmReasoningProfile(), {
    ...DEFAULT_LLM_REASONING_PROFILE,
  });
  assert.deepEqual(reasoningRequestFor("semantic"), {
    reasoning: { effort: "none" },
  });
});

test("reasoning profiles reject unknown call types and unsupported efforts", () => {
  assert.throws(
    () => normalizeLlmReasoningProfile({ semantic: "maximum" }),
    (error) => error?.code === "LLM_REASONING_PROFILE_INVALID",
  );
  assert.throws(
    () => normalizeLlmReasoningProfile({ semantic: "high", crawler: "low" }),
    (error) => error?.code === "LLM_REASONING_PROFILE_INVALID",
  );
  assert.throws(
    () => normalizeLlmReasoningProfile({ version: 2 }),
    (error) => error?.code === "LLM_REASONING_PROFILE_INVALID",
  );
});

test("concurrent runs retain isolated per-call reasoning profiles", async () => {
  const [first, second] = await Promise.all([
    withLlmReasoningProfile(
      { semantic: "high", actuator: "medium", analysis: "low" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ...activeLlmReasoningProfile() };
      },
    ),
    withLlmReasoningProfile(
      { semantic: "low", actuator: "xhigh", analysis: "none" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ...activeLlmReasoningProfile() };
      },
    ),
  ]);
  assert.equal(first.semantic, "high");
  assert.equal(first.actuator, "medium");
  assert.equal(second.semantic, "low");
  assert.equal(second.actuator, "xhigh");
  assert.equal(activeLlmReasoningProfile().semantic, "none");
});

test("structured model requests send the configured reasoning effort", async () => {
  let requestBody = null;
  const result = await callStructuredModel({
    name: "reasoning_payload_test",
    schema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    system: "Return the answer.",
    prompt: "Return ok.",
    configuration: {
      configured: true,
      apiKey: "test-key",
      model: "gpt-5.4-mini",
      callType: "actuator",
      reasoningEffort: "xhigh",
    },
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ id: "resp_reasoning", output_text: '{"answer":"ok"}' }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.deepEqual(requestBody.reasoning, { effort: "xhigh" });
  assert.equal(result.reasoningEffort, "xhigh");
});
