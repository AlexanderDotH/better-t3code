import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  SubagentId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import type {
  ProviderAdapterV2,
  ProviderAdapterV2Event,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { CommandReceiptStoreV2, layer as receiptLayer } from "./CommandReceiptStore.ts";
import { OrchestrationEffectWorkerV2 } from "./EffectWorker.ts";
import { EventSinkV2 } from "./EventSink.ts";
import { EventStoreV2, layer as eventStoreLayer } from "./EventStore.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { layerSingle } from "./ProviderAdapterRegistry.ts";
import { layer as projectionLayer } from "./ProjectionStore.ts";
import { ReplyThreadLifecycle, layerService } from "./ReplyThreadLifecycle.ts";
import { layerMemory } from "../persistence/Sqlite.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const selection = { instanceId, model: "gpt-5.4" };
const projectId = ProjectId.make("reply-lifecycle-project");
const ownerId = ThreadId.make("reply-owner");
const replyId = ThreadId.make("reply-child");
const nestedId = ThreadId.make("reply-grandchild");
const forkId = ThreadId.make("unrelated-fork");

function fakeProvider(cwd: string) {
  const active = new Set<ThreadId>();
  const interruptions = new Map<ThreadId, number>();
  const adapter: ProviderAdapterV2["Service"] = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
        const owned = new Set<ThreadId>();
        const turns = new Map<
          ProviderTurnId,
          { threadId: ThreadId; providerThreadId: ProviderThreadId; ordinal: number }
        >();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const id of owned) active.delete(id);
          }).pipe(Effect.andThen(Queue.shutdown(events))),
        );
        const snapshot = (providerThread: OrchestrationV2ProviderThread) =>
          Effect.succeed({ providerThread, providerTurns: [], messages: [], runtimeRequests: [] });
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd,
            model: selection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`native-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: `native:${threadId}`, strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.gen(function* () {
              const id = ProviderTurnId.make(`native-turn:${turn.attemptId}`);
              active.add(turn.threadId);
              owned.add(turn.threadId);
              turns.set(id, {
                threadId: turn.threadId,
                providerThreadId: turn.providerThread.id,
                ordinal: turn.runOrdinal,
              });
              yield* Queue.offer(events, {
                type: "provider_turn.updated",
                driver,
                threadId: turn.threadId,
                providerTurn: {
                  id,
                  providerThreadId: turn.providerThread.id,
                  nodeId: turn.rootNodeId,
                  runAttemptId: turn.attemptId,
                  nativeTurnRef: null,
                  ordinal: turn.providerTurnOrdinal,
                  status: "running",
                  startedAt: now,
                  completedAt: null,
                },
              });
            }),
          interruptTurn: ({ providerTurnId }) =>
            Effect.gen(function* () {
              const turn = turns.get(providerTurnId);
              if (turn === undefined) return;
              active.delete(turn.threadId);
              interruptions.set(turn.threadId, (interruptions.get(turn.threadId) ?? 0) + 1);
              yield* Queue.offer(events, {
                type: "turn.terminal",
                driver,
                providerThreadId: turn.providerThreadId,
                providerTurnId,
                runOrdinal: turn.ordinal,
                status: "interrupted",
                failure: null,
                threadDisposition: "reusable",
              });
            }),
          steerTurn: () => Effect.die("Unexpected steer"),
          respondToRuntimeRequest: () => Effect.die("Unexpected request"),
          readThreadSnapshot: ({ providerThread }) => snapshot(providerThread),
          rollbackThread: ({ providerThread }) => snapshot(providerThread),
          forkThread: (request) =>
            Effect.succeed({
              ...request.sourceProviderThread,
              id: ProviderThreadId.make(`native-thread:${request.targetThreadId}`),
              appThreadId: request.targetThreadId,
            }),
        };
      }),
  };
  return { adapter, active, interruptions };
}

const createThread = Effect.fn("ReplyLifecycleTest.create")(function* (
  threadId: ThreadId,
  cwd: string,
) {
  yield* (yield* OrchestratorV2).dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId,
    title: threadId,
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: cwd,
    createdBy: "user",
    creationSource: "web",
  });
});
const seedSource = Effect.fn("ReplyLifecycleTest.seedSource")(function* (threadId: ThreadId) {
  const now = yield* DateTime.now;
  const id = MessageId.make(`source:${threadId}`);
  const message: OrchestrationV2ConversationMessage = {
    id,
    threadId,
    runId: null,
    nodeId: null,
    role: "user",
    text: "Source",
    attachments: [],
    streaming: false,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
  };
  yield* (yield* EventSinkV2).write({
    events: [
      {
        id: EventId.make(`source-event:${threadId}`),
        type: "message.updated",
        threadId,
        occurredAt: now,
        payload: message,
      },
      {
        id: EventId.make(`source-item-event:${threadId}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: {
          id: TurnItemId.make(`source-item:${threadId}`),
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 0,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "user_message",
          messageId: id,
          text: message.text,
          inputIntent: "turn_start",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
        },
      },
    ],
  });
  return id;
});
const waitForRunning = Effect.fn("ReplyLifecycleTest.waitRunning")(function* (threadId: ThreadId) {
  yield* (yield* OrchestrationEffectWorkerV2).drain();
  yield* (yield* EventSinkV2).stream({ threadId, eventType: "provider-turn.updated" }).pipe(
    Stream.filter(
      (stored) =>
        stored.event.type === "provider-turn.updated" && stored.event.payload.status === "running",
    ),
    Stream.take(1),
    Stream.runDrain,
  );
});
const startReply = Effect.fn("ReplyLifecycleTest.startReply")(function* (
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  messageId: MessageId,
) {
  const promptId = MessageId.make(`prompt:${targetThreadId}`);
  yield* (yield* OrchestratorV2).dispatch({
    type: "message.reply.start",
    commandId: CommandId.make(`reply:${targetThreadId}`),
    threadId: sourceThreadId,
    targetThreadId,
    messageId: promptId,
    replyTopicId: SubagentId.make(`topic:${targetThreadId}`),
    text: "Reply",
    replyTo: { messageId, role: "user", text: "Source" },
    attachments: [],
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
  });
  yield* waitForRunning(targetThreadId);
  return promptId;
});
const send = Effect.fn("ReplyLifecycleTest.send")(function* (
  threadId: ThreadId,
  suffix: string,
  mode: "start_immediately" | "queue_after_active" = "start_immediately",
) {
  return yield* (yield* OrchestratorV2).dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`send:${threadId}:${suffix}`),
    threadId,
    messageId: MessageId.make(`message:${threadId}:${suffix}`),
    text: suffix,
    attachments: [],
    dispatchMode: { type: mode },
    createdBy: "user",
    creationSource: "web",
  });
});

