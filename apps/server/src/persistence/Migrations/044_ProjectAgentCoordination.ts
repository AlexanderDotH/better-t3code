import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_project_agent_claims (
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      claims_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, thread_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_project_agent_messages (
      sequence INTEGER PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      sender_thread_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('info', 'request', 'blocker', 'response')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_project_agent_message_recipients (
      message_sequence INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      recipient_thread_id TEXT NOT NULL,
      PRIMARY KEY (message_sequence, recipient_thread_id),
      FOREIGN KEY (message_sequence)
        REFERENCES projection_project_agent_messages(sequence)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_project_agent_inbox_cursors (
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      acknowledged_sequence INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged_sequence >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_project_agent_claims_project
    ON projection_project_agent_claims(project_id, updated_at DESC, thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_project_agent_messages_project_sequence
    ON projection_project_agent_messages(project_id, sequence DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_project_agent_recipients_inbox
    ON projection_project_agent_message_recipients(
      project_id,
      recipient_thread_id,
      message_sequence
    )
  `;
});
