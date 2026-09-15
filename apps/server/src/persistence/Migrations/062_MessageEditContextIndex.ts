import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_events_message_edit_context
    ON orchestration_events(aggregate_kind, stream_id, sequence)
    WHERE aggregate_kind = 'thread'
      AND event_type IN ('thread.message-edited', 'thread.session-set')
  `;
});
