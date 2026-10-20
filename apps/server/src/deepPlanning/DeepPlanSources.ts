// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  DEEP_PLAN_MAX_CHUNK_RECORDS,
  DEEP_PLAN_MAX_PAGE_SIZE,
  DEEP_PLAN_MAX_RECORD_BYTES,
  DeepPlanExportId,
  DeepPlanSourceCatalogEntry,
  DeepPlanSourceCoverage,
  DeepPlanSourceError,
  DeepPlanSourceId,
  DeepPlanSourceRecord,
  DeepPlanSourceRecordOrigin,
  DeepPlanSourceSnapshot,
  DeepPlanSourceSummary,
  IsoDateTime,
  ProjectId,
  ThreadForkState,
  ThreadId,
  type DeepPlanExportSourcesInput,
  type DeepPlanCatalogSourcesInput,
  type DeepPlanCatalogSourcesResult,
  type DeepPlanExportSourcesResult,
  type DeepPlanImportSourceChunkInput,
  type DeepPlanImportSourceChunkResult,
  type DeepPlanInitializeSourcesInput,
  type DeepPlanListSourcesInput,
  type DeepPlanListSourcesResult,
  type DeepPlanReadExportChunkInput,
  type DeepPlanReadExportChunkResult,
  type DeepPlanReadSourceChunkInput,
  type DeepPlanReadSourceChunkResult,
  type DeepPlanRunId,
  type DeepPlanSummarizeSourceInput,
  type DeepPlanDocument,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { SOURCE_EXPORT_BATCH_BYTES, SourceExportEntry } from "./DeepPlanSourceExport.ts";
import { captureSourceExportInWorker } from "./DeepPlanSourceWorkerClient.ts";
import {
  canonicalSourceJson,
  sourceChunkHash,
  sourceContentHash,
  sourceManifestHasher,
  sourceOriginKey,
  sourceRecordContentHash,
  sourceRecordId,
} from "./DeepPlanSourceContent.ts";

type SourceEffect<A> = Effect.Effect<A, DeepPlanSourceError>;
type SourceChunk = DeepPlanReadExportChunkResult;

export interface DeepPlanSourcesShape {
  readonly catalogSources: (
    input: DeepPlanCatalogSourcesInput,
  ) => SourceEffect<DeepPlanCatalogSourcesResult>;
  readonly exportSources: (
    input: DeepPlanExportSourcesInput,
  ) => SourceEffect<DeepPlanExportSourcesResult>;
  readonly readExportChunk: (input: DeepPlanReadExportChunkInput) => SourceEffect<SourceChunk>;
  readonly initializeSources: (
    input: DeepPlanInitializeSourcesInput,
  ) => SourceEffect<DeepPlanListSourcesResult>;
  readonly importSourceChunk: (
    input: DeepPlanImportSourceChunkInput,
  ) => SourceEffect<DeepPlanImportSourceChunkResult>;
  readonly listSources: (
    input: DeepPlanListSourcesInput,
  ) => SourceEffect<DeepPlanListSourcesResult>;
  readonly readSourceChunk: (
    input: DeepPlanReadSourceChunkInput,
  ) => SourceEffect<DeepPlanReadSourceChunkResult>;
  readonly summarizeSource: (
    input: DeepPlanSummarizeSourceInput,
  ) => SourceEffect<DeepPlanSourceCoverage>;
  readonly assertCompleteCoverage: (
    runId: DeepPlanRunId,
  ) => SourceEffect<DeepPlanListSourcesResult>;
  readonly validatePlanCitations: (
    runId: DeepPlanRunId,
    plan: DeepPlanDocument,
  ) => SourceEffect<void>;
}

export class DeepPlanSources extends Context.Service<DeepPlanSources, DeepPlanSourcesShape>()(
  "t3/deepPlanning/DeepPlanSources",
) {}

const QUERY_PAGE_SIZE = 128;
const EXPORT_RECORD_BATCH_SIZE = 128;
const DEFAULT_CATALOG_PAGE_SIZE = 50;
const DEFAULT_RECORD_PAGE_SIZE = 25;
const RECORD_PAGE_BYTES = 256 * 1024;
const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  scope: Schema.String,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  anchor: Schema.optional(Schema.String),
  endOffset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
const CursorJson = Schema.fromJsonString(Cursor);
const decodeCursorJson = Schema.decodeUnknownEffect(CursorJson);
const encodeCursorJson = Schema.encodeSync(CursorJson);
const SnapshotJson = Schema.fromJsonString(DeepPlanSourceSnapshot);
const RecordJson = Schema.fromJsonString(DeepPlanSourceRecord);
const SummaryJson = Schema.fromJsonString(DeepPlanSourceSummary);
const ThreadRow = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  archivedAt: Schema.NullOr(IsoDateTime),
  fork: Schema.NullOr(Schema.fromJsonString(ThreadForkState)),
  forkProjectId: Schema.optional(Schema.NullOr(ProjectId)),
});
const RunSourceRow = Schema.Struct({
  snapshot: SnapshotJson,
  importedRecordCount: Schema.Number,
  nextChunkIndex: Schema.Number,
  complete: Schema.Number,
  readRecordCount: Schema.Number,
  status: DeepPlanSourceCoverage.fields.status,
  summary: Schema.NullOr(SummaryJson),
  error: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
type RunSourceRow = typeof RunSourceRow.Type;
const decodeSnapshotJson = Schema.decodeEffect(SnapshotJson);
const decodeSourceExportEntry = Schema.decodeEffect(Schema.fromJsonString(SourceExportEntry));
const decodeRecordJson = Schema.decodeEffect(RecordJson);
const decodeRecordOriginJson = Schema.decodeEffect(
  Schema.fromJsonString(DeepPlanSourceRecordOrigin),
);
const decodeRunSourceRows = Schema.decodeUnknownEffect(Schema.Array(RunSourceRow));
const decodeCatalogRows = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      ...ThreadRow.fields,
      updatedAt: IsoDateTime,
      messageCount: Schema.Number,
      activityCount: Schema.Number,
    }),
  ),
);
const isSourceError = Schema.is(DeepPlanSourceError);

