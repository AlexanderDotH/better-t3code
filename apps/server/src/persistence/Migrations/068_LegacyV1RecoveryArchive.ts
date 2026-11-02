import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const legacyRecoveryTables = [
  "projection_thread_activities",
  "projection_turns",
  "projection_thread_proposed_plans",
  "projection_pending_approvals",
  "projection_state",
  "checkpoint_diff_blobs",
] as const;

export const ensureFrozenMessageEditLookupIndex = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_orch_receipts_frozen_message_edits
    ON orchestration_command_receipts(aggregate_id, result_sequence, command_id)
    WHERE aggregate_kind = 'thread' AND command_type = 'message.edit' AND status = 'accepted'
  `;
});

// Renaming preserves blobs, fork-only columns and indexes without copying large histories.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const receiptColumns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(orchestration_command_receipts)`;
  if (receiptColumns.some(({ name }) => name === "command_type")) {
    yield* ensureFrozenMessageEditLookupIndex;
  }
  yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_v2_legacy_subagent_threads (
      thread_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      UNIQUE (source_thread_id, subagent_id)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS legacy_v1_recovery_schema (
      table_name TEXT PRIMARY KEY,
      create_sql TEXT NOT NULL
    )
  `;
  for (const table of legacyRecoveryTables) {
    const source = yield* sql<{ readonly sql: string }>`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${table}
    `;
    if (source.length === 0) continue;
    const archived = yield* sql`
      SELECT table_name FROM legacy_v1_recovery_schema WHERE table_name = ${table}
    `;
    if (archived.length > 0) continue;
    yield* sql`ALTER TABLE ${sql(table)} RENAME TO ${sql(`legacy_v1_${table}`)}`;
    yield* sql`
      INSERT INTO legacy_v1_recovery_schema (table_name, create_sql)
      VALUES (${table}, ${source[0]!.sql})
    `;
  }
});
