import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import {
  makeHttpChatAdapter,
  type HttpChatAdapterExecuteTurn,
  type HttpChatTranscriptMessage,
} from "./HttpChatAdapter.ts";

class HttpChatAdapter extends Context.Service<
  HttpChatAdapter,
  ProviderAdapterShape<ProviderAdapterError>
>()("t3/provider/Layers/HttpChatAdapter.test/HttpChatAdapter") {}

const PROVIDER = ProviderDriverKind.make("syntheticHttp");
const INSTANCE_ID = ProviderInstanceId.make("syntheticHttpMain");
const FORCE_STOP_RUNTIME_SESSION_ID = RuntimeSessionId.make("http-force-stop-runtime");
const REPLACEMENT_RUNTIME_SESSION_ID = RuntimeSessionId.make("http-replacement-runtime");

const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const makeLayer = (executeTurn: HttpChatAdapterExecuteTurn) =>
  Layer.effect(
    HttpChatAdapter,
    makeHttpChatAdapter({
      provider: PROVIDER,
      providerInstanceId: INSTANCE_ID,
      executeTurn,
    }),
  ).pipe(Layer.provideMerge(NodeServices.layer));

const collectThreadEvents = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  threadId: ThreadId,
  count: number,
) =>
  adapter.streamEvents.pipe(
    Stream.filter((event) => event.threadId === threadId),
    Stream.take(count),
    Stream.runCollect,
    Effect.forkChild,
    Effect.tap(() => Effect.yieldNow),
  );

const collectTurnEvents = (
  adapter: ProviderAdapterShape<ProviderAdapterError>,
  threadId: ThreadId,
  count: number,
) =>
  adapter.streamEvents.pipe(
    Stream.filter(
      (event) =>
        event.threadId === threadId &&
        (event.type === "turn.started" ||
          event.type === "turn.aborted" ||
          event.type === "turn.completed" ||
          event.type === "content.delta" ||
          event.type === "item.completed" ||
          event.type === "runtime.error"),
    ),
    Stream.take(count),
    Stream.runCollect,
    Effect.forkChild,
    Effect.tap(() => Effect.yieldNow),
  );

it.layer(
  makeLayer((input) =>
    input.emitAssistantDelta("ready").pipe(Effect.as({ assistantText: "ready" })),
  ),
)("HttpChatAdapter", (it) => {
  it.effect("starts, lists, detects, and stops synthetic sessions", () =>
    Effect.gen(function* () {
      const adapter = yield* HttpChatAdapter;
      const threadId = asThreadId("thread-http-lifecycle");
      const eventsFiber = yield* collectThreadEvents(adapter, threadId, 3);

      const session = yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: INSTANCE_ID,
          model: "test-model",
        },
      });

      NodeAssert.equal(session.provider, PROVIDER);
      NodeAssert.equal(session.providerInstanceId, INSTANCE_ID);
      NodeAssert.equal(session.status, "ready");
      NodeAssert.equal(session.model, "test-model");
      NodeAssert.equal(yield* adapter.hasSession(threadId), true);
      NodeAssert.deepEqual(
        (yield* adapter.listSessions()).map((listed) => listed.threadId),
        [threadId],
      );

      yield* adapter.stopSession(threadId);

      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      NodeAssert.deepEqual(yield* adapter.listSessions(), []);

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      NodeAssert.deepEqual(
        events.map((event) => event.type),
        ["session.started", "thread.started", "session.exited"],
      );
      NodeAssert.equal(
        events.every((event) => event.runtimeSessionId === session.runtimeSessionId),
        true,
      );
    }),
  );
});

