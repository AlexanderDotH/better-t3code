import {
  EventId,
  ProjectAgentMessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
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
});
