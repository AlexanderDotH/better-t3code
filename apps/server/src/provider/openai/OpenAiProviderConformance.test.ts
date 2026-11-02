import { expect, it } from "@effect/vitest";
import {
  ChatAttachment,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { makeOpenAiAdapter } from "./OpenAiAdapter.ts";
import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import type { OpenAiRoundRequest } from "./OpenAiProtocol.ts";
import {
  nativeProviderTestLayer,
  nativeProviderTurnInput,
  runNativeProviderTurn,
} from "../testUtils/nativeProviderV2.ts";
const decodeAttachment = Schema.decodeEffect(ChatAttachment);
const encodeUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const MODEL: OpenAiCatalogModel = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isVerified: true,
};

it.layer(nativeProviderTestLayer)("OpenAI V2 conformance", (it) => {
  it.effect(
    "streams Responses output and resumes encrypted reasoning without retaining image bytes",
    () =>
      Effect.gen(function* () {
        const requests: Array<OpenAiRoundRequest> = [];
        const instanceId = ProviderInstanceId.make("openai-test");
        const threadId = ThreadId.make("openai-v2");
        const modelSelection = { instanceId, model: MODEL.id, options: [] };
        const runtimePolicy = {
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          cwd: null,
        };
        const adapter = yield* makeOpenAiAdapter(
          { enabled: true },
          {
            instanceId,
            transport: {
              listModels: Effect.succeed([MODEL]),
              streamRound: (request) => {
                requests.push({ ...request, history: [...request.history] });
                return Stream.fromIterable([
                  { type: "contentDelta" as const, kind: "assistant" as const, delta: "Answer" },
                  {
                    type: "completed" as const,
                    model: MODEL.id,
                    stopReason: "completed",
                    assistantText: "Answer",
                    historyItems: [
                      { type: "reasoning", id: "opaque", encrypted_content: "encrypted-state" },
                      {
                        type: "message",
                        role: "assistant",
                        content: [{ type: "output_text", text: "Answer" }],
                      },
                    ],
                    toolCalls: [],
                  },
                ]);
              },
            },
            harness: {
              declarations: () => Effect.succeed([]),
              isAvailable: () => Effect.succeed(false),
              requiresApproval: () => false,
              requestType: () => "dynamic_tool_call",
              approvalDetail: (name) => name,
              execute: () => Effect.die("No tool expected"),
            },
          },
        );
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("openai-session"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        const attachment = yield* decodeAttachment({
          type: "image",
          id: "test-image",
          name: "test.png",
          mimeType: "image/png",
          sizeBytes: 4,
        });
        const host = yield* ProviderHost;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFile(
          host.resolveAttachmentPath(attachment)!,
          new Uint8Array([1, 2, 3, 4]),
        );
        const input = yield* nativeProviderTurnInput(providerThread, 1, modelSelection);
        const events = yield* runNativeProviderTurn(runtime, {
          ...input,
          message: { ...input.message, attachments: [attachment] },
        });
        expect(
          events.some(
            (event) => event.type === "message.updated" && event.message.text === "Answer",
          ),
        ).toBe(true);
        const encoded = encodeUnknownJson;
        expect(yield* encoded(requests[0]?.history)).toContain("data:image/png;base64,");
        const resumed = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("openai-resumed"),
          modelSelection,
          runtimePolicy,
        });
        const restored = yield* resumed.resumeThread({ providerThread });
        yield* runNativeProviderTurn(
          resumed,
          yield* nativeProviderTurnInput(restored, 2, modelSelection),
        );
        expect(yield* encoded(requests[1]?.history)).toContain("encrypted-state");
        expect(yield* encoded(requests[1]?.history)).not.toContain("data:image/png;base64,");
      }),
  );
});