it.layer(
  makeLayer((input) =>
    Effect.gen(function* () {
      yield* input.emitAssistantDelta("Hello ");
      yield* input.emitAssistantDelta("world");
      return { assistantText: "Hello world" };
    }),
  ),
)("HttpChatAdapter transcripts", (it) => {
  it.effect("streams assistant deltas and stores an in-memory transcript", () =>
    Effect.gen(function* () {
      const adapter = yield* HttpChatAdapter;
      const threadId = asThreadId("thread-http-transcript");
      const eventsFiber = yield* collectTurnEvents(adapter, threadId, 5);

      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Say hello",
      });

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      NodeAssert.deepEqual(
        events.map((event) => event.type),
        ["turn.started", "content.delta", "content.delta", "item.completed", "turn.completed"],
      );
      NodeAssert.equal(
        events.every((event) => event.runtimeSessionId === FORCE_STOP_RUNTIME_SESSION_ID),
        true,
      );
      NodeAssert.equal(turn.threadId, threadId);

      const snapshot = yield* adapter.readThread(threadId);
      NodeAssert.equal(snapshot.threadId, threadId);
      NodeAssert.equal(snapshot.turns.length, 1);
      NodeAssert.equal(snapshot.turns[0]?.id, turn.turnId);
      NodeAssert.deepEqual(snapshot.turns[0]?.items, [
        {
          type: "user_message",
          role: "user",
          content: "Say hello",
          attachments: [],
        },
        {
          type: "assistant_message",
          role: "assistant",
          content: "Hello world",
        },
      ]);
    }),
  );

  it.effect("rolls back completed turns from the transcript", () =>
    Effect.gen(function* () {
      const adapter = yield* HttpChatAdapter;
      const threadId = asThreadId("thread-http-rollback");

      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      const firstCompleted = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "turn.completed"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId, input: "first" });
      yield* Fiber.join(firstCompleted).pipe(Effect.timeout("1 second"));

      const secondCompleted = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "turn.completed"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId, input: "second" });
      yield* Fiber.join(secondCompleted).pipe(Effect.timeout("1 second"));

      const rolledBack = yield* adapter.rollbackThread(threadId, 1);

      NodeAssert.equal(rolledBack.turns.length, 1);
      NodeAssert.deepEqual(rolledBack.turns[0]?.items, [
        {
          type: "user_message",
          role: "user",
          content: "first",
          attachments: [],
        },
        {
          type: "assistant_message",
          role: "assistant",
          content: "Hello world",
        },
      ]);
    }),
  );
});

it("passes the full stateless transcript to each HTTP turn executor", () =>
  Effect.gen(function* () {
    const seenMessages: Array<ReadonlyArray<HttpChatTranscriptMessage>> = [];
    const scope = yield* Scope.make("sequential");
    let scopeClosed = false;

    try {
      const layer = makeLayer((input) => {
        seenMessages.push(input.messages);
        return input.emitAssistantDelta(`response-${seenMessages.length}`).pipe(
          Effect.as({
            assistantText: `response-${seenMessages.length}`,
          }),
        );
      });
      const context = yield* Layer.buildWithScope(layer, scope);
      const adapter = yield* Effect.service(HttpChatAdapter).pipe(Effect.provide(context));
      const threadId = asThreadId("thread-http-stateless-history");

      const firstCompleted = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "turn.completed"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "first" });
      yield* Fiber.join(firstCompleted).pipe(Effect.timeout("1 second"));

      const secondCompleted = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "turn.completed"),
        Stream.take(1),
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId, input: "second" });
      yield* Fiber.join(secondCompleted).pipe(Effect.timeout("1 second"));

      NodeAssert.equal(seenMessages.length, 2);
      NodeAssert.deepEqual(
        seenMessages[1]?.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        [
          { role: "user", content: "first" },
          { role: "assistant", content: "response-1" },
          { role: "user", content: "second" },
        ],
      );
    } finally {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
      scopeClosed = true;
    }

    NodeAssert.equal(scopeClosed, true);
  }));

it("aborts an active turn and records it as interrupted", () =>
  Effect.gen(function* () {
    const deltaEmitted = yield* Deferred.make<void>();
    const scope = yield* Scope.make("sequential");
    let scopeClosed = false;

    try {
      const layer = makeLayer((input) =>
        Effect.gen(function* () {
          yield* input.emitAssistantDelta("partial");
          yield* Deferred.succeed(deltaEmitted, undefined).pipe(Effect.ignore);
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                if (input.signal.aborted) {
                  resolve();
                  return;
                }
                input.signal.addEventListener("abort", () => resolve(), { once: true });
              }),
          );
          return {};
        }),
      );
      const context = yield* Layer.buildWithScope(layer, scope);
      const providedAdapter = yield* Effect.service(HttpChatAdapter).pipe(Effect.provide(context));
      const threadId = asThreadId("thread-http-interrupt");
      const eventsFiber = yield* collectTurnEvents(providedAdapter, threadId, 4);

      yield* providedAdapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeMode: "full-access",
      });
      const turn = yield* providedAdapter.sendTurn({ threadId, input: "wait" });
      yield* Deferred.await(deltaEmitted).pipe(Effect.timeout("1 second"));
      yield* providedAdapter.interruptTurn(threadId, turn.turnId);

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      NodeAssert.deepEqual(
        events.map((event) => event.type),
        ["turn.started", "content.delta", "turn.aborted", "turn.completed"],
      );
      const completed = events.at(-1);
      NodeAssert.equal(completed?.type, "turn.completed");
      NodeAssert.equal(
        completed?.type === "turn.completed" ? completed.payload.state : null,
        "interrupted",
      );

      const sessions = yield* providedAdapter.listSessions();
      NodeAssert.equal(sessions[0]?.status, "ready");
      NodeAssert.equal(sessions[0]?.activeTurnId, undefined);
      const snapshot = yield* providedAdapter.readThread(threadId);
      const assistant = snapshot.turns[0]?.items[1] as { readonly content?: string } | undefined;
      NodeAssert.equal(assistant?.content, "partial");
    } finally {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
      scopeClosed = true;
    }

    NodeAssert.equal(scopeClosed, true);
  }));

