import { it } from "@effect/vitest";
import { DecisionGenerationError, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import type { DecisionGenerationRequest } from "./DecisionGenerationProvider.ts";
import {
  buildPromptedDecisionRequest,
  makePromptedDecisionProvider,
} from "./PromptedDecisionGeneration.ts";

const request: DecisionGenerationRequest = {
  cwd: "/workspace",
  modelSelection: createModelSelection(ProviderInstanceId.make("prompted"), "text-model"),
  state: "Candidate index facts",
  questions: {
    relevance: {
      instructions: "Choose whether the facts help.",
      criteria: { include: "They help", skip: "They do not help" },
    },
  },
};
const promptedRequest = buildPromptedDecisionRequest(request);
const decodePromptedOutput = Schema.decodeEffect(promptedRequest.outputSchema);

describe("PromptedDecisionGeneration", () => {
  it.effect("builds a strict per-question choice schema", () =>
    Effect.gen(function* () {
      const valid = yield* decodePromptedOutput({
        answers: { relevance: { choice: "include", confidence: 0.8 } },
      });
      const invalid = yield* decodePromptedOutput({
        answers: { relevance: { choice: "invented" } },
      }).pipe(Effect.result);

      expect(valid.answers.relevance?.choice).toBe("include");
      expect(Result.isFailure(invalid)).toBe(true);
      expect(promptedRequest.prompt).toContain("<t3code_decision_call>");
      expect(promptedRequest.prompt).toContain("Candidate index facts");
    }),
  );

  it.effect("uses the selected generative model and preserves usage", () =>
    Effect.gen(function* () {
      const selectedModels: string[] = [];
      const provider = makePromptedDecisionProvider((input) =>
        Effect.sync(() => {
          selectedModels.push(input.modelSelection.model);
          return {
            output: { answers: { relevance: { choice: "skip" } } },
            model: "provider-resolved-model",
            usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
          };
        }),
      );

      const result = yield* provider.decide(request);

      expect(selectedModels).toEqual(["text-model"]);
      expect(result).toEqual({
        model: "provider-resolved-model",
        answers: { relevance: { choice: "skip" } },
        usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
      });
    }),
  );

  it.effect("propagates typed runner failures", () =>
    Effect.gen(function* () {
      const provider = makePromptedDecisionProvider(() =>
        Effect.fail(
          new DecisionGenerationError({
            operation: "decide",
            reason: "provider-failed",
            detail: "Structured generation failed.",
          }),
        ),
      );

      const result = yield* provider.decide(request).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toBe("provider-failed");
    }),
  );
});
