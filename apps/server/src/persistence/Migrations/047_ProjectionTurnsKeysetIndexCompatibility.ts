import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Composite index for bounded thread-detail reads. The turn ID is the stable
// tiebreaker when multiple turns share a requested_at timestamp.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_keyset
    ON projection_turns(thread_id, requested_at, turn_id)
  `;
});
