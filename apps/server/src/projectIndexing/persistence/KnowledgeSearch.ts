import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { isWorkspaceRelativePath } from "../privacy/WorkspacePrivacy.ts";
import { decodeRecord } from "./KnowledgeRecords.ts";
import {
  boundedPageSize,
  isStaticKnowledgeRevision,
  readKnowledgeRevision,
} from "./KnowledgeReads.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";
import {
  KNOWLEDGE_SEARCH_KINDS,
  type KnowledgeSearchHit,
  type KnowledgeSearchKind,
  type KnowledgeSearchPage,
  type KnowledgeSearchQuery,
} from "./KnowledgeStoreTypes.ts";

const MAX_SEARCH_TERMS = 16;
const MAX_SEARCH_TERM_LENGTH = 128;
const MAX_SEARCH_QUERY_LENGTH = 2_048;
const MAX_SEARCH_SCOPES = 32;
const MAX_SEARCH_CANDIDATES = 2_048;
const SEARCH_INTENT_WORDS = new Set([
  "a",
  "an",
  "and",
  "add",
  "change",
  "code",
  "das",
  "der",
  "die",
  "ein",
  "eine",
  "find",
  "fix",
  "for",
  "from",
  "how",
  "im",
  "in",
  "ist",
  "mit",
  "of",
  "on",
  "or",
  "remove",
  "the",
  "to",
  "und",
  "update",
  "where",
  "why",
  "with",
]);
const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(",");
const escapeLike = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export function searchTerms(query: string): {
  readonly match: string;
  readonly exactNames: ReadonlyArray<string>;
  readonly primary: string;
  readonly terms: ReadonlyArray<string>;
} | null {
  const original = query.slice(0, MAX_SEARCH_QUERY_LENGTH).match(/[\p{L}\p{N}_]+/gu);
  if (!original?.length) return null;
  const useful = original.filter((term) => !SEARCH_INTENT_WORDS.has(term.toLowerCase()));
  const wholeTerms = (useful.length ? useful : original).slice(0, MAX_SEARCH_TERMS);
  const pieces = wholeTerms.flatMap(
    (term) =>
      term
        .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
        .replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2")
        .match(/[\p{L}\p{N}_]+/gu) ?? [],
  );
  const terms = [
    ...new Set(
      [...wholeTerms, ...pieces].map((term) => term.slice(0, MAX_SEARCH_TERM_LENGTH).toLowerCase()),
    ),
  ].slice(0, MAX_SEARCH_TERMS);
  const primary = wholeTerms
    .reduce((longest, term) => (term.length > longest.length ? term : longest), "")
    .toLowerCase();
  return {
    match: terms.map((term) => `"${term}"*`).join(" OR "),
    exactNames: wholeTerms.map((term) => term.toLowerCase()),
    primary,
    terms,
  };
}

interface SearchRow {
  readonly kind: KnowledgeSearchKind;
  readonly id: string;
  readonly payload: string;
  readonly rank: number;
}

