import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const summaryColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_subagents)
  `;
  if (!summaryColumns.some(({ name }) => name === "message_reply_json")) {
    yield* sql`ALTER TABLE projection_thread_subagents ADD COLUMN message_reply_json TEXT`;
  }

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_subagent_messages)
  `;
  for (const column of ["context_json", "reply_to_json", "reply_topic_id"]) {
    if (!messageColumns.some(({ name }) => name === column)) {
      yield* sql`ALTER TABLE projection_thread_subagent_messages ADD COLUMN ${sql(column)} TEXT`;
    }
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orchestration_reply_requests
    ON orchestration_events(stream_id, sequence)
    WHERE event_type IN (
      'thread.reply-start-requested', 'thread.reply-interrupt-requested', 'thread.reply-retry-requested',
      'thread.reply-approval-response-requested', 'thread.reply-user-input-response-requested',
      'thread.reply-user-input-dismiss-requested'
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_subagent_messages_thread_created
    ON projection_thread_subagent_messages(thread_id, created_at, subagent_id, message_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_subagent_activities_thread_created
    ON projection_thread_subagent_activities(thread_id, created_at, subagent_id, activity_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_subagent_activities_request_lifecycle
    ON projection_thread_subagent_activities(
      thread_id, subagent_id, kind, json_extract(payload_json, '$.requestId'), created_at
    )
  `;
});
