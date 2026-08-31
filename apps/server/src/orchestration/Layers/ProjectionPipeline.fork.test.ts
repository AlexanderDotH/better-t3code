import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const TestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-projection-fork-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

const now = "2026-08-24T12:00:00.000Z";
const later = "2026-08-24T12:00:01.000Z";
const projectId = ProjectId.make("project-fork");
const sourceThreadId = ThreadId.make("thread-source");
const threadId = ThreadId.make("thread-fork");
const turnId = TurnId.make("turn-fork-1");
const userMessageId = MessageId.make("message-fork-user");
const assistantMessageId = MessageId.make("message-fork-assistant");

it.layer(TestLayer)("OrchestrationProjectionPipeline fork history", (it) => {
  it.effect("projects a frozen prefix without making inherited rows live", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { attachmentsDir } = yield* ServerConfig;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.make("event-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: now,
        commandId: CommandId.make("command-project"),
        causationEventId: null,
        correlationId: CommandId.make("command-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Fork project",
          workspaceRoot: "/tmp/project-fork",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("event-source-thread"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        occurredAt: now,
        commandId: CommandId.make("command-source-thread"),
        causationEventId: null,
        correlationId: CommandId.make("command-source-thread"),
        metadata: {},
        payload: {
          threadId: sourceThreadId,
          projectId,
          title: "Source thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.make("event-source-message"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        occurredAt: now,
        commandId: CommandId.make("command-source-message"),
        causationEventId: null,
        correlationId: CommandId.make("command-source-message"),
        metadata: {},
        payload: {
          threadId: sourceThreadId,
          messageId: MessageId.make("message-source-user"),
          role: "user",
          text: "Earlier question",
          attachments: [
            {
              type: "image",
              id: "thread-source-00000000-0000-4000-8000-000000000001",
              name: "history.png",
              mimeType: "image/png",
              sizeBytes: 7,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      const attachmentPath = path.join(
        attachmentsDir,
        "thread-source-00000000-0000-4000-8000-000000000001.png",
      );
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(attachmentPath, "forked attachment");

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.make("event-thread"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("command-thread"),
        causationEventId: null,
        correlationId: CommandId.make("command-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Source thread (fork)",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-codex",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const userOrigin = { sourceThreadId, sourceId: "message-source-user", ordinal: 0 };
      const assistantOrigin = {
        sourceThreadId,
        sourceId: "message-source-assistant",
        ordinal: 1,
      };
      const activityOrigin = { sourceThreadId, sourceId: "activity-source", ordinal: 2 };
      const planOrigin = { sourceThreadId, sourceId: "plan-source", ordinal: 3 };
      const subagentOrigin = { sourceThreadId, sourceId: "subagent-source", ordinal: 4 };
      const turnOrigin = { sourceThreadId, sourceId: "turn-source", ordinal: 5 };
      const checkpointOrigin = { sourceThreadId, sourceId: "checkpoint-source", ordinal: 6 };

      yield* appendAndProject({
        type: "thread.forked",
        eventId: EventId.make("event-forked"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: later,
        commandId: CommandId.make("command-forked"),
        causationEventId: null,
        correlationId: CommandId.make("command-forked"),
        metadata: {},
        payload: {
          threadId,
          fork: {
            provenance: {
              sourceThreadId,
              sourceTitle: "Source thread",
              boundary: { kind: "message", messageId: assistantMessageId },
              forkedAt: later,
            },
            workspace: {
              spec: {
                mode: "local",
                baseBranch: "main",
                startFromOrigin: false,
                runSetupScript: false,
              },
              status: "pending",
              preparedAt: null,
              lastError: null,
            },
            handoff: {
              status: "pending",
              historyInputChars: 42,
              historyAttachmentCount: 1,
              remainingInputChars: 1000,
              remainingAttachmentCount: 3,
              completedAt: null,
            },
          },
          history: {
            messages: [
              {
                id: userMessageId,
                role: "user",
                text: "Earlier question",
                attachments: [
                  {
                    type: "image",
                    id: "thread-source-00000000-0000-4000-8000-000000000001",
                    name: "history.png",
                    mimeType: "image/png",
                    sizeBytes: 7,
                  },
                ],
                turnId,
                streaming: false,
                createdAt: now,
                updatedAt: now,
                historyOrigin: userOrigin,
              },
              {
                id: assistantMessageId,
                role: "assistant",
                text: "Earlier answer",
                turnId,
                streaming: false,
                createdAt: later,
                updatedAt: later,
                historyOrigin: assistantOrigin,
              },
            ],
            proposedPlans: [
              {
                id: "plan-fork",
                turnId,
                planMarkdown: "# Historical plan",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: later,
                updatedAt: later,
                historyOrigin: planOrigin,
              },
            ],
            activities: [
              {
                id: EventId.make("activity-fork"),
                tone: "approval",
                kind: "user-input.requested",
                summary: "Historical prompt",
                payload: { requestId: "historical-request" },
                turnId,
                sequence: 7,
                createdAt: later,
                historyOrigin: activityOrigin,
              },
            ],
            subagents: [
              {
                id: SubagentId.make("subagent-fork"),
                origin: "provider-native",
                providerInstanceId: null,
                providerDriver: null,
                providerThreadId: "provider-subagent-source",
                parentId: null,
                path: "/root/research",
                name: "Research",
                nickname: null,
                role: null,
                task: "Inspect",
                model: null,
                reasoningEffort: null,
                depth: 1,
                status: "completed",
                statusMessage: null,
                latestProgress: null,
                latestTurn: null,
                startedAt: now,
                updatedAt: later,
                completedAt: later,
                historyOrigin: subagentOrigin,
              },
            ],
            turns: [
              {
                turnId,
                pendingMessageId: userMessageId,
                assistantMessageId,
                state: "completed",
                requestedAt: now,
                startedAt: now,
                completedAt: later,
                checkpointTurnCount: 1,
                checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-source/turn/1"),
                checkpointStatus: "ready",
                checkpointFiles: [],
                historyOrigin: turnOrigin,
              },
            ],
            checkpoints: [
              {
                turnId,
                checkpointTurnCount: 1,
                checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread-source/turn/1"),
                status: "ready",
                files: [],
                assistantMessageId,
                completedAt: later,
                historyOrigin: checkpointOrigin,
              },
            ],
          },
        },
      });

      const projectedThread = yield* sql<{
        readonly forkJson: string | null;
        readonly latestTurnId: string | null;
        readonly latestUserMessageAt: string | null;
        readonly pendingUserInputCount: number;
        readonly hasActionableProposedPlan: number;
      }>`
        SELECT
          fork_json AS "forkJson",
          latest_turn_id AS "latestTurnId",
          latest_user_message_at AS "latestUserMessageAt",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.equal(projectedThread.length, 1);
      assert.equal(projectedThread[0]?.latestTurnId, null);
      assert.equal(projectedThread[0]?.latestUserMessageAt, null);
      assert.equal(projectedThread[0]?.pendingUserInputCount, 0);
      assert.equal(projectedThread[0]?.hasActionableProposedPlan, 0);
      assert.deepEqual(JSON.parse(projectedThread[0]?.forkJson ?? "null"), {
        provenance: {
          sourceThreadId: "thread-source",
          sourceTitle: "Source thread",
          boundary: { kind: "message", messageId: "message-fork-assistant" },
          forkedAt: later,
        },
        workspace: {
          spec: {
            mode: "local",
            baseBranch: "main",
            startFromOrigin: false,
            runSetupScript: false,
          },
          status: "pending",
          preparedAt: null,
          lastError: null,
        },
        handoff: {
          status: "pending",
          historyInputChars: 42,
          historyAttachmentCount: 1,
          remainingInputChars: 1000,
          remainingAttachmentCount: 3,
          completedAt: null,
        },
      });

      const markers = yield* sql<{
        readonly entity: string;
        readonly historyOriginJson: string | null;
      }>`
        SELECT 'message' AS entity, history_origin_json AS "historyOriginJson"
        FROM projection_thread_messages
        WHERE message_id = ${userMessageId}
        UNION ALL
        SELECT 'plan', history_origin_json
        FROM projection_thread_proposed_plans
        WHERE plan_id = 'plan-fork'
        UNION ALL
        SELECT 'activity', history_origin_json
        FROM projection_thread_activities
        WHERE activity_id = 'activity-fork'
        UNION ALL
        SELECT 'subagent', history_origin_json
        FROM projection_thread_subagents
        WHERE subagent_id = 'subagent-fork'
        UNION ALL
        SELECT 'turn', history_origin_json
        FROM projection_turns
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
        UNION ALL
        SELECT 'checkpoint', history_origin_json
        FROM projection_thread_fork_checkpoints
        WHERE thread_id = ${threadId} AND turn_id = ${turnId}
        ORDER BY entity
      `;
      assert.deepEqual(
        markers.map(({ entity, historyOriginJson }) => [
          entity,
          JSON.parse(historyOriginJson ?? "null"),
        ]),
        [
          ["activity", activityOrigin],
          ["checkpoint", checkpointOrigin],
          ["message", userOrigin],
          ["plan", planOrigin],
          ["subagent", subagentOrigin],
          ["turn", turnOrigin],
        ],
      );

      const attachmentReferences = yield* sql<{
        readonly threadId: string;
        readonly messageId: string;
        readonly attachmentId: string;
      }>`
        SELECT
          thread_id AS "threadId",
          message_id AS "messageId",
          attachment_id AS "attachmentId"
        FROM projection_attachment_references
        WHERE thread_id = ${threadId}
      `;
      assert.deepEqual(attachmentReferences, [
        {
          threadId,
          messageId: userMessageId,
          attachmentId: "thread-source-00000000-0000-4000-8000-000000000001",
        },
      ]);

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.make("event-fork-reverted"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: later,
        commandId: CommandId.make("command-fork-reverted"),
        causationEventId: null,
        correlationId: CommandId.make("command-forked"),
        metadata: {},
        payload: { threadId, turnCount: 0 },
      });
      const retainedHistory = yield* sql<{
        readonly messages: number;
        readonly plans: number;
        readonly activities: number;
        readonly turns: number;
        readonly checkpoints: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM projection_thread_messages
            WHERE thread_id = ${threadId} AND history_origin_json IS NOT NULL) AS messages,
          (SELECT COUNT(*) FROM projection_thread_proposed_plans
            WHERE thread_id = ${threadId} AND history_origin_json IS NOT NULL) AS plans,
          (SELECT COUNT(*) FROM projection_thread_activities
            WHERE thread_id = ${threadId} AND history_origin_json IS NOT NULL) AS activities,
          (SELECT COUNT(*) FROM projection_turns
            WHERE thread_id = ${threadId} AND history_origin_json IS NOT NULL) AS turns,
          (SELECT COUNT(*) FROM projection_thread_fork_checkpoints
            WHERE thread_id = ${threadId}) AS checkpoints
      `;
      assert.deepEqual(retainedHistory, [
        { messages: 2, plans: 1, activities: 1, turns: 1, checkpoints: 1 },
      ]);

      yield* appendAndProject({
        type: "thread.fork-workspace-updated",
        eventId: EventId.make("event-fork-workspace"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: later,
        commandId: CommandId.make("command-fork-workspace"),
        causationEventId: null,
        correlationId: CommandId.make("command-forked"),
        metadata: {},
        payload: {
          threadId,
          status: "ready",
          preparedAt: later,
          lastError: null,
          createdAt: later,
        },
      });
      yield* appendAndProject({
        type: "thread.fork-handoff-completed",
        eventId: EventId.make("event-fork-handoff"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: later,
        commandId: CommandId.make("command-fork-handoff"),
        causationEventId: null,
        correlationId: CommandId.make("command-forked"),
        metadata: {},
        payload: { threadId, completedAt: later },
      });

      const updatedFork = yield* sql<{ readonly forkJson: string }>`
        SELECT fork_json AS "forkJson"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      const parsedFork = JSON.parse(updatedFork[0]?.forkJson ?? "null") as {
        readonly workspace: { readonly status: string; readonly preparedAt: string | null };
        readonly handoff: { readonly status: string; readonly completedAt: string | null };
      };
      assert.deepEqual(parsedFork.workspace, {
        spec: {
          mode: "local",
          baseBranch: "main",
          startFromOrigin: false,
          runSetupScript: false,
        },
        status: "ready",
        preparedAt: later,
        lastError: null,
      });
      assert.equal(parsedFork.handoff.status, "completed");
      assert.equal(parsedFork.handoff.completedAt, later);

      yield* appendAndProject({
        type: "thread.deleted",
        eventId: EventId.make("event-source-deleted"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        occurredAt: later,
        commandId: CommandId.make("command-source-deleted"),
        causationEventId: null,
        correlationId: CommandId.make("command-source-deleted"),
        metadata: {},
        payload: { threadId: sourceThreadId, deletedAt: later },
      });
      assert.isTrue(yield* fileSystem.exists(attachmentPath));

      yield* appendAndProject({
        type: "thread.deleted",
        eventId: EventId.make("event-fork-deleted"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: later,
        commandId: CommandId.make("command-fork-deleted"),
        causationEventId: null,
        correlationId: CommandId.make("command-fork-deleted"),
        metadata: {},
        payload: { threadId, deletedAt: later },
      });
      assert.isFalse(yield* fileSystem.exists(attachmentPath));
    }),
  );
});
