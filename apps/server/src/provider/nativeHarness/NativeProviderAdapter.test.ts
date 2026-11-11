import * as Deferred from "effect/Deferred";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnId,
  CheckpointId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as Adapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import { makeNativeProviderAdapter } from "./NativeProviderAdapter.ts";
import type {
  NativeProviderRoundEvent,
  NativeProviderToolCall,
  NativeProviderTurnAdmission,
} from "./NativeProviderTypes.ts";

const instanceId = ProviderInstanceId.make("native-v2-test");
const threadId = ThreadId.make("native-v2-thread");
const modelSelection = { instanceId, model: "test-model", options: [] };
const runtimePolicy = {
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  cwd: null,
};
const persisted = Schema.Struct({
  history: Schema.Array(Schema.String),
  turns: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      historyStart: Schema.Number,
      historyEnd: Schema.Number,
      items: Schema.Array(Schema.Unknown),
    }),
  ),
  totalProcessedTokens: Schema.Number,
});
const layer = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);
type Tool = NativeProviderToolCall<string>;
const makeAdapter = (
  rounds: Array<ReadonlyArray<NativeProviderRoundEvent<string, Tool>>>,
  observed: Array<ReadonlyArray<string>>,
  options: {
    readonly approval?: boolean;
    readonly maxSessions?: number;
    readonly maxIdleWorkingSets?: number;
    readonly onEvicted?: (threadId: ThreadId) => void;
    readonly admission?: NativeProviderTurnAdmission;
    readonly onExecute?: () => void;
    readonly onReleaseThread?: () => void;
    readonly stream?: Stream.Stream<NativeProviderRoundEvent<string, Tool>>;
  } = {},
) =>
  makeNativeProviderAdapter<string, object, object, object, Tool>({
    provider: ProviderDriverKind.make("native-v2"),
    instanceId,
    admission: options.admission,
    capabilities: { sessionModelSwitch: "in-session" },
    messages: { sessionStarted: "", sessionReady: "", turnRunning: "", turnSettled: "" },
    limits: {
      ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
      ...(options.maxIdleWorkingSets === undefined
        ? {}
        : { maxIdleWorkingSets: options.maxIdleWorkingSets }),
      maxToolDefinitions: 4,
      maxToolOutputBytes: 1024,
      maxParallelToolCalls: 1,
    },
    onWorkingSetEvicted: options.onEvicted,
    history: {
      directoryName: "native-v2",
      resumeVersion: 1,
      encode: JSON.stringify,
      decode: (encoded) =>
        Schema.decodeEffect(Schema.fromJsonString(persisted))(encoded).pipe(
          Effect.orDie,
          Effect.map((value) => ({
            ...value,
            history: [...value.history],
            turns: value.turns.map((turn) => ({
              ...turn,
              items: [...turn.items],
              id: TurnId.make(turn.id),
            })),
          })),
        ),
    },
    start: () => Effect.succeed({ model: modelSelection.model, state: {}, configured: {} }),
    prepareTurn: ({ input }) =>
      Effect.succeed({
        model: modelSelection.model,
        userHistoryItems: [input.input ?? ""],
        attachmentBytes: 0,
        toolDeclarations: [],
        protocol: {},
      }),
    streamRound: ({ session }) => {
      observed.push([...session.history]);
      return options.stream ?? Stream.fromIterable(rounds.shift() ?? []);
    },
    toolHarness: {
      releaseThread: () => Effect.sync(() => options.onReleaseThread?.()),
      isAvailable: () => Effect.succeed(true),
      requiresApproval: () => options.approval ?? false,
      requestType: () => "command_execution_approval",
      approvalDetail: () => "Allow?",
      execute: () =>
        Effect.sync(() => {
          options.onExecute?.();
          return {
            ok: true,
            itemType: "dynamic_tool_call",
            title: "Tool",
            detail: "Tool complete",
            output: { text: "tool-result" },
          };
        }),
    },
    toolResultsToHistoryItems: ({ results }) =>
      results.map(({ result }) => (result.ok ? "tool-result" : "declined")),
  });
