import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { GeminiClient } from "../provider/GeminiClient.ts";
import { makeGeminiTextGeneration } from "./GeminiTextGeneration.ts";

it.effect("GeminiTextGeneration uses SDK structured output with the selected model", () =>
  Effect.gen(function* () {
    const requests: Array<GenerateContentParameters> = [];
    const client = {
      models: {
        generateContent: async (request: GenerateContentParameters) => {
          requests.push(request);
          return { text: '{"branch":"Add Gemini Provider!"}' } as GenerateContentResponse;
        },
        generateContentStream: async () => {
          throw new Error("streaming is not used by text-generation tests");
        },
        list: async () => {
          throw new Error("model discovery is not used by text-generation tests");
        },
      },
    } as GeminiClient;
    const textGeneration = yield* makeGeminiTextGeneration(
      { enabled: true, customModels: [] },
      { GOOGLE_API_KEY: "test-key" },
      () => client,
    );

    const generated = yield* textGeneration.generateBranchName({
      cwd: process.cwd(),
      message: "Add Gemini as a provider",
      modelSelection: {
        instanceId: ProviderInstanceId.make("gemini"),
        model: "gemini-3.6-flash",
      },
    });

    expect(generated).toEqual({ branch: "add-gemini-provider" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe("gemini-3.6-flash");
    expect(requests[0]?.config).toMatchObject({
      responseMimeType: "application/json",
      temperature: 0.2,
    });
    expect(requests[0]?.config?.responseJsonSchema).toMatchObject({
      type: "object",
      properties: { branch: { type: "string" } },
    });
  }),
);
