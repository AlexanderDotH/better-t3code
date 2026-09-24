import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";

/** Replace affected static facts in the active revision without touching the published revision. */
export const resetKnowledgeFileStructure = Effect.fn("resetKnowledgeFileStructure")(function* (
  sql: SqlClient.SqlClient,
  revision: number,
  filePaths: ReadonlyArray<string>,
) {
  if (filePaths.length > 128 || filePaths.some((path) => !isSafeProjectSourcePath(path)))
    return yield* new KnowledgeStoreError({
      code: "invalid-reset",
      detail:
        "Structural reset accepts at most 128 readable source paths. Remove knowledge for private or excluded files instead.",
    });
  if (filePaths.length === 0) return;
  const placeholders = filePaths.map(() => "?").join(",");
  const excluded = yield* sql.unsafe<{ id: string }>(
    `SELECT id FROM knowledge_records WHERE revision = ? AND kind = 'files' AND id IN (${placeholders}) AND (json_extract(payload, '$.status') IN ('skipped','deleted') OR json_extract(payload, '$.contentHash') = 'unread') LIMIT 1`,
    [revision, ...filePaths],
  );
  if (excluded[0])
    return yield* new KnowledgeStoreError({
      code: "invalid-reset",
      detail:
        "Remove knowledge for deleted or excluded files instead of retaining their descriptions.",
    });

  // Keep the selection inside SQLite so a large source file never becomes an
  // unbounded JavaScript ID array. The surrounding writer transaction owns it.
  yield* sql`CREATE TEMP TABLE knowledge_structure_reset_ids(kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(kind, id)) WITHOUT ROWID`;
  yield* sql.unsafe(
    `
    INSERT OR IGNORE INTO temp.knowledge_structure_reset_ids(kind, id)
    SELECT kind, id FROM knowledge_records WHERE revision = ? AND kind IN ('entities','callsites','imports','evidence','gaps') AND file_path IN (${placeholders})
    UNION
    SELECT record.kind, record.id FROM knowledge_records record
      JOIN knowledge_record_dependencies dependency ON dependency.revision = record.revision AND dependency.kind = record.kind AND dependency.id = record.id
      WHERE record.revision = ? AND dependency.file_path IN (${placeholders})
        AND record.kind = 'modules' AND json_extract(record.payload, '$.provenance') = 'parser'
    UNION
    SELECT 'rules', record.id FROM knowledge_records record
      JOIN json_each(record.payload, '$.evidenceIds') reference
      JOIN knowledge_records evidence ON evidence.revision = record.revision AND evidence.kind = 'evidence' AND evidence.id = reference.value
      WHERE record.revision = ? AND record.kind = 'rules'
        AND json_extract(record.payload, '$.provenance') = 'parser'
        AND json_extract(record.payload, '$.source') = 'explicit'
        AND evidence.file_path IN (${placeholders})
    UNION
    SELECT 'imports', dependency.id FROM knowledge_record_dependencies dependency
      WHERE dependency.revision = ? AND dependency.kind = 'imports' AND dependency.file_path IN (${placeholders})
    UNION
    SELECT 'callsites', dependency.id FROM knowledge_record_dependencies dependency
      WHERE dependency.revision = ? AND dependency.kind = 'callsites' AND dependency.file_path IN (${placeholders})
    UNION
    SELECT 'callsites', edge.callsite_id FROM knowledge_calls edge
      JOIN knowledge_records target ON target.revision = edge.revision AND target.kind = 'entities' AND target.id = edge.callee_id
      WHERE edge.revision = ? AND target.file_path IN (${placeholders})
    UNION
    SELECT 'callsites', edge.callsite_id FROM knowledge_calls edge
      JOIN knowledge_records caller ON caller.revision = edge.revision AND caller.kind = 'entities' AND caller.id = edge.caller_id
      WHERE edge.revision = ? AND caller.file_path IN (${placeholders})
  `,
    [
      revision,
      ...filePaths,
      revision,
      ...filePaths,
      revision,
      ...filePaths,
      revision,
      ...filePaths,
      revision,
      ...filePaths,
      revision,
      ...filePaths,
      revision,
      ...filePaths,
    ],
  );
  yield* sql`INSERT OR IGNORE INTO temp.knowledge_structure_reset_ids(kind, id)
    SELECT 'gaps', gap.id FROM temp.knowledge_structure_reset_ids selected
      JOIN knowledge_records callsite ON callsite.revision = ${revision} AND callsite.kind = 'callsites' AND callsite.id = selected.id
      JOIN knowledge_records gap ON gap.revision = callsite.revision AND gap.kind = 'gaps' AND gap.id = 'gap:' || callsite.id AND gap.file_path = callsite.file_path
      WHERE selected.kind = 'callsites' AND json_extract(gap.payload, '$.kind') = 'unresolved-call'`;

  yield* sql.unsafe(
    `UPDATE knowledge_records SET payload = json_set(payload, '$.status', 'pending') WHERE revision = ? AND kind = 'files' AND id IN (${placeholders})`,
    [revision, ...filePaths],
  );
  yield* sql`DELETE FROM knowledge_calls WHERE revision = ${revision} AND callsite_id IN (SELECT id FROM temp.knowledge_structure_reset_ids WHERE kind = 'callsites')`;
  yield* sql`DELETE FROM knowledge_record_dependencies WHERE revision = ${revision} AND (kind, id) IN (SELECT kind, id FROM temp.knowledge_structure_reset_ids)`;
  yield* sql`DELETE FROM knowledge_records WHERE revision = ${revision} AND (kind, id) IN (SELECT kind, id FROM temp.knowledge_structure_reset_ids)`;
  yield* sql`DROP TABLE temp.knowledge_structure_reset_ids`;
});
