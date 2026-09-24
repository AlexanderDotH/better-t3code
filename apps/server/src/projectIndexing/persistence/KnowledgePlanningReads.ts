import { ProjectIndexCoverageV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { isWorkspaceRelativePath } from "../privacy/WorkspacePrivacy.ts";
import { boundedPageSize, readKnowledgeRevision } from "./KnowledgeReads.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";

const decodeCoverage = Schema.decodeEffect(ProjectIndexCoverageV1);
const MAX_PLANNING_INPUTS = 200;

function pathPage(revision: number, rows: ReadonlyArray<{ readonly path: string }>, limit: number) {
  const items = rows.slice(0, limit).map((row) => row.path);
  return { revision, items, nextCursor: rows.length > limit ? (items.at(-1) ?? null) : null };
}

export function makeKnowledgePlanningReads(sql: SqlClient.SqlClient) {
  const countFiles = Effect.fn("KnowledgeStore.countFiles")(
    function* (revision: number) {
      yield* readKnowledgeRevision(sql, revision);
      const rows = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM knowledge_records
        WHERE revision = ${revision} AND kind = 'files'
      `;
      return rows[0]!.count;
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("count files")),
  );

  const aggregateCoverage = Effect.fn("KnowledgeStore.aggregateCoverage")(
    function* (revision: number) {
      yield* readKnowledgeRevision(sql, revision);
      const rows = yield* sql<ProjectIndexCoverageV1>`
      SELECT
        COUNT(*) FILTER (WHERE kind = 'files') AS "discoveredFiles",
        COUNT(*) FILTER (WHERE kind = 'files' AND json_extract(payload, '$.status') <> 'skipped') AS "eligibleFiles",
        COUNT(*) FILTER (WHERE kind = 'files' AND json_extract(payload, '$.status') = 'indexed') AS "indexedFiles",
        COUNT(*) FILTER (WHERE kind = 'files' AND json_extract(payload, '$.status') = 'skipped') AS "skippedFiles",
        COUNT(*) FILTER (WHERE kind = 'files' AND json_extract(payload, '$.status') = 'failed') AS "failedFiles",
        COUNT(*) FILTER (WHERE kind = 'entities') AS "totalEntities",
        0 AS "analyzedEntities",
        COUNT(*) FILTER (WHERE kind = 'imports') AS "totalImports",
        COUNT(*) FILTER (WHERE kind = 'imports' AND json_extract(payload, '$.resolution') = 'workspace') AS "resolvedImports",
        COUNT(*) FILTER (WHERE kind = 'callsites') AS "totalCallsites",
        COUNT(*) FILTER (WHERE kind = 'callsites' AND json_extract(payload, '$.resolution') = 'resolved') AS "resolvedCallsites",
        COUNT(*) FILTER (WHERE kind = 'callsites' AND json_extract(payload, '$.resolution') = 'candidate') AS "candidateCallsites",
        COUNT(*) FILTER (WHERE kind = 'callsites' AND json_extract(payload, '$.resolution') = 'unresolved') AS "unresolvedCallsites"
      FROM knowledge_records WHERE revision = ${revision}
    `;
      return yield* decodeCoverage(rows[0]!);
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("aggregate coverage")),
  );

  const getChangedFilePaths = Effect.fn("KnowledgeStore.getChangedFilePaths")(
    function* (input: {
      readonly revision: number;
      readonly currentRevision: number;
      readonly limit?: number;
      readonly afterPath?: string;
    }) {
      yield* readKnowledgeRevision(sql, input.revision);
      const revision = yield* readKnowledgeRevision(sql, input.currentRevision);
      const limit = boundedPageSize(input.limit);
      const rows = yield* sql<{ path: string }>`
      WITH changed(path) AS (
        SELECT current_file.id FROM knowledge_records current_file
        LEFT JOIN knowledge_records previous ON previous.revision = ${input.revision} AND previous.kind = 'files' AND previous.id = current_file.id
        WHERE current_file.revision = ${revision} AND current_file.kind = 'files' AND (
          json_extract(current_file.payload, '$.status') IN ('pending','failed','stale','deleted')
          OR (previous.id IS NULL AND json_extract(current_file.payload, '$.status') <> 'skipped')
          OR (previous.id IS NOT NULL AND (
            json_extract(previous.payload, '$.contentHash') <> json_extract(current_file.payload, '$.contentHash')
            OR json_extract(previous.payload, '$.classification') <> json_extract(current_file.payload, '$.classification')
            OR json_extract(previous.payload, '$.configDependencies') <> json_extract(current_file.payload, '$.configDependencies')
          ))
        )
        UNION
        SELECT previous.id FROM knowledge_records previous
        LEFT JOIN knowledge_records current_file ON current_file.revision = ${revision} AND current_file.kind = 'files' AND current_file.id = previous.id
        WHERE previous.revision = ${input.revision} AND previous.kind = 'files' AND current_file.id IS NULL
      )
      SELECT path FROM changed WHERE path > ${input.afterPath ?? ""} ORDER BY path LIMIT ${limit + 1}
    `;
      return pathPage(revision, rows, limit);
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("find changed files")),
  );

  const getAffectedFilePaths = Effect.fn("KnowledgeStore.getAffectedFilePaths")(
    function* (input: {
      readonly revision: number;
      readonly changedPaths: ReadonlyArray<string>;
      readonly currentRevision?: number;
      readonly limit?: number;
      readonly afterPath?: string;
    }) {
      const revision = yield* readKnowledgeRevision(sql, input.revision);
      const currentRevision =
        input.currentRevision === undefined
          ? revision
          : yield* readKnowledgeRevision(sql, input.currentRevision);
      if (input.changedPaths.length === 0) return { revision, items: [], nextCursor: null };
      if (
        input.changedPaths.length > MAX_PLANNING_INPUTS ||
        input.changedPaths.some((path) => !isWorkspaceRelativePath(path))
      )
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "Dependency traversal accepts at most 200 workspace-relative changed paths.",
        });
      const limit = boundedPageSize(input.limit);
      const rows = yield* sql.unsafe<{ path: string }>(
        `
      WITH RECURSIVE
      scope(revision) AS (VALUES (?) UNION VALUES (?)),
      seed(path) AS (VALUES ${input.changedPaths.map(() => "(?)").join(",")}),
      global_change(value) AS (
        SELECT EXISTS(SELECT 1 FROM knowledge_records file JOIN scope ON scope.revision = file.revision JOIN seed ON seed.path = file.id
          WHERE file.kind = 'files' AND json_extract(file.payload, '$.classification') IN ('rule','configuration','manifest'))
      ),
      affected(path) AS (
        SELECT path FROM seed
        UNION
        SELECT file.id FROM knowledge_records file JOIN scope ON scope.revision = file.revision
          WHERE file.kind = 'files' AND (SELECT value FROM global_change) = 1
        UNION
        SELECT dependent.file_path FROM affected changed
          JOIN knowledge_record_dependencies dependency ON dependency.revision = ? AND dependency.kind = 'files' AND dependency.file_path = changed.path
          JOIN knowledge_records dependent ON dependent.revision = dependency.revision AND dependent.kind = dependency.kind AND dependent.id = dependency.id
          WHERE dependent.file_path IS NOT NULL
        UNION
        SELECT importer.file_path FROM affected changed
          JOIN knowledge_record_dependencies dependency ON dependency.kind = 'imports' AND dependency.file_path = changed.path
          JOIN scope ON scope.revision = dependency.revision
          JOIN knowledge_records importer ON importer.revision = dependency.revision AND importer.kind = 'imports' AND importer.id = dependency.id
          WHERE importer.file_path IS NOT NULL AND importer.file_path <> changed.path
        UNION
        SELECT callsite.file_path FROM affected changed
          JOIN knowledge_records target ON target.revision = ? AND target.kind = 'entities' AND target.file_path = changed.path
          JOIN knowledge_calls edge ON edge.revision = target.revision AND edge.callee_id = target.id
          JOIN knowledge_records callsite ON callsite.revision = edge.revision AND callsite.kind = 'callsites' AND callsite.id = edge.callsite_id
          WHERE callsite.file_path IS NOT NULL
      )
      SELECT path FROM affected WHERE path > ? ORDER BY path LIMIT ?
    `,
        [
          revision,
          currentRevision,
          ...input.changedPaths,
          revision,
          revision,
          input.afterPath ?? "",
          limit + 1,
        ],
      );
      return pathPage(revision, rows, limit);
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("traverse affected files")),
  );

  return { countFiles, aggregateCoverage, getChangedFilePaths, getAffectedFilePaths };
}
