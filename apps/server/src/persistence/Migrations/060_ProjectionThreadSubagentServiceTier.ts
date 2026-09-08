import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_subagents)
  `;

  if (!columns.some(({ name }) => name === "service_tier")) {
    yield* sql`
      ALTER TABLE projection_thread_subagents
      ADD COLUMN service_tier TEXT
    `;
  }
});
