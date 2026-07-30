import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration038 from "./038_ProjectionThreadsSnoozedCompatibility.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const snoozeColumns = ["snoozed_until", "snoozed_at"] as const;

const getProjectionColumns = Effect.fn("getProjectionColumns")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
});

it.effect("038_ProjectionThreadsSnoozedCompatibility repairs a legacy fork migration 34", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          created_at,
          updated_at
        )
        VALUES (
          'thread-legacy',
          'project-legacy',
          'Legacy thread',
          '2026-07-30T00:00:00.000Z',
          '2026-07-30T00:00:00.000Z'
        )
      `;
    yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (33, 'ProjectSpeechProfiles'),
          (34, 'ProjectionThreadSubagents')
      `;

    yield* runMigrations({ toMigrationInclusive: 37 });
    const columnsBeforeRepair = yield* getProjectionColumns();
    for (const name of snoozeColumns) {
      assert.isFalse(columnsBeforeRepair.some((column) => column.name === name));
    }

    const migrations = yield* runMigrations({ toMigrationInclusive: 38 });
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[38, "ProjectionThreadsSnoozedCompatibility"]],
    );

    const columnsAfterRepair = yield* getProjectionColumns();
    for (const name of snoozeColumns) {
      assert.isTrue(columnsAfterRepair.some((column) => column.name === name));
    }

    const rows = yield* sql<{
      readonly threadId: string;
      readonly snoozedUntil: string | null;
      readonly snoozedAt: string | null;
    }>`
        SELECT
          thread_id AS "threadId",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt"
        FROM projection_threads
        WHERE thread_id = 'thread-legacy'
      `;
    assert.deepStrictEqual(rows, [
      {
        threadId: "thread-legacy",
        snoozedUntil: null,
        snoozedAt: null,
      },
    ]);

    const legacyLedger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id IN (34, 38)
        ORDER BY migration_id
      `;
    assert.deepStrictEqual(legacyLedger, [
      { migrationId: 34, name: "ProjectionThreadSubagents" },
      { migrationId: 38, name: "ProjectionThreadsSnoozedCompatibility" },
    ]);

    yield* Migration038;
    yield* Migration038;
    assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 38 }), []);
  }).pipe(provideFreshDatabase),
);
