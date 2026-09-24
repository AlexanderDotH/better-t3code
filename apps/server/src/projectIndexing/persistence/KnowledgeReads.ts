import { ProjectIndexCoverageV1, ProjectIndexSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { decodeRecord } from "./KnowledgeRecords.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";
import type {
  KnowledgeCallQuery,
  KnowledgeGenerationStatus,
  KnowledgePage,
  KnowledgeRecordKind,
  KnowledgeRecordMap,
  KnowledgeRecordQuery,
  KnowledgeStoreState,
} from "./KnowledgeStoreTypes.ts";

export const boundedPageSize = (limit: number | undefined, maximum = 200) =>
  Math.max(1, Math.min(maximum, Math.floor(Number.isFinite(limit) ? limit! : 100)));
const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => "?").join(",");
const escapeLike = (text: string) =>
  text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
const decodeSettings = Schema.decodeEffect(Schema.fromJsonString(ProjectIndexSettings));
const decodeCoverage = Schema.decodeEffect(Schema.fromJsonString(ProjectIndexCoverageV1));

interface StateRow {
  readonly workspace_id: string;
  readonly revision: number;
  readonly published_revision: number | null;
  readonly active_revision: number | null;
  readonly status: KnowledgeGenerationStatus;
  readonly settings_json: string;
  readonly coverage_json: string | null;
  readonly updated_at: number;
}

export const readKnowledgeRevision = Effect.fn("readKnowledgeRevision")(function* (
  sql: SqlClient.SqlClient,
  requested?: number,
) {
  const revision =
    requested ??
    (yield* sql<{
      published_revision: number | null;
    }>`SELECT published_revision FROM knowledge_state WHERE singleton = 1`)[0]
      ?.published_revision ??
    0;
  if (revision !== 0) {
    const rows = yield* sql<{ revision: number }>`
      SELECT generation.revision FROM knowledge_generations generation
      WHERE generation.revision = ${revision} AND (
        generation.views_path IS NOT NULL
        OR generation.revision = (SELECT active_revision FROM knowledge_state WHERE singleton = 1)
        OR generation.revision = (SELECT revision FROM knowledge_state WHERE singleton = 1 AND lease_token IS NOT NULL)
      )
    `;
    if (!rows[0])
      return yield* new KnowledgeStoreError({
        code: "revision-conflict",
        detail: "This knowledge revision is no longer available. Restart the query.",
      });
  }
  return revision;
});

export const isStaticKnowledgeRevision = Effect.fn("isStaticKnowledgeRevision")(function* (
  sql: SqlClient.SqlClient,
  requested: number,
) {
  const revision = yield* readKnowledgeRevision(sql, requested);
  const generation = (yield* sql<{
    knowledge_format: string | null;
  }>`SELECT json_extract(metadata_json, '$.knowledgeFormat') AS knowledge_format FROM knowledge_generations WHERE revision = ${revision}`)[0];
  return generation?.knowledge_format === "static-v1";
});

