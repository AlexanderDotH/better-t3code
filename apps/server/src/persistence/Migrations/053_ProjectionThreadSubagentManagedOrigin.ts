import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0043 from "./043_ProjectionThreadSubagentFetchMetadata.ts";

export default Effect.gen(function* () {
  // Keep direct repair runs safe on historical fork ledgers as well as the
  // normal ordered migration path.
  yield* Migration0043;

  const sql = yield* SqlClient.SqlClient;
  const [table] = yield* sql<{ readonly sql: string | null }>`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'projection_thread_subagents'
  `;
  if (table?.sql?.includes("'t3-managed'")) return;

  yield* sql`
    ALTER TABLE projection_thread_subagents
    RENAME TO projection_thread_subagents_legacy_053
  `;

  yield* sql`
    CREATE TABLE projection_thread_subagents (
      thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'provider-native'
        CHECK (origin IN ('provider-native', 't3-fetch', 't3-managed')),
      provider_instance_id TEXT,
      provider_driver TEXT,
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
    INSERT INTO projection_thread_subagents (
      thread_id,
      subagent_id,
      origin,
      provider_instance_id,
      provider_driver,
      provider_thread_id,
      parent_subagent_id,
      path,
      name,
      nickname,
      role,
      task,
      model,
      reasoning_effort,
      depth,
      status,
      status_message,
      latest_progress_json,
      latest_turn_json,
      started_at,
      updated_at,
      completed_at
    )
    SELECT
      thread_id,
      subagent_id,
      origin,
      provider_instance_id,
      provider_driver,
      provider_thread_id,
      parent_subagent_id,
      path,
      name,
      nickname,
      role,
      task,
      model,
      reasoning_effort,
      depth,
      status,
      status_message,
      latest_progress_json,
      latest_turn_json,
      started_at,
      updated_at,
      completed_at
    FROM projection_thread_subagents_legacy_053
  `;

  yield* sql`DROP TABLE projection_thread_subagents_legacy_053`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagents_thread_status_updated
    ON projection_thread_subagents(thread_id, status, updated_at, subagent_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagents_thread_parent_updated
    ON projection_thread_subagents(thread_id, parent_subagent_id, updated_at, subagent_id)
  `;
});
