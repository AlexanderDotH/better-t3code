import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("060_ProjectionThreadSubagentServiceTier", (it) => {
  it.effect("adds service tier storage without dropping existing subagents", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 59 });
      yield* sql`
        INSERT INTO projection_thread_subagents (
          thread_id, subagent_id, provider_thread_id, name, depth, status, started_at, updated_at
        ) VALUES (
          'thread-existing', 'agent-existing', 'provider-existing', 'Existing', 1, 'running',
          '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 60 });

      const rows = yield* sql<{ readonly id: string; readonly serviceTier: string | null }>`
        SELECT subagent_id AS "id", service_tier AS "serviceTier"
        FROM projection_thread_subagents
      `;
      assert.deepStrictEqual(rows, [{ id: "agent-existing", serviceTier: null }]);
    }),
  );
});
