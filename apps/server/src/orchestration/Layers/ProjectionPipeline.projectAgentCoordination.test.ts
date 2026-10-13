import {
  EventId,
  MessageId,
  SubagentId,
  ProjectAgentMessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const projectId = ProjectId.make("project-agent-projection");
const threadId = ThreadId.make("thread-agent-projection");
const turnId = TurnId.make("turn-agent-projection");
const now = "2026-08-09T18:00:00.000Z";

function event<T extends OrchestrationEvent["type"]>(
  sequence: number,
  type: T,
  aggregateKind: "project" | "thread",
  aggregateId: ProjectId | ThreadId,
  payload: Extract<OrchestrationEvent, { readonly type: T }>["payload"],
): Extract<OrchestrationEvent, { readonly type: T }> {
  return {
    sequence,
    eventId: EventId.make(`event-agent-projection-${sequence}`),
    type,
    aggregateKind,
    aggregateId,
    occurredAt: now,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload,
  } as Extract<OrchestrationEvent, { readonly type: T }>;
}

const PipelineLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
);
const TestLayer = Layer.mergeAll(PipelineLayer, OrchestrationProjectionSnapshotQueryLive).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-agent-projection-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("project agent coordination projections", (it) => {
  it.effect("persists messages and hydrates only a running turn's active claim", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* pipeline.projectEvent(
        event(1, "project.created", "project", projectId, {
          projectId,
          title: "Coordination projection",
          workspaceRoot: "/workspace/coordination",
          defaultModelSelection: null,
          checkpointsEnabled: true,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      yield* pipeline.projectEvent(
        event(2, "thread.created", "thread", threadId, {
          threadId,
          projectId,
          title: "Agent projection",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      yield* pipeline.projectEvent(
        event(3, "thread.session-set", "thread", threadId, {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeSessionId: null,
            runtimeMode: "full-access",
            activeTurnId: turnId,
            abortState: null,
            lastError: null,
            updatedAt: now,
          },
        }),
      );
      yield* pipeline.projectEvent(
        event(4, "project.agent-claim-set", "project", projectId, {
          projectId,
          threadId,
          turnId,
          summary: "Editing projections",
          claims: [{ kind: "path", path: "apps/server/src/orchestration" }],
          updatedAt: now,
        }),
      );
      yield* pipeline.projectEvent(
        event(5, "project.agent-message-sent", "project", projectId, {
          projectId,
          messageId: ProjectAgentMessageId.make("message-agent-projection"),
          senderThreadId: threadId,
          recipientThreadIds: [ThreadId.make("thread-recipient")],
          kind: "info",
          body: "Projection work is claimed.",
          sentAt: now,
        }),
      );

      const readModel = yield* snapshotQuery.getCommandReadModel();
      expect(readModel.projects[0]?.coordinationClaims).toEqual([
        {
          projectId,
          threadId,
          turnId,
          summary: "Editing projections",
          claims: [{ kind: "path", path: "apps/server/src/orchestration" }],
          updatedAt: now,
        },
      ]);
      const messageRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_project_agent_messages
      `;
      expect(messageRows[0]?.count).toBe(1);

      yield* pipeline.projectEvent(
        event(6, "project.agent-claim-released", "project", projectId, {
          projectId,
          threadId,
          expectedTurnId: turnId,
          releasedAt: now,
        }),
      );
      expect((yield* snapshotQuery.getCommandReadModel()).projects[0]?.coordinationClaims).toEqual(
        [],
      );
    }),
  );
  it.effect("keeps the parent lease live for an active reply after the main turn completes", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("reply-coordination-project");
      const threadId = ThreadId.make("reply-coordination-parent");
      const observerId = ThreadId.make("reply-coordination-observer");
      const topicId = SubagentId.make("reply-coordination-topic");
      const rootTurnId = TurnId.make("reply-coordination-root-turn");
      const replyTurnId = TurnId.make("reply-coordination-reply-turn");
      const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
      let sequence = 100;
      yield* pipeline.projectEvent(
        event(sequence++, "project.created", "project", projectId, {
          projectId,
          title: "Reply coordination",
          workspaceRoot: "/workspace/reply-coordination",
          defaultModelSelection: null,
          checkpointsEnabled: true,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      for (const id of [threadId, observerId]) {
        yield* pipeline.projectEvent(
          event(sequence++, "thread.created", "thread", id, {
            threadId: id,
            projectId,
            title: id,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      const session = {
        threadId,
        status: "running" as const,
        providerName: "codex",
        providerInstanceId: modelSelection.instanceId,
        runtimeSessionId: null,
        runtimeMode: "full-access" as const,
        activeTurnId: rootTurnId,
        abortState: null,
        lastError: null,
        updatedAt: now,
      };
      yield* pipeline.projectEvent(
        event(sequence++, "thread.session-set", "thread", threadId, { threadId, session }),
      );
      const topic: OrchestrationSubagentSummary = {
        id: topicId,
        origin: "t3-managed",
        providerInstanceId: modelSelection.instanceId,
        providerDriver: null,
        providerThreadId: topicId,
        parentId: null,
        path: null,
        name: "Reply",
        nickname: null,
        role: null,
        task: null,
        model: modelSelection.model,
        reasoningEffort: null,
        depth: 1,
        status: "waiting",
        statusMessage: null,
        latestProgress: null,
        latestTurn: {
          turnId: replyTurnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
        startedAt: now,
        updatedAt: now,
        completedAt: null,
        messageReply: {
          rootMessageId: MessageId.make("coordination-source"),
          replyTo: {
            messageId: MessageId.make("coordination-source"),
            role: "assistant",
            text: "Quoted source",
          },
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          workspacePath: "/workspace/reply-coordination",
        },
      };
      yield* pipeline.projectEvent(
        event(sequence++, "thread.subagent-upserted", "thread", threadId, {
          threadId,
          subagent: topic,
        }),
      );
      const lease = {
        projectId,
        threadId,
        turnId: replyTurnId,
        summary: "Reply owns this file",
        claims: [{ kind: "path" as const, path: "reply.ts" }],
        updatedAt: now,
      };
      yield* pipeline.projectEvent(
        event(sequence++, "project.agent-claim-set", "project", projectId, lease),
      );
      yield* pipeline.projectEvent(
        event(sequence++, "thread.session-set", "thread", threadId, {
          threadId,
          session: { ...session, status: "ready", activeTurnId: null },
        }),
      );
      yield* pipeline.projectEvent(
        event(sequence++, "project.agent-claim-released", "project", projectId, {
          projectId,
          threadId,
          expectedTurnId: rootTurnId,
          releasedAt: now,
        }),
      );
      expect(
        (yield* query.getCommandReadModel()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([lease]);
      expect(
        (yield* query.getSnapshot()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([lease]);
      expect(yield* query.hasActiveProjectAgentPeer(observerId)).toBe(true);
      expect(yield* query.hasActiveProjectAgentPeer(threadId)).toBe(true);
      const summary = yield* query.getSubagentSummaryById(threadId, topicId);
      expect(summary).toMatchObject({
        value: { messageReply: topic.messageReply, status: "waiting" },
      });

      yield* pipeline.projectEvent(
        event(sequence++, "project.agent-claim-set", "project", projectId, {
          ...lease,
          turnId: TurnId.make("stale-reply-turn"),
        }),
      );
      expect(
        (yield* query.getCommandReadModel()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([]);
      yield* pipeline.projectEvent(
        event(sequence++, "project.agent-claim-set", "project", projectId, lease),
      );
      yield* pipeline.projectEvent(
        event(sequence++, "thread.subagent-upserted", "thread", threadId, {
          threadId,
          subagent: {
            ...topic,
            latestTurn: { ...topic.latestTurn!, state: "completed", completedAt: now },
          },
        }),
      );
      expect(
        (yield* query.getCommandReadModel()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([]);
      expect(
        (yield* query.getSnapshot()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([]);
      expect(yield* query.hasActiveProjectAgentPeer(observerId)).toBe(false);
      expect(yield* query.hasActiveProjectAgentPeer(threadId)).toBe(false);
      const remainingClaims = yield* sql<{ readonly turnId: string }>`
        SELECT turn_id AS "turnId" FROM projection_project_agent_claims WHERE project_id = ${projectId}
      `;
      expect(remainingClaims).toEqual([{ turnId: replyTurnId }]);

      yield* pipeline.projectEvent(
        event(sequence++, "thread.subagent-upserted", "thread", threadId, {
          threadId,
          subagent: topic,
        }),
      );
      yield* pipeline.projectEvent(
        event(sequence++, "thread.archived", "thread", threadId, {
          threadId,
          archivedAt: now,
          updatedAt: now,
        }),
      );
      expect(
        (yield* query.getCommandReadModel()).projects.find((project) => project.id === projectId)
          ?.coordinationClaims,
      ).toEqual([]);
      expect(yield* query.hasActiveProjectAgentPeer(observerId)).toBe(false);
    }),
  );
});
