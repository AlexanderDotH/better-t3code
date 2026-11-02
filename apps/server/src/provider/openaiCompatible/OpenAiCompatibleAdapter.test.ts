import { expect, it, describe } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  TurnId,
  type OpenAiCompatibleSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeOpenAiCompatibleAdapter,
  makeOpenAiCompatibleHistoryStrategy,
  resolveOpenAiCompatibleModel,
} from "./OpenAiCompatibleAdapter.ts";
import { OpenAiCompatibleProtocolError } from "./OpenAiCompatibleProtocol.ts";
import {
  nativeProviderTestLayer,
  nativeProviderTurnInput,
  runNativeProviderTurn,
} from "../testUtils/nativeProviderV2.ts";
const INSTANCE = ProviderInstanceId.make("compatible-test");
const SETTINGS = {
  enabled: true,
  baseUrl: "http://localhost:1234/v1",
  defaultModel: "local/custom-coder",
  customModels: [],
} satisfies OpenAiCompatibleSettings;
describe("Compatible model and persistence policy", () => {
  it("accepts explicit manual models without a catalog or configured default", () => {
    expect(resolveOpenAiCompatibleModel(SETTINGS, "  model-not-in-catalog  ")).toEqual({
      ok: true,
      model: "model-not-in-catalog",
    });
    expect(resolveOpenAiCompatibleModel({ ...SETTINGS, defaultModel: "" }, "manual-model")).toEqual(
      { ok: true, model: "manual-model" },
    );
    expect(resolveOpenAiCompatibleModel(SETTINGS)).toEqual({
      ok: true,
      model: SETTINGS.defaultModel,
    });
    expect(resolveOpenAiCompatibleModel({ ...SETTINGS, enabled: false })).toMatchObject({
      ok: false,
    });
    expect(resolveOpenAiCompatibleModel({ ...SETTINGS, defaultModel: "" })).toMatchObject({
      ok: false,
    });
  });

  it.effect("validates persisted identity and turn boundaries", () =>
    Effect.gen(function* () {
      const history = makeOpenAiCompatibleHistoryStrategy({
        driverKind: "lmstudio",
        instanceId: INSTANCE,
        baseUrl: SETTINGS.baseUrl,
      });
      const persisted = {
        sessionId: "session-1",
        history: [{ type: "user" as const, content: "Hello" }],
        turns: [{ id: TurnId.make("turn-1"), historyStart: 0, historyEnd: 1, items: [] }],
        totalProcessedTokens: 10,
      };
      expect(yield* history.decode(history.encode(persisted), "session-1")).toEqual({
        history: persisted.history,
        turns: persisted.turns,
        totalProcessedTokens: 10,
      });
      const wrongSession = yield* history
        .decode(history.encode(persisted), "session-2")
        .pipe(Effect.flip);
      expect(wrongSession.detail).toContain("different provider instance");
      const invalid = history.encode({
        ...persisted,
        turns: [{ ...persisted.turns[0]!, historyEnd: 2 }],
      });
      expect((yield* history.decode(invalid, "session-1").pipe(Effect.flip)).detail).toContain(
        "turn boundaries",
      );
    }),
  );
});

it.layer(nativeProviderTestLayer)("Compatible V2 adapters", (it) => {
  it.effect.each(["openaiCompatible", "lmstudio"] as const)(
    "%s permits manual models and rejects history for a changed endpoint",
    (driverKind) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(`${driverKind}-v2`);
        const modelSelection = { instanceId: INSTANCE, model: "manual-model", options: [] };
        const runtimePolicy = {
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          cwd: null,
        };
        const options = {
          driverKind,
          instanceId: INSTANCE,
          transport: {
            baseUrl: SETTINGS.baseUrl,
            listModels: Effect.fail(
              new OpenAiCompatibleProtocolError({ message: "Catalog unavailable" }),
            ),
            streamRound: () =>
              Stream.succeed({
                type: "completed" as const,
                model: "manual-model",
                assistantText: "Answer",
                historyItems: [{ type: "assistant" as const, content: "Answer" }],
                toolCalls: [],
              }),
          },
          harness: {
            declarations: () => Effect.succeed([]),
            isAvailable: () => Effect.succeed(false),
            requiresApproval: () => false,
            requestType: () => "dynamic_tool_call" as const,
            approvalDetail: (name: string) => name,
            execute: () => Effect.die("No tool expected"),
          },
        };
        const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make(`${driverKind}-session`),
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
            (event) => event.type === "message.updated" && event.message.text === "Answer",
          ),
        ).toBe(true);
        const changed = yield* makeOpenAiCompatibleAdapter(
          { ...SETTINGS, baseUrl: "http://localhost:4321/v1" },
          {
            ...options,
            transport: { ...options.transport, baseUrl: "http://localhost:4321/v1" },
          },
        );
        const resumed = yield* changed.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make(`${driverKind}-changed`),
          modelSelection,
          runtimePolicy,
        });
        const failure = yield* resumed.resumeThread({ providerThread }).pipe(Effect.flip);
        expect(failure._tag).toBe("ProviderAdapterProtocolError");
      }),
  );
});
