import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import archiveLegacySources from "./068_LegacyV1RecoveryArchive.ts";

// Legacy plans, activities and checkpoint diffs have no equivalent V2 history.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* archiveLegacySources;

  yield* sql`DROP TABLE IF EXISTS projection_thread_activities`;
  yield* sql`DROP TABLE IF EXISTS projection_turns`;
  yield* sql`DROP TABLE IF EXISTS projection_thread_proposed_plans`;
  yield* sql`DROP TABLE IF EXISTS projection_pending_approvals`;
  yield* sql`DROP TABLE IF EXISTS projection_state`;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
});
