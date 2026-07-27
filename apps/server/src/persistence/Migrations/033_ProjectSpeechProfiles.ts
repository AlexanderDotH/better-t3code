import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
