import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DecisionGenerationError,
  DecisionGenerationInput,
  DecisionGenerationResult,
} from "./decision.ts";

const decodeInput = Schema.decodeUnknownSync(DecisionGenerationInput);
const decodeResult = Schema.decodeUnknownSync(DecisionGenerationResult);

describe("DecisionGeneration contracts", () => {
  it("decodes provider-neutral choice questions and optional diagnostics", () => {
    expect(
      decodeInput({
        modelSelection: { instanceId: "openrouter", model: "native-decision-model" },
        state: "Choose only from the provided criteria.",
        questions: {
          context: {
            instructions: "Decide whether the retrieved context helps.",
            criteria: {
              include: "The context contains useful project facts.",
              skip: "The context is irrelevant or redundant.",
            },
          },
        },
      }).questions.context?.criteria,
    ).toEqual({
      include: "The context contains useful project facts.",
      skip: "The context is irrelevant or redundant.",
    });

    expect(
      decodeResult({
        model: "native-decision-model",
        answers: {
          context: {
            choice: "include",
            probabilities: { include: 0.9, skip: 0.1 },
            confidence: 0.8,
          },
        },
        usage: { inputTokens: 25, outputTokens: 2, totalTokens: 27, costUsd: 0.001 },
      }),
    ).toMatchObject({
      model: "native-decision-model",
      answers: { context: { choice: "include", confidence: 0.8 } },
      usage: { totalTokens: 27, costUsd: 0.001 },
    });
  });

  it("rejects empty decisions and out-of-range diagnostics", () => {
    const selection = { instanceId: "openrouter", model: "decision-model" };
    expect(() =>
      decodeInput({ modelSelection: selection, state: "state", questions: {} }),
    ).toThrow();
    expect(() =>
      decodeInput({
        modelSelection: selection,
        state: "state",
        questions: { context: { instructions: "Choose.", criteria: {} } },
      }),
    ).toThrow();
    expect(() =>
      decodeResult({
        model: "decision-model",
        answers: { context: { choice: "include", confidence: 1.1 } },
      }),
    ).toThrow();
    expect(() => decodeResult({ model: "decision-model", answers: {} })).toThrow();
  });

  it("exposes a structured provider-boundary error", () => {
    const error = new DecisionGenerationError({
      operation: "decide",
      reason: "invalid-response",
      detail: "The response selected an unknown choice.",
    });

    expect(error).toMatchObject({
      _tag: "DecisionGenerationError",
      operation: "decide",
      reason: "invalid-response",
    });
    expect(error.message).toContain("unknown choice");
  });
});
