import * as Path from "effect/Path";
import * as ResourceCleanup from "./ResourceCleanupService.ts";
import { readInheritedHandoffItems } from "./ContextHandoffService.ts";
import * as ServerConfig from "../config.ts";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";
import * as TerminalManager from "../terminal/Manager.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import { createAttachmentId } from "../attachmentStore.ts";
import { frozenMessageEditsQuery } from "./FrozenMessageHistory.ts";
import * as FetchPreparation from "../fetch/FetchPreparation.ts";
import { FetchWorkerCoordinator } from "../fetch/FetchWorkerCoordinator.ts";
import type { FetchRunInput } from "../fetch/FetchWorkerState.ts";
import {
  GeneralSubagentCoordinator,
  GeneralSubagentCoordinatorLive,
} from "../subagents/GeneralSubagentCoordinator.ts";
import { DeepPlanWorkflow } from "../deepPlanning/DeepPlanWorkflow.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as AutoReasoningPreparation from "./AutoReasoningPreparation.ts";
import { compactThread } from "./BetterT3Runtime.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ProjectStoreV2, layer as projectStoreLayer } from "./ProjectStore.ts";
import { DecisionGeneration } from "../decisionGeneration/DecisionGeneration.ts";
import type { DecisionGenerationRequest } from "../decisionGeneration/DecisionGeneration.ts";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { isAutoReasoningEnabled, getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { contextPrefixFingerprint } from "../contextCompaction/contextCompactionPolicy.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DeepPlanWorkflowLive } from "../deepPlanning/DeepPlanWorkflow.ts";
import { DeepPlanSources } from "../deepPlanning/DeepPlanSources.ts";
import {
  DeepPlanValidationReactor,
  DeepPlanValidationDispatcher,
  DeepPlanValidationReactorLive,
} from "../deepPlanning/DeepPlanValidationReactor.ts";
import { EventSinkV2 } from "./EventSink.ts";
import * as ProviderRuntimeRecovery from "./ProviderRuntimeRecoveryService.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  DeepPlanRunId,
  EventId,
  MessageId,
  NodeId,
  resolveResultlessRetryTarget,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderTurnId,
  SubagentId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for metadata controls"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const alternateInstanceId = ProviderInstanceId.make("codex-alt");
const alternateAdapter = { ...adapter, instanceId: alternateInstanceId };
const compactionAdapters = ["opencode", "grok"].map((driver) => ({
  ...adapter,
  driver: ProviderDriverKind.make(driver),
  instanceId: ProviderInstanceId.make(driver),
}));
const layerDatabase = SqlitePersistence.layerMemory;
const layerFor = (settings?: Parameters<typeof ServerSettings.layerTest>[0]) =>
  Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    projectStoreLayer.pipe(Layer.provide(layerDatabase)),
    EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "control-reads" },
      ProviderAdapterRegistry.layerFromAdapters([adapter, alternateAdapter, ...compactionAdapters]),
      {
        databaseLayer: layerDatabase,
        runEffectWorker: false,
        ...(settings === undefined ? {} : { settings }),
      },
    ),
  );

const layerTest = layerFor();
const createThread = Effect.fn("BetterT3Commands.createThread")(function* (
  threadId: ThreadId,
  selection = modelSelection,
) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("better-project"),
    title: "Source",
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
});
const seedMessage = Effect.fn("BetterT3Commands.seedMessage")(function* (threadId: ThreadId) {
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const messageId = MessageId.make(`source:${threadId}`);
  yield* projection.apply({
    id: EventId.make(`seed:${threadId}`),
    type: "message.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: messageId,
      threadId,
      runId: null,
      nodeId: null,
      role: "user",
      text: "Original requirement",
      attachments: [],
      streaming: false,
      createdBy: "user",
      creationSource: "web",
      createdAt: now,
      updatedAt: now,
    },
  });
  yield* projection.apply({
    id: EventId.make(`item:${threadId}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`item:${threadId}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed",
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      type: "user_message",
      inputIntent: "turn_start",
      messageId,
      text: "Original requirement",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    },
  });
  return messageId;
});
it.effect("queues native compaction through registered OpenCode and ACP providers", () =>
  Effect.gen(function* () {
    const orchestration = yield* Orchestrator.OrchestratorV2;
    for (const provider of compactionAdapters) {
      const threadId = ThreadId.make(`compact:${provider.driver}`);
      yield* createThread(threadId, { instanceId: provider.instanceId, model: "test-model" });
      yield* compactThread(threadId);
      const projection = yield* orchestration.getThreadProjection(threadId);
      assert.equal(projection.messages.at(-1)?.text, "/compact");
      assert.equal(projection.runs.at(-1)?.modelSelection.instanceId, provider.instanceId);
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        ProviderAdapterRegistry.layerFromAdapters([adapter, ...compactionAdapters]),
        ThreadManagement.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              layerTest,
              ServerSettings.layerTest({
                providerInstances: Object.fromEntries(
                  compactionAdapters.map((provider) => [
                    provider.instanceId,
                    { driver: provider.driver, enabled: true, config: {} },
                  ]),
                ),
              }),
              CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase)),
            ),
          ),
        ),
      ),
    ),
  ),
);

