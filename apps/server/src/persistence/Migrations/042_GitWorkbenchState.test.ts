import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0042 from "./042_GitWorkbenchState.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_GitWorkbenchState", (it) => {
  it.effect("creates one durable queue row per environment worktree and undo metadata", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Migration0042;

      const queueColumns = yield* sql.unsafe<{ readonly name: string }>(
        "PRAGMA table_info('git_workbench_queue')",
      );
      assert.deepStrictEqual(
        queueColumns.map(({ name }) => name),
        [
          "environment_id",
          "worktree_root",
          "workflow_id",
          "thread_id",
          "turn_id",
          "status",
          "revision",
          "workflow_json",
          "preconditions_json",
          "review_reasons_json",
          "last_error",
          "created_at",
          "updated_at",
        ],
      );

      const undoColumns = yield* sql.unsafe<{ readonly name: string }>(
        "PRAGMA table_info('git_workbench_undo_snapshots')",
      );
      assert.deepStrictEqual(
        undoColumns.map(({ name }) => name),
        [
          "id",
          "cwd",
          "worktree_root",
          "reason",
          "branch_ref",
          "head_oid",
          "base_ref_namespace",
          "index_tree_oid",
          "worktree_commit_oid",
          "captured_state_token",
          "metadata_json",
          "created_at",
          "expires_at",
        ],
      );

      const queueIndexes = yield* sql.unsafe<{ readonly name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'git_workbench_queue' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
      );
      assert.deepStrictEqual(
        queueIndexes.map(({ name }) => name),
        ["idx_git_workbench_queue_recovery", "idx_git_workbench_queue_turn"],
      );
    }),
  );
});
