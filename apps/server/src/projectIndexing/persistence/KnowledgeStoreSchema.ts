import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

export const KNOWLEDGE_STORE_VERSION = 1;
export const KNOWLEDGE_STORE_APPLICATION_ID = 0x54334b49;
export const KNOWLEDGE_STORE_OWNER = "t3-project-index";

export class KnowledgeStoreError extends Schema.TaggedError<KnowledgeStoreError>()(
  "KnowledgeStoreError",
  { code: Schema.String, detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return this.detail;
  }
}
const isKnowledgeStoreError = Schema.is(KnowledgeStoreError);

export const asStoreError =
  (operation: string) =>
  (cause: unknown): KnowledgeStoreError =>
    isKnowledgeStoreError(cause)
      ? cause
      : new KnowledgeStoreError({
          code: "storage-failed",
          detail: `Project indexing storage could not ${operation}. Check workspace permissions and database integrity.`,
          cause,
        });

const TABLES = [
  `CREATE TABLE IF NOT EXISTS knowledge_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    workspace_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    published_revision INTEGER,
    active_revision INTEGER,
    status TEXT NOT NULL DEFAULT 'idle',
    settings_json TEXT NOT NULL,
    coverage_json TEXT,
    metadata_json TEXT,
    updated_at INTEGER NOT NULL,
    lease_owner TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_generations (
    revision INTEGER PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    coverage_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    views_path TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_records (
    revision INTEGER NOT NULL REFERENCES knowledge_generations(revision) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    file_path TEXT,
    name TEXT NOT NULL,
    search_text TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY(revision, kind, id)
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_records_file ON knowledge_records(revision, file_path, kind, id)`,
  `CREATE INDEX IF NOT EXISTS knowledge_records_name ON knowledge_records(revision, kind, name, id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_record_dependencies (
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    PRIMARY KEY(revision, kind, id, file_path, entity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_dependencies_file ON knowledge_record_dependencies(revision, file_path, kind, id)`,
  `CREATE INDEX IF NOT EXISTS knowledge_dependencies_entity ON knowledge_record_dependencies(revision, entity_id, kind, id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_calls (
    revision INTEGER NOT NULL,
    callsite_id TEXT NOT NULL,
    caller_id TEXT NOT NULL,
    callee_id TEXT NOT NULL,
    PRIMARY KEY(revision, callsite_id, caller_id, callee_id)
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_calls_caller ON knowledge_calls(revision, caller_id, callsite_id)`,
  `CREATE INDEX IF NOT EXISTS knowledge_calls_callee ON knowledge_calls(revision, callee_id, callsite_id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_jobs (
    revision INTEGER NOT NULL REFERENCES knowledge_generations(revision) ON DELETE CASCADE,
    id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    entity_id TEXT,
    input_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    claim_token TEXT,
    claim_lease_token TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(revision, id),
    UNIQUE(revision, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS knowledge_jobs_pending ON knowledge_jobs(revision, state, kind, id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_artifacts (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    revision INTEGER NOT NULL
  )`,
] as const;

const QUERY_INDEXES = [
  `CREATE INDEX IF NOT EXISTS knowledge_files_state ON knowledge_records(revision, json_extract(payload, '$.status'), json_extract(payload, '$.classification'), id) WHERE kind = 'files'`,
  `CREATE INDEX IF NOT EXISTS knowledge_jobs_source ON knowledge_jobs(revision, file_path, kind, state, id)`,
  `CREATE INDEX IF NOT EXISTS knowledge_callsite_range ON knowledge_records(revision, file_path, json_extract(payload, '$.range.startOffset'), json_extract(payload, '$.range.endOffset'), id) WHERE kind = 'callsites'`,
  `CREATE INDEX IF NOT EXISTS knowledge_entity_name_range ON knowledge_records(revision, file_path, name, json_extract(payload, '$.nameRange.startOffset'), json_extract(payload, '$.nameRange.endOffset'), id) WHERE kind = 'entities'`,
  `CREATE INDEX IF NOT EXISTS knowledge_entity_range ON knowledge_records(revision, file_path, json_extract(payload, '$.range.endOffset'), json_extract(payload, '$.range.startOffset'), id) WHERE kind = 'entities'`,
  `CREATE INDEX IF NOT EXISTS knowledge_entity_container ON knowledge_records(revision, file_path, json_extract(payload, '$.containerId'), id) WHERE kind = 'entities'`,
] as const;