it.effect("persists DeepPlan revisions and command receipts in V2 without a provider run", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("deep-plan-owner");
    yield* createThread(threadId);
    const runId = DeepPlanRunId.make("deep-plan-durable");
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    yield* orchestrator.dispatch({
      type: "thread.deep-plan.start",
      commandId: CommandId.make("plan-start"),
      threadId,
      runId,
      createdAt,
    });
    const pause = {
      type: "thread.deep-plan.update" as const,
      commandId: CommandId.make("plan-pause"),
      threadId,
      runId,
      expectedRevision: 0,
      operationId: "pause",
      mutation: { type: "pause" as const, reason: "User stopped work" },
      createdAt,
    };
    const accepted = yield* orchestrator.dispatch(pause);
    const replay = yield* orchestrator.dispatch(pause);
    assert.equal(replay.sequence, accepted.sequence);
    assert.equal(replay.replayed, true);
    const shell = yield* orchestrator.getThreadShell(threadId);
    assert.equal(shell?.deepPlan?.revision, 1);
    assert.equal(shell?.deepPlan?.phase, "paused");
    assert.equal(shell?.activeRunId, null);
    const otherId = ThreadId.make("other-plan-owner");
    yield* createThread(otherId);
    const duplicateOwner = yield* orchestrator
      .dispatch({
        type: "thread.deep-plan.start",
        commandId: CommandId.make("duplicate-owner"),
        threadId: otherId,
        runId,
        createdAt,
      })
      .pipe(Effect.flip);
    assert.equal(duplicateOwner._tag, "OrchestratorDispatchError");
    const rejected = yield* orchestrator
      .dispatch({ ...pause, commandId: CommandId.make("stale-pause"), operationId: "other" })
      .pipe(Effect.flip);
    assert.equal(rejected._tag, "OrchestratorDispatchError");
  }).pipe(Effect.provide(layerTest)),
);
it.effect(
  "starts parallel replies as independently stoppable V2 children and edits messages with CAS",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("reply-owner");
      yield* createThread(threadId);
      const sourceId = yield* seedMessage(threadId);
      const edit = {
        type: "message.edit" as const,
        commandId: CommandId.make("edit-source"),
        threadId,
        messageId: sourceId,
        expectedText: "Original requirement",
        text: "Edited requirement",
      };
      yield* orchestrator.dispatch(edit);
      const stale = yield* orchestrator
        .dispatch({ ...edit, commandId: CommandId.make("stale-edit"), text: "Overwrite" })
        .pipe(Effect.flip);
      assert.equal(stale._tag, "OrchestratorDispatchError");
      for (const index of [1, 2]) {
        const childId = ThreadId.make(`reply-child:${index}`);
        yield* orchestrator.dispatch({
          type: "message.reply.start",
          commandId: CommandId.make(`reply:${index}`),
          threadId,
          targetThreadId: childId,
          replyTopicId: SubagentId.make(`topic:${index}`),
          messageId: MessageId.make(`reply-message:${index}`),
          text: `Discuss option ${index}`,
          replyTo: { messageId: sourceId, role: "user", text: "Edited requirement" },
          attachments: [],
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdBy: "user",
          creationSource: "web",
        });
        const child = yield* orchestrator.getThreadProjection(childId);
        assert.equal(child.thread.lineage.parentThreadId, threadId);
        assert.equal(child.thread.messageReply?.replyTopicId, `topic:${index}`);
        assert.equal(child.runs.length, 1);
        assert.equal(child.messages[0]?.replyTo?.text, "Edited requirement");
        assert.equal(child.messages[0]?.text, `Discuss option ${index}`);
        assert.include(child.runs[0]?.additionalContext ?? "", "Recent main conversation");
      }
      assert.equal((yield* orchestrator.getThreadProjection(threadId)).runs.length, 0);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const topicThreadId = ThreadId.make("reply-child:1");
      const topicAnswerId = MessageId.make("topic-answer");
      yield* projections.apply({
        id: EventId.make("topic-answer-item"),
        type: "turn-item.updated",
        threadId: topicThreadId,
        occurredAt: now,
        payload: {
          id: TurnItemId.make("topic-answer-item"),
          threadId: topicThreadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 10,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "assistant_message",
          messageId: topicAnswerId,
          text: "Option one keeps the cache warm",
          streaming: false,
        },
      });
      const nestedId = ThreadId.make("reply-child:nested");
      yield* orchestrator.dispatch({
        type: "message.reply.start",
        commandId: CommandId.make("reply:nested"),
        threadId,
        targetThreadId: nestedId,
        replyTopicId: SubagentId.make("topic:nested"),
        messageId: MessageId.make("reply-message:nested"),
        text: "Expand on that",
        replyTo: {
          messageId: MessageId.make("reply-message:1"),
          replyTopicId: SubagentId.make("topic:1"),
          role: "user",
          text: "Discuss option 1",
        },
        attachments: [],
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "web",
      });
      const nestedContext =
        (yield* orchestrator.getThreadProjection(nestedId)).runs[0]?.additionalContext ?? "";
      assert.include(nestedContext, "This topic originally replied to:\nEdited requirement");
      assert.include(nestedContext, "Option one keeps the cache warm");
      const assistantId = MessageId.make("editable-assistant");
      yield* projections.apply({
        id: EventId.make("editable-assistant-created"),
        type: "message.updated",
        threadId,
        occurredAt: now,
        payload: {
          id: assistantId,
          threadId,
          runId: null,
          nodeId: null,
          role: "assistant",
          text: "Original answer",
          attachments: [],
          streaming: false,
          createdBy: "agent",
          creationSource: "server",
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* projections.apply({
        id: EventId.make("editable-assistant-item"),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: {
          id: TurnItemId.make("editable-assistant-item"),
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 2,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "assistant_message",
          messageId: assistantId,
          text: "Original answer",
          streaming: false,
        },
      });
      yield* orchestrator.dispatch({
        type: "message.edit",
        commandId: CommandId.make("edit-assistant"),
        threadId,
        messageId: assistantId,
        expectedText: "Original answer",
        text: "Corrected answer",
      });
      const edited = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(
        edited.messages.find((message) => message.id === assistantId)?.text,
        "Corrected answer",
      );
      assert.isTrue(
        edited.turnItems.some(
          (item) =>
            item.type === "assistant_message" &&
            item.messageId === assistantId &&
            item.text === "Corrected answer",
        ),
      );
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-reply-owner"),
        threadId,
      });
      const childFollowup = yield* orchestrator
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("closed-reply-followup"),
          threadId: ThreadId.make("reply-child:1"),
          messageId: MessageId.make("closed-reply-followup"),
          text: "Continue",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          dispatchMode: { type: "queue_after_active" },
        })
        .pipe(Effect.flip);
      assert.equal(childFollowup._tag, "OrchestratorDispatchError");
      const resume = yield* orchestrator
        .dispatch({
          type: "queue.resume",
          commandId: CommandId.make("closed-reply-resume"),
          threadId: ThreadId.make("reply-child:2"),
        })
        .pipe(Effect.flip);
      assert.equal(resume._tag, "OrchestratorDispatchError");
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "forks an imported message boundary through portable context and preserves edited history on the next run",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("fork-edited-owner");
      const targetThreadId = ThreadId.make("fork-edited-target");
      yield* createThread(threadId);
      const messageId = yield* seedMessage(threadId);
      yield* orchestrator.dispatch({
        type: "message.edit",
        commandId: CommandId.make("edit-before-fork"),
        threadId,
        messageId,
        expectedText: "Original requirement",
        text: "Corrected requirement",
      });
      yield* orchestrator.dispatch({
        type: "thread.fork",
        commandId: CommandId.make("fork-at-message"),
        sourceThreadId: threadId,
        targetThreadId,
        sourcePoint: { type: "message", messageId },
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.edit",
        commandId: CommandId.make("edit-after-exact-fork"),
        threadId,
        messageId,
        expectedText: "Corrected requirement",
        text: "Later parent correction",
      });
      const prefix = yield* orchestrator.getThreadSnapshotWindow(targetThreadId, { rowLimit: 20 });
      assert.isTrue(
        prefix.projection.visibleTurnItems.some(
          ({ item }) =>
            item.type === "user_message" &&
            item.messageId === messageId &&
            item.text === "Corrected requirement",
        ),
      );
      assert.equal((yield* orchestrator.getThreadShell(targetThreadId))?.visibleItemCount, 1);
      const nestedThreadId = ThreadId.make("fork-inherited-message-target");
      yield* orchestrator.dispatch({
        type: "thread.fork",
        commandId: CommandId.make("fork-inherited-message"),
        sourceThreadId: targetThreadId,
        targetThreadId: nestedThreadId,
        sourcePoint: { type: "message", messageId },
        createdBy: "user",
        creationSource: "web",
      });
      const nestedPrefix = yield* orchestrator.getTimelinePage(nestedThreadId, {
        limit: 20,
        view: "messages",
      });
      assert.isTrue(
        nestedPrefix.items.some(
          ({ item }) =>
            item.type === "user_message" &&
            item.messageId === messageId &&
            item.text === "Corrected requirement",
        ),
      );
      const inherited = yield* readInheritedHandoffItems(
        yield* ProjectionStore.ProjectionStoreV2,
        prefix.projection.thread,
      );
      assert.isTrue(
        inherited.some(
          (item) => item.type === "user_message" && item.text === "Corrected requirement",
        ),
      );
      assert.isFalse(
        inherited.some(
          (item) => item.type === "user_message" && item.text === "Later parent correction",
        ),
      );
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("nested-fork-first-run"),
        threadId: nestedThreadId,
        messageId: MessageId.make("nested-fork-prompt"),
        text: "Continue inherited context",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      assert.include(
        JSON.stringify((yield* orchestrator.getThreadProjection(nestedThreadId)).contextHandoffs),
        "Corrected requirement",
      );
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("fork-first-run"),
        threadId: targetThreadId,
        messageId: MessageId.make("fork-first-message"),
        text: "Continue from this point",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const fork = yield* orchestrator.getThreadProjection(targetThreadId);
      assert.equal(fork.contextTransfers[0]?.resolution?.strategy, "portable_context");
      assert.include(JSON.stringify(fork.contextHandoffs), "Corrected requirement");
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("edited-next-run"),
        threadId,
        messageId: MessageId.make("edited-next-message"),
        text: "Continue the corrected requirement",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const source = yield* orchestrator.getThreadProjection(threadId);
      assert.include(JSON.stringify(source.contextHandoffs), "Later parent correction");
      assert.equal(source.thread.pendingHistoryEdit, undefined);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("forks an inherited proposed plan at its exact history boundary", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const sourceThreadId = ThreadId.make("exact-plan-source");
    const firstFork = ThreadId.make("exact-plan-first-fork");
    const nestedFork = ThreadId.make("exact-plan-nested-fork");
    yield* createThread(sourceThreadId);
    yield* seedMessage(sourceThreadId);
    const base = (yield* orchestrator.getThreadProjection(sourceThreadId)).turnItems[0]!;
    if (base.type !== "user_message") return yield* Effect.die("Expected the seeded user message.");
    const planId = PlanId.make("exact-plan");
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make("exact-plan-item"),
      type: "turn-item.updated",
      threadId: sourceThreadId,
      occurredAt: now,
      payload: {
        ...base,
        id: TurnItemId.make("exact-plan-item"),
        ordinal: 2,
        type: "proposed_plan",
        planId,
        markdown: "Plan at the selected boundary",
        streaming: false,
      },
    });
    yield* projections.apply({
      id: EventId.make("after-exact-plan-item"),
      type: "turn-item.updated",
      threadId: sourceThreadId,
      occurredAt: now,
      payload: {
        ...base,
        id: TurnItemId.make("after-exact-plan-item"),
        ordinal: 3,
        type: "assistant_message",
        messageId: MessageId.make("after-exact-plan-message"),
        text: "Later answer outside the fork",
        streaming: false,
      },
    });
    for (const [sourceId, targetId] of [
      [sourceThreadId, firstFork],
      [firstFork, nestedFork],
    ] as const) {
      yield* orchestrator.dispatch({
        type: "thread.fork",
        commandId: CommandId.make(`fork:${targetId}`),
        sourceThreadId: sourceId,
        targetThreadId: targetId,
        sourcePoint: { type: "proposed_plan", planId },
        createdBy: "user",
        creationSource: "web",
      });
      const prefix = yield* orchestrator.getThreadSnapshotWindow(targetId, { rowLimit: 20 });
      assert.isTrue(
        prefix.projection.visibleTurnItems.some(
          ({ item }) => item.type === "proposed_plan" && item.planId === planId,
        ),
      );
      assert.isFalse(
        prefix.projection.visibleTurnItems.some(
          ({ item }) =>
            item.type === "assistant_message" && item.text === "Later answer outside the fork",
        ),
      );
      assert.equal((yield* orchestrator.getThreadShell(targetId))?.visibleItemCount, 2);
      const bounded = yield* orchestrator.getThreadSnapshotWindow(targetId, { rowLimit: 1 });
      assert.equal(bounded.projection.visibleTurnItems.length, 1);
      assert.equal(bounded.projection.visibleTurnItems[0]?.position, 1);
    }
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("exact-plan-resume"),
      threadId: nestedFork,
      messageId: MessageId.make("exact-plan-prompt"),
      text: "Implement this plan",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      dispatchMode: { type: "start_immediately" },
    });
    const resumed = yield* orchestrator.getThreadProjection(nestedFork);
    assert.include(JSON.stringify(resumed.contextHandoffs), "Plan at the selected boundary");
    assert.notInclude(JSON.stringify(resumed.contextHandoffs), "Later answer outside the fork");
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "continues a durable plan through V2 and a restart, and pauses it after a provider failure",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const events = yield* EventSinkV2;
      const threadId = ThreadId.make("continuation-owner");
      yield* createThread(threadId);
      yield* orchestrator.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("continuation-mode"),
        threadId,
        interactionMode: "plan",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("continuation-earlier-run"),
        threadId,
        messageId: MessageId.make("continuation-earlier-message"),
        text: "Earlier request",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const earlierRun = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
      const failedAt = yield* DateTime.now;
      yield* events.write({
        events: [
          {
            id: EventId.make("continuation-earlier-failed"),
            type: "run.updated",
            threadId,
            runId: earlierRun.id,
            occurredAt: failedAt,
            payload: { ...earlierRun, status: "failed", completedAt: failedAt },
          },
        ],
      });
      const runId = DeepPlanRunId.make("continuation-plan");
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrator.dispatch({
        type: "thread.deep-plan.start",
        commandId: CommandId.make("continuation-start"),
        threadId,
        runId,
        createdAt,
      });
      const feature = DeepPlanValidationReactorLive.pipe(
        Layer.provideMerge(
          DeepPlanWorkflowLive.pipe(
            Layer.provide(Layer.mock(DeepPlanSources)({})),
            Layer.provide(ProviderAdapterRegistry.layerFromAdapters([adapter])),
          ),
        ),
        Layer.provide(
          Layer.succeed(DeepPlanValidationDispatcher, {
            dispatch: () => Effect.die("Final validation is not ready"),
          }),
        ),
        Layer.provide(NodeServices.layer),
      );
      const recovery = ProviderRuntimeRecovery.make.pipe(
        Effect.provide(
          Layer.merge(
            IdAllocator.layer,
            ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const reactor = yield* DeepPlanValidationReactor;
        yield* reactor.start();
        const planning = yield* orchestrator.dispatch({
          type: "thread.deep-plan.update",
          commandId: CommandId.make("continuation-sources"),
          threadId,
          runId,
          expectedRevision: 0,
          operationId: "sources",
          mutation: { type: "sources-set", sources: [] },
          createdAt,
        });
        yield* reactor.drainThrough(planning.sequence);
        const beforeRequest = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(beforeRequest.thread.deepPlan?.phase, "planning");
        assert.equal(beforeRequest.runs.length, 1);
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("continuation-request"),
          threadId,
          messageId: MessageId.make("continuation-request-message"),
          text: "Plan the change.",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          deepPlanRunId: runId,
          dispatchMode: { type: "start_immediately" },
        });
        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.thread.deepPlan?.phase, "planning");
        assert.equal(projection.runs.length, 2);
        assert.equal(projection.runs[1]?.deepPlanRunId, runId);
        const shutdown = yield* recovery;
        yield* shutdown.prepareForShutdown;
        yield* shutdown.reconcile("shutdown");
        yield* reactor.drainThrough(yield* events.latestSequence());
        const stopped = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(stopped.runs[1]?.status, "cancelled");
        assert.equal(stopped.thread.deepPlan?.phase, "planning");
      }).pipe(Effect.provide(feature));
      yield* Effect.gen(function* () {
        const reactor = yield* DeepPlanValidationReactor;
        yield* reactor.start();
        yield* reactor.drainThrough(yield* events.latestSequence());
        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.thread.deepPlan?.phase, "planning");
        assert.equal(projection.runs.length, 3);
        const providerRun = projection.runs[2]!;
        assert.equal(providerRun.deepPlanRunId, runId);
        assert.notInclude(
          projection.messages.map((message) => message.text).join("\n"),
          "Continue where you left off",
        );
        const now = yield* DateTime.now;
        const failure = yield* events.write({
          events: [
            {
              id: EventId.make("continuation-provider-failed"),
              type: "run.updated",
              threadId,
              runId: providerRun.id,
              occurredAt: now,
              payload: { ...providerRun, status: "failed", completedAt: now },
            },
          ],
        });
        yield* reactor.drainThrough(failure.at(-1)!.sequence);
        const paused = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(paused.thread.deepPlan?.phase, "paused");
        assert.equal(paused.runs.length, 3);
      }).pipe(Effect.provide(feature));
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "waits for repository exploration outside the provider worker and releases it with saved findings",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const threadId = ThreadId.make("fetch-owner");
      yield* createThread(threadId);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("fetch-message"),
        threadId,
        messageId: MessageId.make("fetch-message"),
        text: "Explore this implementation",
        attachments: [],
        fetchMode: "repository-exploration",
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      yield* worker.drain();
      const pending = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(pending.messages[0]?.fetchMode, "repository-exploration");
      assert.equal(pending.runs[0]?.status, "starting");
      assert.equal(pending.providerTurns.length, 0);
      const command = {
        type: "prepared-run.fetch.complete" as const,
        commandId: CommandId.make("fetch-result"),
        threadId,
        runId: pending.runs[0]!.id,
        context: "Repository evidence with exact files",
      };
      yield* orchestrator.dispatch(command);
      const replay = yield* orchestrator.dispatch(command);
      assert.equal(replay.replayed, true);
      const ready = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(ready.runs[0]?.fetchContext, command.context);
    }).pipe(Effect.provide(layerTest)),
);
it.effect(
  "uses a saved context summary and retained tail without rewriting the stored conversation",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const events = yield* EventSinkV2;
      const threadId = ThreadId.make("context-owner");
      yield* createThread(threadId);
      yield* seedMessage(threadId);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("context-original-run"),
        threadId,
        messageId: MessageId.make("context-recent-message"),
        text: "Recent request",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const initial = yield* orchestrator.getThreadProjection(threadId);
      const run = initial.runs[0]!;
      const now = yield* DateTime.now;
      yield* events.write({
        events: [
          {
            id: EventId.make("context-original-completed"),
            type: "run.updated",
            threadId,
            runId: run.id,
            occurredAt: now,
            payload: { ...run, status: "completed", completedAt: now },
          },
          {
            id: EventId.make("context-original-usage"),
            type: "provider-turn.updated",
            threadId,
            runId: run.id,
            occurredAt: now,
            payload: {
              id: ProviderTurnId.make("context-original-turn"),
              providerThreadId: run.providerThreadId!,
              nodeId: run.rootNodeId!,
              runAttemptId: run.activeAttemptId,
              nativeTurnRef: null,
              ordinal: 1,
              status: "completed",
              startedAt: now,
              completedAt: now,
              tokenUsage: { usedTokens: 650, maxTokens: 1000, updatedAt: DateTime.formatIso(now) },
            },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "thread.context-compaction.update",
        commandId: CommandId.make("context-save"),
        threadId,
        savedState: "prepared",
        checkpoint: {
          version: 1,
          prefixMessageCount: 1,
          prefixFingerprint: contextPrefixFingerprint(initial.messages, 1),
          summary: "Saved original requirement",
          modelSelection,
          agentModelSelection: modelSelection,
          mode: "summary",
          cwd: "/repo",
          sourceRuntimeSessionId: null,
        },
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("context-next-run"),
        threadId,
        messageId: MessageId.make("context-next-message"),
        text: "Continue",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const compacted = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(compacted.thread.contextCompaction?.state, "applied");
      assert.equal(compacted.messages[0]?.text, "Original requirement");
      assert.include(JSON.stringify(compacted.contextHandoffs), "Saved original requirement");
      assert.include(JSON.stringify(compacted.contextHandoffs), "Recent request");
    }).pipe(
      Effect.provide(
        layerFor({ betterT3Environment: { flags: { "agent.contextCompaction": true } } }),
      ),
    ),
);

it.effect(
  "resolves automatic reasoning through the configured router and saves it once per V2 run",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const threadId = ThreadId.make("auto-reasoning-owner");
      yield* createThread(threadId);
      const automatic = {
        ...modelSelection,
        options: [
          { id: "reasoningEffort", value: "medium" },
          { id: "t3AutoReasoning", value: true },
        ],
      };
      const started = yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("automatic-run"),
        threadId,
        messageId: MessageId.make("automatic-prompt"),
        text: "Diagnose and fix this cross-client state bug",
        modelSelection: automatic,
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      yield* worker.drain();
      assert.equal((yield* orchestrator.getThreadProjection(threadId)).providerTurns.length, 0);
      const decided = yield* Deferred.make<DecisionGenerationRequest>();
      const completed = yield* orchestrator
        .streamStoredEventsFrom({
          threadId,
          afterSequence: started.sequence,
          eventType: "run.updated",
        })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "run.updated" &&
              stored.event.payload.resolvedModelSelection !== undefined,
          ),
          Stream.runHead,
          Effect.forkScoped,
        );
      const now = DateTime.formatIso(yield* DateTime.now);
      const provider = {
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: "test",
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: now,
        models: [
          {
            slug: modelSelection.model,
            name: modelSelection.model,
            isCustom: false,
            capabilities: {
              optionDescriptors: [
                {
                  id: "reasoningEffort",
                  label: "Reasoning effort",
                  type: "select" as const,
                  options: [
                    { id: "medium", label: "Medium" },
                    { id: "high", label: "High" },
                  ],
                },
              ],
            },
          },
        ],
        slashCommands: [],
        skills: [],
      };
      const feature = AutoReasoningPreparation.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
            Layer.mock(ProjectStoreV2)({
              get: () =>
                Effect.succeedSome({
                  projectId: ProjectId.make("better-project"),
                  title: "Project",
                  workspaceRoot: "/repo",
                  defaultModelSelection: null,
                  defaultThreadEnvMode: null,
                  autoPull: false,
                  faviconPath: null,
                  projectIcon: null,
                  scripts: [],
                  pinnedAt: null,
                  archivedAt: null,
                  createdAt: now,
                  updatedAt: now,
                  deletedAt: null,
                }),
            }),
            ServerSettings.layerTest({
              autoReasoningModelSelection: {
                instanceId: ProviderInstanceId.make("router"),
                model: "configured-router",
              },
            }),
            Layer.mock(DecisionGeneration)({
              decide: (input) =>
                Deferred.succeed(decided, input).pipe(
                  Effect.as({
                    model: "configured-router",
                    answers: { autoReasoning: { choice: "high", confidence: 1 } },
                  }),
                ),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const request = yield* Deferred.await(decided);
        assert.equal(request.modelSelection.model, "configured-router");
        yield* Fiber.join(completed);
        const projection = yield* orchestrator.getThreadProjection(threadId);
        const run = projection.runs[0]!;
        assert.isTrue(isAutoReasoningEnabled(run.modelSelection));
        assert.isFalse(isAutoReasoningEnabled(run.resolvedModelSelection));
        assert.equal(
          getModelSelectionStringOptionValue(run.resolvedModelSelection!, "reasoningEffort"),
          "high",
        );
        assert.equal(run.autoReasoning?.effort, "high");
        assert.isFalse(run.autoReasoning?.fallback);
      }).pipe(Effect.provide(feature));
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "uses V2 child identities for general agents and still accepts interruption after disabling the feature",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("general-parent");
      yield* createThread(threadId);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("general-parent-start"),
        threadId,
        messageId: MessageId.make("general-parent-prompt"),
        text: "Implement the task",
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const provider = {
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        enabled: true,
        installed: true,
        version: "test",
        status: "ready" as const,
        auth: { status: "authenticated" as const },
        checkedAt: DateTime.formatIso(yield* DateTime.now),
        models: [modelSelection.model, "deep-plan-model"].map((slug) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: null,
        })),
        slashCommands: [],
        skills: [],
      };
      const settings = ServerSettings.layerTest({
        betterT3Environment: { flags: { "agent.generalSubagents": true } },
      });
      const feature = GeneralSubagentCoordinatorLive.pipe(
        Layer.provideMerge(settings),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
            Layer.mock(DeepPlanWorkflow)({}),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              dispatch: orchestrator.dispatch,
            }),
            NodeServices.layer,
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const agents = yield* GeneralSubagentCoordinator;
        const configuration = yield* ServerSettings.ServerSettingsService;
        const spawned = yield* agents.spawn({
          parentThreadId: threadId,
          callerProviderInstanceId: instanceId,
          task: "Inspect and implement a bounded change",
        });
        const parent = yield* orchestrator.getThreadProjection(threadId);
        const task = parent.subagents.find((task) => String(task.id) === spawned.agentId)!;
        assert.isNotNull(task.childThreadId);
        const child = yield* orchestrator.getThreadProjection(task.childThreadId!);
        assert.equal(child.thread.lineage.parentThreadId, threadId);
        assert.equal(child.thread.generalSubagent, true);
        assert.equal(child.runs.length, 1);
        assert.equal(child.thread.title, "Inspect and implement a bounded change");
        assert.include(child.messages[0]?.text ?? "", "T3 GENERAL-PURPOSE SUBAGENT");
        assert.include(
          child.messages[0]?.text ?? "",
          `"transcriptRef": "subagent:${spawned.agentId}"`,
        );
        yield* agents.followUp({
          parentThreadId: threadId,
          callerProviderInstanceId: instanceId,
          agentId: spawned.agentId,
          task: "Verify the implementation",
        });
        const followedUp = yield* orchestrator.getThreadProjection(child.thread.id);
        assert.isTrue(
          followedUp.messages.some(
            (message) =>
              message.text.includes("T3 DIRECT SUBAGENT FOLLOW-UP") &&
              message.text.includes("Verify the implementation") &&
              message.text.includes(`"transcriptRef": "subagent:${spawned.agentId}"`),
          ),
        );
        const nested = yield* agents
          .spawn({
            parentThreadId: child.thread.id,
            callerProviderInstanceId: instanceId,
            task: "Nested task",
          })
          .pipe(Effect.flip);
        assert.equal(nested.reason, "nested-spawn-disabled");
        const deepPlanRunId = DeepPlanRunId.make("general-parent-plan");
        yield* orchestrator.dispatch({
          type: "thread.deep-plan.start",
          commandId: CommandId.make("general-parent-plan-start"),
          threadId,
          runId: deepPlanRunId,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        const planWorker = yield* agents.spawn({
          parentThreadId: threadId,
          callerProviderInstanceId: instanceId,
          task: "Summarize a frozen source",
          deepPlanExecution: {
            runId: deepPlanRunId,
            runThreadId: threadId,
            approvedPlanVersion: null,
            phase: "planning",
            readOnly: true,
            modelSelection: { instanceId, model: "deep-plan-model" },
          },
        });
        assert.equal(planWorker.model, "deep-plan-model");
        yield* configuration.updateSettings({
          betterT3Environment: { flags: { "agent.generalSubagents": false } },
        });
        const stopped = yield* agents.interruptAgent({
          parentThreadId: threadId,
          callerProviderInstanceId: instanceId,
          agentId: spawned.agentId,
        });
        assert.isTrue(stopped.interrupted);
        const state = yield* orchestrator.getThreadProjection(child.thread.id);
        assert.isTrue(["interrupted", "cancelled"].includes(state.runs[0]!.status));
      }).pipe(Effect.provide(feature));
    }).pipe(Effect.provide(layerTest)),
);

