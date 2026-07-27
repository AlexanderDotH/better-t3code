import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration036 from "./036_ProjectSpeechProfilesCompatibility.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const expectedProjectionColumns = [
  "settled_override",
  "settled_at",
  "snoozed_until",
  "snoozed_at",
  "title_regeneration_request_id",
  "title_regeneration_started_at",
] as const;

const expectedSpeechColumns = [
  "project_id",
  "project_title",
  "workspace_root",
  "repository_key",
  "source",
  "context_prompt",
  "keyterms_json",
  "technologies_json",
  "created_at",
  "updated_at",
  "warning",
] as const;

const createLegacySpeechSchema = Effect.fn("createLegacySpeechSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE project_speech_profiles (
      project_id TEXT PRIMARY KEY,
      project_title TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      repository_key TEXT,
      source TEXT NOT NULL CHECK (source IN ('indexed', 'basic')),
      context_prompt TEXT NOT NULL,
      keyterms_json TEXT NOT NULL,
      technologies_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      warning TEXT
    )
  `;
  yield* sql`
    CREATE INDEX idx_project_speech_profiles_created
    ON project_speech_profiles(created_at, project_id)
  `;
});

const assertCompleteSchema = Effect.fn("assertCompleteSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const speechColumns = yield* sql<{
    readonly name: string;
    readonly notnull: number;
    readonly pk: number;
  }>`PRAGMA table_info(project_speech_profiles)`;
  const indexes = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'project_speech_profiles'
  `;

  for (const name of expectedProjectionColumns) {
    assert.isTrue(projectionColumns.some((column) => column.name === name));
  }
  assert.deepStrictEqual(
    speechColumns.map(({ name }) => name),
    expectedSpeechColumns,
  );
  assert.strictEqual(speechColumns.find(({ name }) => name === "project_id")?.pk, 1);
  assert.strictEqual(speechColumns.find(({ name }) => name === "repository_key")?.notnull, 0);
  assert.strictEqual(speechColumns.find(({ name }) => name === "warning")?.notnull, 0);
  assert.isTrue(indexes.some(({ name }) => name === "idx_project_speech_profiles_created"));
});

it.effect("036_ProjectSpeechProfilesCompatibility upgrades a database ending at migration 32", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 32 });
    const migrations = yield* runMigrations();
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [33, "ProjectionThreadsSettled"],
        [34, "ProjectionThreadsSnoozed"],
        [35, "ProjectionThreadTitleRegeneration"],
        [36, "ProjectSpeechProfilesCompatibility"],
      ],
    );
    yield* assertCompleteSchema();
  }).pipe(provideFreshDatabase),
);

it.effect(
  "036_ProjectSpeechProfilesCompatibility upgrades an upstream database ending at migration 35",
  () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 35 });
      const migrations = yield* runMigrations();
      assert.deepStrictEqual(
        migrations.map(([id, name]) => [id, name]),
        [[36, "ProjectSpeechProfilesCompatibility"]],
      );
      yield* assertCompleteSchema();
    }).pipe(provideFreshDatabase),
);

it.effect("036_ProjectSpeechProfilesCompatibility repairs a legacy fork migration 33", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* createLegacySpeechSchema();
    yield* sql`
        INSERT INTO project_speech_profiles (
          project_id,
          project_title,
          workspace_root,
          repository_key,
          source,
          context_prompt,
          keyterms_json,
          technologies_json,
          created_at,
          updated_at,
          warning
        )
        VALUES (
          'project-legacy',
          'Legacy project',
          '/workspace/legacy',
          'example/legacy',
          'indexed',
          'Legacy context',
          '["Effect","SQLite"]',
          '["TypeScript"]',
          '2026-07-12T00:00:00.000Z',
          '2026-07-13T00:00:00.000Z',
          'legacy warning'
        )
      `;
    yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (33, 'ProjectSpeechProfiles')
      `;

    const migrations = yield* runMigrations();
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [34, "ProjectionThreadsSnoozed"],
        [35, "ProjectionThreadTitleRegeneration"],
        [36, "ProjectSpeechProfilesCompatibility"],
      ],
    );
    yield* assertCompleteSchema();

    const rows = yield* sql<{
      readonly projectId: string;
      readonly projectTitle: string;
      readonly warning: string | null;
    }>`
        SELECT
          project_id AS "projectId",
          project_title AS "projectTitle",
          warning
        FROM project_speech_profiles
      `;
    assert.deepStrictEqual(rows, [
      {
        projectId: "project-legacy",
        projectTitle: "Legacy project",
        warning: "legacy warning",
      },
    ]);
    const legacyLedger = yield* sql<{ readonly name: string }>`
        SELECT name FROM effect_sql_migrations WHERE migration_id = 33
      `;
    assert.deepStrictEqual(legacyLedger, [{ name: "ProjectSpeechProfiles" }]);
  }).pipe(provideFreshDatabase),
);

it.effect("036_ProjectSpeechProfilesCompatibility is idempotent when applied again", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* Migration036;
    yield* Migration036;
    const migrations = yield* runMigrations();
    assert.deepStrictEqual(migrations, []);
    yield* assertCompleteSchema();

    const migrationRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM effect_sql_migrations
        WHERE migration_id = 36
      `;
    assert.deepStrictEqual(migrationRows, [{ count: 1 }]);
  }).pipe(provideFreshDatabase),
);
