import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  RunAttemptId,
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  SubagentId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as CoordinationRepository from "../persistence/Layers/ProjectionProjectAgentCoordination.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../persistence/Services/ProjectionProjectAgentCoordination.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as Coordinator from "./ProjectAgentCoordinator.ts";
import * as Delivery from "./ProjectAgentMessageDelivery.ts";

const projectId = ProjectId.make("coordination-project");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Coordination persistence never starts a provider process"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const database = Sqlite.layerMemory;
const settingsPatch = {
  betterT3Environment: {
    version: 1,
    initialization: "existing-install-migration",
    flags: { "agent.projectCoordination": true },
  },
} as const;
const settings = ServerSettings.layerTest(settingsPatch);
const dependencies = Layer.mergeAll(
  database,
  settings,
  NodeServices.layer,
  ProjectStore.layer.pipe(Layer.provide(database)),
  EffectOutbox.layer.pipe(Layer.provide(database)),
  CoordinationRepository.ProjectionProjectAgentCoordinationRepositoryLive.pipe(
    Layer.provide(database),
  ),
  ReplayHarness.layerWithRegistry(
    { name: "project-coordination" },
    ProviderRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false, settings: settingsPatch },
  ),
);
const testLayer = Layer.merge(Coordinator.ProjectAgentCoordinatorLive, Delivery.layer).pipe(
  Layer.provideMerge(dependencies),
);

const createThread = Effect.fn("coordination.test.createThread")(function* (threadId: ThreadId) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId,
    title: threadId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
});