it.effect("uses the destination project's text-generation model for automatic Fetch fallback", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("project-fetch-owner");
    yield* createThread(threadId);
    const started = yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("project-fetch-start"),
      threadId,
      messageId: MessageId.make("project-fetch-message"),
      text: "Explore this implementation",
      attachments: [],
      fetchMode: "repository-exploration",
      createdBy: "user",
      creationSource: "web",
      dispatchMode: { type: "start_immediately" },
    });
    const pending = yield* orchestrator.getThreadProjection(threadId);
    const selected = yield* Deferred.make<FetchRunInput>();
    const completed = yield* orchestrator
      .streamStoredEventsFrom({
        threadId,
        afterSequence: started.sequence,
        eventType: "run.updated",
      })
      .pipe(
        Stream.filter(
          (stored) =>
            stored.event.type === "run.updated" && stored.event.payload.fetchContext !== undefined,
        ),
        Stream.runHead,
        Effect.forkScoped,
      );
    const now = DateTime.formatIso(yield* DateTime.now);
    const fetchInstance = ProviderInstanceId.make("fetch-api");
    const provider = {
      instanceId: fetchInstance,
      driver: ProviderDriverKind.make("openai"),
      displayName: "Fetch API",
      enabled: true,
      installed: true,
      version: "test",
      status: "ready" as const,
      auth: { status: "authenticated" as const },
      checkedAt: now,
      models: ["environment-model", "project-model"].map((slug) => ({
        slug,
        name: slug,
        isCustom: false,
        capabilities: null,
      })),
      slashCommands: [],
      skills: [],
      fetchWorkers: { maxRecommendedWorkers: 2, commandExecutionPolicy: "deny" as const },
    };
    const feature = FetchPreparation.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
          Layer.mock(ProjectStoreV2)({
            get: () =>
              Effect.succeedSome({
                projectId: ProjectId.make("better-project"),
                title: "Project",
                workspaceRoot: "/project-root",
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                autoPull: false,
                faviconPath: null,
                projectIcon: null,
                scripts: [],
                pinnedAt: null,
                archivedAt: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              }),
          }),
          ServerSettings.layerTest({
            textGenerationModelSelection: { instanceId: fetchInstance, model: "environment-model" },
            fetchModelSelection: null,
            providerInstances: {
              [fetchInstance]: { driver: ProviderDriverKind.make("openai"), enabled: true },
            },
            projectSettingsOverrides: {
              [ProjectId.make("better-project")]: {
                textGenerationModelSelection: { instanceId: fetchInstance, model: "project-model" },
              },
            },
          }),
          Layer.mock(FetchWorkerCoordinator)({
            run: (input) =>
              Deferred.succeed(selected, input).pipe(
                Effect.as({
                  runId: pending.runs[0]!.id,
                  status: "completed",
                  context: "Project repository evidence",
                  warnings: [],
                  plannedWorkers: 1,
                  completedWorkers: 1,
                  successfulWorkers: 1,
                  providerInstanceId: input.modelSelection.instanceId,
                  providerDriver: input.providerDriver,
                  modelSelection: input.modelSelection,
                }),
              ),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const input = yield* Deferred.await(selected);
      assert.equal(input.modelSelection.model, "project-model");
      assert.equal(input.cwd, "/project-root");
      yield* Fiber.join(completed);
    }).pipe(Effect.provide(feature));
    const ready = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(ready.runs[0]?.fetchContext, "Project repository evidence");
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "keeps fork and reply prefixes frozen across parent edits and retains their attachment until the last owner is deleted",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const events = yield* EventSinkV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const cleanup = yield* ResourceCleanup.ResourceCleanupService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const sql = yield* SqlClient.SqlClient;
      const sourceId = ThreadId.make("frozen-source");
      const firstFork = ThreadId.make("frozen-before-edit");
      const laterFork = ThreadId.make("frozen-after-edit");
      const replyId = ThreadId.make("frozen-reply");
      const projectCreatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* (yield* ProjectStoreV2).apply({
        sequence: 1,
        eventId: EventId.make("frozen-project-created"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("better-project"),
        occurredAt: projectCreatedAt,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "project.created",
        payload: {
          projectId: ProjectId.make("better-project"),
          title: "Frozen project",
          workspaceRoot: "/frozen-project",
          defaultModelSelection: modelSelection,
          scripts: [],
          createdAt: projectCreatedAt,
          updatedAt: projectCreatedAt,
        },
      });
      yield* createThread(sourceId);
      const attachmentId = createAttachmentId(sourceId, ".txt")!;
      const attachment = {
        type: "file" as const,
        id: ChatAttachmentId.make(attachmentId),
        name: "evidence.txt",
        mimeType: "text/plain",
        sizeBytes: 14,
      };
      const path = yield* Path.Path;
      const filePath = path.join(config.attachmentsDir, `${attachmentId}.txt`);
      yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fs.writeFileString(filePath, "Saved evidence");
      const messageId = MessageId.make("frozen-original-message");
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("frozen-source-turn"),
        threadId: sourceId,
        messageId,
        text: "Original requirement",
        attachments: [attachment],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      });
      const initial = yield* orchestrator.getThreadProjection(sourceId);
      const run = initial.runs[0]!;
      const providerThread = initial.providerThreads[0]!;
      const now = yield* DateTime.now;
      yield* events.write({
        events: [
          {
            id: EventId.make("frozen-source-completed"),
            type: "run.updated",
            threadId: sourceId,
            runId: run.id,
            occurredAt: now,
            payload: { ...run, status: "completed", completedAt: now },
          },
          {
            id: EventId.make("frozen-source-native-thread"),
            type: "provider-thread.updated",
            threadId: sourceId,
            runId: run.id,
            occurredAt: now,
            payload: {
              ...providerThread,
              status: "idle",
              nativeThreadRef: {
                driver: adapter.driver,
                nativeId: "frozen-native-thread",
                strength: "strong",
              },
            },
          },
          {
            id: EventId.make("frozen-source-native-turn"),
            type: "provider-turn.updated",
            threadId: sourceId,
            runId: run.id,
            occurredAt: now,
            payload: {
              id: ProviderTurnId.make("frozen-native-turn"),
              providerThreadId: providerThread.id,
              nodeId: run.rootNodeId!,
              runAttemptId: run.activeAttemptId,
              nativeTurnRef: {
                driver: adapter.driver,
                nativeId: "frozen-native-turn",
                strength: "strong",
              },
              ordinal: 1,
              status: "completed",
              startedAt: now,
              completedAt: now,
            },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "thread.fork",
        commandId: CommandId.make("fork-before-edit"),
        sourceThreadId: sourceId,
        targetThreadId: firstFork,
        sourcePoint: { type: "run", runId: run.id },
        modelSelection: { instanceId: alternateInstanceId, model: modelSelection.model },
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.edit",
        commandId: CommandId.make("frozen-edit-one"),
        threadId: sourceId,
        messageId,
        expectedText: "Original requirement",
        text: "First correction",
        attachments: [],
      });
      yield* orchestrator.dispatch({
        type: "thread.fork",
        commandId: CommandId.make("fork-after-edit"),
        sourceThreadId: sourceId,
        targetThreadId: laterFork,
        sourcePoint: { type: "run", runId: run.id },
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.edit",
        commandId: CommandId.make("frozen-edit-two"),
        threadId: sourceId,
        messageId,
        expectedText: "First correction",
        text: "Second correction",
      });
      const before = yield* orchestrator.getThreadSnapshotWindow(firstFork, { rowLimit: 20 });
      const after = yield* orchestrator.getThreadSnapshotWindow(laterFork, { rowLimit: 20 });
      assert.isTrue(
        before.projection.visibleTurnItems.some(
          ({ item }) =>
            item.type === "user_message" &&
            item.messageId === messageId &&
            item.text === "Original requirement",
        ),
      );
      assert.isTrue(
        after.projection.visibleTurnItems.some(
          ({ item }) =>
            item.type === "user_message" &&
            item.messageId === messageId &&
            item.text === "First correction",
        ),
      );
      const page = yield* orchestrator.getTimelinePage(firstFork, { view: "messages", limit: 20 });
      assert.isTrue(
        page.items.some(
          ({ item }) =>
            item.type === "user_message" &&
            item.messageId === messageId &&
            item.text === "Original requirement",
        ),
      );
      const search = yield* orchestrator.searchThread({
        threadId: firstFork,
        query: "Original requirement",
      });
      assert.equal(search.totalMatches, 1);
      yield* orchestrator.dispatch({
        type: "message.reply.start",
        commandId: CommandId.make("frozen-reply-create"),
        threadId: firstFork,
        targetThreadId: replyId,
        replyTopicId: SubagentId.make("frozen-topic"),
        messageId: MessageId.make("frozen-reply-message"),
        text: "Explain the original",
        replyTo: { messageId, role: "user", text: "Original requirement" },
        attachments: [],
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "web",
      });
      const reply = yield* orchestrator.getThreadProjection(replyId);
      assert.include(reply.runs[0]?.additionalContext ?? "", "Original requirement");
      assert.notInclude(reply.runs[0]?.additionalContext ?? "", "Second correction");
      for (const threadId of [firstFork, laterFork])
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`resume:${threadId}`),
          threadId,
          messageId: MessageId.make(`prompt:${threadId}`),
          text: "Continue",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
          dispatchMode: { type: "start_immediately" },
        });
      const firstContext = yield* orchestrator.getThreadProjection(firstFork);
      const laterContext = yield* orchestrator.getThreadProjection(laterFork);
      assert.include(JSON.stringify(firstContext.contextHandoffs), "Original requirement");
      assert.notInclude(JSON.stringify(firstContext.contextHandoffs), "Second correction");
      assert.include(JSON.stringify(laterContext.contextHandoffs), "First correction");
      assert.equal(laterContext.contextTransfers[0]?.resolution?.strategy, "portable_context");
      yield* cleanup.cleanupAttachments([attachmentId]);
      assert.isTrue(yield* fs.exists(filePath));
      const deletedAttachmentIds = new Set<string>();
      for (const threadId of [firstFork, laterFork, replyId]) {
        const commandId = CommandId.make(`delete:${threadId}`);
        yield* orchestrator.dispatch({ type: "thread.delete", commandId, threadId });
        for (const effect of yield* outbox.listByCommandId(commandId))
          if (effect.request.type === "attachment.cleanup")
            for (const id of effect.request.attachmentIds) deletedAttachmentIds.add(id);
      }
      assert.isTrue(deletedAttachmentIds.has(attachmentId));
      yield* cleanup.cleanupAttachments([...deletedAttachmentIds]);
      assert.isFalse(yield* fs.exists(filePath));
      const plan = yield* sql<{
        detail: string;
      }>`EXPLAIN QUERY PLAN ${frozenMessageEditsQuery(sql, sourceId, 0)}`;
      assert.isTrue(plan.some((row) => row.detail.includes("idx_orch_events_command_id")));
      assert.isTrue(
        plan.some((row) => row.detail.includes("idx_orch_receipts_frozen_message_edits")),
      );
      assert.isFalse(plan.some((row) => row.detail.includes("SCAN event")));
    }).pipe(
      Effect.provide(
        ResourceCleanup.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-frozen-attachments-" }).pipe(
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(TerminalManager.TerminalManager)({}),
              Layer.mock(PreviewManager.PreviewManager)({}),
              Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
            ),
          ),
          Layer.provideMerge(
            layerFor({
              providerInstances: {
                [alternateInstanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
              },
            }),
          ),
        ),
      ),
    ),
);

