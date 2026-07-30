import { describe, expect, it } from "vite-plus/test";

import {
  buildGeminiThinkingConfig,
  deriveGeminiReasoningEffortSteps,
  GeminiThinkingLevel,
  reasoningEffortToGeminiThinkingBudget,
} from "./GeminiThinkingConfig.ts";

describe("Gemini thinking config", () => {
  it("uses thinkingLevel for Gemini 3 models", () => {
    expect(buildGeminiThinkingConfig("gemini-3-pro-preview", "minimal")).toEqual({
      thinkingLevel: GeminiThinkingLevel.MINIMAL,
      includeThoughts: true,
    });
    expect(buildGeminiThinkingConfig("gemini-3-flash-preview", "xhigh")).toEqual({
      thinkingLevel: GeminiThinkingLevel.HIGH,
      includeThoughts: true,
    });
  });

  it("uses bounded thinkingBudget for Gemini 2.5 Flash and Pro models", () => {
    expect(buildGeminiThinkingConfig("gemini-2.5-flash", "high")).toEqual({
      thinkingBudget: 18432,
      includeThoughts: true,
    });
    expect(buildGeminiThinkingConfig("gemini-2.5-pro", "xhigh")).toEqual({
      thinkingBudget: 32768,
      includeThoughts: true,
    });
    expect(reasoningEffortToGeminiThinkingBudget("gemini-2.5-flash-lite", "xhigh")).toBe(24576);
  });

  it("omits thinking config for Gemini models without direct reasoning controls", () => {
    expect(buildGeminiThinkingConfig("gemini-2.0-flash", "medium")).toBeUndefined();
    expect(buildGeminiThinkingConfig("text-embedding-004", "medium")).toBeUndefined();
  });

  it("derives the selectable reasoning steps by Gemini model family", () => {
    expect(deriveGeminiReasoningEffortSteps("gemini-3-pro-preview")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(deriveGeminiReasoningEffortSteps("gemini-2.5-pro")).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(deriveGeminiReasoningEffortSteps("gemini-2.0-flash")).toEqual([]);
  });
});
