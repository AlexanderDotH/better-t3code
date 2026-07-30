import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration041 from "./041_ProjectionThreadSubagents.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect("041 recreates subagent tables when a conflicting migration 37 was recorded", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 36 });
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES
        (37, 'LegacyDifferentMigration'),
        (38, 'ProjectionThreadsSnoozedCompatibility')
    `;

    yield* runMigrations({ toMigrationInclusive: 41 });

    for (const tableName of [
      "projection_thread_subagents",
      "projection_thread_subagent_messages",
      "projection_thread_subagent_proposed_plans",
      "projection_thread_subagent_activities",
    ]) {
      const tables = yield* sql.unsafe<{ readonly name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
      );
      assert.deepStrictEqual(tables, [{ name: tableName }]);
    }
  }).pipe(provideFreshDatabase),
);

it.effect("041 preserves existing subagent rows when reapplied", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 41 });
    yield* sql`
      INSERT INTO projection_thread_subagents (
        thread_id, subagent_id, provider_thread_id, parent_subagent_id, path, name,
        nickname, role, task, model, reasoning_effort, depth, status, status_message,
        latest_progress_json, latest_turn_json, started_at, updated_at, completed_at
      )
      VALUES (
        'thread-existing', 'agent-existing', 'provider-thread-existing', NULL,
        '/root/existing', 'existing', NULL, NULL, 'Preserve this row', NULL, NULL, 1,
        'completed', NULL, NULL, NULL, '2026-07-30T00:00:00.000Z',
        '2026-07-30T00:01:00.000Z', '2026-07-30T00:01:00.000Z'
      )
    `;

    yield* Migration041;
    yield* Migration041;

    const rows = yield* sql<{ readonly subagentId: string; readonly task: string | null }>`
      SELECT subagent_id AS "subagentId", task
      FROM projection_thread_subagents
    `;
    assert.deepStrictEqual(rows, [{ subagentId: "agent-existing", task: "Preserve this row" }]);
  }).pipe(provideFreshDatabase),
);