it.effect("retries a resultless user message without duplicating its history", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("retry-resultless");
    yield* createThread(threadId);
    const messageId = yield* seedMessage(threadId);
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const seeded = yield* orchestrator.getThreadProjection(threadId);
    const attachment = {
      type: "file" as const,
      id: ChatAttachmentId.make("retry-evidence"),
      name: "evidence.txt",
      mimeType: "text/plain",
      sizeBytes: 14,
    };
    const now = yield* DateTime.now;
    yield* projections.apply({
      id: EventId.make("retry:attachment-message"),
      type: "message.updated",
      threadId,
      occurredAt: now,
      payload: { ...seeded.messages[0]!, attachments: [attachment] },
    });
    const seededItem = seeded.turnItems[0]!;
    if (seededItem.type !== "user_message") return yield* Effect.die("Expected retry user item");
    yield* projections.apply({
      id: EventId.make("retry:attachment-item"),
      type: "turn-item.updated",
      threadId,
      occurredAt: now,
      payload: { ...seededItem, attachments: [attachment] },
    });
    const before = yield* orchestrator.getThreadProjection(threadId);
    const command = {
      type: "message.retry" as const,
      commandId: CommandId.make("retry-resultless:start"),
      threadId,
      messageId,
      runId: null,
      fetchMode: "repository-exploration" as const,
      modelSelection: { ...modelSelection, options: [{ id: "reasoningEffort", value: "high" }] },
    };
    const first = yield* orchestrator.dispatch(command);
    const after = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(after.runs.length, 1);
    assert.equal(after.messages.length, 1);
    assert.equal(after.runs[0]?.userMessageId, messageId);
    assert.deepEqual(after.runs[0]?.modelSelection, command.modelSelection);
    assert.equal(after.messages[0]?.text, before.messages[0]?.text);
    assert.deepEqual(after.messages[0]?.attachments, [attachment]);
    assert.equal(after.thread.runtimeMode, before.thread.runtimeMode);
    assert.equal(after.thread.interactionMode, before.thread.interactionMode);
    assert.deepEqual(after.messages[0]?.createdAt, before.messages[0]?.createdAt);
    assert.equal(after.messages[0]?.fetchMode, "repository-exploration");
    assert.equal(after.turnItems.filter((item) => item.type === "user_message").length, 1);
    assert.equal(after.turnItems[0]?.id, before.turnItems[0]?.id);
    assert.equal(after.turnItems[0]?.ordinal, before.turnItems[0]?.ordinal);
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* worker.drain();
    const afterWorker = yield* orchestrator.getThreadProjection(threadId);
    assert.equal(afterWorker.messages.length, 1);
    assert.equal(afterWorker.messages[0]?.id, messageId);
    assert.deepEqual(afterWorker.messages[0]?.attachments, [attachment]);
    assert.equal(
      afterWorker.turnItems.find((item) => item.type === "user_message")?.id,
      seededItem.id,
    );
    const replay = yield* orchestrator.dispatch(command);
    assert.isTrue(replay.replayed);
    assert.equal(replay.sequence, first.sequence);
    const freshRetry = yield* orchestrator
      .dispatch({ ...command, commandId: CommandId.make("retry-resultless:stale") })
      .pipe(Effect.flip);
    assert.equal(freshRetry._tag, "OrchestratorDispatchError");
    for (const status of ["interrupted", "failed"] as const) {
      const previous = yield* orchestrator.getThreadProjection(threadId);
      const run = previous.runs.at(-1)!;
      yield* projections.apply({
        id: EventId.make(`retry:${status}:run`),
        type: "run.updated",
        threadId,
        runId: run.id,
        occurredAt: now,
        payload: {
          ...run,
          status,
          completedAt: now,
          sourcePlanRef: { threadId, planId: PlanId.make("retry-plan") },
        },
      });
      const node = previous.nodes.find((node) => node.id === run.rootNodeId)!;
      yield* projections.apply({
        id: EventId.make(`retry:${status}:node`),
        type: "node.updated",
        threadId,
        runId: run.id,
        occurredAt: now,
        payload: { ...node, status, completedAt: now },
      });
      yield* projections.apply({
        id: EventId.make(`retry:${status}:plan`),
        type: "plan.updated",
        threadId,
        runId: run.id,
        occurredAt: now,
        payload: {
          id: PlanId.make("retry-plan"),
          threadId,
          runId: run.id,
          nodeId: NodeId.make(node.id),
          status: "completed",
          kind: "proposed_plan",
          markdown: "Original implementation plan",
        },
      });
      const stopped = yield* orchestrator.getThreadProjection(threadId);
      assert.deepEqual(resolveResultlessRetryTarget(stopped), { messageId, runId: run.id });
      yield* orchestrator.dispatch({
        ...command,
        commandId: CommandId.make(`retry:${status}:start`),
        runId: run.id,
        fetchMode: null,
      });
      const resumed = yield* orchestrator.getThreadProjection(threadId);
      assert.equal(resumed.messages.length, 1);
      assert.equal(resumed.messages[0]?.fetchMode, undefined);
      assert.deepEqual(resumed.messages[0]?.attachments, [attachment]);
      assert.deepEqual(resumed.runs.at(-1)?.sourcePlanRef, {
        threadId,
        planId: PlanId.make("retry-plan"),
      });
      assert.equal(
        resumed.turnItems.find((item) => item.type === "user_message")?.id,
        seededItem.id,
      );
    }
    const latest = yield* orchestrator.getThreadProjection(threadId);
    const latestRun = latest.runs.at(-1)!;
    yield* projections.apply({
      id: EventId.make("retry:partial:run"),
      type: "run.updated",
      threadId,
      runId: latestRun.id,
      occurredAt: now,
      payload: { ...latestRun, status: "failed", completedAt: now },
    });
    const root = latest.nodes.find((node) => node.id === latestRun.rootNodeId)!;
    yield* projections.apply({
      id: EventId.make("retry:partial:node"),
      type: "node.updated",
      threadId,
      runId: latestRun.id,
      occurredAt: now,
      payload: { ...root, status: "failed", completedAt: now },
    });
    const idle = yield* orchestrator.getThreadProjection(threadId);
    assert.deepEqual(resolveResultlessRetryTarget(idle), { messageId, runId: latestRun.id });
    assert.isNull(
      resolveResultlessRetryTarget({ ...idle, thread: { ...idle.thread, archivedAt: now } }),
    );
    assert.isNull(
      resolveResultlessRetryTarget({ ...idle, providerSessions: [{ status: "running" }] }),
    );
    assert.isNull(
      resolveResultlessRetryTarget({ ...idle, runtimeRequests: [{ status: "pending" }] }),
    );
    assert.isNull(
      resolveResultlessRetryTarget({
        ...idle,
        turnItems: [
          ...idle.turnItems,
          {
            type: "user_message",
            ordinal: 99999999,
            runId: null,
            messageId: MessageId.make("newer-queued"),
            inputIntent: "queued_turn",
          },
        ],
      }),
    );
    yield* projections.apply({
      id: EventId.make("retry:partial:message"),
      type: "message.updated",
      threadId,
      runId: latestRun.id,
      occurredAt: now,
      payload: {
        ...idle.messages[0]!,
        id: MessageId.make("partial-answer"),
        role: "assistant",
        runId: latestRun.id,
        streaming: true,
        text: "Partial",
      },
    });
    const rejected = yield* orchestrator
      .dispatch({
        ...command,
        commandId: CommandId.make("retry:partial:refused"),
        runId: latestRun.id,
      })
      .pipe(Effect.flip);
    assert.equal(rejected._tag, "OrchestratorDispatchError");
    yield* projections.apply({
      id: EventId.make("retry:empty:message"),
      type: "message.updated",
      threadId,
      runId: latestRun.id,
      occurredAt: now,
      payload: {
        ...idle.messages[0]!,
        id: MessageId.make("partial-answer"),
        role: "assistant",
        runId: latestRun.id,
        streaming: false,
        text: "",
      },
    });
    const emptyRejected = yield* orchestrator
      .dispatch({
        ...command,
        commandId: CommandId.make("retry:empty:refused"),
        runId: latestRun.id,
      })
      .pipe(Effect.flip);
    assert.equal(emptyRejected._tag, "OrchestratorDispatchError");

    const itemOnlyThreadId = ThreadId.make("retry-item-only");
    yield* createThread(itemOnlyThreadId);
    const itemOnlyMessageId = yield* seedMessage(itemOnlyThreadId);
    const itemOnly = yield* orchestrator.getThreadProjection(itemOnlyThreadId);
    yield* projections.apply({
      id: EventId.make("retry:item-only:answer"),
      type: "turn-item.updated",
      threadId: itemOnlyThreadId,
      occurredAt: now,
      payload: {
        ...seededItem,
        threadId: itemOnlyThreadId,
        id: TurnItemId.make("retry:empty-assistant-item"),
        type: "assistant_message",
        messageId: MessageId.make("retry:empty-assistant"),
        ordinal: itemOnly.turnItems[0]!.ordinal + 1,
        text: "",
        streaming: true,
      },
    });
    const itemOnlyRejected = yield* orchestrator
      .dispatch({
        ...command,
        commandId: CommandId.make("retry:item-only:refused"),
        threadId: itemOnlyThreadId,
        messageId: itemOnlyMessageId,
      })
      .pipe(Effect.flip);
    assert.equal(itemOnlyRejected._tag, "OrchestratorDispatchError");
    const queuedThreadId = ThreadId.make("retry-newer-queued");
    yield* createThread(queuedThreadId);
    const oldMessageId = yield* seedMessage(queuedThreadId);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("retry:newer-queued:message"),
      threadId: queuedThreadId,
      messageId: MessageId.make("retry:newer-input"),
      text: "Newer queued request",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      dispatchMode: { type: "queue_after_active" },
    });
    const queueRejected = yield* orchestrator
      .dispatch({
        ...command,
        commandId: CommandId.make("retry:newer-queued:refused"),
        threadId: queuedThreadId,
        messageId: oldMessageId,
      })
      .pipe(Effect.flip);
    assert.equal(queueRejected._tag, "OrchestratorDispatchError");
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const effects = yield* outbox.listByCommandId(command.commandId);
    assert.equal(
      effects.filter((effect) => effect.request.type === "provider-turn.start").length,
      1,
    );
  }).pipe(Effect.provide(layerTest)),
);
