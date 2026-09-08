import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some(({ name }) => name === "fork_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN fork_json TEXT
    `;
  }

  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  if (!messageColumns.some(({ name }) => name === "history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_thread_messages
      ADD COLUMN history_origin_json TEXT
    `;
  }

  const proposedPlanColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_proposed_plans)
  `;
  if (!proposedPlanColumns.some(({ name }) => name === "history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN history_origin_json TEXT
    `;
  }

  const activityColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_activities)
  `;
  if (!activityColumns.some(({ name }) => name === "history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_thread_activities
      ADD COLUMN history_origin_json TEXT
    `;
  }

  const subagentColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_subagents)
  `;
  if (!subagentColumns.some(({ name }) => name === "history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_thread_subagents
      ADD COLUMN history_origin_json TEXT
    `;
  }

  const turnColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;
  if (!turnColumns.some(({ name }) => name === "history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN history_origin_json TEXT
    `;
  }
  if (!turnColumns.some(({ name }) => name === "checkpoint_history_origin_json")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN checkpoint_history_origin_json TEXT
    `;
  }
  if (!turnColumns.some(({ name }) => name === "history_checkpoint_turn_count")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN history_checkpoint_turn_count INTEGER
    `;
  }
  if (!turnColumns.some(({ name }) => name === "history_checkpoint_ref")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN history_checkpoint_ref TEXT
    `;
  }
  if (!turnColumns.some(({ name }) => name === "history_checkpoint_status")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN history_checkpoint_status TEXT
    `;
  }
  if (!turnColumns.some(({ name }) => name === "history_checkpoint_files_json")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN history_checkpoint_files_json TEXT
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_fork_checkpoints (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      checkpoint_turn_count INTEGER NOT NULL,
      checkpoint_ref TEXT NOT NULL,
      checkpoint_status TEXT NOT NULL,
      checkpoint_files_json TEXT NOT NULL,
      assistant_message_id TEXT,
      completed_at TEXT NOT NULL,
      history_origin_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, turn_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_fork_checkpoints_thread_count
    ON projection_thread_fork_checkpoints(thread_id, checkpoint_turn_count)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_attachment_references (
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('thread', 'subagent')),
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      PRIMARY KEY (owner_kind, thread_id, subagent_id, message_id, attachment_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_attachment_references_attachment
    ON projection_attachment_references(attachment_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_attachment_references_thread
    ON projection_attachment_references(thread_id, owner_kind, subagent_id, message_id)
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_attachment_references (
      owner_kind,
      thread_id,
      subagent_id,
      message_id,
      attachment_id
    )
    SELECT
      'thread',
      messages.thread_id,
      '',
      messages.message_id,
      json_extract(attachment.value, '$.id')
    FROM projection_thread_messages AS messages
    JOIN json_each(
      CASE
        WHEN json_valid(messages.attachments_json) THEN messages.attachments_json
        ELSE '[]'
      END
    ) AS attachment
    WHERE json_type(attachment.value, '$.id') = 'text'
  `;
  yield* sql`
    INSERT OR IGNORE INTO projection_attachment_references (
      owner_kind,
      thread_id,
      subagent_id,
      message_id,
      attachment_id
    )
    SELECT
      'subagent',
      messages.thread_id,
      messages.subagent_id,
      messages.message_id,
      json_extract(attachment.value, '$.id')
    FROM projection_thread_subagent_messages AS messages
    JOIN json_each(
      CASE
        WHEN json_valid(messages.attachments_json) THEN messages.attachments_json
        ELSE '[]'
      END
    ) AS attachment
    WHERE json_type(attachment.value, '$.id') = 'text'
  `;
});
