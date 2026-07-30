import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Some fork databases already created these tables under migration 34 or 37.
// CREATE IF NOT EXISTS makes the fresh post-collision migration safe for both
// those databases and clean installations.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagents (
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      parent_subagent_id TEXT,
      path TEXT,
      name TEXT NOT NULL,
      nickname TEXT,
      role TEXT,
      task TEXT,
      model TEXT,
      reasoning_effort TEXT,
      depth INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'starting',
          'running',
          'waiting',
          'completed',
          'interrupted',
          'error',
          'unavailable'
        )
      ),
      status_message TEXT,
      latest_progress_json TEXT,
      latest_turn_json TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (thread_id, subagent_id),
      UNIQUE (thread_id, provider_thread_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_messages (
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      turn_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT,
      is_streaming INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, subagent_id, message_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_proposed_plans (
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      implemented_at TEXT,
      implementation_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, subagent_id, plan_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_activities (
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, subagent_id, activity_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagents_thread_status_updated
    ON projection_thread_subagents(thread_id, status, updated_at, subagent_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagents_thread_parent_updated
    ON projection_thread_subagents(thread_id, parent_subagent_id, updated_at, subagent_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_messages_agent_created
    ON projection_thread_subagent_messages(thread_id, subagent_id, created_at, message_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_plans_agent_created
    ON projection_thread_subagent_proposed_plans(thread_id, subagent_id, created_at, plan_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_activities_agent_sequence_created
    ON projection_thread_subagent_activities(
      thread_id,
      subagent_id,
      sequence,
      created_at,
      activity_id
    )
  `;
});
