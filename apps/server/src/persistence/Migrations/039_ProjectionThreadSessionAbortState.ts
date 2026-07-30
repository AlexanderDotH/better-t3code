import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// The first local implementation used migration ID 33. Deployed shared databases
// already recorded a different migration at that ID, so this idempotent migration
// must remain at the first fresh ID after the known 33-38 compatibility range.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;

  if (!columns.some((column) => column.name === "runtime_session_id")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN runtime_session_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "abort_state_json")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN abort_state_json TEXT
      CHECK (abort_state_json IS NULL OR json_valid(abort_state_json))
    `;
  }
});
