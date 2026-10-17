import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_source_exports (
      export_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      selection_json TEXT NOT NULL,
      complete_project INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_sources (
      source_id TEXT PRIMARY KEY,
      export_id TEXT,
      source_ordinal INTEGER,
      snapshot_json TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
      UNIQUE (export_id, source_ordinal)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_source_contents (
      record_id TEXT PRIMARY KEY,
      origin_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      record_json TEXT NOT NULL,
      record_bytes INTEGER NOT NULL,
      record_kind TEXT NOT NULL,
      required_analysis INTEGER NOT NULL,
      content_id TEXT,
      chunk_index INTEGER,
      total_chunks INTEGER,
      body_bytes INTEGER NOT NULL DEFAULT 0,
      UNIQUE (origin_key, content_hash)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_source_records (
      source_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      record_id TEXT NOT NULL,
      PRIMARY KEY (source_id, ordinal)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_source_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      initialized_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_run_sources (
      run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_ordinal INTEGER NOT NULL,
      imported_record_count INTEGER NOT NULL DEFAULT 0,
      next_chunk_index INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
      read_record_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      summary_json TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, source_id),
      UNIQUE (run_id, source_ordinal)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS deep_plan_source_import_chunks (
      run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      content_hash TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      final_chunk INTEGER NOT NULL CHECK (final_chunk IN (0, 1)),
      PRIMARY KEY (run_id, source_id, chunk_index)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deep_plan_source_records_record
    ON deep_plan_source_records(record_id)
  `;
});
