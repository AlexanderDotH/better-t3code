import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import type { KnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import { asStoreError } from "./KnowledgeStoreSchema.ts";
import { removeOwnedKnowledgeArtifact } from "./KnowledgeViews.ts";

const RETAINED_KNOWLEDGE_GENERATIONS = 3;
const ARTIFACT_COLLECTION_BATCH_SIZE = 100;

const retainedRevisions = Effect.fn("retainedKnowledgeRevisions")(function* (
  sql: SqlClient.SqlClient,
) {
  const rows = yield* sql<{ revision: number | null }>`
    WITH published(format) AS (
      SELECT json_extract(generation.metadata_json, '$.knowledgeFormat')
      FROM knowledge_state state
      LEFT JOIN knowledge_generations generation ON generation.revision = state.published_revision
      WHERE state.singleton = 1
    )
    SELECT revision FROM (
      SELECT revision FROM knowledge_generations
      WHERE status = 'completed' AND views_path IS NOT NULL
        AND (COALESCE((SELECT format FROM published), 'legacy-ai') <> 'static-v1'
          OR json_extract(metadata_json, '$.knowledgeFormat') = 'static-v1')
      ORDER BY revision DESC LIMIT ${RETAINED_KNOWLEDGE_GENERATIONS}
    )
    UNION SELECT published_revision FROM knowledge_state WHERE singleton = 1
    UNION SELECT active_revision FROM knowledge_state WHERE singleton = 1
    UNION SELECT revision FROM knowledge_state WHERE singleton = 1 AND lease_token IS NOT NULL
  `;
  return rows.flatMap((row) => (row.revision === null ? [] : [row.revision]));
});

function obsoleteRevisions(revisions: ReadonlyArray<number>, column: string): string {
  return revisions.length === 0
    ? "1 = 1"
    : `${column} NOT IN (${revisions.map(() => "?").join(",")})`;
}

function obsoleteRevisionRanges(revisions: ReadonlyArray<number>) {
  const retained = [...new Set(revisions)].sort((left, right) => left - right);
  if (retained.length === 0) return [{ predicate: "1 = 1", values: [] }];

  const ranges = [{ predicate: "revision < ?", values: [retained[0]!] }];
  for (let index = 1; index < retained.length; index++) {
    const previous = retained[index - 1]!;
    const next = retained[index]!;
    if (next > previous + 1)
      ranges.push({ predicate: "revision > ? AND revision < ?", values: [previous, next] });
  }
  ranges.push({ predicate: "revision > ?", values: [retained.at(-1)!] });
  return ranges;
}

/** Generation metadata keeps idempotency and status after heavy data expires. */
export const collectKnowledgeHistory = Effect.fn("collectKnowledgeHistory")(
  function* (sql: SqlClient.SqlClient, workspace: KnowledgeWorkspace) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
        const revisions = yield* retainedRevisions(sql);
        const obsolete = obsoleteRevisions(revisions, "revision");
        const ranges = obsoleteRevisionRanges(revisions);
        for (const table of [
          "knowledge_records",
          "knowledge_calls",
          "knowledge_record_dependencies",
          "knowledge_jobs",
        ]) {
          for (const range of ranges)
            yield* sql.unsafe(`DELETE FROM ${table} WHERE ${range.predicate}`, range.values);
        }
        yield* sql.unsafe(
          `UPDATE knowledge_generations SET views_path = NULL WHERE views_path IS NOT NULL AND ${obsolete}`,
          revisions,
        );
      }),
    );

    // Ownership rows survive interruption until their matching file has been checked.
    // Short transactions also let the active worker renew its lease between batches.
    while (
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
          const revisions = yield* retainedRevisions(sql);
          const rows = yield* sql.unsafe<{ path: string; content_hash: string; revision: number }>(
            `
      SELECT artifact.path, artifact.content_hash, artifact.revision
      FROM knowledge_artifacts artifact
      LEFT JOIN knowledge_generations generation ON generation.revision = artifact.revision
      WHERE (${obsoleteRevisions(revisions, "artifact.revision")} AND generation.views_path IS NULL)
        OR (generation.status = 'completed' AND generation.views_path IS NOT NULL
          AND substr(artifact.path, 1, length(generation.views_path) + 1) <> generation.views_path || '/')
      ORDER BY artifact.path LIMIT ${ARTIFACT_COLLECTION_BATCH_SIZE}
    `,
            revisions,
          );
          for (const artifact of rows) {
            yield* removeOwnedKnowledgeArtifact(workspace, artifact);
            yield* sql`DELETE FROM knowledge_artifacts WHERE path = ${artifact.path} AND content_hash = ${artifact.content_hash} AND revision = ${artifact.revision}`;
          }
          return rows.length > 0;
        }),
      )
    ) {}
  },
  Effect.mapError(asStoreError("collect obsolete knowledge generations")),
);
