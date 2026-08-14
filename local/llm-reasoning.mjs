import { AsyncLocalStorage } from "node:async_hooks";

export const LLM_REASONING_PROFILE_VERSION = 1;
export const LLM_REASONING_EFFORTS = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export const LLM_REASONING_CALL_TYPES = Object.freeze([
  "semantic",
  "actuator",
  "analysis",
]);
export const DEFAULT_LLM_REASONING_PROFILE = Object.freeze({
  version: LLM_REASONING_PROFILE_VERSION,
  semantic: "none",
  actuator: "none",
  analysis: "none",
});

const profiles = new AsyncLocalStorage();
const effortSet = new Set(LLM_REASONING_EFFORTS);

export class LlmReasoningProfileError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "LlmReasoningProfileError";
    this.code = "LLM_REASONING_PROFILE_INVALID";
  }
}

export function normalizeLlmReasoningProfile(input = null) {
  if (input === null || input === undefined) {
    return { ...DEFAULT_LLM_REASONING_PROFILE };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LlmReasoningProfileError(
      "llmReasoning must be an object with semantic, actuator, and analysis effort values.",
    );
  }
  const allowedKeys = new Set(["version", ...LLM_REASONING_CALL_TYPES]);
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new LlmReasoningProfileError(
      `Unknown llmReasoning setting${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}.`,
    );
  }
  if (
    input.version !== undefined &&
    input.version !== LLM_REASONING_PROFILE_VERSION
  ) {
    throw new LlmReasoningProfileError(
      `llmReasoning.version must equal ${LLM_REASONING_PROFILE_VERSION}.`,
    );
  }
  const normalized = { ...DEFAULT_LLM_REASONING_PROFILE };
  for (const callType of LLM_REASONING_CALL_TYPES) {
    const effort = input[callType] ?? "none";
    if (!effortSet.has(effort)) {
      throw new LlmReasoningProfileError(
        `llmReasoning.${callType} must be one of: ${LLM_REASONING_EFFORTS.join(", ")}.`,
      );
    }
    normalized[callType] = effort;
  }
  return normalized;
}

export function withLlmReasoningProfile(profile, task) {
  if (typeof task !== "function") {
    throw new TypeError("withLlmReasoningProfile requires a task function.");
  }
  return profiles.run(normalizeLlmReasoningProfile(profile), task);
}

export function activeLlmReasoningProfile() {
  return profiles.getStore() || DEFAULT_LLM_REASONING_PROFILE;
}

export function reasoningEffortFor(callType) {
  if (!LLM_REASONING_CALL_TYPES.includes(callType)) {
    throw new TypeError(`Unknown LLM call type: ${callType}.`);
  }
  return activeLlmReasoningProfile()[callType];
}

export function reasoningRequestFor(callType, configuredEffort = null) {
  const effort = configuredEffort || reasoningEffortFor(callType);
  if (!effortSet.has(effort)) {
    throw new LlmReasoningProfileError(
      `Unsupported reasoning effort for ${callType}: ${effort}.`,
    );
  }
  return { reasoning: { effort } };
}
