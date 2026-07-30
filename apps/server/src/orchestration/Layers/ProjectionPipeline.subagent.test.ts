import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const threadId = ThreadId.make("thread-subagent-projection");
const subagentId = SubagentId.make("agent-subagent-projection");
const startedAt = "2026-07-30T10:00:00.000Z";

function event<T extends OrchestrationEvent["type"]>(
  sequence: number,
  type: T,
  occurredAt: string,
  payload: Extract<OrchestrationEvent, { readonly type: T }>["payload"],
): Extract<OrchestrationEvent, { readonly type: T }> {
  return {
    sequence,
    eventId: EventId.make(`event-subagent-projection-${sequence}`),
    type,
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload,
  } as Extract<OrchestrationEvent, { readonly type: T }>;
}

function summary(): OrchestrationSubagentSummary {
  return {
    id: subagentId,
    providerThreadId: "provider-agent-subagent-projection",
    parentId: null,
    path: "/root/projection",
    name: "projection",
    nickname: "projection",
    role: "worker",
    task: "Implement the projection",
    model: "gpt-5.6",
    reasoningEffort: "ultra",
    depth: 1,
    status: "running",
    statusMessage: "Projecting child events",
    latestProgress: null,
    latestTurn: null,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  };
}

const TestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-projection-pipeline-subagents-",
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("OrchestrationProjectionPipeline subagent projections", (it) => {
  it.effect(
    "routes child transcript events away from root tables and deletes every child row with its thread",
    () =>
      Effect.gen(function* () {
        const pipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;
        const turnId = TurnId.make("turn-subagent-projection");
        const progressedAt = "2026-07-30T10:00:01.000Z";
        const completedAt = "2026-07-30T10:00:02.000Z";

        yield* pipeline.projectEvent(
          event(1, "thread.created", startedAt, {
            threadId,
            projectId: ProjectId.make("project-subagent-projection"),
            title: "Subagent projection",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: startedAt,
            updatedAt: startedAt,
          }),
        );
        yield* pipeline.projectEvent(
          event(2, "thread.subagent-upserted", startedAt, {
            threadId,
            subagent: summary(),
          }),
        );
        yield* pipeline.projectEvent(
          event(3, "thread.message-sent", progressedAt, {
            threadId,
            subagentId,
            messageId: MessageId.make("message-subagent-projection"),
            role: "assistant",
            text: "child output",
            turnId,
            streaming: false,
            createdAt: progressedAt,
            updatedAt: progressedAt,
          }),
        );
        yield* pipeline.projectEvent(
          event(4, "thread.proposed-plan-upserted", progressedAt, {
            threadId,
            subagentId,
            proposedPlan: {
              id: "plan-subagent-projection",
              turnId,
              planMarkdown: "# Child plan",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: progressedAt,
              updatedAt: progressedAt,
            },
          }),
        );
        yield* pipeline.projectEvent(
          event(5, "thread.activity-appended", progressedAt, {
            threadId,
            subagentId,
            activity: {
              id: EventId.make("activity-subagent-projection"),
              tone: "info",
              kind: "command.started",
              summary: "Running tests",
              payload: { command: "vp test" },
              turnId,
              sequence: 1,
              createdAt: progressedAt,
            },
          }),
        );
        yield* pipeline.projectEvent(
          event(6, "thread.subagent-progress-set", progressedAt, {
            threadId,
            subagentId,
            progress: {
              kind: "test",
              summary: "Running focused tests",
              detail: null,
              createdAt: progressedAt,
            },
            updatedAt: progressedAt,
          }),
        );
        yield* pipeline.projectEvent(
          event(7, "thread.subagent-state-set", completedAt, {
            threadId,
            subagentId,
            status: "completed",
            statusMessage: "Done",
            updatedAt: completedAt,
          }),
        );

        const rootMessageCount = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM projection_thread_messages
          WHERE thread_id = ${threadId}
        `;
        const rootPlanCount = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM projection_thread_proposed_plans
          WHERE thread_id = ${threadId}
        `;
        const rootActivityCount = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM projection_thread_activities
          WHERE thread_id = ${threadId}
        `;
        const rootTurnCount = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM projection_turns
          WHERE thread_id = ${threadId}
        `;
        assert.deepEqual(
          [
            rootMessageCount[0]?.count,
            rootPlanCount[0]?.count,
            rootActivityCount[0]?.count,
            rootTurnCount[0]?.count,
          ],
          [0, 0, 0, 0],
        );

        const childCounts = yield* sql<{
          readonly summaries: number;
          readonly messages: number;
          readonly plans: number;
          readonly activities: number;
        }>`
          SELECT
            (SELECT COUNT(*) FROM projection_thread_subagents
              WHERE thread_id = ${threadId}) AS summaries,
            (SELECT COUNT(*) FROM projection_thread_subagent_messages
              WHERE thread_id = ${threadId}) AS messages,
            (SELECT COUNT(*) FROM projection_thread_subagent_proposed_plans
              WHERE thread_id = ${threadId}) AS plans,
            (SELECT COUNT(*) FROM projection_thread_subagent_activities
              WHERE thread_id = ${threadId}) AS activities
        `;
        assert.deepEqual(childCounts, [{ summaries: 1, messages: 1, plans: 1, activities: 1 }]);

        const summaryRows = yield* sql<{
          readonly status: string;
          readonly statusMessage: string | null;
          readonly progressJson: string | null;
          readonly completedAt: string | null;
        }>`
          SELECT
            status,
            status_message AS "statusMessage",
            latest_progress_json AS "progressJson",
            completed_at AS "completedAt"
          FROM projection_thread_subagents
          WHERE thread_id = ${threadId}
            AND subagent_id = ${subagentId}
        `;
        assert.equal(summaryRows[0]?.status, "completed");
        assert.equal(summaryRows[0]?.statusMessage, "Done");
        assert.deepEqual(JSON.parse(summaryRows[0]?.progressJson ?? "null"), {
          kind: "test",
          summary: "Running focused tests",
          detail: null,
          createdAt: progressedAt,
        });
        assert.equal(summaryRows[0]?.completedAt, completedAt);

        yield* pipeline.projectEvent(
          event(8, "thread.deleted", completedAt, {
            threadId,
            deletedAt: completedAt,
          }),
        );

        const remainingChildRows = yield* sql<{
          readonly summaries: number;
          readonly messages: number;
          readonly plans: number;
          readonly activities: number;
        }>`
          SELECT
            (SELECT COUNT(*) FROM projection_thread_subagents
              WHERE thread_id = ${threadId}) AS summaries,
            (SELECT COUNT(*) FROM projection_thread_subagent_messages
              WHERE thread_id = ${threadId}) AS messages,
            (SELECT COUNT(*) FROM projection_thread_subagent_proposed_plans
              WHERE thread_id = ${threadId}) AS plans,
            (SELECT COUNT(*) FROM projection_thread_subagent_activities
              WHERE thread_id = ${threadId}) AS activities
        `;
        assert.deepEqual(remainingChildRows, [
          { summaries: 0, messages: 0, plans: 0, activities: 0 },
        ]);
      }),
  );
});
