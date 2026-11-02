import {
  FinishReason,
  GenerateContentResponse,
  type GenerateContentParameters,
} from "@google/genai";
import { expect, it } from "@effect/vitest";
import {
  GEMINI_DEFAULT_MODEL,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { GeminiClient } from "./GeminiClient.ts";
import { makeGeminiAdapter } from "./GeminiAdapter.ts";
import {
  nativeProviderTestLayer,
  nativeProviderTurnInput,
  runNativeProviderTurn,
} from "./testUtils/nativeProviderV2.ts";
function response(input: {
  readonly text?: string;
  readonly thought?: boolean;
  readonly functionCall?: {
    readonly id: string;
    readonly name: string;
    readonly args: Record<string, unknown>;
  };
}): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            ...(input.text
              ? [
                  {
                    text: input.text,
                    ...(input.thought !== undefined ? { thought: input.thought } : {}),
                  },
                ]
              : []),
            ...(input.functionCall ? [{ functionCall: input.functionCall }] : []),
          ],
        },
        finishReason: FinishReason.STOP,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      totalTokenCount: 14,
    },
  });
}

function fakeClient(input: {
  readonly rounds: Array<ReadonlyArray<GenerateContentResponse>>;
  readonly requests: Array<GenerateContentParameters>;
}): GeminiClient {
  return {
    models: {
      generateContent: async () => response({ text: "{}" }),
      generateContentStream: async (request) => {
        input.requests.push(request);
        const chunks = input.rounds.shift() ?? [];
        return (async function* () {
          for (const chunk of chunks) yield chunk;
        })();
      },
      list: async () => {
        throw new Error("model discovery is not used by adapter tests");
      },
    },
  } as GeminiClient;
}

it.layer(nativeProviderTestLayer)("Gemini V2 adapter", (it) => {
  it.effect("runs more than 64 official SDK tool rounds through the V2 runtime", () =>
    Effect.gen(function* () {
      const requests: Array<GenerateContentParameters> = [];
      let executed = 0;
      const instanceId = ProviderInstanceId.make("gemini");
      const threadId = ThreadId.make("gemini-v2-test");
      const modelSelection = { instanceId, model: GEMINI_DEFAULT_MODEL, options: [] };
      const runtimePolicy = {
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        cwd: null,
      };
      const adapter = yield* makeGeminiAdapter(
        { enabled: true, customModels: [] },
        {
          instanceId,
          environment: { GOOGLE_API_KEY: "test-key" },
          clientFactory: () =>
            fakeClient({
              requests,
              rounds: [
                ...Array.from({ length: 65 }, (_, index) => [
                  response({
                    functionCall: {
                      id: `call-${index}`,
                      name: "workspace_context",
                      args: { queries: [{ text: `symbol-${index}` }] },
                    },
                  }),
                ]),
                [response({ text: "Finished all 65 searches." })],
              ],
            }),
          toolExecutor: {
            execute: () =>
              Effect.sync(() => {
                executed++;
                return {
                  ok: true,
                  itemType: "mcp_tool_call" as const,
                  title: "Search",
                  detail: "Done",
                  output: { matches: [] },
                };
              }),
          },
        },
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("gemini-v2-1"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runNativeProviderTurn(
        runtime,
        yield* nativeProviderTurnInput(providerThread, 1, modelSelection),
      );
      expect(executed).toBe(65);
      expect(requests).toHaveLength(66);
      expect(
        events.some(
          (event) =>
            event.type === "message.updated" && event.message.text === "Finished all 65 searches.",
        ),
      ).toBe(true);
    }),
  );
  it.effect("preserves selected thinking configuration and separate reasoning output", () =>
    Effect.gen(function* () {
      const requests: Array<GenerateContentParameters> = [];
      const instanceId = ProviderInstanceId.make("gemini");
      const threadId = ThreadId.make("gemini-thinking");
      const modelSelection = {
        instanceId,
        model: "gemini-3.6-flash",
        options: [{ id: "reasoningEffort", value: "high" }],
      };
      const runtimePolicy = {
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        cwd: null,
      };
      const adapter = yield* makeGeminiAdapter(
        { enabled: true, customModels: [] },
        {
          instanceId,
          environment: { GOOGLE_API_KEY: "test-key" },
          clientFactory: () =>
            fakeClient({
              requests,
              rounds: [
                [
                  response({ text: "Analyzing...", thought: true }),
                  response({ text: "Final answer." }),
                ],
              ],
            }),
          toolExecutor: { execute: () => Effect.die("No tool expected") },
        },
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("gemini-thinking"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runNativeProviderTurn(
        runtime,
        yield* nativeProviderTurnInput(providerThread, 1, modelSelection),
      );
      expect(requests[0]?.config?.thinkingConfig).toEqual({
        thinkingLevel: "HIGH",
        includeThoughts: true,
      });
      expect(
        events.some(
          (event) =>
            event.type === "turn_item.updated" &&
            event.turnItem.type === "reasoning" &&
            event.turnItem.text === "Analyzing...",
        ),
      ).toBe(true);
    }),
  );
});
