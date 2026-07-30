import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration040 from "./040_ProjectionCompatibility.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const expectedThreadColumns = [
  "settled_override",
  "settled_at",
  "snoozed_until",
  "snoozed_at",
  "title_regeneration_request_id",
  "title_regeneration_started_at",
] as const;

const assertCompatibilitySchema = Effect.fn("assertCompatibilitySchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const speechColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(project_speech_profiles)
  `;

  for (const name of expectedThreadColumns) {
    assert.isTrue(threadColumns.some((column) => column.name === name));
  }
  assert.deepStrictEqual(
    speechColumns.map(({ name }) => name),
    [
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
    ],
  );
});

it.effect("040_ProjectionCompatibility upgrades a clean database ending at migration 32", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 32 });

    const migrations = yield* runMigrations({ toMigrationInclusive: 40 });

    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [39, "ProjectionThreadSessionAbortState"],
        [40, "ProjectionCompatibility"],
      ],
    );
    yield* assertCompatibilitySchema();
  }).pipe(provideFreshDatabase),
);

it.effect("040_ProjectionCompatibility repairs a legacy fork without rewriting its ledger", () =>
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

    yield* runMigrations({ toMigrationInclusive: 40 });
    yield* assertCompatibilitySchema();

    const threadRows = yield* sql<{
      readonly threadId: string;
      readonly settledAt: string | null;
      readonly snoozedAt: string | null;
    }>`
      SELECT
        thread_id AS "threadId",
        settled_at AS "settledAt",
        snoozed_at AS "snoozedAt"
      FROM projection_threads
      WHERE thread_id = 'thread-legacy'
    `;
    assert.deepStrictEqual(threadRows, [
      {
        threadId: "thread-legacy",
        settledAt: null,
        snoozedAt: null,
      },
    ]);

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

it.effect("040_ProjectionCompatibility is idempotent on a live-shaped migration 38 database", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* Migration040;
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
        'project-existing',
        'Existing project',
        '/workspace/existing',
        'example/existing',
        'indexed',
        'Existing context',
        '["Effect"]',
        '["TypeScript"]',
        '2026-07-30T00:00:00.000Z',
        '2026-07-30T00:00:00.000Z',
        NULL
      )
    `;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES
        (33, 'ProjectSpeechProfiles'),
        (34, 'ProjectionThreadsSnoozed'),
        (35, 'ProjectionThreadTitleRegeneration'),
        (36, 'ProjectSpeechProfilesCompatibility'),
        (37, 'ProjectionThreadSubagents'),
        (38, 'ProjectionThreadsSnoozedCompatibility')
    `;

    const migrations = yield* runMigrations({ toMigrationInclusive: 40 });

    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [39, "ProjectionThreadSessionAbortState"],
        [40, "ProjectionCompatibility"],
      ],
    );
    yield* assertCompatibilitySchema();
    yield* Migration040;
    const projects = yield* sql<{ readonly projectId: string }>`
      SELECT project_id AS "projectId"
      FROM project_speech_profiles
    `;
    assert.deepStrictEqual(projects, [{ projectId: "project-existing" }]);

    const legacyLedger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      WHERE migration_id BETWEEN 33 AND 38
      ORDER BY migration_id
    `;
    assert.deepStrictEqual(legacyLedger, [
      { migrationId: 33, name: "ProjectSpeechProfiles" },
      { migrationId: 34, name: "ProjectionThreadsSnoozed" },
      { migrationId: 35, name: "ProjectionThreadTitleRegeneration" },
      { migrationId: 36, name: "ProjectSpeechProfilesCompatibility" },
      { migrationId: 37, name: "ProjectionThreadSubagents" },
      { migrationId: 38, name: "ProjectionThreadsSnoozedCompatibility" },
    ]);
  }).pipe(provideFreshDatabase),
);