export function makeKnowledgeReads(sql: SqlClient.SqlClient) {
  const getCoverage = Effect.fn("KnowledgeStore.getCoverage")(
    function* (revision: number) {
      const rows = yield* sql<{
        coverage_json: string | null;
      }>`SELECT coverage_json FROM knowledge_generations WHERE revision = ${revision}`;
      const json = rows[0]?.coverage_json;
      return json == null ? null : yield* decodeCoverage(json);
    },
    Effect.mapError(asStoreError("read revision coverage")),
  );
  const getState = Effect.fn("KnowledgeStore.getState")(function* (): Effect.fn.Return<
    KnowledgeStoreState,
    KnowledgeStoreError
  > {
    const rows = yield* sql<StateRow>`SELECT * FROM knowledge_state WHERE singleton = 1`.pipe(
      Effect.mapError(asStoreError("read state")),
    );
    const row = rows[0];
    if (!row)
      return yield* new KnowledgeStoreError({
        code: "corrupt-store",
        detail: "The knowledge store is missing its workspace state.",
      });
    const settings = yield* decodeSettings(row.settings_json).pipe(
      Effect.mapError(asStoreError("decode settings")),
    );
    const coverage =
      row.coverage_json === null
        ? null
        : yield* decodeCoverage(row.coverage_json).pipe(
            Effect.mapError(asStoreError("decode coverage")),
          );
    return {
      workspaceId: row.workspace_id,
      revision: row.revision,
      publishedRevision: row.published_revision,
      activeRevision: row.active_revision,
      status: row.status,
      settings,
      coverage,
      updatedAt: row.updated_at,
    };
  });

  const readRevision = (requested?: number) => readKnowledgeRevision(sql, requested);
  const isStaticRevision = (revision: number) =>
    isStaticKnowledgeRevision(sql, revision).pipe(
      Effect.mapError(asStoreError("read knowledge format")),
    );

  const listRecords = <Kind extends KnowledgeRecordKind>(
    input: KnowledgeRecordQuery<Kind>,
  ): Effect.Effect<KnowledgePage<KnowledgeRecordMap[Kind]>, KnowledgeStoreError> =>
    Effect.gen(function* () {
      const revision = yield* readRevision(input.revision);
      const limit = boundedPageSize(input.limit);
      const predicates = ["record.revision = ?", "record.kind = ?", "record.id > ?"];
      const parameters: Array<string | number> = [revision, input.kind, input.afterId ?? ""];
      for (const [field, values] of [
        ["status", input.fileStatuses],
        ["classification", input.fileClassifications],
      ] as const) {
        if (values === undefined) continue;
        if (values.length === 0) return { revision, items: [], nextCursor: null };
        if (values.length > 16)
          return yield* new KnowledgeStoreError({
            code: "query-limit",
            detail: "A file filter accepts at most 16 values.",
          });
        predicates.push(`json_extract(record.payload, '$.${field}') IN (${placeholders(values)})`);
        parameters.push(...values);
      }
      if (input.query) {
        predicates.push("record.search_text LIKE ? ESCAPE '\\'");
        parameters.push(`%${escapeLike(input.query.slice(0, 2048).toLowerCase())}%`);
      }
      if (input.sourceFilePath !== undefined) {
        predicates.push("record.file_path = ?");
        parameters.push(input.sourceFilePath);
      }
      if (input.filePath) {
        const dependencyFilter =
          "EXISTS (SELECT 1 FROM knowledge_record_dependencies dependency WHERE dependency.revision = record.revision AND dependency.kind = record.kind AND dependency.id = record.id AND dependency.file_path = ?)";
        if (input.kind === "callsites") {
          predicates.push(
            `(${dependencyFilter} OR EXISTS (SELECT 1 FROM knowledge_calls edge JOIN knowledge_records target ON target.revision = edge.revision AND target.kind = 'entities' AND target.id = edge.callee_id WHERE edge.revision = record.revision AND edge.callsite_id = record.id AND target.file_path = ?))`,
          );
          parameters.push(input.filePath, input.filePath);
        } else {
          predicates.push(dependencyFilter);
          parameters.push(input.filePath);
        }
      }
      if (input.ids) {
        if (input.ids.length === 0) return { revision, items: [], nextCursor: null };
        if (input.ids.length > 200)
          return yield* new KnowledgeStoreError({
            code: "query-limit",
            detail: "A record lookup accepts at most 200 IDs.",
          });
        predicates.push(`record.id IN (${placeholders(input.ids)})`);
        parameters.push(...input.ids);
      }
      if (input.entityIds) {
        if (input.entityIds.length === 0) return { revision, items: [], nextCursor: null };
        if (input.entityIds.length > 200)
          return yield* new KnowledgeStoreError({
            code: "query-limit",
            detail: "A related-record lookup accepts at most 200 entity IDs.",
          });
        predicates.push(
          `EXISTS (SELECT 1 FROM knowledge_record_dependencies dependency WHERE dependency.revision = record.revision AND dependency.kind = record.kind AND dependency.id = record.id AND dependency.entity_id IN (${placeholders(input.entityIds)}))`,
        );
        parameters.push(...input.entityIds);
      }
      if (input.filePathPrefixes && input.filePathPrefixes.length > 0) {
        if (input.filePathPrefixes.length > 32)
          return yield* new KnowledgeStoreError({
            code: "query-limit",
            detail: "A query accepts at most 32 file scopes.",
          });
        predicates.push(
          `EXISTS (SELECT 1 FROM knowledge_record_dependencies dependency WHERE dependency.revision = record.revision AND dependency.kind = record.kind AND dependency.id = record.id AND (${input.filePathPrefixes.map(() => "(dependency.file_path = ? OR dependency.file_path LIKE ? ESCAPE '\\')").join(" OR ")}))`,
        );
        for (const prefix of input.filePathPrefixes)
          parameters.push(
            prefix.replace(/\/+$/u, ""),
            `${escapeLike(prefix.replace(/\/+$/u, ""))}/%`,
          );
      }
      parameters.push(limit + 1);
      const rows = yield* sql.unsafe<{ id: string; payload: string }>(
        `SELECT record.id, record.payload FROM knowledge_records record WHERE ${predicates.join(" AND ")} ORDER BY record.id LIMIT ?`,
        parameters,
      );
      const page = rows.slice(0, limit);
      const items = yield* Effect.forEach(page, (row) => decodeRecord(input.kind, row.payload));
      return {
        revision,
        items,
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    }).pipe(sql.withTransaction, Effect.mapError(asStoreError("query records")));

  const getRecord = <Kind extends KnowledgeRecordKind>(kind: Kind, id: string, revision?: number) =>
    listRecords({
      kind,
      ids: [id],
      limit: 1,
      ...(revision === undefined ? {} : { revision }),
    }).pipe(Effect.map((page) => page.items[0] ?? null));

  const listCalls = Effect.fn("KnowledgeStore.listCalls")(
    function* (
      input: KnowledgeCallQuery,
    ): Effect.fn.Return<KnowledgePage<KnowledgeRecordMap["callsites"]>, KnowledgeStoreError> {
      const revision = yield* readRevision(input.revision).pipe(
        Effect.mapError(asStoreError("read revision")),
      );
      if (input.entityIds.length === 0) return { revision, items: [], nextCursor: null };
      if (input.entityIds.length > 200)
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "A call query accepts at most 200 entity IDs.",
        });
      const limit = boundedPageSize(input.limit, 600);
      const directions =
        input.direction === "both"
          ? ["caller_id", "callee_id"]
          : [input.direction === "callers" ? "callee_id" : "caller_id"];
      const filter = directions
        .map((column) => `edge.${column} IN (${placeholders(input.entityIds)})`)
        .join(" OR ");
      const parameters = [
        revision,
        input.afterId ?? "",
        ...directions.flatMap(() => input.entityIds),
        limit + 1,
      ];
      const rows = yield* sql
        .unsafe<{ id: string; payload: string }>(
          `SELECT record.id, record.payload FROM knowledge_records record WHERE record.revision = ? AND record.kind = 'callsites' AND record.id > ? AND EXISTS (SELECT 1 FROM knowledge_calls edge WHERE edge.revision = record.revision AND edge.callsite_id = record.id AND (${filter})) ORDER BY record.id LIMIT ?`,
          parameters,
        )
        .pipe(Effect.mapError(asStoreError("query calls")));
      const page = rows.slice(0, limit);
      return {
        revision,
        items: yield* Effect.forEach(page, (row) => decodeRecord("callsites", row.payload)),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("query calls")),
  );

  const traverseCalls = Effect.fn("KnowledgeStore.traverseCalls")(
    function* (input: KnowledgeCallQuery & { readonly maxDepth?: number }) {
      const revision = yield* readRevision(input.revision);
      const limit = boundedPageSize(input.limit, 600);
      const maximumDepth = Math.max(1, Math.min(8, Math.floor(input.maxDepth ?? 2)));
      const visited = new Set(input.entityIds.slice(0, 200));
      const callsites = new Map<string, KnowledgeRecordMap["callsites"]>();
      let frontier = [...visited];
      let truncated = input.entityIds.length > 200;
      for (
        let depth = 0;
        depth < maximumDepth && frontier.length > 0 && callsites.size < limit;
        depth++
      ) {
        const page = yield* listCalls({
          ...input,
          entityIds: frontier.slice(0, 200),
          revision,
          limit: limit - callsites.size,
        });
        truncated ||= page.nextCursor !== null || frontier.length > 200;
        const next: string[] = [];
        for (const call of page.items) {
          callsites.set(call.id, call);
          const neighbors =
            input.direction === "callers"
              ? call.callerEntityId
                ? [call.callerEntityId]
                : []
              : input.direction === "callees"
                ? call.targetEntityIds
                : [...call.targetEntityIds, ...(call.callerEntityId ? [call.callerEntityId] : [])];
          for (const entityId of neighbors)
            if (!visited.has(entityId)) {
              if (visited.size >= 200) {
                truncated = true;
                continue;
              }
              visited.add(entityId);
              next.push(entityId);
            }
        }
        frontier = next;
        if (depth === maximumDepth - 1 && frontier.length > 0) truncated = true;
      }
      return { revision, callsites: [...callsites.values()], entityIds: [...visited], truncated };
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("traverse calls")),
  );

  const getRecordDependencyPaths = Effect.fn("KnowledgeStore.getRecordDependencyPaths")(
    function* (input: {
      readonly kind: KnowledgeRecordKind;
      readonly id: string;
      readonly revision: number;
      readonly limit?: number;
      readonly afterPath?: string;
    }) {
      const revision = yield* readRevision(input.revision);
      const limit = boundedPageSize(input.limit);
      const rows = yield* sql<{
        file_path: string;
      }>`SELECT DISTINCT file_path FROM knowledge_record_dependencies WHERE revision = ${revision} AND kind = ${input.kind} AND id = ${input.id} AND file_path > ${input.afterPath ?? ""} ORDER BY file_path LIMIT ${limit + 1}`;
      const items = rows.slice(0, limit).map((row) => row.file_path);
      return { revision, items, nextCursor: rows.length > limit ? (items.at(-1) ?? null) : null };
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("read record dependencies")),
  );

  const recordCounts = Effect.fn("KnowledgeStore.recordCounts")(
    function* (revision: number) {
      yield* readRevision(revision);
      return yield* sql<{
        kind: KnowledgeRecordKind;
        count: number;
      }>`SELECT kind, COUNT(*) AS count FROM knowledge_records WHERE revision = ${revision} GROUP BY kind`;
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("count records")),
  );

  return {
    isStaticRevision,
    getState,
    getCoverage,
    getRecord,
    listRecords,
    listCalls,
    traverseCalls,
    recordCounts,
    getRecordDependencyPaths,
  };
}