const turnInput = Effect.fn("NativeProviderAdapterV2.test.turnInput")(function* (
  providerThread: Adapter.ProviderAdapterV2ThreadSnapshot["providerThread"],
  ordinal: number,
): Effect.fn.Return<Adapter.ProviderAdapterV2TurnInput> {
  const now = yield* DateTime.now;
  return {
    appThread: {
      id: threadId,
      projectId: ProjectId.make("native-project"),
      title: "Native",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: runtimePolicy.runtimeMode,
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThread.id,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId,
    runId: RunId.make(`run-${ordinal}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt-${ordinal}`),
    rootNodeId: NodeId.make(`root-${ordinal}`),
    providerThread,
    message: {
      messageId: MessageId.make(`message-${ordinal}`),
      text: `question-${ordinal}`,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    },
    modelSelection,
    runtimePolicy,
  };
});
it.layer(layer)("NativeProviderAdapterV2", (it) => {
  it.effect("retiring a replaced session preserves its replacement's shared tool clients", () =>
    Effect.gen(function* () {
      let released = 0;
      const adapter = yield* makeAdapter([], [], {
        onReleaseThread: () => {
          released++;
        },
      });
      const retired = yield* Scope.make();
      const current = yield* Scope.make();
      for (const [scope, sessionId] of [
        [retired, "retired"],
        [current, "current"],
      ] as const) {
        yield* adapter
          .openSession({
            threadId,
            providerSessionId: ProviderSessionId.make(sessionId),
            modelSelection,
            runtimePolicy,
          })
          .pipe(Effect.provideService(Scope.Scope, scope));
      }
      yield* Scope.close(retired, Exit.void);
      assert.equal(released, 0);
      yield* Scope.close(current, Exit.void);
      assert.equal(released, 1);
    }),
  );
  it.effect("keeps thread identity across initialization, resume and native replacement", () =>
    Effect.gen(function* () {
      const observed: Array<ReadonlyArray<string>> = [];
      const adapter = yield* makeAdapter(
        [
          [
            {
              type: "completed",
              historyItems: ["tool-call"],
              toolCalls: [{ name: "read", args: {}, metadata: "call" }],
            },
          ],
          [
            { type: "contentDelta", kind: "assistant", delta: "answer" },
            { type: "completed", historyItems: ["answer"], toolCalls: [] },
          ],
          [
            {
              type: "completed",
              assistantText: "resumed",
              historyItems: ["resumed"],
              toolCalls: [],
            },
          ],
          [{ type: "completed", historyItems: ["fresh"], toolCalls: [] }],
        ],
        observed,
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-session"),
        modelSelection,
        runtimePolicy,
      });
      const now = yield* DateTime.now;
      const preparedThread = {
        id: ProviderThreadId.make("prepared-native-thread"),
        driver: adapter.driver,
        providerInstanceId: instanceId,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "not_loaded" as const,
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      };
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
        existingProviderThread: preparedThread,
      });
      assert.equal(providerThread.id, preparedThread.id);
      assert.isNotNull(providerThread.nativeThreadRef);
      const firstEvents = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      const events = yield* Fiber.join(firstEvents);
      assert.isTrue(
        events.some((event) => event.type === "message.updated" && event.message.text === "answer"),
      );
      assert.isTrue(
        events.some(
          (event) => event.type === "turn_item.updated" && event.turnItem.type === "dynamic_tool",
        ),
      );
      assert.deepEqual(observed[1], ["question-1", "tool-call", "tool-result"]);
      const resumed = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-session-2"),
        modelSelection,
        runtimePolicy,
      });
      const restored = yield* resumed.resumeThread({ providerThread });
      const secondEvents = yield* resumed.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* resumed.startTurn(yield* turnInput(restored, 2));
      yield* Fiber.join(secondEvents);
      assert.deepEqual(observed[2], [
        "question-1",
        "tool-call",
        "tool-result",
        "answer",
        "question-2",
      ]);
      const replacement = yield* resumed.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
        existingProviderThread: restored,
        forceNewNativeThread: true,
      });
      assert.equal(replacement.id, preparedThread.id);
      assert.notEqual(replacement.nativeThreadRef?.nativeId, restored.nativeThreadRef?.nativeId);
      const replacementEvents = yield* resumed.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* resumed.startTurn(yield* turnInput(replacement, 3));
      yield* Fiber.join(replacementEvents);
      assert.deepEqual(observed[3], ["question-3"]);
    }),
  );
  it.effect("reports a stream without a completion as a V2 failure", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter([[]], []);
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const terminal = yield* runtime.events.pipe(
        Stream.filter((event) => event.type === "turn.terminal"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      assert.equal((yield* Fiber.join(terminal))[0]?.status, "failed");
    }),
  );

  it.effect("declines a live approval without running its tool", () =>
    Effect.gen(function* () {
      let executed = false;
      const observed: Array<ReadonlyArray<string>> = [];
      const adapter = yield* makeAdapter(
        [
          [
            {
              type: "completed",
              historyItems: ["tool-call"],
              toolCalls: [{ name: "write", args: {}, metadata: "call" }],
            },
          ],
          [{ type: "completed", historyItems: ["declined-answer"], toolCalls: [] }],
        ],
        observed,
        {
          approval: true,
          onExecute: () => {
            executed = true;
          },
        },
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-approval"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runForEach((event) =>
          event.type === "runtime_request.updated" && event.runtimeRequest.status === "pending"
            ? runtime.respondToRuntimeRequest({
                requestId: event.runtimeRequest.id,
                decision: "decline",
              })
            : Effect.void,
        ),
        Effect.forkChild,
      );
      yield* runtime.startTurn({
        ...(yield* turnInput(providerThread, 1)),
        runtimePolicy: { ...runtimePolicy, runtimeMode: "approval-required" },
      });
      yield* Fiber.join(events);
      assert.isFalse(executed);
      assert.deepEqual(observed[1], ["question-1", "tool-call", "declined"]);
    }),
  );
  it.effect("interrupts an active response and emits one interrupted terminal", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const stream = Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
        Stream.drain,
        Stream.concat(Stream.never),
      );
      const adapter = yield* makeAdapter([], [], { stream });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-interrupt"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      yield* Deferred.await(started);
      const providerTurn = (yield* runtime.readThreadSnapshot({ providerThread }))
        .providerTurns[0]!;
      yield* runtime.interruptTurn({ providerThread, providerTurnId: providerTurn.id });
      const collected = yield* Fiber.join(events);
      assert.deepEqual(
        collected.filter((event) => event.type === "turn.terminal").map((event) => event.status),
        ["interrupted"],
      );
    }),
  );
  it.effect("releases its memory lease after a failed stream", () =>
    Effect.gen(function* () {
      let acquired = 0;
      let released = 0;
      const admission: NativeProviderTurnAdmission = {
        withLease: (_request, effect) =>
          Effect.sync(() => {
            acquired++;
          }).pipe(
            Effect.andThen(effect),
            Effect.ensuring(
              Effect.sync(() => {
                released++;
              }),
            ),
          ),
      };
      const adapter = yield* makeAdapter([[]], [], { admission });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-lease"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const terminal = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runLast,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      const last = yield* Fiber.join(terminal);
      assert.equal(acquired, 1);
      assert.equal(released, 1);
      // The reason reaches the user instead of a generic wrapper around it.
      assert.notInclude(JSON.stringify(last), "Provider turn failed");
    }),
  );
  it.effect("persists a rewind before a subsequent session resumes", () =>
    Effect.gen(function* () {
      const observed: Array<ReadonlyArray<string>> = [];
      const adapter = yield* makeAdapter(
        [
          [{ type: "completed", historyItems: ["answer"], toolCalls: [] }],
          [{ type: "completed", historyItems: ["next"], toolCalls: [] }],
        ],
        observed,
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-rollback"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const terminal = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      yield* Fiber.join(terminal);
      yield* runtime.rollbackThread({
        providerThread,
        target: {
          type: "thread_start",
          checkpointId: CheckpointId.make("rewind"),
          appRunOrdinal: 0,
        },
        providerThreadTurns: [],
      });
      const resumed = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("native-after-rollback"),
        modelSelection,
        runtimePolicy,
      });
      const restored = yield* resumed.resumeThread({ providerThread });
      const next = yield* resumed.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* resumed.startTurn(yield* turnInput(restored, 2));
      yield* Fiber.join(next);
      assert.deepEqual(observed[1], ["question-2"]);
    }),
  );

  it.effect("bounds open sessions and evicts idle histories without losing their transcript", () =>
    Effect.gen(function* () {
      const observed: Array<ReadonlyArray<string>> = [];
      const evicted: Array<ThreadId> = [];
      const adapter = yield* makeAdapter(
        [
          [{ type: "completed", historyItems: ["first"], toolCalls: [] }],
          [{ type: "completed", historyItems: ["second"], toolCalls: [] }],
          [{ type: "completed", historyItems: ["third"], toolCalls: [] }],
        ],
        observed,
        {
          maxSessions: 2,
          maxIdleWorkingSets: 1,
          onEvicted: (id) => {
            evicted.push(id);
          },
        },
      );
      const first = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("bounded-first"),
        modelSelection,
        runtimePolicy,
      });
      const firstThread = yield* first.ensureThread({ threadId, modelSelection, runtimePolicy });
      const firstDone = yield* first.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* first.startTurn(yield* turnInput(firstThread, 1));
      yield* Fiber.join(firstDone);
      const second = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("bounded-second"),
        modelSelection,
        runtimePolicy,
      });
      const secondThread = yield* second.ensureThread({ threadId, modelSelection, runtimePolicy });
      const secondDone = yield* second.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* second.startTurn(yield* turnInput(secondThread, 2));
      yield* Fiber.join(secondDone);
      assert.equal(evicted.length, 1);
      const rejected = yield* adapter
        .openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("bounded-third"),
          modelSelection,
          runtimePolicy,
        })
        .pipe(Effect.flip);
      assert.equal(rejected._tag, "ProviderAdapterOpenSessionError");
      const reloaded = yield* first.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* first.startTurn(yield* turnInput(firstThread, 3));
      yield* Fiber.join(reloaded);
      assert.deepEqual(observed[2], ["question-1", "first", "question-3"]);
    }),
  );
  it.effect("rejects protocol events after a round has completed", () =>
    Effect.gen(function* () {
      const adapter = yield* makeAdapter(
        [
          [
            { type: "completed", historyItems: ["done"], toolCalls: [] },
            { type: "contentDelta", kind: "assistant", delta: "late" },
          ],
        ],
        [],
      );
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("late-event"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.startTurn(yield* turnInput(providerThread, 1));
      const output = yield* Fiber.join(events);
      assert.equal(output.find((event) => event.type === "turn.terminal")?.status, "failed");
      assert.isFalse(output.some((event) => event.type === "message.updated"));
    }),
  );
});
