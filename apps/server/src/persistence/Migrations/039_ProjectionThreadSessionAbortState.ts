import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Shared databases have recorded conflicting migrations in the 33-38 range.
// Keep this repair at the first fresh ID and make direct reapplication safe.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;

  if (!columns.some(({ name }) => name === "runtime_session_id")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN runtime_session_id TEXT
    `;
  }

  if (!columns.some(({ name }) => name === "abort_state_json")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN abort_state_json TEXT
      CHECK (abort_state_json IS NULL OR json_valid(abort_state_json))
    `;
  }
});
