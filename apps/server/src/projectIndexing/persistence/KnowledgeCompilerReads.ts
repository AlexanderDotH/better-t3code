import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { decodeRecord } from "./KnowledgeRecords.ts";
import { readKnowledgeRevision } from "./KnowledgeReads.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";

export interface KnowledgeSourceLocation {
  readonly filePath: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

const validOffsets = (location: KnowledgeSourceLocation) =>
  Number.isSafeInteger(location.startOffset) &&
  Number.isSafeInteger(location.endOffset) &&
  location.startOffset >= 0 &&
  location.endOffset >= location.startOffset;
const EXECUTABLE_KINDS = new Set([
  "class",
  "constructor",
  "method",
  "function",
  "lambda",
  "initializer",
]);

export function makeKnowledgeCompilerReads(sql: SqlClient.SqlClient) {
  const getCallsitesAt = Effect.fn("KnowledgeStore.getCallsitesAt")(
    function* (input: {
      readonly revision: number;
      readonly locations: ReadonlyArray<KnowledgeSourceLocation>;
    }) {
      yield* readKnowledgeRevision(sql, input.revision);
      if (input.locations.length === 0) return [];
      if (
        input.locations.length > 128 ||
        input.locations.some((location) => !validOffsets(location))
      )
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "Compiler callsite lookup accepts at most 128 valid source locations.",
        });
      const rows = yield* sql.unsafe<{ id: string; payload: string }>(
        `
      WITH locations(file_path, start_offset, end_offset) AS (VALUES ${input.locations.map(() => "(?,?,?)").join(",")})
      SELECT DISTINCT record.id, record.payload FROM locations
      JOIN knowledge_records record ON record.revision = ? AND record.kind = 'callsites' AND record.file_path = locations.file_path
        AND json_extract(record.payload, '$.range.startOffset') = locations.start_offset
        AND json_extract(record.payload, '$.range.endOffset') = locations.end_offset
      ORDER BY record.id LIMIT 601
    `,
        [
          ...input.locations.flatMap((location) => [
            location.filePath,
            location.startOffset,
            location.endOffset,
          ]),
          input.revision,
        ],
      );
      if (rows.length > 600)
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "The compiler location batch matched too many callsites. Use a smaller batch.",
        });
      return yield* Effect.forEach(rows, (row) => decodeRecord("callsites", row.payload));
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("find compiler callsites")),
  );

  const getDeclarationTarget = Effect.fn("KnowledgeStore.getDeclarationTarget")(
    function* (
      input: KnowledgeSourceLocation & {
        readonly revision: number;
        readonly name?: string;
      },
    ) {
      yield* readKnowledgeRevision(sql, input.revision);
      if (!validOffsets(input))
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "Compiler declaration lookup requires a valid source range.",
        });
      const rangeFilter =
        input.name === undefined
          ? "json_extract(payload, '$.range.startOffset') BETWEEN ? AND ? AND json_extract(payload, '$.range.endOffset') BETWEEN ? AND ?"
          : "name = ? AND json_extract(payload, '$.nameRange.startOffset') = ? AND json_extract(payload, '$.nameRange.endOffset') = ?";
      const locationParameters =
        input.name === undefined
          ? [input.startOffset, input.endOffset, input.endOffset - 1, input.endOffset + 1]
          : [input.name, input.startOffset, input.endOffset];
      const rows = yield* sql.unsafe<{ payload: string }>(
        `
      SELECT payload FROM knowledge_records
      WHERE revision = ? AND kind = 'entities' AND file_path = ?
        AND json_extract(payload, '$.kind') <> 'file'
        AND json_extract(payload, '$.range.startOffset') IS NOT NULL
        AND json_extract(payload, '$.range.endOffset') IS NOT NULL
        AND ${rangeFilter}
      ORDER BY (json_extract(payload, '$.range.startOffset') = ?) DESC,
        (json_extract(payload, '$.range.endOffset') - json_extract(payload, '$.range.startOffset')) DESC, id
      LIMIT 1
    `,
        [input.revision, input.filePath, ...locationParameters, input.startOffset],
      );
      if (!rows[0]) return null;
      const selected = yield* decodeRecord("entities", rows[0].payload);
      if (selected.kind === "variable" || selected.kind === "property") {
        const children = yield* sql<{ payload: string }>`
        SELECT payload FROM knowledge_records
        WHERE revision = ${input.revision} AND kind = 'entities' AND file_path = ${input.filePath}
          AND json_extract(payload, '$.containerId') = ${selected.id}
          AND json_extract(payload, '$.kind') IN ('lambda','function')
        ORDER BY json_extract(payload, '$.range.startOffset'), id LIMIT 1
      `;
        return children[0] ? yield* decodeRecord("entities", children[0].payload) : null;
      }
      return EXECUTABLE_KINDS.has(selected.kind) ? selected : null;
    },
    sql.withTransaction,
    Effect.mapError(asStoreError("find compiler declaration")),
  );

  return { getCallsitesAt, getDeclarationTarget };
}