it.effect("commits offline delivery with the inbox and leaves active peers unsteered", () =>
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const orchestration = yield* Orchestrator.OrchestratorV2;
    const coordinator = yield* Coordinator.ProjectAgentCoordinator;
    const repository = yield* ProjectionProjectAgentCoordinationRepository;
    const delivery = yield* Delivery.ProjectAgentMessageDelivery;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* projects.apply({
      sequence: 1,
      eventId: EventId.make("coordination-project-created"),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "Coordination",
        workspaceRoot: "/coordination",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    const senderId = ThreadId.make("coordination-sender");
    const idleId = ThreadId.make("coordination-idle");
    yield* createThread(senderId);
    yield* createThread(idleId);
    yield* orchestration.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("coordination-start-sender"),
      threadId: senderId,
      messageId: MessageId.make("coordination-start-sender"),
      text: "Work on the project",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* repository.upsertClaim({
      projectId,
      threadId: idleId,
      turnId: TurnId.make("old-turn"),
      summary: "Recovered stale work",
      claims: [{ kind: "path", path: "src/parser.ts" }],
      updatedAt: now,
    });
    const afterRestart = yield* Coordinator.ProjectAgentCoordinator.use((fresh) =>
      fresh.list(senderId),
    ).pipe(Effect.provide(Layer.fresh(Coordinator.ProjectAgentCoordinatorLive)));
    expect(afterRestart.peers.find((peer) => peer.threadId === idleId)?.claims).toEqual([]);
    const senderProjection = yield* orchestration.getThreadProjection(senderId);
    const sourceRun = senderProjection.runs[0]!;
    const nowDate = DateTime.makeUnsafe(now);
    const activeAttemptId =
      sourceRun.activeAttemptId ?? RunAttemptId.make("coordination-current-attempt");
    yield* (yield* EventSink.EventSinkV2).write({
      events: [
        {
          id: EventId.make("sender-active-attempt"),
          type: "run.updated",
          threadId: senderId,
          occurredAt: nowDate,
          payload: { ...sourceRun, activeAttemptId },
        },
      ],
    });
    yield* (yield* EventSink.EventSinkV2).write({
      events: [
        {
          id: EventId.make("sender-native-turn"),
          type: "provider-turn.updated",
          threadId: senderId,
          occurredAt: nowDate,
          payload: {
            id: ProviderTurnId.make("sender-native-turn"),
            providerThreadId: ProviderThreadId.make("sender-provider-thread"),
            nodeId: NodeId.make("sender-node"),
            runAttemptId: activeAttemptId,
            nativeTurnRef: {
              driver: ProviderDriverKind.make("codex"),
              nativeId: "current-sender-turn",
              strength: "strong",
            },
            ordinal: 1,
            status: "running",
            startedAt: nowDate,
            completedAt: null,
          },
        },
      ],
    });
    const sent = yield* coordinator.send(senderId, {
      target: { threadId: idleId },
      kind: "request",
      body: "Please check the parser.",
    });
    const inbox = yield* repository.readInbox({ projectId, threadId: idleId, limit: 20 });
    expect(inbox.messages.map((message) => message.messageId)).toEqual([sent.messageId]);
    const effects = yield* outbox.listByCommandId(
      CommandId.make(`project-agent-message:${sent.messageId}`),
    );
    expect(effects.map((effect) => effect.request.type)).toEqual([
      "project-agent.message.deliver",
      "project-agent.message.deliver",
    ]);
    expect((yield* orchestration.getThreadShell(idleId))?.activeRunId).toBeNull();
    for (const effect of effects) {
      if (effect.request.type === "project-agent.message.deliver")
        yield* delivery.execute({ threadId: effect.threadId, request: effect.request });
    }
    const awakened = yield* orchestration.getThreadProjection(idleId);
    expect(awakened.runs).toHaveLength(1);
    expect(
      (yield* coordinator.list(senderId)).peers.find((peer) => peer.threadId === idleId)?.claims,
    ).toEqual([]);
    const claimed = yield* coordinator.claim(senderId, {
      action: "set",
      summary: "Current work",
      claims: [{ kind: "path", path: "src/parser.ts" }],
    });
    expect(claimed.accepted).toBe(true);
    expect((yield* coordinator.list(senderId)).peers.find((peer) => peer.self)?.claims).toEqual([
      { kind: "path", path: "src/parser.ts" },
    ]);
    expect(awakened.messages[0]?.text).toContain("Please check the parser.");
    expect(awakened.messages[0]?.senderThreadId).toBe(senderId);
    expect(awakened.turnItems.filter((item) => item.type === "notification")).toHaveLength(1);
    for (const effect of effects) {
      if (effect.request.type === "project-agent.message.deliver")
        yield* delivery.execute({ threadId: effect.threadId, request: effect.request });
    }
    expect((yield* orchestration.getThreadProjection(idleId)).runs).toHaveLength(1);
    expect(
      (yield* orchestration.getThreadProjection(idleId)).turnItems.filter(
        (item) => item.type === "notification",
      ),
    ).toHaveLength(1);

    const activeMessage = yield* coordinator.send(senderId, {
      target: { threadId: idleId },
      kind: "info",
      body: "A second update while working.",
    });
    const activeEffects = yield* outbox.listByCommandId(
      CommandId.make(`project-agent-message:${activeMessage.messageId}`),
    );
    for (const effect of activeEffects) {
      if (effect.request.type === "project-agent.message.deliver") {
        expect(effect.request.wake).toBeUndefined();
        yield* delivery.execute({ threadId: effect.threadId, request: effect.request });
      }
    }
    expect((yield* orchestration.getThreadProjection(idleId)).messages).toHaveLength(1);
    expect(
      (yield* repository.readInbox({ projectId, threadId: idleId, limit: 20 })).messages,
    ).toHaveLength(2);

    const rollbackTarget = ThreadId.make("coordination-rollback");
    yield* createThread(rollbackTarget);
    const failed = yield* Coordinator.ProjectAgentCoordinator.use((fresh) =>
      fresh.send(senderId, {
        target: { threadId: rollbackTarget },
        kind: "request",
        body: "Must not persist without delivery.",
      }),
    ).pipe(
      Effect.provide(Layer.fresh(Coordinator.ProjectAgentCoordinatorLive)),
      Effect.provideService(EffectOutbox.EffectOutboxV2, {
        ...outbox,
        enqueue: () => Effect.fail(new EffectOutbox.EffectOutboxError({ operation: "enqueue" })),
      }),
      Effect.flip,
    );
    expect(failed._tag).toBe("ProjectAgentCoordinationOperationError");
    expect(
      (yield* repository.readInbox({ projectId, threadId: rollbackTarget, limit: 20 })).messages,
    ).toEqual([]);

    for (const status of ["archived", "busy"] as const) {
      const targetId = ThreadId.make(`coordination-${status}`);
      yield* createThread(targetId);
      const pending = yield* coordinator.send(senderId, {
        target: { threadId: targetId },
        kind: "request",
        body: "Do not interrupt newer work.",
      });
      if (status === "archived")
        yield* orchestration.dispatch({
          type: "thread.archive",
          commandId: CommandId.make(`archive:${targetId}`),
          threadId: targetId,
        });
      else
        yield* orchestration.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`start:${targetId}`),
          threadId: targetId,
          messageId: MessageId.make(`start:${targetId}`),
          text: "New user work",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
      const pendingEffects = yield* outbox.listByCommandId(
        CommandId.make(`project-agent-message:${pending.messageId}`),
      );
      for (const effect of pendingEffects) {
        if (effect.request.type === "project-agent.message.deliver")
          yield* delivery.execute({ threadId: effect.threadId, request: effect.request });
      }
      expect(
        (yield* orchestration.getThreadProjection(targetId)).messages.map(
          (message) => message.text,
        ),
      ).toEqual(status === "archived" ? [] : ["New user work"]);
    }
  }).pipe(Effect.provide(testLayer)),
);