function testLayer(adapter: ProviderAdapterV2["Service"]) {
  const database = layerMemory;
  const stores = Layer.mergeAll(projectionLayer, eventStoreLayer, receiptLayer).pipe(
    Layer.provide(database),
  );
  return layerService.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        stores,
        ProviderReplayHarness.layerWithRegistry({ name: "reply-lifecycle" }, layerSingle(adapter), {
          databaseLayer: database,
          runEffectWorker: false,
        }),
      ),
    ),
  );
}

it.effect.each(["thread.archive", "thread.delete"] as const)(
  "cascades %s through running reply children without stopping unrelated forks or tasks",
  (type) =>
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace("reply-lifecycle");
      const fake = fakeProvider(cwd);
      yield* Effect.gen(function* () {
        const engine = yield* OrchestratorV2;
        const lifecycle = yield* ReplyThreadLifecycle;
        const sink = yield* EventSinkV2;
        const events = yield* EventStoreV2;
        const receipts = yield* CommandReceiptStoreV2;
        yield* createThread(ownerId, cwd);
        const source = yield* seedSource(ownerId);
        const prompt = yield* startReply(ownerId, replyId, source);
        yield* startReply(replyId, nestedId, prompt);
        yield* send(replyId, "queued", "queue_after_active");
        yield* createThread(forkId, cwd);
        const fork = (yield* engine.getThreadProjection(forkId)).thread;
        yield* sink.write({
          events: [
            {
              id: EventId.make("fork-lineage"),
              type: "thread.metadata-updated",
              threadId: forkId,
              occurredAt: yield* DateTime.now,
              payload: {
                ...fork,
                historyOrigin: "v1_import",
                lineage: {
                  rootThreadId: ownerId,
                  parentThreadId: ownerId,
                  relationshipToParent: "fork",
                },
              },
            },
          ],
        });
        yield* send(forkId, "fork-work");
        yield* waitForRunning(forkId);
        const forkState = yield* engine.getThreadProjection(forkId);
        const parentRun = forkState.runs[0]!;
        yield* engine.dispatch({
          type: "delegated_task.request",
          commandId: CommandId.make("unrelated-task"),
          parentThreadId: forkId,
          parentRunId: parentRun.id,
          parentNodeId: parentRun.rootNodeId!,
          task: "Unrelated task",
          modelSelection: selection,
          runtimeMode: "full-access",
          interactionMode: "default",
          completionWake: "settled_only",
          createdBy: "agent",
          creationSource: "mcp",
        });
        const taskId = (yield* engine.getThreadProjection(forkId)).subagents[0]!.childThreadId!;
        yield* waitForRunning(taskId);
        expect((yield* engine.getThreadProjection(ownerId)).subagents).toEqual([]);
        expect((yield* engine.getThreadProjection(ownerId)).nodes).toEqual([]);
        yield* lifecycle.start();
        yield* engine.dispatch({
          type,
          commandId: CommandId.make(`close:${type}`),
          threadId: ownerId,
        });
        if (type === "thread.archive") {
          const refused = yield* Effect.exit(
            send(replyId, "closed-followup", "queue_after_active"),
          );
          expect(Exit.isFailure(refused)).toBe(true);
        }
        yield* lifecycle.drain;
        yield* (yield* OrchestrationEffectWorkerV2).drain();
        for (const id of [replyId, nestedId]) {
          const child = yield* engine.getThreadProjection(id);
          expect(fake.active.has(id)).toBe(false);
          expect(
            child.runs.every((run) => ["interrupted", "cancelled", "queued"].includes(run.status)),
          ).toBe(true);
          expect(child.thread.deletedAt !== null).toBe(type === "thread.delete");
        }
        expect(fake.active.has(forkId)).toBe(true);
        expect(fake.active.has(taskId)).toBe(true);
        expect((yield* engine.getThreadProjection(forkId)).thread.deletedAt).toBeNull();
        if (type === "thread.archive") {
          const resumed = yield* Effect.exit(
            engine.dispatch({
              type: "queue.resume",
              commandId: CommandId.make("closed-resume"),
              threadId: replyId,
            }),
          );
          expect(Exit.isFailure(resumed)).toBe(true);
          expect(
            (yield* engine.getThreadProjection(replyId)).runs.find((run) => run.status === "queued")
              ?.queueHeld,
          ).toBe(true);
        }
        const closed = Option.getOrThrow(
          yield* events
            .read({
              threadId: ownerId,
              eventType: type === "thread.delete" ? "thread.deleted" : "thread.archived",
            })
            .pipe(Stream.runLast),
        );
        const commandId = CommandId.make(
          `reply-lifecycle:${type === "thread.delete" ? "delete" : "stop"}:${closed.sequence}:${replyId}`,
        );
        const receipt = Option.getOrThrow(yield* receipts.getByCommandId(commandId));
        expect(receipt.status).toBe("accepted");
        const before = yield* events.readByCommandId({ commandId }).pipe(Stream.runCollect);
        yield* lifecycle.handle(closed);
        yield* lifecycle.recover;
        yield* (yield* OrchestrationEffectWorkerV2).drain();
        expect(yield* events.readByCommandId({ commandId }).pipe(Stream.runCollect)).toEqual(
          before,
        );
        if (type === "thread.archive") expect(fake.interruptions.get(replyId)).toBe(1);
      }).pipe(Effect.provide(testLayer(fake.adapter)));
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["thread.archive", "thread.delete"] as const)(
  "recovers reply cleanup after %s committed before lifecycle startup",
  (type) =>
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace("reply-recovery");
      const fake = fakeProvider(cwd);
      yield* Effect.gen(function* () {
        const engine = yield* OrchestratorV2;
        const sink = yield* EventSinkV2;
        const lifecycle = yield* ReplyThreadLifecycle;
        yield* createThread(ownerId, cwd);
        yield* startReply(ownerId, replyId, yield* seedSource(ownerId));
        yield* engine.dispatch({
          type,
          commandId: CommandId.make(`offline-close:${type}`),
          threadId: ownerId,
        });
        expect(fake.active.has(replyId)).toBe(true);
        const afterSequence = yield* sink.latestSequence();
        yield* lifecycle.start();
        yield* sink.stream({ threadId: replyId, afterSequence }).pipe(
          Stream.filter(({ event }) =>
            type === "thread.delete"
              ? event.type === "thread.deleted"
              : (event.type === "turn-item.updated" &&
                  event.payload.type === "run_interrupt_request") ||
                (event.type === "run.updated" &&
                  ["interrupted", "cancelled"].includes(event.payload.status)),
          ),
          Stream.take(1),
          Stream.runDrain,
        );
        yield* lifecycle.drain;
        yield* (yield* OrchestrationEffectWorkerV2).drain();
        yield* sink.stream({ threadId: replyId, afterSequence }).pipe(
          Stream.filter(
            ({ event }) =>
              event.type === "run.updated" &&
              ["interrupted", "cancelled"].includes(event.payload.status),
          ),
          Stream.take(1),
          Stream.runDrain,
        );
        expect(fake.active.has(replyId)).toBe(false);
        const recovered = yield* engine.getThreadProjection(replyId);
        expect(
          recovered.runs.every((run) => ["interrupted", "cancelled"].includes(run.status)),
        ).toBe(true);
        expect(recovered.thread.deletedAt !== null).toBe(type === "thread.delete");
      }).pipe(Effect.provide(testLayer(fake.adapter)));
    }).pipe(Effect.provide(NodeServices.layer)),
);
