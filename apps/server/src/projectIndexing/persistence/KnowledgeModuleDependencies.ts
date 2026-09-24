import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { decodeRecord } from "./KnowledgeRecords.ts";

const DEPENDENCY_PAGE_SIZE = 200;

/** Derive package edges only from current imports whose source and target are indexed. */
export const refreshKnowledgeModuleDependencies = Effect.fn("refreshKnowledgeModuleDependencies")(
  function* (sql: SqlClient.SqlClient, revision: number) {
    yield* sql`CREATE TEMP TABLE knowledge_module_scopes (
      module_id TEXT PRIMARY KEY,
      scope_path TEXT NOT NULL,
      scope_length INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL DEFAULT 1
    ) WITHOUT ROWID`;
    yield* sql`CREATE TEMP TABLE knowledge_import_page (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL
    ) WITHOUT ROWID`;
    yield* sql`CREATE TEMP TABLE knowledge_package_edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY(source_id, target_id)
    ) WITHOUT ROWID`;

    let afterModuleId = "";
    while (true) {
      const rows = yield* sql<{
        id: string;
        payload: string;
      }>`SELECT id, payload FROM knowledge_records
        WHERE revision = ${revision} AND kind = 'modules' AND id > ${afterModuleId}
          AND json_extract(payload, '$.provenance') = 'parser'
        ORDER BY id LIMIT ${DEPENDENCY_PAGE_SIZE}`;
      if (rows.length === 0) break;
      for (const row of rows) {
        const module = yield* decodeRecord("modules", row.payload);
        if (module.filePaths.length !== 1) continue;
        const manifestPath = module.filePaths[0]!;
        const slash = manifestPath.lastIndexOf("/");
        const scopePath = slash < 0 ? "" : manifestPath.slice(0, slash);
        yield* sql`INSERT INTO temp.knowledge_module_scopes(module_id, scope_path, scope_length)
          VALUES (${module.id}, ${scopePath}, ${scopePath.length})`;
      }
      afterModuleId = rows.at(-1)!.id;
    }
    yield* sql`UPDATE temp.knowledge_module_scopes SET duplicate_count = (
      SELECT COUNT(*) FROM temp.knowledge_module_scopes same_scope
      WHERE same_scope.scope_path = knowledge_module_scopes.scope_path
    )`;

    let afterImportId = "";
    while (true) {
      yield* sql`DELETE FROM temp.knowledge_import_page`;
      yield* sql`INSERT INTO temp.knowledge_import_page(id, source_path, target_path)
        SELECT import.id, import.file_path, json_extract(import.payload, '$.targetPath')
        FROM knowledge_records import
        JOIN knowledge_records source ON source.revision = import.revision AND source.kind = 'files' AND source.id = import.file_path
        JOIN knowledge_records target ON target.revision = import.revision AND target.kind = 'files' AND target.id = json_extract(import.payload, '$.targetPath')
        WHERE import.revision = ${revision} AND import.kind = 'imports' AND import.id > ${afterImportId}
          AND json_extract(import.payload, '$.resolution') = 'workspace'
          AND json_extract(import.payload, '$.freshness') = 'current'
          AND json_extract(import.payload, '$.sourceHash') = json_extract(source.payload, '$.contentHash')
          AND json_extract(source.payload, '$.status') = 'indexed'
          AND json_extract(target.payload, '$.status') = 'indexed'
        ORDER BY import.id LIMIT ${DEPENDENCY_PAGE_SIZE}`;
      const last = (yield* sql<{
        id: string;
      }>`SELECT id FROM temp.knowledge_import_page ORDER BY id DESC LIMIT 1`)[0];
      if (!last) break;
      yield* sql`INSERT OR IGNORE INTO temp.knowledge_package_edges(source_id, target_id)
        SELECT source_scope.module_id, target_scope.module_id
        FROM temp.knowledge_import_page import
        JOIN temp.knowledge_module_scopes source_scope ON source_scope.scope_path = (
          SELECT candidate.scope_path FROM temp.knowledge_module_scopes candidate
          WHERE candidate.scope_path = '' OR substr(import.source_path, 1, candidate.scope_length + 1) = candidate.scope_path || '/'
          ORDER BY candidate.scope_length DESC, candidate.module_id LIMIT 1
        )
        JOIN temp.knowledge_module_scopes target_scope ON target_scope.scope_path = (
          SELECT candidate.scope_path FROM temp.knowledge_module_scopes candidate
          WHERE candidate.scope_path = '' OR substr(import.target_path, 1, candidate.scope_length + 1) = candidate.scope_path || '/'
          ORDER BY candidate.scope_length DESC, candidate.module_id LIMIT 1
        )
        WHERE source_scope.duplicate_count = 1 AND target_scope.duplicate_count = 1
          AND source_scope.module_id <> target_scope.module_id`;
      afterImportId = last.id;
    }

    yield* sql`UPDATE knowledge_records SET payload = json_set(payload, '$.dependsOnModuleIds', json(
      (SELECT json_group_array(target_id) FROM (
        SELECT target_id FROM temp.knowledge_package_edges edge
        WHERE edge.source_id = knowledge_records.id ORDER BY target_id
      ))
    )) WHERE revision = ${revision} AND kind = 'modules' AND json_extract(payload, '$.provenance') = 'parser'`;
    const moduleCount =
      (yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM temp.knowledge_module_scopes`)[0]
        ?.count ?? 0;
    const dependencyCount =
      (yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM temp.knowledge_package_edges`)[0]
        ?.count ?? 0;
    yield* sql`DROP TABLE temp.knowledge_package_edges`;
    yield* sql`DROP TABLE temp.knowledge_import_page`;
    yield* sql`DROP TABLE temp.knowledge_module_scopes`;
    return { moduleCount, dependencyCount };
  },
);
