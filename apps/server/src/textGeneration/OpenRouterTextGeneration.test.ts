import { describe, expect, it } from "@effect/vitest";
import {
  type OpenRouterSettings,
  ProviderInstanceId,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  makeOpenRouterTextGeneration,
  type OpenRouterTextCompletion,
} from "./OpenRouterTextGeneration.ts";

const SETTINGS = {
  enabled: true,
  protocol: "chat-completions",
  defaultModel: "openai/gpt-5.5",
  customModels: [],
  contextCompression: false,
  routingMode: "openrouter-default",
  providerOrder: [],
  routingSort: "price",
  allowFallbacks: "inherit",
  dataCollection: "inherit",
  requireZdr: false,
} as const satisfies OpenRouterSettings;

const selection = {
  instanceId: ProviderInstanceId.make("openrouter"),
  model: "anthropic/claude-sonnet-4",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

describe("OpenRouterTextGeneration", () => {
  it.effect("uses the explicit provider default model for structured text generation", () =>
    Effect.gen(function* () {
      const requests: Array<Parameters<OpenRouterTextCompletion>[0]> = [];
      const complete: OpenRouterTextCompletion = (request) =>
        Effect.sync(() => {
          requests.push(request);
          return { text: '{"title":"  Native OpenRouter  "}' };
        });
      const textGeneration = makeOpenRouterTextGeneration(SETTINGS, complete);

      const result = yield* textGeneration.generateThreadTitle({
        cwd: "/workspace",
        message: "Implement OpenRouter",
        attachments: [],
        modelSelection: selection,
      });

      expect(result).toEqual({ title: "Native OpenRouter" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        model: "openai/gpt-5.5",
        reasoningEffort: "high",
      });
      expect(requests[0]?.instructions).toContain("exactly one JSON object");
    }),
  );

  it.effect("blocks text generation while the default model is missing", () =>
    Effect.gen(function* () {
      let calls = 0;
      const textGeneration = makeOpenRouterTextGeneration({ ...SETTINGS, defaultModel: "" }, () =>
        Effect.sync(() => {
          calls++;
          return { text: "{}" };
        }),
      );

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Blocked",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error.detail).toContain("default model");
      expect(calls).toBe(0);
    }),
  );

  it.effect("blocks text generation when the configured default left the live catalog", () =>
    Effect.gen(function* () {
      let calls = 0;
      const textGeneration = makeOpenRouterTextGeneration(
        SETTINGS,
        () =>
          Effect.sync(() => {
            calls++;
            return { text: "{}" };
          }),
        {
          isModelAvailable: (model) => {
            expect(model).toBe("openai/gpt-5.5");
            return Effect.succeed(false);
          },
        },
      );

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Blocked",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error.detail).toContain("no longer available");
      expect(calls).toBe(0);
    }),
  );

  it.effect("maps transport and schema failures without retaining provider payloads", () =>
    Effect.gen(function* () {
      const secret = "sk-or-secret-should-not-escape";
      const complete: OpenRouterTextCompletion = () =>
        Effect.fail(new TextCompletionTestError({ message: `upstream included ${secret}` }));
      const textGeneration = makeOpenRouterTextGeneration(SETTINGS, complete);

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Failure",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error.detail).toBe("OpenRouter text generation request failed.");
      expect(JSON.stringify(error)).not.toContain(secret);
    }),
  );
});

class TextCompletionTestError extends Schema.TaggedErrorClass<TextCompletionTestError>()(
  "TextCompletionTestError",
  { message: Schema.String },
) {}
