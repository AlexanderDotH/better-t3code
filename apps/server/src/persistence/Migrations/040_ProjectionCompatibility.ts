import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Upstream and older fork builds assigned IDs 33-36 to different migrations.
// This migration converges every known schema at a fresh ID while preserving
// historical ledger rows and any data already stored in these projections.
const addColumnIfMissing = Effect.fn("ProjectionCompatibility.addColumnIfMissing")(function* (
  table: string,
  column: string,
  definition: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql.unsafe<{ readonly name: string }>(`PRAGMA table_info('${table}')`);
  if (columns.some(({ name }) => name === column)) {
    return;
  }
  yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
});

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* addColumnIfMissing("projection_threads", "settled_override", "TEXT");
  yield* addColumnIfMissing("projection_threads", "settled_at", "TEXT");
  yield* addColumnIfMissing("projection_threads", "snoozed_until", "TEXT");
  yield* addColumnIfMissing("projection_threads", "snoozed_at", "TEXT");
  yield* addColumnIfMissing("projection_threads", "title_regeneration_request_id", "TEXT");
  yield* addColumnIfMissing("projection_threads", "title_regeneration_started_at", "TEXT");

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_speech_profiles (
      project_id TEXT PRIMARY KEY,
      project_title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      repository_key TEXT,
      source TEXT NOT NULL CHECK (source IN ('indexed', 'basic')),
      context_prompt TEXT NOT NULL,
      keyterms_json TEXT NOT NULL,
      technologies_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      warning TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_speech_profiles_created
    ON project_speech_profiles(created_at, project_id)
  `;
});
