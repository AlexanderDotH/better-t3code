import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Native upstream used ledger ID 41 for these columns, while the fork already
// owns that immutable ID. Reapply the idempotent schema change at the first
// collision-free fork ID so fresh, fork, and native-upstream databases converge.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;
  const columnNames = new Set(columns.map(({ name }) => name));

  if (!columnNames.has("client_surface")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN client_surface TEXT
    `;
  }

  if (!columnNames.has("client_app_version")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN client_app_version TEXT
    `;
  }
});
