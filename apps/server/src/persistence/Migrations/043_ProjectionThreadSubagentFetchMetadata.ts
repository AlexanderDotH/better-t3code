import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Shared fork databases can re-run repair migrations directly. Check every
// column so the migration is safe both through the ledger and on direct use.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_subagents)
  `;
  const columnNames = new Set(columns.map(({ name }) => name));

  if (!columnNames.has("origin")) {
    yield* sql`
      ALTER TABLE projection_thread_subagents
      ADD COLUMN origin TEXT NOT NULL DEFAULT 'provider-native'
      CHECK (origin IN ('provider-native', 't3-fetch'))
    `;
  }

  if (!columnNames.has("provider_instance_id")) {
    yield* sql`
      ALTER TABLE projection_thread_subagents
      ADD COLUMN provider_instance_id TEXT
    `;
  }

  if (!columnNames.has("provider_driver")) {
    yield* sql`
      ALTER TABLE projection_thread_subagents
      ADD COLUMN provider_driver TEXT
    `;
  }
});