export function makeKnowledgeSearch(sql: SqlClient.SqlClient) {
  const searchRecords = <Kind extends KnowledgeSearchKind>(
    input: KnowledgeSearchQuery<Kind>,
  ): Effect.Effect<KnowledgeSearchPage<Kind>, KnowledgeStoreError> =>
    Effect.gen(function* () {
      const revision = yield* readKnowledgeRevision(sql, input.revision);
      if (
        input.kinds.length === 0 ||
        input.kinds.length > KNOWLEDGE_SEARCH_KINDS.length ||
        input.kinds.some((kind) => !KNOWLEDGE_SEARCH_KINDS.includes(kind))
      )
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "Search requires one to five static record kinds.",
        });
      if (
        input.filePathPrefixes &&
        (input.filePathPrefixes.length > MAX_SEARCH_SCOPES ||
          input.filePathPrefixes.some((prefix) => !isWorkspaceRelativePath(prefix)))
      )
        return yield* new KnowledgeStoreError({
          code: "query-limit",
          detail: "Search accepts at most 32 workspace-relative file scopes.",
        });
      if (
        input.after &&
        (!Number.isFinite(input.after.rank) ||
          !KNOWLEDGE_SEARCH_KINDS.some((kind) => kind === input.after?.kind) ||
          input.after.id.length === 0)
      )
        return yield* new KnowledgeStoreError({
          code: "invalid-cursor",
          detail: "The search cursor is invalid. Restart the query.",
        });
      const terms = searchTerms(input.query);
      if (!terms || input.filePathPrefixes?.length === 0)
        return { revision, items: [], nextCursor: null };
      if (!(yield* isStaticKnowledgeRevision(sql, revision)))
        return { revision, items: [], nextCursor: null };
      const available = yield* sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_record_fts'`;
      if (!available[0]) return { revision, items: [], nextCursor: null };

      const limit = boundedPageSize(input.limit);
      const normalized = input.query.slice(0, MAX_SEARCH_QUERY_LENGTH).trim().toLowerCase();
      const predicates: string[] = [];
      if (!input.includeStale)
        predicates.push(
          "(record.kind = 'files' AND json_extract(record.payload, '$.status') = 'indexed' OR record.kind <> 'files' AND json_extract(record.payload, '$.freshness') = 'current')",
        );
      const parameters: Array<string | number> = [terms.match, revision, ...input.kinds];
      let candidateScopePredicate = "";
      if (input.filePathPrefixes) {
        candidateScopePredicate = `EXISTS (SELECT 1 FROM knowledge_record_dependencies dependency
            WHERE dependency.revision = search_key.revision AND dependency.kind = search_key.kind AND dependency.id = search_key.record_id
              AND (${input.filePathPrefixes.map(() => "(dependency.file_path = ? OR dependency.file_path LIKE ? ESCAPE '\\')").join(" OR ")}))`;
        for (const prefix of input.filePathPrefixes) {
          const path = prefix.replace(/\/+$/u, "");
          parameters.push(path, `${escapeLike(path)}/%`);
        }
      }
      parameters.push(
        MAX_SEARCH_CANDIDATES,
        normalized,
        ...terms.exactNames,
        `%${escapeLike(terms.primary)}%`,
        `%${escapeLike(terms.primary)}%`,
      );
      const cursorPredicate = input.after
        ? "WHERE rank > ? OR (rank = ? AND kind > ?) OR (rank = ? AND kind = ? AND id > ?)"
        : "";
      if (input.after)
        parameters.push(
          input.after.rank,
          input.after.rank,
          input.after.kind,
          input.after.rank,
          input.after.kind,
          input.after.id,
        );
      parameters.push(limit + 1);
      const rows = yield* sql.unsafe<SearchRow>(
        `WITH matched AS MATERIALIZED (
          SELECT search_key.revision, search_key.kind, search_key.record_id,
            bm25(knowledge_record_fts, 2.0, 6.0, 3.0, 2.0, 1.0) AS score
          FROM knowledge_record_fts
          JOIN knowledge_search_keys search_key ON search_key.search_id = knowledge_record_fts.rowid
          WHERE knowledge_record_fts MATCH ?
            AND search_key.revision = ?
            AND search_key.kind IN (${placeholders(input.kinds.length)})
            ${candidateScopePredicate ? `AND ${candidateScopePredicate}` : ""}
          ORDER BY score, search_key.kind, search_key.record_id
          LIMIT ?
        ), ranked AS (
          SELECT record.kind, record.id, record.payload,
            CASE
              WHEN lower(record.file_path) = ? THEN 0.0
              WHEN lower(record.name) IN (${placeholders(terms.exactNames.length)}) THEN 1.0
              WHEN lower(record.name) LIKE ? ESCAPE '\\' OR lower(record.file_path) LIKE ? ESCAPE '\\' THEN 2.0
              ELSE 3.0 + matched.score / (1.0 + abs(matched.score))
            END AS rank
          FROM matched
          JOIN knowledge_records record ON record.revision = matched.revision AND record.kind = matched.kind AND record.id = matched.record_id
          ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
        )
        SELECT kind, id, payload, rank FROM ranked ${cursorPredicate}
        ORDER BY rank, kind, id LIMIT ?`,
        parameters,
      );
      const page = rows.slice(0, limit);
      const items = yield* Effect.forEach(page, (row) =>
        decodeRecord(row.kind, row.payload).pipe(
          Effect.map(
            (record) => ({ kind: row.kind, record, rank: row.rank }) as KnowledgeSearchHit<Kind>,
          ),
        ),
      );
      const last = rows.length > limit ? page.at(-1) : undefined;
      return {
        revision,
        items,
        nextCursor: last ? { rank: last.rank, kind: last.kind, id: last.id } : null,
      };
    }).pipe(sql.withTransaction, Effect.mapError(asStoreError("search static knowledge")));

  return { searchRecords };
}