function coverageFromRow(row: RunSourceRow): DeepPlanSourceCoverage {
  return {
    sourceId: row.snapshot.sourceId,
    status: row.status,
    importedRecordCount: row.importedRecordCount,
    readRecordCount: row.readRecordCount,
    summary: row.summary,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}

function sourceError(
  code: DeepPlanSourceError["code"],
  message: string,
  sourceId?: DeepPlanSourceId,
) {
  return new DeepPlanSourceError({
    code,
    message,
    ...(sourceId === undefined ? {} : { sourceId }),
  });
}

function storageError(cause: unknown): DeepPlanSourceError {
  return isSourceError(cause)
    ? cause
    : sourceError("storage-failed", "Deep Planning source storage failed.");
}

function pageLimit(value: number | undefined, maximum: number, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.min(maximum, Math.floor(value)));
}

function encodeCursor(scope: string, offset: number, endOffset?: number): string {
  return Buffer.from(
    encodeCursorJson({
      version: 1,
      scope,
      offset,
      ...(endOffset === undefined ? {} : { endOffset }),
    }),
  ).toString("base64url");
}

const decodeCursor = Effect.fnUntraced(function* (encoded: string | undefined, scope: string) {
  if (encoded === undefined) return { offset: 0, endOffset: undefined };
  const cursor = yield* decodeCursorJson(Buffer.from(encoded, "base64url").toString("utf8")).pipe(
    Effect.mapError(() => sourceError("invalid-chunk", "The source cursor is invalid.")),
  );
  if (cursor.scope !== scope) {
    return yield* sourceError("invalid-chunk", "The source cursor belongs to another snapshot.");
  }
  return cursor;
});

const sourceContentRow = Effect.fnUntraced(function* (
  sourceId: DeepPlanSourceId,
  record: DeepPlanSourceRecord,
) {
  const recordJson = canonicalSourceJson(record);
  const recordBytes = Buffer.byteLength(recordJson);
  if (recordBytes > DEEP_PLAN_MAX_RECORD_BYTES)
    return yield* sourceError(
      "invalid-chunk",
      "Source records must use content chunks for large bodies.",
      sourceId,
    );
  const body = record.kind === "attachment" || record.kind === "content";
  return {
    record_id: record.recordId,
    origin_key: sourceOriginKey(record.origin),
    content_hash: record.contentHash,
    record_json: recordJson,
    record_bytes: recordBytes,
    record_kind: record.kind,
    required_analysis:
      record.kind === "attachment" || (record.kind === "content" && !record.requiredForAnalysis)
        ? 0
        : 1,
    content_id:
      record.kind === "attachment"
        ? record.attachmentId
        : record.kind === "content"
          ? record.contentId
          : null,
    chunk_index: body ? record.chunkIndex : null,
    total_chunks: body ? record.totalChunks : null,
    body_bytes:
      record.kind === "attachment"
        ? Buffer.byteLength(record.dataBase64, "base64")
        : record.kind === "content"
          ? Buffer.byteLength(record.data)
          : 0,
  };
});

