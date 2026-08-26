import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import {
  makeNativeProviderAdapter,
  type NativeProviderRoundEvent,
  type NativeProviderToolCall,
  type NativeProviderToolResult,
} from "./NativeProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("native-test");
const INSTANCE = ProviderInstanceId.make("native-test");
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-native-provider-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

type TestHistoryItem = Readonly<Record<string, unknown>> & { readonly type: string };
type TestToolCall = NativeProviderToolCall<{ readonly callId: string }>;

function makeTestAdapter(input: {
  readonly rounds: Array<ReadonlyArray<NativeProviderRoundEvent<TestHistoryItem, TestToolCall>>>;
  readonly executed: Array<string>;
  readonly maxIdleWorkingSets?: number;
  readonly maxParallelToolCalls?: number;
  readonly onWorkingSetEvicted?: (threadId: ThreadId) => void;
  readonly requiresApproval?: boolean;
  readonly execute?: (
    name: string,
  ) => Effect.Effect<NativeProviderToolResult, ProviderAdapterRequestError>;
  readonly streamRound?: (input: {
    readonly signal: AbortSignal;
  }) => Stream.Stream<
    NativeProviderRoundEvent<TestHistoryItem, TestToolCall>,
    ProviderAdapterRequestError
  >;
}) {
  return makeNativeProviderAdapter<TestHistoryItem, object, object, object, TestToolCall>({
    provider: PROVIDER,
    instanceId: INSTANCE,
    capabilities: { sessionModelSwitch: "in-session", mcp: "unsupported" },
    messages: {
      sessionStarted: "Native test session owned by T3 Code",
      sessionReady: "Native test session ready",
      turnRunning: "Native test turn running",
      turnSettled: "Native test turn settled",
    },
    limits: {
      maxIdleWorkingSets: input.maxIdleWorkingSets,
      maxToolDefinitions: 8,
      maxToolOutputBytes: 1024,
      maxToolRounds: 4,
      maxParallelToolCalls: input.maxParallelToolCalls ?? 2,
    },
    history: {
      directoryName: "native-test",
      resumeVersion: 1,
      encode: ({ sessionId, history, turns, totalProcessedTokens }) =>
        JSON.stringify({ schemaVersion: 1, sessionId, history, turns, totalProcessedTokens }),
      decode: (encoded, sessionId) =>
        Effect.gen(function* () {
          const value = yield* decodeJson(encoded).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/resume",
                  detail: "Invalid test history JSON.",
                  cause,
                }),
            ),
          );
          if (
            !Predicate.isObject(value) ||
            !Object.hasOwn(value, "sessionId") ||
            value.sessionId !== sessionId ||
            !Object.hasOwn(value, "history") ||
            !Array.isArray(value.history) ||
            !Object.hasOwn(value, "turns") ||
            !Array.isArray(value.turns)
          ) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/resume",
              detail: "Invalid test history shape.",
            });
          }
          return {
            history: value.history as Array<TestHistoryItem>,
            turns: value.turns as Array<{
              id: ReturnType<typeof import("@t3tools/contracts").TurnId.make>;
              historyStart: number;
              historyEnd: number;
              items: Array<unknown>;
            }>,
            totalProcessedTokens:
              Object.hasOwn(value, "totalProcessedTokens") &&
              typeof value.totalProcessedTokens === "number"
                ? value.totalProcessedTokens
                : 0,
          };
        }),
    },
    start: () =>
      Effect.succeed({
        model: "test-model",
        state: {},
        configured: { harness: "t3-code", model: "test-model" },
      }),
    prepareTurn: ({ input: turnInput }) =>
      Effect.succeed({
        model: "test-model",
        userHistoryItems: [{ type: "user", text: turnInput.input ?? "" }],
        attachmentBytes: 0,
        toolDeclarations: [{ name: "write_file" }],
        protocol: {},
      }),
    streamRound: (roundInput) =>
      input.streamRound?.({ signal: roundInput.signal }) ??
      Stream.fromIterable(input.rounds.shift() ?? []),
    toolHarness: {
      isAvailable: () => Effect.succeed(true),
      requiresApproval: () => input.requiresApproval ?? true,
      requestType: () => "file_change_approval",
      approvalDetail: (name) => name,
      execute: ({ name }) => {
        input.executed.push(name);
        return (
          input.execute?.(name) ??
          Effect.succeed({
            ok: true,
            itemType: "file_change",
            title: name,
            detail: "written",
            output: { written: true },
          })
        );
      },
    },
    toolResultsToHistoryItems: ({ results }) =>
      results.map(({ call, result }) => ({
        type: "tool",
        callId: call.metadata.callId,
        output: result.output,
      })),
    onWorkingSetEvicted: input.onWorkingSetEvicted,
  });
}

