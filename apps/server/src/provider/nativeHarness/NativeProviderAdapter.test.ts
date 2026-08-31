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
import type { InProcessWorkAdmissionRequest } from "../../resourceProtection/InProcessWorkAdmission.ts";
import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
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
  it.effect("uses the shared in-process governor and releases its lease after a turn", () => {
    const requests: Array<InProcessWorkAdmissionRequest> = [];
    let releaseCount = 0;
    const resourceLayer = Layer.mock(ResourceProtection.SubagentResourceGovernor)({
      acquireInProcessLease: (request) =>
        Effect.sync(() => {
          requests.push(request);
          return {
            workId: request.workId,
            reservedBytes: 1024,
            release: Effect.sync(() => {
              releaseCount += 1;
            }),
          };
        }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [
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
        const threadId = ThreadId.make("native-core-shared-admission");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        yield* adapter.sendTurn({ threadId, input: "Use shared admission" });

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
        });
        expect(requests[0]?.reservation.serializedHistoryBytes).toBeGreaterThan(0);
        expect(requests[0]?.reservation.toolBufferBytes).toBe(1024);
        expect(releaseCount).toBe(1);
      }),
    ).pipe(Effect.provide(testLayer.pipe(Layer.provideMerge(resourceLayer))));
  });

  it.effect("releases the shared in-process lease when a native turn is interrupted", () => {
    let releaseCount = 0;
    const resourceLayer = Layer.mock(ResourceProtection.SubagentResourceGovernor)({
      acquireInProcessLease: (request) =>
        Effect.succeed({
          workId: request.workId,
          reservedBytes: 1024,
          release: Effect.sync(() => {
            releaseCount += 1;
          }),
        }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const roundStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [],
          streamRound: () =>
            Stream.fromEffect(
              Deferred.succeed(roundStarted, undefined).pipe(
                Effect.andThen(Deferred.await(blocked)),
                Effect.as({
                  type: "completed" as const,
                  historyItems: [{ type: "assistant" }],
                  toolCalls: [],
                }),
              ),
            ),
        });
        const threadId = ThreadId.make("native-core-shared-admission-interrupt");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Interrupt shared admission" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(roundStarted);
        yield* adapter.interruptTurn(threadId);
        yield* Fiber.await(turnFiber);
        expect(releaseCount).toBe(1);
      }),
    ).pipe(Effect.provide(testLayer.pipe(Layer.provideMerge(resourceLayer))));
  });

  it.effect("fails before model streaming when shared admission is cancelled", () => {
    let streamCalls = 0;
    const resourceLayer = Layer.mock(ResourceProtection.SubagentResourceGovernor)({
      acquireInProcessLease: () => Effect.succeed(undefined),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [],
          streamRound: () => {
            streamCalls += 1;
            return Stream.empty;
          },
        });
        const threadId = ThreadId.make("native-core-shared-admission-cancelled");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const failure = yield* adapter
          .sendTurn({ threadId, input: "Cancel admission" })
          .pipe(Effect.flip);
        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "resource/admission",
        });
        expect(streamCalls).toBe(0);
      }),
    ).pipe(Effect.provide(testLayer.pipe(Layer.provideMerge(resourceLayer))));
  });

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
          name: "workspace_edit",
          args: {
            changes: [
              {
                path: "notes.txt",
                edits: [{ type: "write", mode: "upsert", content: "hello\n" }],
              },
            ],
          },
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
        expect(executed).toEqual(["workspace_edit"]);

        const beforeResume = yield* adapter.readThread(threadId);
        expect(beforeResume.turns).toHaveLength(1);
        expect(beforeResume.turns[0]?.items).toEqual([
          { type: "reasoning", text: "Thinking" },
          {
            type: "file_change",
            name: "workspace_edit",
            title: "workspace_edit",
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

  it.effect("persists an exact one MiB tool result once and returns a small model digest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rawOutput = `fatal error\n${"line\n".repeat(Math.ceil((1024 * 1024) / 5))}`.slice(
          0,
          1024 * 1024,
        );
        const call: TestToolCall = {
          sourceId: "large-tool-item",
          name: "exec_command",
          args: { command: "generate-large-output" },
          metadata: { callId: "large-call" },
        };
        const adapter = yield* makeTestAdapter({
          executed: [],
          requiresApproval: false,
          execute: () =>
            Effect.succeed({
              ok: true,
              itemType: "command_execution",
              title: "Generate large output",
              detail: "Exited with code 0",
              output: { stdout: rawOutput, exitCode: 0, changedPaths: ["generated.txt"] },
            }),
          rounds: [
            [{ type: "completed", historyItems: [{ type: "assistant" }], toolCalls: [call] }],
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
        const toolEvents: Array<{
          readonly type: "content.delta" | "item.completed";
          readonly payload: Readonly<Record<string, unknown>>;
        }> = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (
                event.itemId === "large-tool-item" &&
                (event.type === "content.delta" || event.type === "item.completed")
              ) {
                toolEvents.push(event);
              }
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("native-core-large-tool-result");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        yield* adapter.sendTurn({ threadId, input: "Write it" });
        yield* Effect.yieldNow;

        expect(toolEvents).toHaveLength(1);
        expect(toolEvents[0]).toMatchObject({
          type: "item.completed",
          payload: {
            status: "completed",
            title: "Generate large output",
            detail: "Exited with code 0",
            data: { stdout: rawOutput, exitCode: 0, changedPaths: ["generated.txt"] },
          },
        });
        const completion = toolEvents[0]!.payload;
        const toolItem = (yield* adapter.readThread(threadId)).turns[0]?.items[0] as {
          readonly output: Readonly<Record<string, unknown>>;
        };
        expect(toolItem.output).toMatchObject({
          ok: true,
          status: "completed",
          title: "Generate large output",
          detail: "Exited with code 0",
          exitCode: 0,
          changedPaths: ["generated.txt"],
          errorLines: ["fatal error"],
          detailRef: "tool-result:large-tool-item",
        });
        expect(Buffer.byteLength(JSON.stringify(toolItem.output))).toBeLessThanOrEqual(16 * 1024);
        expect(Buffer.byteLength(JSON.stringify(toolItem.output))).toBeLessThan(
          Buffer.byteLength(JSON.stringify(completion)) / 10,
        );
        yield* Fiber.interrupt(eventFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("returns a tool result at the 32 KiB boundary unchanged", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = { value: "x".repeat(32 * 1024 - '{"value":""}'.length) };
        const adapter = yield* makeTestAdapter({
          executed: [],
          requiresApproval: false,
          execute: () =>
            Effect.succeed({
              ok: true,
              itemType: "file_change",
              title: "Boundary",
              detail: "Boundary",
              output,
            }),
          rounds: [
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant" }],
                toolCalls: [
                  {
                    sourceId: "boundary-tool-item",
                    name: "write_file",
                    args: { path: "boundary.txt" },
                    metadata: { callId: "boundary-call" },
                  },
                ],
              },
            ],
            [{ type: "completed", historyItems: [{ type: "assistant" }], toolCalls: [] }],
          ],
        });
        const threadId = ThreadId.make("native-core-boundary-tool-result");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        yield* adapter.sendTurn({ threadId, input: "Write it" });

        const toolItem = (yield* adapter.readThread(threadId)).turns[0]?.items[0] as {
          readonly output: Readonly<Record<string, unknown>>;
        };
        expect(Buffer.byteLength(JSON.stringify(output))).toBe(32 * 1024);
        expect(toolItem.output).toEqual(output);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("replays a declined approval without executing the tool", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const executed: Array<string> = [];
        const adapter = yield* makeTestAdapter({
          executed,
          rounds: [
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", calls: 1 }],
                toolCalls: [
                  {
                    sourceId: "declined-tool-item",
                    name: "write_file",
                    args: { path: "declined.txt" },
                    metadata: { callId: "declined-call" },
                  },
                ],
              },
            ],
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "Not written" }],
                toolCalls: [],
                assistantText: "Not written",
              },
            ],
          ],
        });
        const threadId = ThreadId.make("native-core-declined-approval");
        yield* adapter.startSession({
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
          .sendTurn({ threadId, input: "Do not write it" })
          .pipe(Effect.forkChild);
        const opened = yield* Fiber.join(openedFiber);
        expect(Option.isSome(opened)).toBe(true);
        if (Option.isNone(opened) || opened.value.type !== "request.opened") return;
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(opened.value.requestId),
          "decline",
        );
        yield* Fiber.join(turnFiber);

        expect(executed).toEqual([]);
        expect((yield* adapter.readThread(threadId)).turns[0]?.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "dynamic_tool_call",
              name: "write_file",
              output: { error: "Tool call decline." },
            }),
            { type: "assistant_message", text: "Not written" },
          ]),
        );
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails closed when transport emits content after its terminal event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter({
          executed: [],
          rounds: [
            [
              {
                type: "completed",
                historyItems: [{ type: "assistant", text: "Terminal" }],
                toolCalls: [],
                assistantText: "Terminal",
              },
              { type: "contentDelta", kind: "assistant", delta: "late" },
            ],
          ],
        });
        const threadId = ThreadId.make("native-core-output-after-terminal");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });

        const error = yield* adapter
          .sendTurn({ threadId, input: "Reject late output" })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "model/stream",
          detail: "native-test emitted output after the terminal response event.",
        });
        const [session] = yield* adapter.listSessions();
        expect(session?.status).toBe("ready");
        expect((yield* adapter.readThread(threadId)).turns).toEqual([]);
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
