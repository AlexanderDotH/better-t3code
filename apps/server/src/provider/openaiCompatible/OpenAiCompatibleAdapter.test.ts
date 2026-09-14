import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  McpServerDefinition,
  type OpenAiCompatibleSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import type { NativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import {
  buildNativeHarnessToolCatalog,
  nativeHarnessToolApprovalDetail,
  nativeHarnessToolIsAvailable,
  nativeHarnessToolRequestType,
  nativeHarnessToolRequiresApproval,
} from "../nativeHarness/NativeHarnessTools.ts";
import {
  makeOpenAiCompatibleAdapter,
  makeOpenAiCompatibleHistoryStrategy,
  resolveOpenAiCompatibleModel,
} from "./OpenAiCompatibleAdapter.ts";
import {
  OpenAiCompatibleProtocolError,
  type OpenAiCompatibleRoundEvent,
  type OpenAiCompatibleRoundRequest,
} from "./OpenAiCompatibleProtocol.ts";
import type { OpenAiCompatibleTransport } from "./OpenAiCompatibleTransport.ts";

const SETTINGS = {
  enabled: true,
  baseUrl: "http://localhost:1234/v1",
  defaultModel: "local/custom-coder",
  customModels: [],
} satisfies OpenAiCompatibleSettings;
const INSTANCE = ProviderInstanceId.make("compatible-test");
const MCP_SERVER = Schema.decodeUnknownSync(McpServerDefinition)({
  id: "docs",
  name: "Docs",
  transport: "http",
  url: "https://mcp.example.test",
});
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-compatible-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeHarness(executed: Array<string> = []): NativeProviderHarness {
  return {
    declarations: buildNativeHarnessToolCatalog,
    isAvailable: (input) => Effect.succeed(nativeHarnessToolIsAvailable(input)),
    requiresApproval: nativeHarnessToolRequiresApproval,
    requestType: nativeHarnessToolRequestType,
    approvalDetail: nativeHarnessToolApprovalDetail,
    execute: ({ name }) =>
      Effect.sync(() => {
        executed.push(name);
        return {
          ok: true,
          itemType: "file_change" as const,
          title: name,
          detail: "written",
          output: { written: true },
        };
      }),
  };
}

function completed(text: string): OpenAiCompatibleRoundEvent {
  return {
    type: "completed",
    model: SETTINGS.defaultModel,
    assistantText: text,
    toolCalls: [],
    historyItems: [{ type: "assistant", content: text }],
  };
}

function toolRound(args = "{}", name = "workspace_edit"): OpenAiCompatibleRoundEvent {
  return {
    type: "completed",
    model: SETTINGS.defaultModel,
    toolCalls: [{ sourceId: "call-1", name, arguments: args }],
    historyItems: [
      { type: "assistant", content: "", toolCalls: [{ id: "call-1", name, arguments: args }] },
    ],
  };
}

function makeTransport(
  rounds: Array<OpenAiCompatibleRoundEvent>,
  requests: Array<OpenAiCompatibleRoundRequest> = [],
): OpenAiCompatibleTransport {
  return {
    baseUrl: SETTINGS.baseUrl,
    listModels: Effect.fail(
      new OpenAiCompatibleProtocolError({ message: "Models route unavailable" }),
    ),
    streamRound: (request) => {
      requests.push({ ...request, history: [...request.history] });
      const round = rounds.shift();
      return round ? Stream.succeed(round) : Stream.empty;
    },
  };
}

describe("OpenAiCompatibleAdapter", () => {
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

  for (const driverKind of ["openaiCompatible", "lmstudio"] as const) {
    it.effect(
      `${driverKind} owns approvals, tool history, model switching, resume, and rollback`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const requests: Array<OpenAiCompatibleRoundRequest> = [];
            const executed: Array<string> = [];
            const transport = makeTransport(
              [
                toolRound(),
                completed("Written"),
                completed("Second answer"),
                completed("After rollback"),
              ],
              requests,
            );
            const options = {
              driverKind,
              instanceId: INSTANCE,
              transport,
              harness: makeHarness(executed),
              resolveMcpServers: () => Effect.succeed([MCP_SERVER]),
            };
            const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
            const threadId = ThreadId.make(`${driverKind}-history`);
            const session = yield* adapter.startSession({
              threadId,
              provider: ProviderDriverKind.make(driverKind),
              providerInstanceId: INSTANCE,
              cwd: process.cwd(),
              runtimeMode: "approval-required",
              sandboxMode: "workspace-write",
            });
            expect(session.providerInstanceId).toBe(INSTANCE);
            assert.isDefined(adapter.mcpRuntime);
            assert.isDefined(session.runtimeSessionId);
            const mcpTarget = {
              providerInstanceId: INSTANCE,
              threadId,
              runtimeSessionId: session.runtimeSessionId,
            };
            expect(yield* adapter.mcpRuntime.getSnapshot(mcpTarget)).toMatchObject([
              { serverId: "docs", source: "t3-managed", providerInstanceId: INSTANCE, threadId },
            ]);
            const otherInstanceMcp = yield* adapter.mcpRuntime
              .getSnapshot({
                ...mcpTarget,
                providerInstanceId: ProviderInstanceId.make("other-instance"),
              })
              .pipe(Effect.flip);
            expect(otherInstanceMcp._tag).toBe("ProviderAdapterValidationError");
            const openedFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.type === "request.opened"),
              Stream.runHead,
              Effect.forkChild({ startImmediately: true }),
            );
            const turnFiber = yield* adapter
              .sendTurn({ threadId, input: "Write it" })
              .pipe(Effect.forkChild);
            const opened = yield* Fiber.join(openedFiber);
            assert.isOk(Option.isSome(opened) && opened.value.type === "request.opened");
            assert.isDefined(opened.value.requestId);
            expect(opened.value.provider).toBe(driverKind);
            expect(opened.value.runtimeSessionId).toBe(session.runtimeSessionId);
            expect(executed).toEqual([]);
            yield* adapter.respondToRequest(
              threadId,
              ApprovalRequestId.make(opened.value.requestId),
              "accept",
            );
            yield* Fiber.join(turnFiber);
            expect(executed).toEqual(["workspace_edit"]);
            expect(requests[1]?.history).toContainEqual({
              type: "tool",
              name: "workspace_edit",
              callId: "call-1",
              content: '{"written":true}',
            });
            yield* adapter.sendTurn({
              threadId,
              input: "Second question",
              modelSelection: { instanceId: INSTANCE, model: "another-manual-model" },
            });
            expect(requests[2]?.model).toBe("another-manual-model");
            const beforeResume = yield* adapter.readThread(threadId);
            expect(beforeResume.turns).toHaveLength(2);
            yield* adapter.stopSession(threadId);

            const resumedAdapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
            const resumed = yield* resumedAdapter.startSession({
              threadId,
              provider: ProviderDriverKind.make(driverKind),
              providerInstanceId: INSTANCE,
              cwd: process.cwd(),
              runtimeMode: "full-access",
              sandboxMode: "workspace-write",
              modelSelection: { instanceId: INSTANCE, model: "another-manual-model" },
              resumeCursor: session.resumeCursor,
            });
            expect(resumed.resumeCursor).toEqual(session.resumeCursor);
            expect(yield* resumedAdapter.readThread(threadId)).toEqual(beforeResume);
            yield* resumedAdapter.rollbackThread(threadId, 1);
            yield* resumedAdapter.sendTurn({ threadId, input: "Continue" });
            expect(requests[3]?.model).toBe("another-manual-model");
            expect(requests[3]?.history).toContainEqual({ type: "assistant", content: "Written" });
            expect(requests[3]?.history).not.toContainEqual({
              type: "user",
              content: "Second question",
            });
          }),
        ).pipe(Effect.provide(testLayer)),
    );
  }

  it.effect("rejects resume after an endpoint URL change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("endpoint-change");
        const options = {
          driverKind: "openaiCompatible" as const,
          instanceId: INSTANCE,
          harness: makeHarness(),
          transport: makeTransport([]),
        };
        const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
        const input = { threadId, cwd: process.cwd(), runtimeMode: "full-access" as const };
        const session = yield* adapter.startSession(input);
        yield* adapter.stopSession(threadId);
        const changed = yield* makeOpenAiCompatibleAdapter(
          { ...SETTINGS, baseUrl: "http://elsewhere.test/v1" },
          {
            ...options,
            transport: { ...options.transport, baseUrl: "http://elsewhere.test/v1" },
          },
        );
        const error = yield* changed
          .startSession({ ...input, resumeCursor: session.resumeCursor })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "session/resume",
          detail: expect.stringContaining("different endpoint"),
        });
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  for (const mode of ["plan", "read-only", "fetch-worker"] as const) {
    it.effect(`blocks write tools in ${mode} mode`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const requests: Array<OpenAiCompatibleRoundRequest> = [];
          const executed: Array<string> = [];
          const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, {
            driverKind: "lmstudio",
            instanceId: INSTANCE,
            harness: makeHarness(executed),
            transport: makeTransport([toolRound(), completed("Read only")], requests),
          });
          const threadId = ThreadId.make(`policy-${mode}`);
          yield* adapter.startSession({
            threadId,
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: mode === "read-only" ? "read-only" : "danger-full-access",
            ...(mode === "fetch-worker" ? { purpose: "fetch-worker" } : {}),
          });
          yield* adapter.sendTurn({
            threadId,
            input: "Inspect",
            interactionMode: mode === "plan" ? "plan" : "default",
          });
          expect(requests[0]?.instructions).toContain("Read-only");
          expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("workspace_edit");
          expect(requests[0]?.tools.map((tool) => tool.name)).not.toContain("exec_command");
          expect(executed).toEqual([]);
          expect(requests[1]?.history).toContainEqual(
            expect.objectContaining({
              type: "tool",
              content: expect.stringContaining("not available"),
            }),
          );
        }),
      ).pipe(Effect.provide(testLayer)),
    );
  }

  it.effect("cancels an in-flight round and resumes only completed history", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<AbortSignal>();
        const blocked = yield* Deferred.make<OpenAiCompatibleRoundEvent>();
        const requests: Array<OpenAiCompatibleRoundRequest> = [];
        const options = {
          driverKind: "openaiCompatible" as const,
          instanceId: INSTANCE,
          harness: makeHarness(),
          transport: {
            ...makeTransport([]),
            streamRound: (request: OpenAiCompatibleRoundRequest) => {
              requests.push({ ...request, history: [...request.history] });
              if (requests.length !== 2) return Stream.succeed(completed("Saved answer"));
              return Stream.fromEffect(
                Effect.gen(function* () {
                  assert.isDefined(request.signal);
                  yield* Deferred.succeed(started, request.signal);
                  return yield* Deferred.await(blocked);
                }),
              );
            },
          },
        };
        const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
        const threadId = ThreadId.make("interrupt-round");
        const sessionInput = { threadId, cwd: process.cwd(), runtimeMode: "full-access" as const };
        const session = yield* adapter.startSession(sessionInput);
        yield* adapter.sendTurn({ threadId, input: "Saved prompt" });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Cancelled prompt" })
          .pipe(Effect.forkChild);
        const signal = yield* Deferred.await(started);
        yield* adapter.interruptTurn(threadId);
        const exit = yield* Fiber.await(turnFiber);
        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(signal.aborted).toBe(true);
        expect((yield* adapter.readThread(threadId)).turns).toHaveLength(1);
        expect((yield* adapter.listSessions())[0]?.status).toBe("ready");
        yield* adapter.stopSession(threadId);
        const resumedAdapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, options);
        yield* resumedAdapter.startSession({ ...sessionInput, resumeCursor: session.resumeCursor });
        yield* resumedAdapter.sendTurn({ threadId, input: "Continue" });
        expect(requests[2]?.history).toEqual([
          { type: "user", content: "Saved prompt" },
          { type: "assistant", content: "Saved answer" },
          { type: "user", content: "Continue" },
        ]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects attachments and malformed tool arguments without executing tools", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const executed: Array<string> = [];
        const requests: Array<OpenAiCompatibleRoundRequest> = [];
        const adapter = yield* makeOpenAiCompatibleAdapter(SETTINGS, {
          driverKind: "openaiCompatible",
          instanceId: INSTANCE,
          harness: makeHarness(executed),
          transport: makeTransport([toolRound('{"secret":"hidden"')], requests),
        });
        const threadId = ThreadId.make("invalid-input");
        yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
        for (const type of ["image", "audio"] as const) {
          const error = yield* adapter
            .sendTurn({
              threadId,
              input: "Read attachment",
              attachments: [
                { type, id: "attachment", name: "sample", mimeType: `${type}/test`, sizeBytes: 1 },
              ],
            })
            .pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "ProviderAdapterValidationError",
            issue: expect.stringContaining("Image and audio"),
          });
        }
        expect(requests).toHaveLength(0);
        const error = yield* adapter
          .sendTurn({ threadId, input: "Malformed tool" })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          detail: expect.stringContaining("malformed arguments"),
        });
        expect(error.message).not.toContain("hidden");
        expect(executed).toEqual([]);
        expect((yield* adapter.readThread(threadId)).turns).toEqual([]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

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