describe("NativeProviderAdapter", () => {
  it.effect("owns start and stop lifecycle state and events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter({ executed: [], rounds: [] });
        const lifecycle: Array<string> = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === "session.started" || event.type === "session.exited") {
                lifecycle.push(event.type);
              }
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("native-core-lifecycle");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        expect(yield* adapter.hasSession(threadId)).toBe(true);
        expect(yield* adapter.listSessions()).toHaveLength(1);
        yield* adapter.stopSession(threadId);
        yield* Effect.yieldNow;
        expect(yield* adapter.hasSession(threadId)).toBe(false);
        expect(yield* adapter.listSessions()).toEqual([]);
        expect(lifecycle).toEqual(["session.started", "session.exited"]);
        yield* Fiber.interrupt(eventFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("emits terminal-only assistant and reasoning content as canonical items", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "Answer", reasoning: "Reason" }],
                toolCalls: [],
                assistantText: "Answer",
                reasoningText: "Reason",
              },
            ],
          ],
        });
        const events: Array<{
          readonly type: string;
          readonly payload: Readonly<Record<string, unknown>>;
        }> = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === "content.delta" || event.type === "item.completed") {
                events.push(event);
              }
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("native-core-terminal-content");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        yield* adapter.sendTurn({ threadId, input: "Respond" });
        yield* Effect.yieldNow;

        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "Answer" },
            }),
            expect.objectContaining({
              type: "content.delta",
              payload: { streamKind: "reasoning_text", delta: "Reason" },
            }),
            expect.objectContaining({
              type: "item.completed",
              payload: expect.objectContaining({
                itemType: "assistant_message",
                data: { text: "Answer" },
              }),
            }),
            expect.objectContaining({
              type: "item.completed",
              payload: expect.objectContaining({
                itemType: "reasoning",
                data: { text: "Reason" },
              }),
            }),
          ]),
        );
        yield* Fiber.interrupt(eventFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("owns approval, tool-loop, persistence, resume, and rollback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const executed: Array<string> = [];
        const call: TestToolCall = {
          sourceId: "tool-item",
          name: "write_file",
          args: { path: "notes.txt" },
          metadata: { callId: "call-1" },
        };
        const adapter = yield* makeTestAdapter({
          executed,
          rounds: [
            [
              { type: "contentDelta", kind: "reasoning", delta: "Thinking" },
              {
                type: "completed",
                historyItems: [{ type: "assistant", calls: 1 }],
                toolCalls: [call],
              },
            ],
            [
              { type: "contentDelta", kind: "assistant", delta: "Done" },
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "Done" }],
                toolCalls: [],
                usage: {
                  usedTokens: 12,
                  inputTokens: 8,
                  cachedInputTokens: 0,
                  outputTokens: 4,
                  reasoningOutputTokens: 1,
                },
              },
            ],
          ],
        });
        const threadId = ThreadId.make("native-core-tool-loop");
        const session = yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          sandboxMode: "workspace-write",
        });
        const openedFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "request.opened"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Write it" })
          .pipe(Effect.forkChild);
        const opened = yield* Fiber.join(openedFiber);
        expect(Option.isSome(opened)).toBe(true);
        if (Option.isNone(opened) || opened.value.type !== "request.opened") return;
        expect(executed).toEqual([]);
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(opened.value.requestId),
          "accept",
        );
        yield* Fiber.join(turnFiber);
        expect(executed).toEqual(["write_file"]);

        const beforeResume = yield* adapter.readThread(threadId);
        expect(beforeResume.turns).toHaveLength(1);
        expect(beforeResume.turns[0]?.items).toEqual([
          { type: "reasoning", text: "Thinking" },
          {
            type: "file_change",
            name: "write_file",
            title: "write_file",
            detail: "written",
            output: { written: true },
          },
          { type: "assistant_message", text: "Done" },
        ]);
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          sandboxMode: "workspace-write",
          resumeCursor: session.resumeCursor,
        });
        expect((yield* adapter.readThread(threadId)).turns).toEqual(beforeResume.turns);
        expect((yield* adapter.rollbackThread(threadId, 1)).turns).toEqual([]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("bounds parallel tool execution to the provider limit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bothStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let active = 0;
        let maxActive = 0;
        const calls: Array<TestToolCall> = Array.from({ length: 3 }, (_, index) => ({
          sourceId: `tool-${index}`,
          name: "write_file",
          args: { path: `notes-${index}.txt` },
          metadata: { callId: `call-${index}` },
        }));
        const executed: Array<string> = [];
        const adapter = yield* makeTestAdapter({
          executed,
          maxParallelToolCalls: 2,
          requiresApproval: false,
          execute: (name) =>
            Effect.gen(function* () {
              active += 1;
              maxActive = Math.max(maxActive, active);
              if (active === 2) yield* Deferred.succeed(bothStarted, undefined).pipe(Effect.ignore);
              yield* Deferred.await(release);
              return {
                ok: true,
                itemType: "file_change" as const,
                title: name,
                detail: "written",
                output: { written: true },
              };
            }).pipe(Effect.ensuring(Effect.sync(() => (active -= 1)))),
          rounds: [
            [{ type: "completed", historyItems: [{ type: "assistant" }], toolCalls: calls }],
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "Done" }],
                toolCalls: [],
                assistantText: "Done",
              },
            ],
          ],
        });
        const threadId = ThreadId.make("native-core-parallel-tools");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Write three files" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(bothStarted);
        expect(maxActive).toBe(2);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(turnFiber);
        expect(executed).toHaveLength(3);
        expect(maxActive).toBe(2);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("cleans up a failed turn and emits one terminal before the next turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempt = 0;
        const terminalStates: Array<string> = [];
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [],
          streamRound: () => {
            attempt += 1;
            return attempt === 1
              ? Stream.fail(
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "model/stream",
                    detail: "synthetic failure",
                  }),
                )
              : Stream.fromIterable([
                  {
                    type: "completed" as const,
                    historyItems: [{ type: "assistant", text: "Recovered" }],
                    toolCalls: [],
                    assistantText: "Recovered",
                  },
                ]);
          },
        });
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === "turn.completed") terminalStates.push(event.payload.state);
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("native-core-failure-cleanup");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const failure = yield* adapter.sendTurn({ threadId, input: "Fail once" }).pipe(Effect.flip);
        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          detail: "synthetic failure",
        });
        const [failedSession] = yield* adapter.listSessions();
        expect(failedSession?.status).toBe("ready");
        expect(Object.hasOwn(failedSession ?? {}, "activeTurnId")).toBe(false);
        yield* adapter.sendTurn({ threadId, input: "Recover" });
        yield* Effect.yieldNow;
        expect(terminalStates).toEqual(["failed", "completed"]);
        expect((yield* adapter.readThread(threadId)).turns).toHaveLength(1);
        yield* Fiber.interrupt(eventFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("cancels an interrupted round, clears active state, and emits one terminal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roundStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const terminalStates: Array<string> = [];
        let attempt = 0;
        let transportAborted = false;
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [],
          streamRound: ({ signal }) => {
            attempt += 1;
            if (attempt > 1) {
              return Stream.fromIterable([
                {
                  type: "completed" as const,
                  historyItems: [{ type: "assistant", text: "After interrupt" }],
                  toolCalls: [],
                  assistantText: "After interrupt",
                },
              ]);
            }
            return Stream.fromEffect(
              Effect.gen(function* () {
                yield* Deferred.succeed(roundStarted, undefined);
                yield* Deferred.await(blocked);
                return {
                  type: "completed" as const,
                  historyItems: [{ type: "assistant" }],
                  toolCalls: [],
                };
              }),
            ).pipe(Stream.ensuring(Effect.sync(() => (transportAborted = signal.aborted))));
          },
        });
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event.type === "turn.completed") terminalStates.push(event.payload.state);
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("native-core-interrupt-cleanup");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Block" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(roundStarted);
        yield* adapter.interruptTurn(threadId);
        yield* Fiber.await(turnFiber);
        expect(transportAborted).toBe(true);
        const [interruptedSession] = yield* adapter.listSessions();
        expect(interruptedSession?.status).toBe("ready");
        expect(Object.hasOwn(interruptedSession ?? {}, "activeTurnId")).toBe(false);
        yield* adapter.sendTurn({ threadId, input: "Continue" });
        yield* Effect.yieldNow;
        expect(terminalStates).toEqual(["interrupted", "completed"]);
        yield* adapter.stopSession(threadId);
        yield* Effect.yieldNow;
        expect(terminalStates).toEqual(["interrupted", "completed"]);
        yield* Fiber.interrupt(eventFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("evicts and reloads persisted idle working sets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const evicted: Array<ThreadId> = [];
        const adapter = yield* makeTestAdapter({
          executed: [],
          maxIdleWorkingSets: 1,
          onWorkingSetEvicted: (threadId) => evicted.push(threadId),
          rounds: [
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "A" }],
                toolCalls: [],
                assistantText: "A",
              },
            ],
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "B" }],
                toolCalls: [],
                assistantText: "B",
              },
            ],
          ],
        });
        const first = ThreadId.make("native-core-eviction-a");
        const second = ThreadId.make("native-core-eviction-b");
        for (const threadId of [first, second]) {
          yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "workspace-write",
          });
          yield* adapter.sendTurn({ threadId, input: `Turn ${threadId}` });
        }
        expect(evicted).toContain(first);
        expect((yield* adapter.readThread(first)).turns).toHaveLength(1);
      }),
    ).pipe(Effect.provide(testLayer)),
  );
});