export const makeDeepPlanSources = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const serverConfig = yield* ServerConfig;
  const environment = yield* ServerEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exportLock = yield* Semaphore.make(1);
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const persistRecord = Effect.fnUntraced(function* (
    sourceId: DeepPlanSourceId,
    ordinal: number,
    record: DeepPlanSourceRecord,
  ) {
    const content = yield* sourceContentRow(sourceId, record);
    yield* sql`INSERT OR IGNORE INTO deep_plan_source_contents ${sql.insert(content)}`;
    const existing = yield* sql<{ readonly recordId: string }>`
      SELECT record_id AS "recordId" FROM deep_plan_source_records
      WHERE source_id = ${sourceId} AND ordinal = ${ordinal}
    `;
    if (existing[0] !== undefined && existing[0].recordId !== record.recordId) {
      return yield* sourceError(
        "content-mismatch",
        "A frozen source record cannot be replaced.",
        sourceId,
      );
    }
    yield* sql`
      INSERT OR IGNORE INTO deep_plan_source_records (source_id, ordinal, record_id)
      VALUES (${sourceId}, ${ordinal}, ${record.recordId})
    `;
  });

  const persistExportRecords = Effect.fnUntraced(function* (
    sourceId: DeepPlanSourceId,
    offset: number,
    records: ReadonlyArray<DeepPlanSourceRecord>,
  ) {
    if (records.length === 0) return;
    const uniqueRecords = new Map(records.map((record) => [record.recordId, record]));
    const stored = yield* sql<{ readonly recordId: string }>`
      SELECT record_id AS "recordId" FROM deep_plan_source_contents
      WHERE ${sql.in("record_id", [...uniqueRecords.keys()])}
    `;
    for (const row of stored) uniqueRecords.delete(row.recordId);
    const contents = yield* Effect.forEach(uniqueRecords.values(), (record) =>
      sourceContentRow(sourceId, record),
    );
    if (contents.length > 0)
      yield* sql`INSERT OR IGNORE INTO deep_plan_source_contents ${sql.insert(contents)}`;
    yield* sql`
      INSERT INTO deep_plan_source_records ${sql.insert(
        records.map((record, index) => ({
          source_id: sourceId,
          ordinal: offset + index,
          record_id: record.recordId,
        })),
      )}
    `;
  });

  const getSnapshot = Effect.fnUntraced(function* (sourceId: DeepPlanSourceId) {
    const rows = yield* sql<{ readonly snapshot: string; readonly complete: number }>`
      SELECT snapshot_json AS snapshot, complete FROM deep_plan_sources WHERE source_id = ${sourceId}
    `;
    if (rows[0] === undefined)
      return yield* sourceError("source-not-found", "The frozen source was not found.", sourceId);
    return {
      snapshot: yield* decodeSnapshotJson(rows[0].snapshot),
      complete: rows[0].complete === 1,
    };
  });

  const ensureRun = Effect.fnUntraced(function* (input: DeepPlanListSourcesInput) {
    const rows = yield* sql<{ readonly threadId: string }>`
      SELECT thread_id AS "threadId" FROM deep_plan_source_runs WHERE run_id = ${input.runId}
    `;
    if (rows[0]?.threadId !== input.threadId) {
      return yield* sourceError(
        "run-not-found",
        "The source collection does not belong to this run.",
      );
    }
  });

  const getRunSource = Effect.fnUntraced(function* (
    runId: DeepPlanRunId,
    sourceId: DeepPlanSourceId,
  ) {
    const rows = yield* sql`
      SELECT s.snapshot_json AS snapshot, r.imported_record_count AS "importedRecordCount",
        r.next_chunk_index AS "nextChunkIndex", r.complete, r.read_record_count AS "readRecordCount",
        r.status, r.summary_json AS summary, r.error, r.updated_at AS "updatedAt"
      FROM deep_plan_run_sources r JOIN deep_plan_sources s ON s.source_id = r.source_id
      WHERE r.run_id = ${runId} AND r.source_id = ${sourceId}
    `;
    const decoded = yield* decodeRunSourceRows(rows);
    if (decoded[0] === undefined) {
      return yield* sourceError(
        "source-not-found",
        "The source is not selected for this run.",
        sourceId,
      );
    }
    return decoded[0];
  });

  const loadRunSources = Effect.fnUntraced(function* (runId: DeepPlanRunId) {
    const rows = yield* sql`
      SELECT s.snapshot_json AS snapshot, r.imported_record_count AS "importedRecordCount",
        r.next_chunk_index AS "nextChunkIndex", r.complete, r.read_record_count AS "readRecordCount",
        r.status, r.summary_json AS summary, r.error, r.updated_at AS "updatedAt"
      FROM deep_plan_run_sources r JOIN deep_plan_sources s ON s.source_id = r.source_id
      WHERE r.run_id = ${runId} ORDER BY r.source_ordinal
    `;
    const decoded = yield* decodeRunSourceRows(rows);
    return {
      runId,
      sources: decoded.map((row) => row.snapshot),
      coverage: decoded.map(coverageFromRow),
    };
  });

  const readRecords = Effect.fnUntraced(function* (input: {
    readonly snapshot: DeepPlanSourceSnapshot;
    readonly scope: string;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  }) {
    const cursor = yield* decodeCursor(input.cursor, input.scope);
    const { offset, endOffset = input.snapshot.recordCount } = cursor;
    if (offset > endOffset || endOffset > input.snapshot.recordCount) {
      return yield* sourceError(
        "invalid-chunk",
        "The source cursor is past the end of the snapshot.",
        input.snapshot.sourceId,
      );
    }
    const rows = yield* sql<{ readonly record: string }>`
      WITH candidates AS (
        SELECT r.ordinal, c.record_id, c.record_bytes
        FROM deep_plan_source_records r JOIN deep_plan_source_contents c ON c.record_id = r.record_id
        WHERE r.source_id = ${input.snapshot.sourceId} AND r.ordinal >= ${offset} AND r.ordinal < ${endOffset}
        ORDER BY r.ordinal
        LIMIT ${pageLimit(input.limit, DEEP_PLAN_MAX_CHUNK_RECORDS, DEFAULT_RECORD_PAGE_SIZE)}
      ), page AS (
        SELECT ordinal, record_id, SUM(record_bytes) OVER (ORDER BY ordinal) AS cumulative_bytes
        FROM candidates
      )
      SELECT c.record_json AS record FROM page p
      JOIN deep_plan_source_contents c ON c.record_id = p.record_id
      WHERE p.cumulative_bytes <= ${RECORD_PAGE_BYTES} ORDER BY p.ordinal
    `;
    const selected: string[] = [];
    let bytes = 0;
    for (const row of rows) {
      const recordBytes = Buffer.byteLength(row.record);
      if (selected.length > 0 && bytes + recordBytes > RECORD_PAGE_BYTES) break;
      selected.push(row.record);
      bytes += recordBytes;
    }
    const records = yield* Effect.forEach(selected, (value) => decodeRecordJson(value));
    const nextOffset = offset + records.length;
    if (nextOffset < endOffset && records.length === 0) {
      return yield* sourceError(
        "incomplete-source",
        "The frozen source is missing records.",
        input.snapshot.sourceId,
      );
    }
    return {
      offset,
      nextOffset,
      chunk: {
        snapshot: input.snapshot,
        records,
        chunkHash: sourceChunkHash(records),
        nextCursor:
          nextOffset < endOffset ? encodeCursor(input.scope, nextOffset, cursor.endOffset) : null,
      } satisfies SourceChunk,
    };
  });

  const readAnalysisRecords = Effect.fnUntraced(function* (input: {
    readonly snapshot: DeepPlanSourceSnapshot;
    readonly scope: string;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  }) {
    const { offset, endOffset } = yield* decodeCursor(input.cursor, input.scope);
    if (endOffset !== undefined)
      return yield* sourceError(
        "invalid-chunk",
        "Read content references with includeBodies=true.",
        input.snapshot.sourceId,
      );
    if (offset > input.snapshot.recordCount)
      return yield* sourceError(
        "invalid-chunk",
        "The source cursor is past the end of the snapshot.",
        input.snapshot.sourceId,
      );
    const rows = yield* sql<{
      readonly ordinal: number;
      readonly record: string | null;
      readonly recordId: string;
      readonly origin: string;
      readonly contentHash: string;
      readonly kind: "attachment" | "content";
      readonly contentId: string;
      readonly totalChunks: number;
      readonly bodyBytes: number;
    }>`
      WITH candidates AS (
        SELECT r.ordinal, c.record_id,
          CASE WHEN c.required_analysis = 1 THEN c.record_bytes ELSE 1024 END AS page_bytes
        FROM deep_plan_source_records r JOIN deep_plan_source_contents c ON c.record_id = r.record_id
        WHERE r.source_id = ${input.snapshot.sourceId} AND r.ordinal >= ${offset}
          AND (c.required_analysis = 1 OR c.chunk_index = 0)
        ORDER BY r.ordinal LIMIT ${pageLimit(input.limit, DEEP_PLAN_MAX_CHUNK_RECORDS, DEFAULT_RECORD_PAGE_SIZE)}
      ), page AS (
        SELECT ordinal, record_id, SUM(page_bytes) OVER (ORDER BY ordinal) AS cumulative_bytes
        FROM candidates
      )
      SELECT p.ordinal, CASE WHEN c.required_analysis = 1 THEN c.record_json ELSE NULL END AS record,
        c.record_id AS "recordId", c.origin_key AS origin, c.content_hash AS "contentHash", c.record_kind AS kind,
        c.content_id AS "contentId", c.total_chunks AS "totalChunks",
        (SELECT SUM(b.body_bytes) FROM deep_plan_source_records r JOIN deep_plan_source_contents b ON b.record_id = r.record_id
          WHERE r.source_id = ${input.snapshot.sourceId} AND r.ordinal >= p.ordinal AND r.ordinal < p.ordinal + c.total_chunks) AS "bodyBytes"
      FROM page p JOIN deep_plan_source_contents c ON c.record_id = p.record_id
      WHERE p.cumulative_bytes <= ${RECORD_PAGE_BYTES} ORDER BY p.ordinal
    `;
    const records: Array<DeepPlanReadSourceChunkResult["records"][number]> = [];
    let nextOffset = offset;
    for (const row of rows) {
      if (row.record !== null) {
        records.push(yield* decodeRecordJson(row.record));
        nextOffset = row.ordinal + 1;
      } else {
        records.push({
          kind: "content-reference",
          recordId: row.recordId,
          origin: yield* decodeRecordOriginJson(row.origin),
          contentHash: row.contentHash,
          contentKind: row.kind,
          contentId: row.contentId,
          chunkIndex: 0,
          totalChunks: row.totalChunks,
          byteLength: row.bodyBytes,
          cursor: encodeCursor(input.scope, row.ordinal, row.ordinal + row.totalChunks),
        });
        nextOffset = row.ordinal + row.totalChunks;
      }
    }
    if (nextOffset < input.snapshot.recordCount && records.length === 0)
      return yield* sourceError(
        "incomplete-source",
        "The frozen source is missing records.",
        input.snapshot.sourceId,
      );
    return {
      offset,
      nextOffset,
      chunk: {
        snapshot: input.snapshot,
        records,
        chunkHash: sourceChunkHash(records),
        nextCursor:
          nextOffset < input.snapshot.recordCount ? encodeCursor(input.scope, nextOffset) : null,
      },
    };
  });

  const catalogSources = Effect.fn("DeepPlanSources.catalogSources")(function* (
    input: DeepPlanCatalogSourcesInput,
  ) {
    const descriptor = yield* environment.getDescriptor;
    const project = yield* sql<{ readonly title: string }>`
      SELECT title FROM projection_projects WHERE project_id = ${input.projectId} AND deleted_at IS NULL
    `;
    if (project[0] === undefined)
      return yield* sourceError("source-not-found", "The source project was not found.");
    const scope = `catalog-live:${input.projectId}:${sourceContentHash([input.threadIds, input.includeArchived])}`;
    let afterThreadId = "";
    if (input.cursor !== undefined) {
      const cursor = yield* decodeCursorJson(
        Buffer.from(input.cursor, "base64url").toString("utf8"),
      ).pipe(
        Effect.mapError(() =>
          sourceError("invalid-chunk", "The source catalog cursor is invalid."),
        ),
      );
      if (cursor.scope !== scope || cursor.anchor === undefined)
        return yield* sourceError(
          "invalid-chunk",
          "The catalog cursor belongs to another project or selection.",
        );
      afterThreadId = cursor.anchor;
    }
    const limit = pageLimit(input.limit, DEEP_PLAN_MAX_PAGE_SIZE, DEFAULT_CATALOG_PAGE_SIZE);
    const rows = yield* sql`
      SELECT t.thread_id AS "threadId", t.title, t.archived_at AS "archivedAt", t.fork_json AS fork,
        (SELECT project_id FROM projection_threads WHERE thread_id = json_extract(t.fork_json, '$.provenance.sourceThreadId')) AS "forkProjectId",
        t.updated_at AS "updatedAt",
        ((SELECT COUNT(*) FROM projection_thread_messages m WHERE m.thread_id = t.thread_id AND m.is_streaming = 0)
          + (SELECT COUNT(*) FROM projection_thread_subagent_messages m WHERE m.thread_id = t.thread_id AND m.is_streaming = 0)) AS "messageCount",
        ((SELECT COUNT(*) FROM projection_thread_activities a WHERE a.thread_id = t.thread_id)
          + (SELECT COUNT(*) FROM projection_thread_subagent_activities a WHERE a.thread_id = t.thread_id)) AS "activityCount"
      FROM projection_threads t
      WHERE t.project_id = ${input.projectId} AND t.deleted_at IS NULL AND t.thread_id > ${afterThreadId}
        AND (${input.includeArchived !== false ? 1 : 0} = 1 OR t.archived_at IS NULL)
        AND ${input.threadIds === undefined ? sql`1 = 1` : sql.in("thread_id", input.threadIds)}
      ORDER BY t.thread_id LIMIT ${limit + 1}
    `;
    const decoded = yield* decodeCatalogRows(rows);
    const selected = decoded.slice(0, limit);
    const sources: DeepPlanSourceCatalogEntry[] = selected.map((row) => ({
      origin: {
        environmentId: descriptor.environmentId,
        projectId: input.projectId,
        threadId: row.threadId,
      },
      projectTitle: project[0]!.title,
      threadTitle: row.title,
      archived: row.archivedAt !== null,
      messageCount: row.messageCount,
      activityCount: row.activityCount,
      updatedAt: row.updatedAt,
      forkOrigin:
        row.fork === null
          ? null
          : {
              environmentId: descriptor.environmentId,
              projectId: row.forkProjectId ?? input.projectId,
              threadId: row.fork.provenance.sourceThreadId,
            },
    }));
    return {
      sources,
      nextCursor:
        decoded.length > limit
          ? Buffer.from(
              encodeCursorJson({ version: 1, scope, offset: 0, anchor: selected.at(-1)!.threadId }),
            ).toString("base64url")
          : null,
    };
  }, Effect.mapError(storageError));

  const exportSources = Effect.fn("DeepPlanSources.exportSources")(
    function* (input: DeepPlanExportSourcesInput) {
      let exportId = input.exportId;
      if (exportId === undefined && input.cursor !== undefined) {
        return yield* sourceError(
          "invalid-chunk",
          "Catalog pagination requires the frozen export ID.",
        );
      }
      if (exportId === undefined) {
        exportId = DeepPlanExportId.make(NodeCrypto.randomUUID());
        const capturedAt = yield* nowIso;
        const descriptor = yield* environment.getDescriptor;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-deep-plan-export-" });
        const outputPath = path.join(directory, "records.ndjson");
        const result = yield* captureSourceExportInWorker({
          dbPath: serverConfig.dbPath,
          outputPath,
          attachmentsDir: serverConfig.attachmentsDir,
          exportId,
          capturedAt,
          environmentId: descriptor.environmentId,
          environmentLabel: descriptor.label,
          input,
        });
        const snapshots: DeepPlanSourceSnapshot[] = [];
        const importedSources = new Set<DeepPlanSourceId>();
        let sourceId: DeepPlanSourceId | undefined;
        let ordinal = 0;
        let pendingRecords: DeepPlanSourceRecord[] = [];
        let pendingBytes = 0;
        let published = false;
        // The worker owns the read snapshot; only bounded imports reserve this connection.
        const flush = Effect.fnUntraced(function* () {
          if (sourceId === undefined || pendingRecords.length === 0) return;
          importedSources.add(sourceId);
          yield* persistExportRecords(sourceId, ordinal, pendingRecords).pipe(sql.withTransaction);
          ordinal += pendingRecords.length;
          pendingRecords = [];
          pendingBytes = 0;
          yield* Effect.yieldNow;
        });
        const cleanup = Effect.gen(function* () {
          for (const importedSource of importedSources) {
            while (true) {
              const rows = yield* sql<{ readonly ordinal: number; readonly recordId: string }>`
                SELECT ordinal, record_id AS "recordId" FROM deep_plan_source_records
                WHERE source_id = ${importedSource} ORDER BY ordinal LIMIT ${EXPORT_RECORD_BATCH_SIZE}
              `;
              if (rows.length === 0) break;
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM deep_plan_source_records
                  WHERE source_id = ${importedSource} AND ${sql.in(
                    "ordinal",
                    rows.map((row) => row.ordinal),
                  )}`;
                  yield* sql`DELETE FROM deep_plan_source_contents
                  WHERE ${sql.in(
                    "record_id",
                    rows.map((row) => row.recordId),
                  )}
                    AND NOT EXISTS (SELECT 1 FROM deep_plan_source_records r
                      WHERE r.record_id = deep_plan_source_contents.record_id)`;
                }),
              );
              yield* Effect.yieldNow;
            }
          }
        });
        yield* Effect.gen(function* () {
          yield* fs.stream(outputPath).pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.filter((line) => line.length > 0),
            Stream.runForEach(
              Effect.fnUntraced(function* (line) {
                const entry = yield* decodeSourceExportEntry(line);
                if (entry.type === "snapshot") {
                  yield* flush();
                  if (
                    ordinal !== entry.snapshot.recordCount ||
                    (sourceId !== undefined && sourceId !== entry.snapshot.sourceId)
                  )
                    return yield* sourceError(
                      "incomplete-source",
                      "The frozen source is missing records.",
                      entry.snapshot.sourceId,
                    );
                  snapshots.push(entry.snapshot);
                  sourceId = undefined;
                  ordinal = 0;
                  return;
                }
                if (sourceId !== undefined && sourceId !== entry.sourceId)
                  return yield* sourceError(
                    "content-mismatch",
                    "The frozen source records are out of order.",
                  );
                sourceId = entry.sourceId;
                const bytes = Buffer.byteLength(line);
                if (pendingBytes + bytes > SOURCE_EXPORT_BATCH_BYTES) yield* flush();
                pendingRecords.push(entry.record);
                pendingBytes += bytes;
                if (pendingRecords.length >= EXPORT_RECORD_BATCH_SIZE) yield* flush();
              }),
            ),
          );
          if (sourceId !== undefined)
            return yield* sourceError(
              "incomplete-source",
              "The frozen source has no completed snapshot.",
            );
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* sql`
              INSERT INTO deep_plan_source_exports (export_id, project_id, captured_at, selection_json, complete_project)
              VALUES (${exportId}, ${input.projectId}, ${capturedAt}, ${canonicalSourceJson({ threadIds: input.threadIds, includeArchived: input.includeArchived })}, ${result.completeProject ? 1 : 0})
            `;
                for (let offset = 0; offset < snapshots.length; offset += QUERY_PAGE_SIZE) {
                  yield* sql`INSERT INTO deep_plan_sources ${sql.insert(
                    snapshots.slice(offset, offset + QUERY_PAGE_SIZE).map((snapshot, index) => ({
                      source_id: snapshot.sourceId,
                      export_id: exportId,
                      source_ordinal: offset + index,
                      snapshot_json: canonicalSourceJson(snapshot),
                      complete: 1,
                    })),
                  )}`;
                }
              }),
            )
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  published = true;
                }),
              ),
              Effect.uninterruptible,
            );
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) && !published
              ? cleanup.pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Could not clean up an incomplete source export", { cause }),
                  ),
                )
              : Effect.void,
          ),
        );
      }
      const exports = yield* sql<{ readonly projectId: string; readonly capturedAt: string }>`
      SELECT project_id AS "projectId", captured_at AS "capturedAt" FROM deep_plan_source_exports WHERE export_id = ${exportId}
    `;
      if (exports[0]?.projectId !== input.projectId)
        return yield* sourceError(
          "export-not-found",
          "The frozen export was not found for this project.",
        );
      const { offset } = yield* decodeCursor(input.cursor, `catalog:${exportId}`);
      const limit = pageLimit(input.limit, DEEP_PLAN_MAX_PAGE_SIZE, DEFAULT_CATALOG_PAGE_SIZE);
      const rows = yield* sql<{ readonly snapshot: string }>`
      SELECT snapshot_json AS snapshot FROM deep_plan_sources
      WHERE export_id = ${exportId} AND source_ordinal >= ${offset}
      ORDER BY source_ordinal LIMIT ${limit + 1}
    `;
      const sources = yield* Effect.forEach(rows.slice(0, limit), (row) =>
        decodeSnapshotJson(row.snapshot),
      );
      return {
        exportId,
        capturedAt: exports[0]!.capturedAt,
        sources,
        nextCursor:
          rows.length > limit ? encodeCursor(`catalog:${exportId}`, offset + sources.length) : null,
      };
    },
    Effect.scoped,
    exportLock.withPermits(1),
    Effect.mapError(storageError),
  );

  const readExportChunk = Effect.fn("DeepPlanSources.readExportChunk")(function* (
    input: DeepPlanReadExportChunkInput,
  ) {
    const owners = yield* sql<{ readonly exportId: string | null }>`
      SELECT export_id AS "exportId" FROM deep_plan_sources WHERE source_id = ${input.sourceId}
    `;
    if (owners[0]?.exportId !== input.exportId)
      return yield* sourceError(
        "export-not-found",
        "The source does not belong to this frozen export.",
        input.sourceId,
      );
    const { snapshot, complete } = yield* getSnapshot(input.sourceId);
    if (!complete)
      return yield* sourceError(
        "incomplete-source",
        "The source export is incomplete.",
        input.sourceId,
      );
    return (yield* readRecords({
      snapshot,
      scope: `export:${input.exportId}:${input.sourceId}`,
      ...input,
    })).chunk;
  }, Effect.mapError(storageError));

  const listSources = Effect.fn("DeepPlanSources.listSources")(function* (
    input: DeepPlanListSourcesInput,
  ) {
    yield* ensureRun(input);
    return yield* loadRunSources(input.runId);
  }, Effect.mapError(storageError));

  const initializeSources = Effect.fn("DeepPlanSources.initializeSources")(
    function* (input: DeepPlanInitializeSourcesInput) {
      const previous = yield* sql<{ readonly threadId: string }>`
      SELECT thread_id AS "threadId" FROM deep_plan_source_runs WHERE run_id = ${input.runId}
    `;
      if (previous[0] !== undefined) {
        yield* ensureRun(input);
        const current = yield* loadRunSources(input.runId);
        if (canonicalSourceJson(current.sources) !== canonicalSourceJson(input.snapshots)) {
          return yield* sourceError(
            "content-mismatch",
            "The selected sources for a run are immutable.",
          );
        }
        return current;
      }
      if (
        new Set(input.snapshots.map((snapshot) => snapshot.sourceId)).size !==
        input.snapshots.length
      ) {
        return yield* sourceError(
          "content-mismatch",
          "A source may only be selected once for a run.",
        );
      }
      const owner = yield* sql<{ readonly projectId: ProjectId }>`
        SELECT project_id AS "projectId" FROM projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL
      `;
      if (owner[0] === undefined)
        return yield* sourceError(
          "run-not-found",
          "The source collection requires a retained owner thread.",
        );
      const localEnvironmentId = yield* environment.getEnvironmentId;
      const localSnapshots = input.snapshots.filter(
        (snapshot) =>
          snapshot.origin.environmentId === localEnvironmentId &&
          snapshot.origin.projectId === owner[0]!.projectId,
      );
      let localExportId = input.localExportId;
      if (localExportId === undefined && localSnapshots[0] !== undefined) {
        const stored = yield* sql<{ readonly exportId: DeepPlanExportId | null }>`
          SELECT export_id AS "exportId" FROM deep_plan_sources WHERE source_id = ${localSnapshots[0].sourceId}
        `;
        localExportId = stored[0]?.exportId ?? undefined;
      }
      const localExport = yield* sql<{
        readonly projectId: ProjectId;
        readonly completeProject: number;
      }>`
        SELECT project_id AS "projectId", complete_project AS "completeProject" FROM deep_plan_source_exports
        WHERE export_id = ${localExportId ?? null}
      `;
      if (
        localExport[0]?.projectId !== owner[0].projectId ||
        localExport[0].completeProject !== 1
      ) {
        return yield* sourceError(
          "incomplete-source",
          "Freeze every retained chat in the current project, including archived chats, before starting the plan.",
        );
      }
      const mandatorySources = yield* sql<{ readonly sourceId: DeepPlanSourceId }>`
        SELECT source_id AS "sourceId" FROM deep_plan_sources WHERE export_id = ${localExportId!} ORDER BY source_ordinal
      `;
      const mandatoryIds = new Set(mandatorySources.map((source) => source.sourceId));
      if (
        mandatorySources.length !== localSnapshots.length ||
        localSnapshots.some((snapshot) => !mandatoryIds.has(snapshot.sourceId))
      ) {
        return yield* sourceError(
          "incomplete-source",
          "Every chat from the frozen current-project export must be included in the plan.",
        );
      }
      const now = yield* nowIso;
      yield* sql`INSERT INTO deep_plan_source_runs (run_id, thread_id, initialized_at) VALUES (${input.runId}, ${input.threadId}, ${now})`;
      for (let ordinal = 0; ordinal < input.snapshots.length; ordinal += 1) {
        const snapshot = input.snapshots[ordinal]!;
        const existing = yield* sql<{ readonly snapshot: string; readonly complete: number }>`
        SELECT snapshot_json AS snapshot, complete FROM deep_plan_sources WHERE source_id = ${snapshot.sourceId}
      `;
        if (
          existing[0] !== undefined &&
          canonicalSourceJson(yield* decodeSnapshotJson(existing[0].snapshot)) !==
            canonicalSourceJson(snapshot)
        ) {
          return yield* sourceError(
            "content-mismatch",
            "The source ID already describes different frozen content.",
            snapshot.sourceId,
          );
        }
        yield* sql`
        INSERT OR IGNORE INTO deep_plan_sources (source_id, snapshot_json, complete)
        VALUES (${snapshot.sourceId}, ${canonicalSourceJson(snapshot)}, 0)
      `;
        const complete = existing[0]?.complete === 1;
        yield* sql`
        INSERT INTO deep_plan_run_sources (run_id, source_id, source_ordinal, imported_record_count, complete, status, updated_at)
        VALUES (${input.runId}, ${snapshot.sourceId}, ${ordinal}, ${complete ? snapshot.recordCount : 0}, ${complete ? 1 : 0}, ${complete ? "ready" : "pending"}, ${now})
      `;
      }
      return yield* loadRunSources(input.runId);
    },
    sql.withTransaction,
    Effect.mapError(storageError),
  );

  const validateManifest = Effect.fnUntraced(function* (snapshot: DeepPlanSourceSnapshot) {
    const manifest = sourceManifestHasher();
    let ordinal = 0;
    let messageCount = 0;
    let activityCount = 0;
    const attachments = new Map<
      string,
      { nextChunk: number; totalChunks: number; lastOrdinal: number }
    >();
    const contents = new Map<
      string,
      { nextChunk: number; totalChunks: number; lastOrdinal: number; requiredForAnalysis: boolean }
    >();
    const messageContentRefs = new Set<string>();
    while (true) {
      const rows = yield* sql<{ readonly ordinal: number; readonly record: string }>`
        SELECT r.ordinal, c.record_json AS record
        FROM deep_plan_source_records r JOIN deep_plan_source_contents c ON c.record_id = r.record_id
        WHERE r.source_id = ${snapshot.sourceId} AND r.ordinal >= ${ordinal}
        ORDER BY r.ordinal LIMIT ${QUERY_PAGE_SIZE}
      `;
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.ordinal !== ordinal)
          return yield* sourceError(
            "incomplete-source",
            "The imported source has a gap in its history.",
            snapshot.sourceId,
          );
        const record = yield* decodeRecordJson(row.record);
        manifest.add(record);
        if (record.kind === "message") {
          messageCount += 1;
          if (record.textContentId !== undefined) messageContentRefs.add(record.textContentId);
          if (record.detailsContentId !== undefined)
            messageContentRefs.add(record.detailsContentId);
        }
        if (record.kind === "activity") activityCount += 1;
        if (record.kind === "attachment") {
          const state = attachments.get(record.attachmentId) ?? {
            nextChunk: 0,
            totalChunks: record.totalChunks,
            lastOrdinal: ordinal - 1,
          };
          if (
            record.chunkIndex !== state.nextChunk ||
            record.totalChunks !== state.totalChunks ||
            state.lastOrdinal !== ordinal - 1
          ) {
            return yield* sourceError(
              "invalid-chunk",
              "The source attachment chunks are incomplete or out of order.",
              snapshot.sourceId,
            );
          }
          state.nextChunk += 1;
          state.lastOrdinal = ordinal;
          attachments.set(record.attachmentId, state);
        }
        if (record.kind === "content") {
          const state = contents.get(record.contentId) ?? {
            nextChunk: 0,
            totalChunks: record.totalChunks,
            lastOrdinal: ordinal - 1,
            requiredForAnalysis: record.requiredForAnalysis,
          };
          if (
            record.chunkIndex !== state.nextChunk ||
            record.totalChunks !== state.totalChunks ||
            state.lastOrdinal !== ordinal - 1 ||
            state.requiredForAnalysis !== record.requiredForAnalysis
          ) {
            return yield* sourceError(
              "invalid-chunk",
              "The source content chunks are incomplete or out of order.",
              snapshot.sourceId,
            );
          }
          state.nextChunk += 1;
          state.lastOrdinal = ordinal;
          contents.set(record.contentId, state);
        }
        ordinal += 1;
      }
    }
    if (
      ordinal !== snapshot.recordCount ||
      messageCount !== snapshot.messageCount ||
      activityCount !== snapshot.activityCount ||
      attachments.size !== snapshot.attachmentCount ||
      [...attachments.values()].some(
        (attachment) => attachment.nextChunk !== attachment.totalChunks,
      ) ||
      [...contents.values()].some((content) => content.nextChunk !== content.totalChunks) ||
      [...messageContentRefs].some((contentId) => !contents.get(contentId)?.requiredForAnalysis)
    ) {
      return yield* sourceError(
        "incomplete-source",
        "The imported source does not contain its entire frozen history.",
        snapshot.sourceId,
      );
    }
    if (manifest.finish() !== snapshot.contentHash) {
      return yield* sourceError(
        "content-mismatch",
        "The imported source does not match its frozen content hash.",
        snapshot.sourceId,
      );
    }
  });

  const importSourceChunk = Effect.fn("DeepPlanSources.importSourceChunk")(
    function* (input: DeepPlanImportSourceChunkInput) {
      yield* ensureRun(input);
      const row = yield* getRunSource(input.runId, input.snapshot.sourceId);
      if (canonicalSourceJson(row.snapshot) !== canonicalSourceJson(input.snapshot))
        return yield* sourceError(
          "content-mismatch",
          "The imported source manifest changed.",
          input.snapshot.sourceId,
        );
      if (sourceChunkHash(input.records) !== input.chunkHash)
        return yield* sourceError(
          "content-mismatch",
          "The imported chunk hash does not match its records.",
          input.snapshot.sourceId,
        );
      const previous = yield* sql<{ readonly contentHash: string; readonly finalChunk: number }>`
      SELECT content_hash AS "contentHash", final_chunk AS "finalChunk" FROM deep_plan_source_import_chunks
      WHERE run_id = ${input.runId} AND source_id = ${input.snapshot.sourceId} AND chunk_index = ${input.chunkIndex}
    `;
      if (previous[0] !== undefined) {
        if (
          previous[0].contentHash !== input.chunkHash ||
          previous[0].finalChunk !== (input.finalChunk ? 1 : 0)
        ) {
          return yield* sourceError(
            "content-mismatch",
            "A retried source chunk must contain the original content.",
            input.snapshot.sourceId,
          );
        }
        return {
          runId: input.runId,
          sourceId: input.snapshot.sourceId,
          importedRecordCount: row.importedRecordCount,
          complete: row.complete === 1,
          coverage: coverageFromRow(row),
        };
      }
      if (row.complete === 1) {
        // Locally frozen sources and previously verified imports need no second transfer.
        return {
          runId: input.runId,
          sourceId: input.snapshot.sourceId,
          importedRecordCount: row.importedRecordCount,
          complete: true,
          coverage: coverageFromRow(row),
        };
      }
      if (
        input.chunkIndex !== row.nextChunkIndex ||
        (!input.finalChunk && input.records.length === 0)
      )
        return yield* sourceError(
          "invalid-chunk",
          "Source chunks must be imported in order.",
          input.snapshot.sourceId,
        );
      if (row.importedRecordCount + input.records.length > row.snapshot.recordCount)
        return yield* sourceError(
          "invalid-chunk",
          "The imported chunk exceeds the frozen record count.",
          input.snapshot.sourceId,
        );
      for (let index = 0; index < input.records.length; index += 1) {
        const record = input.records[index]!;
        if (
          record.origin.environmentId !== row.snapshot.origin.environmentId ||
          sourceRecordContentHash(record) !== record.contentHash ||
          sourceRecordId(record.origin, record.contentHash) !== record.recordId ||
          (record.kind === "message" && record.message.streaming)
        ) {
          return yield* sourceError(
            "content-mismatch",
            "An imported record has invalid provenance or content.",
            input.snapshot.sourceId,
          );
        }
        yield* persistRecord(input.snapshot.sourceId, row.importedRecordCount + index, record);
      }
      const importedRecordCount = row.importedRecordCount + input.records.length;
      if (input.finalChunk) yield* validateManifest(row.snapshot);
      const now = yield* nowIso;
      yield* sql`
      INSERT INTO deep_plan_source_import_chunks (run_id, source_id, chunk_index, content_hash, record_count, final_chunk)
      VALUES (${input.runId}, ${input.snapshot.sourceId}, ${input.chunkIndex}, ${input.chunkHash}, ${input.records.length}, ${input.finalChunk ? 1 : 0})
    `;
      yield* sql`
      UPDATE deep_plan_run_sources SET imported_record_count = ${importedRecordCount}, next_chunk_index = ${input.chunkIndex + 1},
        complete = ${input.finalChunk ? 1 : 0}, status = ${input.finalChunk ? "ready" : "importing"}, updated_at = ${now}
      WHERE run_id = ${input.runId} AND source_id = ${input.snapshot.sourceId}
    `;
      if (input.finalChunk)
        yield* sql`UPDATE deep_plan_sources SET complete = 1 WHERE source_id = ${input.snapshot.sourceId}`;
      const next = yield* getRunSource(input.runId, input.snapshot.sourceId);
      return {
        runId: input.runId,
        sourceId: input.snapshot.sourceId,
        importedRecordCount,
        complete: input.finalChunk,
        coverage: coverageFromRow(next),
      };
    },
    sql.withTransaction,
    Effect.mapError(storageError),
  );

  const readSourceChunk = Effect.fn("DeepPlanSources.readSourceChunk")(
    function* (input: DeepPlanReadSourceChunkInput) {
      yield* ensureRun(input);
      const row = yield* getRunSource(input.runId, input.sourceId);
      if (row.complete !== 1)
        return yield* sourceError(
          "incomplete-source",
          "This source has not finished transferring.",
          input.sourceId,
        );
      const page = yield* (input.includeBodies ? readRecords : readAnalysisRecords)({
        snapshot: row.snapshot,
        scope: `run:${input.runId}:${input.sourceId}`,
        ...input,
      });
      if (page.offset > row.readRecordCount)
        return yield* sourceError(
          "invalid-chunk",
          "Read the source history in order before summarizing it.",
          input.sourceId,
        );
      yield* sql`
      UPDATE deep_plan_run_sources SET read_record_count = MAX(read_record_count, ${page.nextOffset}), updated_at = ${yield* nowIso}
      WHERE run_id = ${input.runId} AND source_id = ${input.sourceId}
    `;
      return page.chunk;
    },
    sql.withTransaction,
    Effect.mapError(storageError),
  );

  const summarizeSource = Effect.fn("DeepPlanSources.summarizeSource")(
    function* (input: DeepPlanSummarizeSourceInput) {
      yield* ensureRun(input);
      const row = yield* getRunSource(input.runId, input.sourceId);
      if (row.snapshot.contentHash !== input.expectedContentHash)
        return yield* sourceError(
          "content-mismatch",
          "The source summary refers to another content version.",
          input.sourceId,
        );
      if (row.complete !== 1 || row.readRecordCount !== row.snapshot.recordCount)
        return yield* sourceError(
          "incomplete-source",
          "Read the entire source before marking its summary complete.",
          input.sourceId,
        );
      if (row.summary !== null) {
        if (canonicalSourceJson(row.summary) !== canonicalSourceJson(input.summary))
          return yield* sourceError(
            "content-mismatch",
            "A completed source summary is immutable.",
            input.sourceId,
          );
        return coverageFromRow(row);
      }
      for (const recordId of input.summary.citedRecordIds) {
        const citations = yield* sql`
        SELECT 1 FROM deep_plan_source_records WHERE source_id = ${input.sourceId} AND record_id = ${recordId} LIMIT 1
      `;
        if (citations.length === 0)
          return yield* sourceError(
            "content-mismatch",
            "The source summary cites a record outside this snapshot.",
            input.sourceId,
          );
      }
      yield* sql`
      UPDATE deep_plan_run_sources SET summary_json = ${canonicalSourceJson(input.summary)}, status = 'summarized', updated_at = ${yield* nowIso}
      WHERE run_id = ${input.runId} AND source_id = ${input.sourceId}
    `;
      return coverageFromRow(yield* getRunSource(input.runId, input.sourceId));
    },
    sql.withTransaction,
    Effect.mapError(storageError),
  );

  const assertCompleteCoverage = Effect.fn("DeepPlanSources.assertCompleteCoverage")(function* (
    runId: DeepPlanRunId,
  ) {
    const exists = yield* sql`SELECT 1 FROM deep_plan_source_runs WHERE run_id = ${runId}`;
    if (exists.length === 0)
      return yield* sourceError("run-not-found", "The run has no frozen source collection.");
    const result = yield* loadRunSources(runId);
    for (let index = 0; index < result.sources.length; index += 1) {
      const source = result.sources[index]!;
      const coverage = result.coverage[index]!;
      if (
        coverage.status !== "summarized" ||
        coverage.importedRecordCount !== source.recordCount ||
        coverage.readRecordCount !== source.recordCount ||
        coverage.summary === null
      ) {
        return yield* sourceError(
          "incomplete-source",
          "Every selected chat must be fully transferred, read, and summarized before approving the plan.",
          source.sourceId,
        );
      }
    }
    return result;
  }, Effect.mapError(storageError));

  const validatePlanCitations = Effect.fn("DeepPlanSources.validatePlanCitations")(function* (
    runId: DeepPlanRunId,
    plan: DeepPlanDocument,
  ) {
    const citations = [
      ...plan.decisions.flatMap((decision) => decision.sources ?? []),
      ...plan.steps.flatMap((step) => [
        ...(step.sources ?? []),
        ...step.acceptanceCriteria.flatMap((criterion) => criterion.sources ?? []),
      ]),
    ];
    const run = yield* sql`SELECT 1 FROM deep_plan_source_runs WHERE run_id = ${runId}`;
    if (run.length === 0)
      return yield* sourceError("run-not-found", "The run has no frozen source collection.");
    for (const citation of citations) {
      yield* getRunSource(runId, citation.sourceId);
      const ids = [...new Set(citation.recordIds)];
      for (let offset = 0; offset < ids.length; offset += QUERY_PAGE_SIZE) {
        const batch = ids.slice(offset, offset + QUERY_PAGE_SIZE);
        const matches = yield* sql<{ readonly count: number }>`
          SELECT COUNT(DISTINCT record_id) AS count FROM deep_plan_source_records
          WHERE source_id = ${citation.sourceId} AND ${sql.in("record_id", batch)}
        `;
        if (matches[0]?.count !== batch.length)
          return yield* sourceError(
            "content-mismatch",
            "The plan cites a record outside its frozen source snapshot.",
            citation.sourceId,
          );
      }
    }
  }, Effect.mapError(storageError));

  return DeepPlanSources.of({
    catalogSources,
    exportSources,
    readExportChunk,
    initializeSources,
    importSourceChunk,
    listSources,
    readSourceChunk,
    summarizeSource,
    assertCompleteCoverage,
    validatePlanCitations,
  });
});

export const DeepPlanSourcesLive = Layer.effect(DeepPlanSources, makeDeepPlanSources);
