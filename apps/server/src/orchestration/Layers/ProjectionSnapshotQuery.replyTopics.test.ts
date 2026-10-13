import {
  MessageId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  type MessageReplyTopic,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const createdAt = "2026-10-13T10:00:00.000Z";
const topicId = SubagentId.make("reply-a");
const marker: MessageReplyTopic = {
  rootMessageId: MessageId.make("source-message"),
  replyTo: {
    messageId: MessageId.make("source-message"),
    role: "assistant",
    text: "Original quote",
  },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  workspacePath: "/workspace",
};

const TestLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

const seedThread = Effect.fn(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at
    ) VALUES (
      ${threadId}, 'project-replies', 'Replies', ${encodeJson(marker.modelSelection)}, 'full-access', 'default', ${createdAt}, ${createdAt}
    )
  `;
  for (const subagentId of [topicId, SubagentId.make("native-a")]) {
    yield* sql`
      INSERT INTO projection_thread_subagents (
        thread_id, subagent_id, provider_thread_id, name, depth, status, started_at, updated_at,
        message_reply_json
      ) VALUES (
        ${threadId}, ${subagentId}, ${subagentId}, ${subagentId}, 1, 'completed', ${createdAt}, ${createdAt},
        ${subagentId === topicId ? encodeJson(marker) : null}
      )
    `;
  }
});

it.layer(TestLayer)("reply topic snapshots", (it) => {
  it.effect("pages reply-only history with tied timestamps and excludes native subagents", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = yield* ProjectionSnapshotQuery;
      const threadId = ThreadId.make("reply-paging");
      yield* seedThread(threadId);
      for (const subagentId of [topicId, SubagentId.make("native-a")]) {
        for (let index = 0; index < 7; index += 1) {
          yield* sql`
            INSERT INTO projection_thread_subagent_messages (
              thread_id, subagent_id, message_id, role, text, is_streaming, created_at, updated_at, reply_to_json, reply_topic_id
            ) VALUES (
              ${threadId}, ${subagentId}, ${`message-${index}`}, 'assistant', ${`Response ${index}`}, 0,
              ${createdAt}, ${createdAt}, ${encodeJson(marker.replyTo)}, ${subagentId === topicId ? topicId : null}
            )
          `;
        }
      }

      const first = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.equal(first.thread.replyMessages?.length, 2);
      assert.equal(first.page?.hasMore, true);
      assert.deepEqual(first.thread.messages, []);
      assert.equal(first.thread.latestTurn, null);
      assert.equal(first.thread.session, null);
      assert.deepEqual(
        first.thread.subagents.find((subagent) => subagent.id === topicId)?.messageReply,
        marker,
      );

      const seen = new Set(first.thread.replyMessages?.map((message) => message.id));
      let cursor = first.page?.beforeCursor;
      while (cursor) {
        const page = Option.getOrThrow(
          yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2, beforeCursor: cursor }),
        );
        assert.isAtMost(page.thread.replyMessages?.length ?? 0, 2);
        for (const message of page.thread.replyMessages ?? []) {
          assert.equal(message.replyTopicId, topicId);
          assert.isFalse(seen.has(message.id));
          seen.add(message.id);
        }
        cursor = page.page?.beforeCursor;
      }
      assert.equal(seen.size, 7);

      const reconnected = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(reconnected.thread.replyMessages, first.thread.replyMessages);
      const commandModel = yield* query.getCommandReadModel();
      const restored = commandModel.threads.find((thread) => thread.id === threadId);
      assert.deepEqual(
        restored?.subagents.map((subagent) => subagent.id),
        [topicId],
      );
    }),
  );

  it.effect("retains unresolved reply interactions outside the recent activity limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = yield* ProjectionSnapshotQuery;
      const threadId = ThreadId.make("reply-interactions");
      yield* seedThread(threadId);
      yield* sql`
        INSERT INTO projection_thread_subagent_activities (
          thread_id, subagent_id, activity_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (
          ${threadId}, ${topicId}, 'pending-input', 'info', 'user-input.requested', 'Choose',
          '{"requestId":"request-a","questions":[]}', 1, ${createdAt}
        )
      `;
      for (let index = 0; index < 510; index += 1) {
        yield* sql`
          INSERT INTO projection_thread_subagent_activities (
            thread_id, subagent_id, activity_id, tone, kind, summary, payload_json, sequence, created_at
          ) VALUES (
            ${threadId}, ${topicId}, ${`activity-${index}`}, 'info', 'tool.completed', 'Done', '{}', ${index + 2}, '2026-10-13T10:01:00.000Z'
          )
        `;
      }
      const snapshot = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(snapshot.thread.activities, []);
      assert.equal(snapshot.thread.replyActivities?.length, 501);
      assert.equal(
        snapshot.thread.replyActivities?.find((activity) => activity.id === "pending-input")
          ?.replyTopicId,
        topicId,
      );
      yield* sql`
        INSERT INTO projection_thread_subagent_activities (
          thread_id, subagent_id, activity_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (
          ${threadId}, ${topicId}, 'resolved-input', 'info', 'user-input.resolved', 'Answered',
          '{"requestId":"request-a"}', 600, '2026-10-13T10:02:00.000Z'
        )
      `;
      const resolved = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.isFalse(
        resolved.thread.replyActivities?.some((activity) => activity.id === "pending-input") ??
          false,
      );
    }),
  );
  it.effect("recovers only retained reply requests through the captured startup sequence", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = yield* ProjectionSnapshotQuery;
      const threadId = ThreadId.make("reply-recovery");
      const archivedId = ThreadId.make("reply-recovery-archived");
      yield* seedThread(threadId);
      yield* seedThread(archivedId);
      yield* sql`UPDATE projection_threads SET archived_at = ${createdAt} WHERE thread_id = ${archivedId}`;
      const rows = [
        { sequence: 10001, threadId, type: "thread.reply-interrupt-requested" },
        { sequence: 10002, threadId, type: "thread.activity-appended" },
        { sequence: 10003, threadId, type: "thread.reply-retry-requested" },
        { sequence: 10004, threadId: archivedId, type: "thread.reply-retry-requested" },
      ];
      for (const row of rows) {
        yield* sql`
          INSERT INTO orchestration_events (
            sequence, event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
            command_id, actor_kind, payload_json, metadata_json
          ) VALUES (
            ${row.sequence}, ${`recovery-${row.sequence}`}, 'thread', ${row.threadId}, ${row.sequence}, ${row.type}, ${createdAt},
            ${`command-${row.sequence}`}, 'user', ${encodeJson({ threadId: row.threadId, replyTopicId: topicId, commandId: `command-${row.sequence}`, createdAt })}, '{}'
          )
        `;
      }
      assert.deepEqual(yield* query.getMessageReplyRecoveryThreadIds(), [threadId]);
      const recovered = yield* query.getMessageReplyRequestEvents(threadId, 10002);
      assert.deepEqual(
        recovered.map((event) => event.type),
        ["thread.reply-interrupt-requested"],
      );
      assert.equal(recovered[0]?.sequence, 10001);
    }),
  );
  it.effect("keeps active topic controls reachable while reading only recent root context", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = yield* ProjectionSnapshotQuery;
      const threadId = ThreadId.make("reply-active-paging");
      yield* seedThread(threadId);
      yield* sql`UPDATE projection_thread_subagents SET status = 'waiting' WHERE thread_id = ${threadId} AND subagent_id = ${topicId}`;
      for (const [messageId, timestamp] of [
        ["reply-pinned-first", createdAt],
        ["reply-pinned-last", "2026-10-13T10:00:01.000Z"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_thread_subagent_messages (
            thread_id, subagent_id, message_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (${threadId}, ${topicId}, ${messageId}, 'assistant', 'Reply context', 0, ${timestamp}, ${timestamp})
        `;
      }
      for (let index = 0; index < 6; index += 1) {
        const timestamp = `2026-10-13T10:01:0${index}.000Z`;
        const messageId = `pinned-root-message-${index}`;
        yield* sql`
          INSERT INTO projection_thread_messages (thread_id, message_id, role, text, is_streaming, created_at, updated_at)
          VALUES (${threadId}, ${messageId}, 'user', ${`Root ${index}`}, 0, ${timestamp}, ${timestamp})
        `;
        yield* sql`
          INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, state, requested_at, checkpoint_files_json)
          VALUES (${threadId}, ${`pinned-root-turn-${index}`}, ${messageId}, 'completed', ${timestamp}, '[]')
        `;
      }
      const snapshot = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(
        snapshot.thread.messages.map((message) => message.text),
        ["Root 4", "Root 5"],
      );
      assert.deepEqual(
        snapshot.thread.replyMessages?.map((message) => message.id),
        ["reply-pinned-last"],
      );
      assert.equal(snapshot.thread.replyMessages?.[0]?.replyTopicId, topicId);
      assert.deepEqual(
        (yield* query.getRecentThreadMessages(threadId, 2)).map((message) => message.text),
        ["Root 4", "Root 5"],
      );
      assert.deepEqual(yield* query.getRecentThreadMessages(threadId, 0), []);
      yield* sql`UPDATE projection_thread_subagents SET status = 'completed' WHERE thread_id = ${threadId} AND subagent_id = ${topicId}`;
      const completed = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(completed.thread.replyMessages, []);
      yield* sql`
        INSERT INTO projection_thread_subagent_activities (
          thread_id, subagent_id, activity_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (
          ${threadId}, ${topicId}, 'pinned-follow-up-question', 'info', 'user-input.requested', 'Choose next step',
          '{"requestId":"follow-up","responseMode":"message","questions":[]}', 1, '2026-10-13T10:00:02.000Z'
        )
      `;
      const pending = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(
        pending.thread.replyMessages?.map((message) => message.id),
        ["reply-pinned-last"],
      );
      yield* sql`
        INSERT INTO projection_thread_subagent_activities (
          thread_id, subagent_id, activity_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES (
          ${threadId}, ${topicId}, 'pinned-follow-up-resolved', 'info', 'user-input.resolved', 'Answered',
          '{"requestId":"follow-up"}', 2, '2026-10-13T10:00:03.000Z'
        )
      `;
      const answered = Option.getOrThrow(
        yield* query.getThreadDetailSnapshot(threadId, { turnLimit: 2 }),
      );
      assert.deepEqual(answered.thread.replyMessages, []);
    }),
  );
});
