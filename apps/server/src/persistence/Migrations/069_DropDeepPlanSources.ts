import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS deep_plan_source_import_chunks`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_run_sources`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_source_runs`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_source_records`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_source_contents`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_sources`;
  yield* sql`DROP TABLE IF EXISTS deep_plan_source_exports`;
});