it.effect("force-stops an HTTP turn locally without waiting for the remote request", () =>
  Effect.gen(function* () {
    const turnStarted = yield* Deferred.make<void>();
    const scope = yield* Scope.make("sequential");
    let activeSignal: AbortSignal | undefined;
    let emitLateDelta: ((delta: string) => Effect.Effect<void, ProviderAdapterError>) | undefined;
    let observedContentDeltas = 0;

    try {
      const layer = makeLayer((input) =>
        Effect.gen(function* () {
          activeSignal = input.signal;
          emitLateDelta = input.emitAssistantDelta;
          yield* Deferred.succeed(turnStarted, undefined).pipe(Effect.ignore);
          return yield* Effect.never;
        }),
      );
      const context = yield* Layer.buildWithScope(layer, scope);
      const adapter = yield* Effect.service(HttpChatAdapter).pipe(Effect.provide(context));
      const threadId = asThreadId("thread-http-force-stop");
      const lateEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "content.delta"),
        Stream.runForEach(() =>
          Effect.sync(() => {
            observedContentDeltas += 1;
          }),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "keep working" });
      yield* Deferred.await(turnStarted).pipe(Effect.timeout("1 second"));

      const result = yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID);

      NodeAssert.deepEqual(result, {
        outcome: "detached",
        mechanism: "local-detach",
        detail:
          "The local HTTP request was aborted and detached, but this provider does not expose a verifiable remote hard-stop API.",
      });
      NodeAssert.equal(activeSignal?.aborted, true);
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      NodeAssert.deepEqual(yield* adapter.listSessions(), []);
      yield* emitLateDelta?.("late provider output") ?? Effect.void;
      yield* Effect.yieldNow;
      NodeAssert.equal(observedContentDeltas, 0);
      yield* Fiber.interrupt(lateEventsFiber);

      NodeAssert.deepEqual(
        yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID),
        {
          outcome: "terminated",
          mechanism: "already-stopped",
        },
      );
    } finally {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
    }
  }),
);

it("does not interrupt or force-stop a replacement runtime with a stale generation token", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("sequential");
    try {
      const context = yield* Layer.buildWithScope(
        makeLayer((input) =>
          input.emitAssistantDelta("ready").pipe(Effect.as({ assistantText: "ready" })),
        ),
        scope,
      );
      const adapter = yield* Effect.service(HttpChatAdapter).pipe(Effect.provide(context));
      const threadId = asThreadId("thread-http-stale-runtime-token");
      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });
      yield* adapter.stopSession(threadId);
      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: REPLACEMENT_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      yield* adapter.interruptTurn(threadId, undefined, FORCE_STOP_RUNTIME_SESSION_ID);
      NodeAssert.deepEqual(
        yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID),
        {
          outcome: "terminated",
          mechanism: "already-stopped",
        },
      );
      NodeAssert.equal(yield* adapter.hasSession(threadId), true);
      NodeAssert.equal(
        (yield* adapter.listSessions())[0]?.runtimeSessionId,
        REPLACEMENT_RUNTIME_SESSION_ID,
      );
    } finally {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
    }
  }));

it("shuts down streamEvents when the adapter scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("sequential");
    const adapterLayer = makeLayer((input) =>
      input.emitAssistantDelta("closing").pipe(Effect.as({ assistantText: "closing" })),
    );
    const context = yield* Layer.buildWithScope(adapterLayer, scope);
    const adapter = yield* Effect.service(HttpChatAdapter).pipe(Effect.provide(context));
    const eventsFiber = yield* adapter.streamEvents.pipe(Stream.runCollect, Effect.forkChild);

    yield* Scope.close(scope, Exit.void);

    const exit = yield* Fiber.await(eventsFiber).pipe(Effect.timeout("1 second"));
    NodeAssert.equal(Exit.isSuccess(exit) || Exit.hasInterrupts(exit), true);
  }));
