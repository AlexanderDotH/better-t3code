import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSessionStartInput,
  type ThreadReplyStartCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ServerConfig } from "../../config.ts";
import {
  MessageReplyCoordinator,
  MessageReplyCoordinatorLive,
} from "../../messageReplies/MessageReplyCoordinator.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { toRootThreadStreamItem } from "../threadStreamRouting.ts";
import { MessageReplyReactor, MessageReplyReactorLive } from "./MessageReplyReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const THREAD_ID = ThreadId.make("reply-integration-thread");
const TOPIC_ID = SubagentId.make("reply-integration-topic");
const MAIN_TURN_ID = TurnId.make("main-turn");
const SOURCE_ID = MessageId.make("main-assistant-message");
const MAIN_CREATED_AT = "2026-10-13T10:00:00.000Z";
const REPLY_CREATED_AT = "2026-10-13T10:01:00.000Z";
const FOLLOWUP_CREATED_AT = "2026-10-13T10:02:00.000Z";
const WORKSPACE_PATH = "/workspace/message-reply-integration";
const PROVIDER_DRIVER = ProviderDriverKind.make("codex");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-6.1-sol",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ],
};
const SOURCE_TEXT = "The main task is implementing the login flow.";

function orchestrationLayer(provider: Partial<ProviderServiceShape>) {
  const engine = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provideMerge(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-message-replies-integration-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  const coordinator = MessageReplyCoordinatorLive.pipe(
    Layer.provideMerge(engine),
    Layer.provide(Layer.mock(ProviderService, provider)),
  );
  return MessageReplyReactorLive.pipe(Layer.provideMerge(coordinator));
}

const makeProvider = Effect.fnUntraced(function* () {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sent = yield* Queue.unbounded<ProviderSendTurnInput>();
  const starts: ProviderSessionStartInput[] = [];
  const stops: Parameters<ProviderServiceShape["stopTransientSession"]>[0][] = [];
  const sessions = new Map<ThreadId, ProviderSessionStartInput>();
  let eventSequence = 0;
  const provider: Partial<ProviderServiceShape> = {
    subscribeEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    streamEvents: Stream.fromPubSub(events),
    getInstanceInfo: () =>
      Effect.succeed({
        instanceId: MODEL_SELECTION.instanceId,
        driverKind: PROVIDER_DRIVER,
        displayName: "Codex",
        enabled: true,
        continuationIdentity: { driverKind: PROVIDER_DRIVER, continuationKey: "codex" },
      }),
    startTransientSession: (threadId, input) =>
      Effect.sync(() => {
        starts.push(input);
        sessions.set(threadId, input);
        return {
          provider: PROVIDER_DRIVER,
          providerInstanceId: MODEL_SELECTION.instanceId,
          threadId,
          runtimeSessionId: input.runtimeSessionId!,
          status: "ready" as const,
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model: input.modelSelection?.model,
          createdAt: REPLY_CREATED_AT,
          updatedAt: REPLY_CREATED_AT,
        };
      }),
    sendTurn: (input) =>
      Queue.offer(sent, input).pipe(
        Effect.as({ threadId: input.threadId, turnId: TurnId.make(`turn:${input.threadId}`) }),
      ),
    stopTransientSession: (target) =>
      Effect.sync(() => {
        stops.push(target);
      }),
    interruptAbortTarget: () => Effect.void,
    forceStopAbortTarget: () =>
      Effect.succeed({ outcome: "terminated" as const, mechanism: "runtime-close" as const }),
  };
  function publish<Type extends ProviderRuntimeEvent["type"]>(
    input: ProviderSendTurnInput,
    type: Type,
    payload: Extract<ProviderRuntimeEvent, { readonly type: Type }>["payload"],
  ) {
    return DateTime.now.pipe(
      Effect.flatMap((now) => {
        const event = {
          type,
          payload,
          eventId: EventId.make(`reply-provider-event-${++eventSequence}`),
          provider: PROVIDER_DRIVER,
          providerInstanceId: MODEL_SELECTION.instanceId,
          threadId: input.threadId,
          runtimeSessionId: sessions.get(input.threadId)!.runtimeSessionId!,
          turnId: TurnId.make(`turn:${input.threadId}`),
          createdAt: DateTime.formatIso(now),
        } as Extract<ProviderRuntimeEvent, { readonly type: Type }>;
        return PubSub.publish(events, event);
      }),
      Effect.asVoid,
    );
  }
  return { provider, starts, stops, publish, nextSend: Queue.take(sent) };
});

it.effect(
  "persists and routes a reply independently, then continues its captured topic after the main turn settles",
  () =>
    Effect.gen(function* () {
      const provider = yield* makeProvider();
      yield* Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const coordinator = yield* MessageReplyCoordinator;
        const reactor = yield* MessageReplyReactor;
        const observed = yield* Queue.unbounded<OrchestrationEvent>();
        const events = yield* engine.subscribeDomainEvents;
        yield* events.pipe(
          Stream.runForEach((event) => Queue.offer(observed, event)),
          Effect.forkScoped,
        );
        const readThread = query.getThreadDetailById(THREAD_ID).pipe(Effect.map(Option.getOrThrow));

        yield* TestClock.setTime(Date.parse(MAIN_CREATED_AT));
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("create-reply-project"),
          projectId: ProjectId.make("reply-project"),
          title: "Reply integration project",
          workspaceRoot: "/workspace",
          createdAt: MAIN_CREATED_AT,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create-reply-thread"),
          threadId: THREAD_ID,
          projectId: ProjectId.make("reply-project"),
          title: "Main task",
          modelSelection: MODEL_SELECTION,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: "main",
          worktreePath: WORKSPACE_PATH,
          createdAt: MAIN_CREATED_AT,
        });
        yield* engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("start-main-turn"),
          threadId: THREAD_ID,
          message: {
            messageId: MessageId.make("main-user-message"),
            role: "user",
            text: "Implement the login flow.",
            attachments: [],
          },
          modelSelection: MODEL_SELECTION,
          runtimeMode: "approval-required",
          interactionMode: "default",
          createdAt: MAIN_CREATED_AT,
        });
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("main-session-running"),
          threadId: THREAD_ID,
          session: {
            threadId: THREAD_ID,
            status: "running",
            providerName: "codex",
            providerInstanceId: MODEL_SELECTION.instanceId,
            runtimeSessionId: RuntimeSessionId.make("main-runtime"),
            runtimeMode: "approval-required",
            activeTurnId: MAIN_TURN_ID,
            abortState: null,
            lastError: null,
            updatedAt: MAIN_CREATED_AT,
          },
          createdAt: MAIN_CREATED_AT,
        });
        yield* engine.dispatch({
          type: "thread.message.import",
          commandId: CommandId.make("import-main-response"),
          threadId: THREAD_ID,
          message: {
            id: SOURCE_ID,
            role: "assistant",
            text: SOURCE_TEXT,
            turnId: MAIN_TURN_ID,
            streaming: false,
            createdAt: MAIN_CREATED_AT,
            updatedAt: MAIN_CREATED_AT,
          },
        });
        const initial = yield* readThread;
        const initialShell = (yield* query.getShellSnapshot()).threads.find(
          (thread) => thread.id === THREAD_ID,
        )!;
        expect(initial.latestTurn?.state).toBe("running");
        yield* reactor.start();
        yield* TestClock.setTime(Date.parse(REPLY_CREATED_AT));

        const command: ThreadReplyStartCommand = {
          type: "thread.reply.start",
          commandId: CommandId.make("first-reply"),
          threadId: THREAD_ID,
          replyTopicId: TOPIC_ID,
          replyTo: { messageId: SOURCE_ID, role: "assistant", text: SOURCE_TEXT },
          message: {
            messageId: MessageId.make("reply-user-1"),
            role: "user",
            text: "Why use this login design?",
            attachments: [],
          },
          createdAt: REPLY_CREATED_AT,
        };
        const receipt = yield* engine.dispatch(command);
        const firstSend = yield* provider.nextSend;
        expect(yield* engine.dispatch(command)).toEqual(receipt);
        yield* reactor.drain;
        expect(provider.starts).toHaveLength(1);
        expect(firstSend.threadId).not.toBe(THREAD_ID);
        expect(firstSend.modelSelection).toEqual(MODEL_SELECTION);
        expect(firstSend.input).toBe(command.message.text);
        expect(provider.starts[0]).toMatchObject({
          providerInstanceId: MODEL_SELECTION.instanceId,
          modelSelection: MODEL_SELECTION,
          runtimeMode: "approval-required",
          cwd: WORKSPACE_PATH,
        });

        yield* provider.publish(firstSend, "content.delta", {
          streamKind: "assistant_text",
          delta: "This design keeps authentication separate.",
        });
        const streamed = yield* Queue.take(observed).pipe(
          Effect.repeat({
            until: (event) =>
              event.type === "thread.message-sent" &&
              event.payload.subagentId === TOPIC_ID &&
              event.payload.text === "This design keeps authentication separate.",
          }),
        );
        expect(toRootThreadStreamItem(streamed).kind).toBe("event");
        const live = yield* readThread;
        const liveShell = (yield* query.getShellSnapshot()).threads.find(
          (thread) => thread.id === THREAD_ID,
        )!;
        expect(live.latestTurn).toEqual(initial.latestTurn);
        expect(live.session).toEqual(initial.session);
        expect(live.messages).toEqual(initial.messages);
        expect(live.checkpoints).toEqual(initial.checkpoints);
        expect(liveShell.latestUserMessageAt).toBe(initialShell.latestUserMessageAt);
        expect(live.replyMessages?.find((message) => message.role === "assistant")).toMatchObject({
          text: "This design keeps authentication separate.",
          streaming: true,
          replyTopicId: TOPIC_ID,
          replyTo: {
            messageId: command.message.messageId,
            replyTopicId: TOPIC_ID,
            role: "user",
            text: command.message.text,
          },
        });
        expect(live.replyMessages?.find((message) => message.role === "user")?.replyTo).toEqual(
          command.replyTo,
        );

        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("main-session-ready"),
          threadId: THREAD_ID,
          session: {
            ...initial.session!,
            status: "ready",
            activeTurnId: null,
            updatedAt: REPLY_CREATED_AT,
          },
          createdAt: REPLY_CREATED_AT,
        });
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make("change-main-settings"),
          threadId: THREAD_ID,
          modelSelection: {
            instanceId: ProviderInstanceId.make("claude-work"),
            model: "new-main-model",
          },
          worktreePath: "/workspace/changed-main-worktree",
        });
        expect((yield* readThread).latestTurn?.state).toBe("completed");
        expect(coordinator.hasActiveTopic(THREAD_ID)).toBe(true);
        yield* provider.publish(firstSend, "turn.completed", { state: "completed" });
        yield* coordinator.awaitIdle(THREAD_ID);

        const completed = yield* readThread;
        const firstReply = completed.replyMessages?.find((message) => message.role === "assistant");
        expect(firstReply?.streaming).toBe(false);
        expect(firstReply?.text).toBe("This design keeps authentication separate.");
        expect(provider.stops).toEqual([expect.objectContaining({ threadId: firstSend.threadId })]);
        yield* TestClock.setTime(Date.parse(FOLLOWUP_CREATED_AT));
        const followup: ThreadReplyStartCommand = {
          ...command,
          commandId: CommandId.make("continue-reply"),
          createdAt: FOLLOWUP_CREATED_AT,
          replyTo: {
            messageId: firstReply!.id,
            replyTopicId: TOPIC_ID,
            role: "assistant",
            text: firstReply!.text,
          },
          message: {
            messageId: MessageId.make("reply-user-2"),
            role: "user",
            text: "Explain the boundary.",
            attachments: [],
          },
        };
        yield* engine.dispatch(followup);
        const secondSend = yield* provider.nextSend;
        expect(secondSend.threadId).not.toBe(firstSend.threadId);
        expect(secondSend.modelSelection).toEqual(MODEL_SELECTION);
        expect(provider.starts[1]).toMatchObject({
          providerInstanceId: MODEL_SELECTION.instanceId,
          modelSelection: MODEL_SELECTION,
          cwd: WORKSPACE_PATH,
        });
        expect(secondSend.transcriptHandoff?.text).toContain(firstReply!.text);
        expect(secondSend.transcriptHandoff?.text).toContain(command.message.text);
        yield* provider.publish(secondSend, "content.delta", {
          streamKind: "assistant_text",
          delta: "The boundary owns authentication state.",
        });
        yield* provider.publish(secondSend, "turn.completed", { state: "completed" });
        yield* coordinator.awaitIdle(THREAD_ID);
        yield* reactor.drain;

        const final = yield* readThread;
        expect(final.subagents).toHaveLength(1);
        expect(final.subagents[0]?.status).toBe("completed");
        expect(final.replyMessages?.map((message) => [message.role, message.text])).toEqual([
          ["user", command.message.text],
          ["assistant", firstReply!.text],
          ["user", followup.message.text],
          ["assistant", "The boundary owns authentication state."],
        ]);
        expect(
          final.replyMessages
            ?.filter((message) => message.role === "assistant")
            .map((message) => message.replyTo),
        ).toEqual([
          {
            messageId: command.message.messageId,
            replyTopicId: TOPIC_ID,
            role: "user",
            text: command.message.text,
          },
          {
            messageId: followup.message.messageId,
            replyTopicId: TOPIC_ID,
            role: "user",
            text: followup.message.text,
          },
        ]);
        expect(final.messages).toEqual(initial.messages);
        expect(final.latestTurn?.turnId).toBe(MAIN_TURN_ID);
        expect(final.latestTurn?.state).toBe("completed");
        const persistedEvents = yield* engine
          .readThreadEvents({
            threadId: THREAD_ID,
            fromSequenceExclusive: receipt.sequence - 1,
            toSequenceInclusive: yield* engine.latestSequence,
            limit: 100,
          })
          .pipe(Stream.runCollect);
        expect(
          persistedEvents.filter((event) => event.type === "thread.reply-start-requested"),
        ).toHaveLength(2);
        for (const event of persistedEvents) {
          if (event.type === "thread.message-sent" && event.payload.subagentId === TOPIC_ID) {
            expect(toRootThreadStreamItem(event).kind).toBe("event");
            expect(event.payload.replyTopicId).toBe(TOPIC_ID);
          }
        }
        expect(provider.starts).toHaveLength(2);
        expect(provider.stops).toHaveLength(2);
      }).pipe(Effect.provide(orchestrationLayer(provider.provider)));
    }),
);
