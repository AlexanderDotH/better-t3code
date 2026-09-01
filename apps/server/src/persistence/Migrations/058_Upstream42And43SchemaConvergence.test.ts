import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0058 from "./058_Upstream42And43SchemaConvergence.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("058_Upstream42And43SchemaConvergence", (it) => {
  it.effect("idempotently restores the fork schemas skipped by an upstream ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 41 });

      yield* Migration0058;
      yield* Migration0058;

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('git_workbench_queue', 'git_workbench_undo_snapshots')
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map(({ name }) => name),
        ["git_workbench_queue", "git_workbench_undo_snapshots"],
      );

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_subagents)
      `;
      const columnNames = new Set(columns.map(({ name }) => name));
      assert.ok(columnNames.has("origin"));
      assert.ok(columnNames.has("provider_instance_id"));
      assert.ok(columnNames.has("provider_driver"));
    }),
  );
});
