import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  if (!columns.some((column) => column.name === "deep_plan_json")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN deep_plan_json TEXT`;
  }
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_deep_plan_implementation
    ON projection_threads(json_extract(deep_plan_json, '$.approval.implementationThreadId'))
    WHERE deep_plan_json IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL
  `;
  const planColumns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(projection_thread_proposed_plans)`;
  if (!planColumns.some((column) => column.name === "deep_plan_reference_json")) {
    yield* sql`ALTER TABLE projection_thread_proposed_plans ADD COLUMN deep_plan_reference_json TEXT`;
  }
});