it.effect("treats only root chats as peers and counts reply topics toward their source", () =>
  Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    const orchestration = yield* Orchestrator.OrchestratorV2;
    const coordinator = yield* Coordinator.ProjectAgentCoordinator;
    const events = yield* EventSink.EventSinkV2;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* projects.apply({
      sequence: 1,
      eventId: EventId.make("root-peers-project-created"),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "Coordination",
        workspaceRoot: "/coordination",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    const start = (threadId: ThreadId) =>
      orchestration.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`root-peers-start:${threadId}`),
        threadId,
        messageId: MessageId.make(`root-peers-start:${threadId}`),
        text: "Work on the project",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
    const senderId = ThreadId.make("root-peers-sender");
    const sourceId = ThreadId.make("root-peers-reply-source");
    yield* createThread(senderId);
    yield* createThread(sourceId);
    yield* start(senderId);
    const base = (yield* orchestration.getThreadProjection(senderId)).thread;
    const child = (id: string, fields: Partial<typeof base>) =>
      events.write({
        events: [
          {
            id: EventId.make(`root-peers-created:${id}`),
            type: "thread.created",
            threadId: ThreadId.make(id),
            occurredAt: base.createdAt,
            payload: {
              ...base,
              id: ThreadId.make(id),
              title: id,
              lineage: {
                parentThreadId: senderId,
                relationshipToParent: "subagent",
                rootThreadId: senderId,
              },
              ...fields,
            },
          },
        ],
      });
    yield* child("root-peers-subagent", {});
    yield* child("root-peers-native-child", { creationSource: "provider" });
    yield* child("root-peers-fetch-worker", { fetchWorker: { commandExecutionPolicy: "deny" } });
    yield* child("root-peers-reply", {
      lineage: {
        parentThreadId: sourceId,
        relationshipToParent: "subagent",
        rootThreadId: sourceId,
      },
      messageReply: {
        replyTopicId: SubagentId.make("root-peers-topic"),
        sourceThreadId: sourceId,
        messageId: MessageId.make("root-peers-source-message"),
      },
    });
    for (const id of ["root-peers-subagent", "root-peers-fetch-worker", "root-peers-reply"])
      yield* start(ThreadId.make(id));

    const listed = yield* coordinator.list(senderId);
    expect(listed.peers.map((peer) => [peer.threadId, peer.phase])).toEqual([
      [senderId, "starting"],
      [sourceId, "starting"],
    ]);
    const broadcast = yield* coordinator.send(senderId, {
      target: { broadcast: true },
      kind: "info",
      body: "Heads up.",
    });
    expect(broadcast.recipientThreadIds).toEqual([sourceId]);
    const direct = yield* coordinator
      .send(senderId, {
        target: { threadId: ThreadId.make("root-peers-subagent") },
        kind: "info",
        body: "Not a peer.",
      })
      .pipe(Effect.flip);
    expect(direct).toMatchObject({ reason: "target_unavailable" });

    const replyRunId = (yield* orchestration.getThreadShell(ThreadId.make("root-peers-reply")))
      ?.activeRunId;
    const reply = {
      replyTopicId: SubagentId.make("root-peers-topic"),
      turnId: TurnId.make(replyRunId!),
      providerInstanceId: instanceId,
    };
    const claimed = yield* coordinator.claim(
      sourceId,
      { action: "set", summary: "Reply work", claims: [{ kind: "path", path: "src/reply.ts" }] },
      reply,
    );
    expect(claimed.accepted).toBe(true);
    const fromReply = yield* coordinator.list(sourceId, reply);
    expect(fromReply.peers.find((peer) => peer.self)).toMatchObject({
      threadId: sourceId,
      claims: [{ kind: "path", path: "src/reply.ts" }],
    });
    const fromReplyCredential = yield* coordinator.list(ThreadId.make("root-peers-reply"));
    expect(fromReplyCredential.peers.find((peer) => peer.self)?.threadId).toBe(sourceId);
    const fromSubagent = yield* coordinator
      .list(ThreadId.make("root-peers-subagent"))
      .pipe(Effect.flip);
    expect(fromSubagent).toMatchObject({ reason: "thread_unavailable" });
  }).pipe(Effect.provide(testLayer)),
);