const SEARCH_BACKFILL_BATCH_SIZE = 512;
const SEARCH_SCHEMA = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_record_fts USING fts5(file_path, name, signature, package_name, rule_text, tokenize='unicode61')`,
  `CREATE TABLE IF NOT EXISTS knowledge_search_keys (
    search_id INTEGER PRIMARY KEY,
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL,
    record_id TEXT NOT NULL,
    UNIQUE(revision, kind, record_id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_search_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    last_revision INTEGER NOT NULL DEFAULT -1,
    last_kind TEXT NOT NULL DEFAULT '',
    last_id TEXT NOT NULL DEFAULT '',
    complete INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE VIEW IF NOT EXISTS knowledge_search_projection AS
    SELECT record.revision AS revision, record.kind AS kind, record.id AS record_id,
      COALESCE(record.file_path, '') AS file_path,
      record.name AS name,
      CASE WHEN record.kind = 'entities' THEN COALESCE(json_extract(record.payload, '$.signature'), '') ELSE '' END AS signature,
      CASE WHEN record.kind = 'imports' THEN COALESCE(json_extract(record.payload, '$.packageName'), '') ELSE '' END AS package_name,
      CASE WHEN record.kind = 'rules' THEN COALESCE(json_extract(record.payload, '$.description'), '') ELSE '' END AS rule_text
    FROM knowledge_records record
    WHERE record.kind IN ('files', 'entities', 'imports', 'modules', 'rules')
      AND (record.kind = 'files' OR (
        COALESCE(json_extract(record.payload, '$.provenance'), '') <> 'llm'
        AND (record.kind <> 'rules' OR json_extract(record.payload, '$.source') = 'explicit')
      ))`,
  `CREATE TRIGGER IF NOT EXISTS knowledge_search_insert AFTER INSERT ON knowledge_records BEGIN
    INSERT OR IGNORE INTO knowledge_search_keys(revision, kind, record_id)
      SELECT revision, kind, record_id FROM knowledge_search_projection
      WHERE revision = NEW.revision AND kind = NEW.kind AND record_id = NEW.id;
    INSERT INTO knowledge_record_fts(rowid, file_path, name, signature, package_name, rule_text)
      SELECT search_key.search_id, projection.file_path, projection.name, projection.signature, projection.package_name, projection.rule_text
      FROM knowledge_search_projection projection
      JOIN knowledge_search_keys search_key ON search_key.revision = projection.revision AND search_key.kind = projection.kind AND search_key.record_id = projection.record_id
      WHERE projection.revision = NEW.revision AND projection.kind = NEW.kind AND projection.record_id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS knowledge_search_update AFTER UPDATE ON knowledge_records BEGIN
    DELETE FROM knowledge_record_fts WHERE rowid IN (
      SELECT search_id FROM knowledge_search_keys WHERE revision = OLD.revision AND kind = OLD.kind AND record_id = OLD.id);
    DELETE FROM knowledge_search_keys WHERE revision = OLD.revision AND kind = OLD.kind AND record_id = OLD.id;
    INSERT OR IGNORE INTO knowledge_search_keys(revision, kind, record_id)
      SELECT revision, kind, record_id FROM knowledge_search_projection
      WHERE revision = NEW.revision AND kind = NEW.kind AND record_id = NEW.id;
    INSERT INTO knowledge_record_fts(rowid, file_path, name, signature, package_name, rule_text)
      SELECT search_key.search_id, projection.file_path, projection.name, projection.signature, projection.package_name, projection.rule_text
      FROM knowledge_search_projection projection
      JOIN knowledge_search_keys search_key ON search_key.revision = projection.revision AND search_key.kind = projection.kind AND search_key.record_id = projection.record_id
      WHERE projection.revision = NEW.revision AND projection.kind = NEW.kind AND projection.record_id = NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS knowledge_search_delete AFTER DELETE ON knowledge_records BEGIN
    DELETE FROM knowledge_record_fts WHERE rowid IN (
      SELECT search_id FROM knowledge_search_keys WHERE revision = OLD.revision AND kind = OLD.kind AND record_id = OLD.id);
    DELETE FROM knowledge_search_keys WHERE revision = OLD.revision AND kind = OLD.kind AND record_id = OLD.id;
  END`,
] as const;

export const ensureKnowledgeQueryIndexes = Effect.fn("ensureKnowledgeQueryIndexes")(function* (
  sql: SqlClient.SqlClient,
) {
  for (const statement of QUERY_INDEXES) yield* sql.unsafe(statement);
  yield* sql.unsafe("DROP INDEX IF EXISTS knowledge_behavior_unit");
  yield* sql.unsafe("DROP INDEX IF EXISTS knowledge_behavior_root");
});

export const ensureKnowledgeSearchIndex = Effect.fn("ensureKnowledgeSearchIndex")(function* (
  sql: SqlClient.SqlClient,
) {
  yield* sql
    .withTransaction(
      Effect.gen(function* () {
        for (const statement of SEARCH_SCHEMA) yield* sql.unsafe(statement);
        yield* sql`INSERT OR IGNORE INTO knowledge_search_state(singleton) VALUES (1)`;
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new KnowledgeStoreError({
            code: "fts-unavailable",
            detail: "Project indexing requires SQLite FTS5 in the bundled Node or Bun runtime.",
            cause,
          }),
      ),
    );

  // Each committed batch can be resumed after interruption, while triggers keep
  // records written during the backfill in sync.
  let complete = false;
  while (!complete) {
    complete = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const state = (yield* sql<{
            last_revision: number;
            last_kind: string;
            last_id: string;
            complete: number;
          }>`SELECT last_revision, last_kind, last_id, complete FROM knowledge_search_state WHERE singleton = 1`)[0];
          if (!state || state.complete === 1) return true;
          const rows = yield* sql<{
            revision: number;
            kind: string;
            record_id: string;
          }>`SELECT revision, kind, record_id FROM knowledge_search_projection
            WHERE (revision, kind, record_id) > (${state.last_revision}, ${state.last_kind}, ${state.last_id})
            ORDER BY revision, kind, record_id LIMIT ${SEARCH_BACKFILL_BATCH_SIZE}`;
          const last = rows.at(-1);
          if (!last) {
            yield* sql`UPDATE knowledge_search_state SET complete = 1 WHERE singleton = 1`;
            return true;
          }
          yield* sql`INSERT OR IGNORE INTO knowledge_search_keys(revision, kind, record_id)
            SELECT revision, kind, record_id FROM knowledge_search_projection
            WHERE (revision, kind, record_id) > (${state.last_revision}, ${state.last_kind}, ${state.last_id})
              AND (revision, kind, record_id) <= (${last.revision}, ${last.kind}, ${last.record_id})
            ORDER BY revision, kind, record_id`;
          yield* sql`INSERT INTO knowledge_record_fts(rowid, file_path, name, signature, package_name, rule_text)
          SELECT search_key.search_id, projection.file_path, projection.name, projection.signature, projection.package_name, projection.rule_text
          FROM knowledge_search_projection projection
          JOIN knowledge_search_keys search_key ON search_key.revision = projection.revision AND search_key.kind = projection.kind AND search_key.record_id = projection.record_id
          WHERE (projection.revision, projection.kind, projection.record_id) > (${state.last_revision}, ${state.last_kind}, ${state.last_id})
            AND (projection.revision, projection.kind, projection.record_id) <= (${last.revision}, ${last.kind}, ${last.record_id})
            AND NOT EXISTS (SELECT 1 FROM knowledge_record_fts existing WHERE existing.rowid = search_key.search_id)
          ORDER BY projection.revision, projection.kind, projection.record_id`;
          yield* sql`UPDATE knowledge_search_state SET last_revision = ${last.revision}, last_kind = ${last.kind}, last_id = ${last.record_id} WHERE singleton = 1`;
          return false;
        }),
      )
      .pipe(Effect.mapError(asStoreError("backfill search index")));
  }
});

export const validateStoreSchema = Effect.fn("validateStoreSchema")(function* (
  sql: SqlClient.SqlClient,
  allowEmpty: boolean,
) {
  const version = (yield* sql<{ user_version: number }>`PRAGMA user_version`)[0]?.user_version ?? 0;
  const owner =
    (yield* sql<{ application_id: number }>`PRAGMA application_id`)[0]?.application_id ?? 0;
  if (version === 0 && owner === 0 && allowEmpty) {
    const tables = yield* sql<{
      name: string;
    }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1`;
    if (tables.length === 0) return false;
  }
  if (version !== KNOWLEDGE_STORE_VERSION) {
    return yield* new KnowledgeStoreError({
      code: "unsupported-version",
      detail: `Knowledge store schema ${version} is unsupported; this build supports schema ${KNOWLEDGE_STORE_VERSION}. Existing knowledge was preserved.`,
    });
  }
  if (owner !== KNOWLEDGE_STORE_APPLICATION_ID) {
    return yield* new KnowledgeStoreError({
      code: "unowned-store",
      detail:
        "The knowledge database is not owned by Project Indexing. Existing files were preserved.",
    });
  }
  return true;
});

export const initializeStoreSchema = Effect.fn("initializeStoreSchema")(function* (
  sql: SqlClient.SqlClient,
  workspaceId: string,
  settingsJson: string,
  now: number,
) {
  yield* sql.withTransaction(
    Effect.gen(function* () {
      for (const statement of TABLES) yield* sql.unsafe(statement);
      yield* sql.unsafe(`PRAGMA application_id = ${KNOWLEDGE_STORE_APPLICATION_ID}`);
      yield* sql.unsafe(`PRAGMA user_version = ${KNOWLEDGE_STORE_VERSION}`);
      yield* sql`INSERT OR IGNORE INTO knowledge_state(singleton, workspace_id, settings_json, updated_at) VALUES (1, ${workspaceId}, ${settingsJson}, ${now})`;
    }),
  );
});
