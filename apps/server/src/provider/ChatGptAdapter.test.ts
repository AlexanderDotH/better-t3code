import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeChatGptAdapter,
  type ChatGptAdapterResponseRequest,
  type ChatGptAdapterTransport,
  type ChatGptHarness,
} from "./ChatGptAdapter.ts";
import {
  nativeProviderTestLayer,
  nativeProviderTurnInput,
  runNativeProviderTurn,
} from "./testUtils/nativeProviderV2.ts";
const noToolsHarness: ChatGptHarness = {
  declarations: () => Effect.succeed([]),
  isAvailable: () => Effect.succeed(false),
  requiresApproval: () => false,
  requestType: () => "dynamic_tool_call",
  approvalDetail: (name) => name,
  execute: () => Effect.die("No tool should execute."),
};

function fakeTransport(input: {
  readonly requests: Array<ChatGptAdapterResponseRequest>;
}): ChatGptAdapterTransport {
  const assistantItem = {
    type: "message",
    id: "message-1",
    role: "assistant",
    content: [{ type: "output_text", text: "Hello from ChatGPT." }],
  } as const;
  return {
    listModels: Effect.succeed([
      {
        id: "gpt-5.6-codex",
        displayName: "GPT-5.6 Codex",
        contextWindow: 400_000,
        default: true,
        reasoningEfforts: ["medium", "high"],
      },
    ]),
    streamResponse: (request) => {
      input.requests.push(request);
      return Stream.fromIterable([
        { type: "outputTextDelta" as const, itemId: "message-1", delta: "Hello " },
        { type: "outputTextDelta" as const, itemId: "message-1", delta: "from ChatGPT." },
        { type: "outputItemDone" as const, item: assistantItem },
        {
          type: "responseCompleted" as const,
          responseId: "response-1",
          status: "completed" as const,
          outputItems: [assistantItem],
          usage: {
            inputTokens: 11,
            cachedInputTokens: 3,
            outputTokens: 7,
            reasoningOutputTokens: 2,
            totalTokens: 18,
          },
        },
      ]);
    },
    compact: () => Effect.die("Compaction is not expected in this test."),
  };
}

it.layer(nativeProviderTestLayer)("ChatGPT V2 adapter", (it) => {
  it.effect("streams and resumes the direct subscription transcript without replaying tools", () =>
    Effect.gen(function* () {
      const requests: Array<ChatGptAdapterResponseRequest> = [];
      const instanceId = ProviderInstanceId.make("chatgpt");
      const threadId = ThreadId.make("chatgpt-v2-test");
      const modelSelection = { instanceId, model: "gpt-5.6-codex", options: [] };
      const runtimePolicy = {
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        cwd: null,
      };
      const adapter = yield* makeChatGptAdapter(
        { enabled: true },
        { instanceId, transport: fakeTransport({ requests }), harness: noToolsHarness },
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("chatgpt-v2-1"),
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
      expect(
        events.some(
          (event) =>
            event.type === "message.updated" && event.message.text === "Hello from ChatGPT.",
        ),
      ).toBe(true);
      expect(
        events.find(
          (event) =>
            event.type === "provider_turn.updated" && event.providerTurn.status === "completed",
        ),
      ).toMatchObject({
        providerTurn: {
          tokenUsage: { inputTokens: 11, outputTokens: 7 },
          responseMetrics: {
            tokenUsage: { inputTokens: 11, outputTokens: 7 },
            timeToFirstTokenMs: expect.any(Number),
            responseDurationMs: expect.any(Number),
          },
        },
      });
      const resumed = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("chatgpt-v2-2"),
        modelSelection,
        runtimePolicy,
      });
      const restored = yield* resumed.resumeThread({ providerThread });
      yield* runNativeProviderTurn(
        resumed,
        yield* nativeProviderTurnInput(restored, 2, modelSelection),
      );
      expect(requests[1]?.input.filter((item) => item.role === "assistant")).toHaveLength(1);
    }),
  );
});
