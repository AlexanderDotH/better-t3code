import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0059 from "./059_KnowledgeGraphDerivedData.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("059_KnowledgeGraphDerivedData", (it) => {
  it.effect("creates isolated rebuildable graph and unlimited semantic queue tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migration0059;
      yield* Migration0059;

      const tables = yield* sql.unsafe<{ readonly name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'knowledge_graph_%' ORDER BY name",
      );
      assert.deepStrictEqual(
        tables.map(({ name }) => name),
        [
          "knowledge_graph_edge_evidence",
          "knowledge_graph_edges",
          "knowledge_graph_evidence",
          "knowledge_graph_file_fingerprints",
          "knowledge_graph_node_evidence",
          "knowledge_graph_nodes",
          "knowledge_graph_patch_log",
          "knowledge_graph_scopes",
          "knowledge_graph_semantic_environments",
          "knowledge_graph_semantic_queue",
        ],
      );

      const orchestrationColumns = yield* sql.unsafe<{ readonly name: string }>(
        "PRAGMA table_info('orchestration_events')",
      );
      assert.isFalse(orchestrationColumns.some(({ name }) => name.includes("knowledge_graph")));

      const evidenceSql = yield* sql.unsafe<{ readonly sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_graph_evidence'",
      );
      assert.notInclude(evidenceSql[0]?.sql ?? "", "source_body");
      assert.include(evidenceSql[0]?.sql ?? "", "length(excerpt) <= 12000");

      const scopeIndexes = yield* sql.unsafe<{ readonly name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'knowledge_graph_scopes' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
      );
      assert.deepStrictEqual(
        scopeIndexes.map(({ name }) => name),
        ["idx_knowledge_graph_scopes_project_root"],
      );

      const semanticEnvironmentColumns = yield* sql.unsafe<{
        readonly name: string;
        readonly notnull: number;
        readonly dfltValue: string | null;
      }>(
        `SELECT name, "notnull" AS "notnull", dflt_value AS "dfltValue"
         FROM pragma_table_info('knowledge_graph_semantic_environments')
         ORDER BY cid`,
      );
      assert.deepStrictEqual(
        semanticEnvironmentColumns.map(({ name }) => name),
        [
          "environment_id",
          "paused",
          "rate_limited_until",
          "semantic_model_key",
          "model_generation",
          "updated_at",
        ],
      );
      assert.deepInclude(
        semanticEnvironmentColumns.find(({ name }) => name === "model_generation"),
        { notnull: 1, dfltValue: "0" },
      );

      yield* sql`INSERT INTO knowledge_graph_scopes
        (scope_id, environment_id, project_id, effective_workspace_root, is_worktree,
         created_at, updated_at)
        VALUES
        ('scope-main', 'environment-1', 'project-1', '/workspace/project', 0, 'now', 'now'),
        ('scope-worktree', 'environment-1', 'project-1', '/workspace/project-worktree', 1,
         'now', 'now')`;
      const isolatedScopes = yield* sql<{ readonly scopeId: string; readonly isWorktree: number }>`
        SELECT scope_id AS "scopeId", is_worktree AS "isWorktree"
        FROM knowledge_graph_scopes
        ORDER BY scope_id`;
      assert.deepStrictEqual(isolatedScopes, [
        { scopeId: "scope-main", isWorktree: 0 },
        { scopeId: "scope-worktree", isWorktree: 1 },
      ]);
    }),
  );
});
