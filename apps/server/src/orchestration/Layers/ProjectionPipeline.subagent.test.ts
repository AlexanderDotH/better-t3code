import { ProviderDriverKind } from "@t3tools/contracts";
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
import * as Schema from "effect/Schema";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
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
    origin: "t3-fetch",
    providerInstanceId: ProviderInstanceId.make("claude-work"),
    providerDriver: ProviderDriverKind.make("claudeAgent"),
    providerThreadId: "provider-agent-subagent-projection",
    parentId: null,
    path: "/root/projection",
    name: "projection",
    nickname: "projection",
    role: "worker",
    task: "Implement the projection",
    model: "gpt-5.6",
    reasoningEffort: "ultra",
    serviceTier: "priority",
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
          readonly origin: string;
          readonly providerInstanceId: string | null;
          readonly providerDriver: string | null;
          readonly serviceTier: string | null;
          readonly status: string;
          readonly statusMessage: string | null;
          readonly progressJson: string | null;
          readonly completedAt: string | null;
        }>`
          SELECT
            origin,
            provider_instance_id AS "providerInstanceId",
            provider_driver AS "providerDriver",
            service_tier AS "serviceTier",
            status,
            status_message AS "statusMessage",
            latest_progress_json AS "progressJson",
            completed_at AS "completedAt"
          FROM projection_thread_subagents
          WHERE thread_id = ${threadId}
            AND subagent_id = ${subagentId}
        `;
        assert.equal(summaryRows[0]?.origin, "t3-fetch");
        assert.equal(summaryRows[0]?.providerInstanceId, "claude-work");
        assert.equal(summaryRows[0]?.providerDriver, "claudeAgent");
        assert.equal(summaryRows[0]?.serviceTier, "priority");
        assert.equal(summaryRows[0]?.status, "completed");
        assert.equal(summaryRows[0]?.statusMessage, "Done");
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Assert the raw persisted representation without schema normalization.
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
  it.effect("persists reply metadata without moving the root turn", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;
      const replyTo = {
        messageId: MessageId.make("root-source"),
        role: "assistant" as const,
        text: "Original source",
      };
      const marker = {
        rootMessageId: replyTo.messageId,
        replyTo,
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        workspacePath: "/workspace",
      };
      yield* pipeline.projectEvent(
        event(100, "thread.created", startedAt, {
          threadId,
          projectId: ProjectId.make("project-reply-persistence"),
          title: "Replies",
          modelSelection: marker.modelSelection,
          runtimeMode: marker.runtimeMode,
          interactionMode: marker.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: startedAt,
          updatedAt: startedAt,
        }),
      );
      yield* sql`UPDATE projection_threads SET latest_turn_id = 'root-turn', latest_user_message_at = ${startedAt} WHERE thread_id = ${threadId}`;
      yield* pipeline.projectEvent(
        event(101, "thread.subagent-upserted", startedAt, {
          threadId,
          subagent: { ...summary(), messageReply: marker },
        }),
      );
      const userMessage = event(102, "thread.message-sent", "2026-07-30T10:00:02.000Z", {
        threadId,
        subagentId,
        messageId: MessageId.make("reply-user"),
        role: "user",
        text: "Explain",
        replyTopicId: subagentId,
        replyTo,
        context: { version: 1, records: [] },
        turnId: null,
        streaming: false,
        createdAt: "2026-07-30T10:00:02.000Z",
        updatedAt: "2026-07-30T10:00:02.000Z",
      });
      yield* pipeline.projectEvent(userMessage);
      const delta = event(103, "thread.message-sent", "2026-07-30T10:00:03.000Z", {
        threadId,
        subagentId,
        messageId: MessageId.make("reply-assistant"),
        role: "assistant",
        text: "Answer",
        replyTopicId: subagentId,
        turnId: TurnId.make("topic-turn"),
        streaming: true,
        createdAt: "2026-07-30T10:00:03.000Z",
        updatedAt: "2026-07-30T10:00:03.000Z",
      });
      yield* pipeline.projectEvent(delta);
      const messages = yield* sql<{
        readonly text: string;
        readonly replyTo: string | null;
        readonly topic: string | null;
        readonly context: string | null;
      }>`
        SELECT text, reply_to_json AS "replyTo", reply_topic_id AS topic, context_json AS context
        FROM projection_thread_subagent_messages WHERE thread_id = ${threadId} ORDER BY message_id
      `;
      assert.equal(messages.length, 2);
      assert.equal(messages[0]?.text, "Answer");
      assert.equal(messages[1]?.replyTo, encodeJson(replyTo));
      assert.equal(messages[1]?.context, '{"version":1,"records":[]}');
      assert.equal(messages[1]?.topic, subagentId);
      const roots = yield* sql<{
        readonly turn: string;
        readonly latestUser: string;
        readonly count: number;
      }>`
        SELECT latest_turn_id AS turn, latest_user_message_at AS "latestUser",
          (SELECT COUNT(*) FROM projection_thread_messages WHERE thread_id = ${threadId}) AS count
        FROM projection_threads WHERE thread_id = ${threadId}
      `;
      assert.deepEqual(roots, [{ turn: "root-turn", latestUser: startedAt, count: 0 }]);
      const summaries = yield* sql<{
        readonly marker: string;
      }>`SELECT message_reply_json AS marker FROM projection_thread_subagents WHERE thread_id = ${threadId}`;
      assert.equal(summaries[0]?.marker, encodeJson(marker));
    }),
  );
});

it.effect("replays reply messages from the event store without duplicating streamed text", () =>
  Effect.gen(function* () {
    const pipeline = yield* OrchestrationProjectionPipeline;
    const eventStore = yield* OrchestrationEventStore;
    const sql = yield* SqlClient.SqlClient;
    const replyTo = {
      messageId: MessageId.make("replay-source"),
      role: "user" as const,
      text: "Original task",
    };
    const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
    yield* eventStore.append(
      event(1, "thread.created", startedAt, {
        threadId,
        projectId: ProjectId.make("project-reply-replay"),
        title: "Replay",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      }),
    );
    yield* eventStore.append(
      event(2, "thread.subagent-upserted", startedAt, {
        threadId,
        subagent: {
          ...summary(),
          messageReply: {
            rootMessageId: replyTo.messageId,
            replyTo,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            workspacePath: "/workspace",
          },
        },
      }),
    );
    yield* eventStore.append(
      event(3, "thread.message-sent", startedAt, {
        threadId,
        subagentId,
        messageId: MessageId.make("replayed-message"),
        role: "assistant",
        text: "First",
        replyTopicId: subagentId,
        replyTo,
        turnId: TurnId.make("replayed-turn"),
        streaming: true,
        createdAt: startedAt,
        updatedAt: startedAt,
      }),
    );
    yield* pipeline.bootstrap;
    yield* eventStore.append(
      event(4, "thread.message-sent", startedAt, {
        threadId,
        subagentId,
        messageId: MessageId.make("replayed-message"),
        role: "assistant",
        text: " second",
        replyTopicId: subagentId,
        turnId: TurnId.make("replayed-turn"),
        streaming: true,
        createdAt: startedAt,
        updatedAt: startedAt,
      }),
    );
    yield* pipeline.bootstrap;
    yield* pipeline.bootstrap;
    const rows = yield* sql<{ readonly text: string; readonly replyTo: string }>`
      SELECT text, reply_to_json AS "replyTo" FROM projection_thread_subagent_messages WHERE thread_id = ${threadId}
    `;
    assert.deepEqual(rows, [{ text: "First second", replyTo: encodeJson(replyTo) }]);
  }).pipe(Effect.provide(TestLayer)),
);
