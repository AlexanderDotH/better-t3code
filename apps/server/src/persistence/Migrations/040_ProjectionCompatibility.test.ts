import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration040 from "./040_ProjectionCompatibility.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const expectedTail = [
  [33, "ProjectionThreadsSettled"],
  [34, "ProjectionThreadsSnoozed"],
  [35, "ProjectionThreadTitleRegeneration"],
  [36, "ProjectSpeechProfilesCompatibility"],
  [37, "ProjectionThreadSubagents"],
  [38, "ProjectionThreadsSnoozedCompatibility"],
  [39, "ProjectionThreadSessionAbortState"],
  [40, "ProjectionCompatibility"],
  [41, "ProjectionThreadSubagents"],
] as const;

it("preserves the public migration registry from 33 through 41", () => {
  assert.deepStrictEqual(
    migrationEntries.filter(([id]) => id >= 33 && id <= 41).map(([id, name]) => [id, name]),
    expectedTail,
  );
});

it.effect("040 repairs legacy fork ledgers without rewriting their history", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES
        (33, 'ProjectSpeechProfiles'),
        (34, 'ProjectionThreadSubagents')
    `;

    yield* runMigrations({ toMigrationInclusive: 40 });

    const threadColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_threads)
    `;
    for (const name of [
      "settled_override",
      "settled_at",
      "snoozed_until",
      "snoozed_at",
      "title_regeneration_request_id",
      "title_regeneration_started_at",
    ]) {
      assert.isTrue(threadColumns.some((column) => column.name === name));
    }

    const speechTables = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'project_speech_profiles'
    `;
    assert.deepStrictEqual(speechTables, [{ name: "project_speech_profiles" }]);

    const legacyLedger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      WHERE migration_id IN (33, 34)
      ORDER BY migration_id
    `;
    assert.deepStrictEqual(legacyLedger, [
      { migrationId: 33, name: "ProjectSpeechProfiles" },
      { migrationId: 34, name: "ProjectionThreadSubagents" },
    ]);
  }).pipe(provideFreshDatabase),
);

it.effect("040 is idempotent after a live-shaped migration 38 database", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 38 });
    yield* Migration040;
    yield* Migration040;

    const migrations = yield* runMigrations({ toMigrationInclusive: 40 });
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [39, "ProjectionThreadSessionAbortState"],
        [40, "ProjectionCompatibility"],
      ],
    );
  }).pipe(provideFreshDatabase),
);
