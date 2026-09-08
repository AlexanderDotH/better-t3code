import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_harness_chat_sync_links (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      continuation_key TEXT NOT NULL,
      native_session_id TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      provider_label TEXT NOT NULL,
      activity TEXT NOT NULL CHECK (activity IN ('active', 'idle', 'unknown')),
      source_updated_at TEXT,
      last_synced_at TEXT NOT NULL,
      UNIQUE (continuation_key, native_session_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_harness_chat_sync_links_source_session
    ON projection_harness_chat_sync_links(source_id, native_session_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_harness_chat_sync_links_project
    ON projection_harness_chat_sync_links(project_id, last_synced_at, thread_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_harness_chat_sync_message_links (
      thread_id TEXT NOT NULL,
      native_message_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, native_message_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_harness_chat_sync_message_links_thread
    ON projection_harness_chat_sync_message_links(thread_id, linked_at, native_message_id)
  `;
});
