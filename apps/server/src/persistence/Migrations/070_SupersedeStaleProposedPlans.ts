import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Adapters superseded earlier proposals only within one live session, so older drafts stayed
// implementable after a later revision. Fork migrations run before upstream creates V2 tables.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('orchestration_v2_projection_plans', 'orchestration_v2_projection_runs')
  `;
  if (tables.length < 2) return;
  yield* sql`
    UPDATE orchestration_v2_projection_plans
    SET status = 'superseded',
      payload_json = json_set(payload_json, '$.status', 'superseded')
    WHERE kind = 'proposed_plan'
      AND status = 'active'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.deepPlan') IS NULL
      AND EXISTS (
        SELECT 1
        FROM orchestration_v2_projection_plans newer
        JOIN orchestration_v2_projection_runs newer_run ON newer_run.run_id = newer.run_id
        JOIN orchestration_v2_projection_runs stale_run
          ON stale_run.run_id = orchestration_v2_projection_plans.run_id
        WHERE newer.thread_id = orchestration_v2_projection_plans.thread_id
          AND newer.kind = 'proposed_plan'
          AND json_extract(newer.payload_json, '$.deepPlan') IS NULL
          AND newer_run.ordinal > stale_run.ordinal
      )
  `;
});
