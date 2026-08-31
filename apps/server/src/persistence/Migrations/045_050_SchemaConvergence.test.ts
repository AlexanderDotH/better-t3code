import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, migrationManifest, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import ForkMigration036 from "./036_ProjectSpeechProfilesCompatibility.ts";
import ForkMigration037 from "./037_ProjectionThreadSubagents.ts";
import Migration045 from "./045_ForkSchemaConvergence.ts";
import Migration046 from "./046_ProjectionThreadsPinnedCompatibility.ts";
import Migration047 from "./047_ProjectionTurnsKeysetIndexCompatibility.ts";
import Migration048 from "./048_ProjectionThreadsPinOrderKeyCompatibility.ts";
import Migration049 from "./049_ProjectionProjectsDefaultThreadEnvModeCompatibility.ts";
import Migration050 from "./050_ProjectionProjectFaviconPathCompatibility.ts";
import Migration051 from "./051_ProjectionProjectCheckpointsEnabled.ts";
import Migration052 from "./052_AuthSessionClientConnectionCompatibility.ts";
import Migration053 from "./053_ProjectionThreadSubagentManagedOrigin.ts";
import Migration056 from "./056_ProjectionThreadLinkedPullRequest.ts";
import Migration057 from "./057_ProjectionThreadsUnsettledAt.ts";

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
  [42, "GitWorkbenchState"],
  [43, "ProjectionThreadSubagentFetchMetadata"],
  [44, "ProjectAgentCoordination"],
  [45, "ForkSchemaConvergence"],
  [46, "ProjectionThreadsPinnedCompatibility"],
  [47, "ProjectionTurnsKeysetIndexCompatibility"],
  [48, "ProjectionThreadsPinOrderKeyCompatibility"],
  [49, "ProjectionProjectsDefaultThreadEnvModeCompatibility"],
  [50, "ProjectionProjectFaviconPathCompatibility"],
  [51, "ProjectionProjectCheckpointsEnabled"],
  [52, "AuthSessionClientConnectionCompatibility"],
  [53, "ProjectionThreadSubagentManagedOrigin"],
  [54, "ProjectionHarnessChatSync"],
  [55, "ProjectionThreadForks"],
  [56, "ProjectionThreadLinkedPullRequest"],
  [57, "ProjectionThreadsUnsettledAt"],
  [58, "Upstream42And43SchemaConvergence"],
  [59, "KnowledgeGraphDerivedData"],
] as const;

const applyUpstreamSchema = Effect.gen(function* () {
  yield* Migration046;
  yield* Migration047;
  yield* Migration048;
  yield* Migration049;
  yield* Migration050;
});

const applyCompatibilityTail = Effect.gen(function* () {
  yield* Migration045;
  yield* applyUpstreamSchema;
  yield* Migration051;
  yield* Migration052;
  yield* Migration053;
});

interface SchemaEntry {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string | null;
}

interface ColumnEntry {
  readonly tableName: string;
  readonly name: string;
  readonly type: string;
  readonly notNull: number;
  readonly defaultValue: string | null;
  readonly primaryKey: number;
}

interface ScenarioSnapshot {
  readonly schema: ReadonlyArray<SchemaEntry>;
  readonly columns: ReadonlyArray<ColumnEntry>;
  readonly integrity: ReadonlyArray<string>;
}

const captureScenario = (setup: Effect.Effect<void, unknown, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* setup;
    const sql = yield* SqlClient.SqlClient;
    const schema = yield* sql<SchemaEntry>`
      SELECT
        type,
        name,
        tbl_name AS "tableName",
        CASE WHEN type = 'index' THEN sql ELSE NULL END AS sql
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_%'
        AND name != 'effect_sql_migrations'
      ORDER BY type, name
    `;
    const columns = yield* sql<ColumnEntry>`
      SELECT
        tables.name AS "tableName",
        columns.name,
        columns.type,
        columns."notnull" AS "notNull",
        columns.dflt_value AS "defaultValue",
        columns.pk AS "primaryKey"
      FROM sqlite_master AS tables
      JOIN pragma_table_xinfo(tables.name) AS columns
      WHERE tables.type = 'table'
        AND tables.name NOT LIKE 'sqlite_%'
        AND tables.name != 'effect_sql_migrations'
      ORDER BY tables.name, columns.name
    `;
    const integrityRows = yield* sql<{ readonly integrityCheck: string }>`
      PRAGMA integrity_check
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => Object.values(row)[0]).filter((value): value is string => value != null),
      ),
    );
    return { schema, columns, integrity: integrityRows } satisfies ScenarioSnapshot;
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory()));

const freshScenario = Effect.asVoid(runMigrations());

const fork51Scenario = Effect.gen(function* () {
  yield* runMigrations({ toMigrationInclusive: 51 });
  yield* runMigrations();
});

const upstream41Scenario = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 35 });
  yield* applyUpstreamSchema;
  yield* Migration052;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name)
    VALUES
      (36, 'ProjectionThreadsPinned'),
      (37, 'ProjectionTurnsKeysetIndex'),
      (38, 'ProjectionThreadsPinOrderKey'),
      (39, 'ProjectionProjectsDefaultThreadEnvMode'),
      (40, 'ProjectionProjectFaviconPath'),
      (41, 'AuthSessionClientConnection')
  `;
  yield* runMigrations();
});

const upstream43Scenario = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 35 });
  yield* applyUpstreamSchema;
  yield* Migration052;
  yield* Migration056;
  yield* Migration057;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name)
    VALUES
      (36, 'ProjectionThreadsPinned'),
      (37, 'ProjectionTurnsKeysetIndex'),
      (38, 'ProjectionThreadsPinOrderKey'),
      (39, 'ProjectionProjectsDefaultThreadEnvMode'),
      (40, 'ProjectionProjectFaviconPath'),
      (41, 'AuthSessionClientConnection'),
      (42, 'ProjectionThreadLinkedPullRequest'),
      (43, 'ProjectionThreadsUnsettledAt')
  `;
  yield* runMigrations();
});

const historicalForkCollisionScenario = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 32 });
  yield* ForkMigration036;
  yield* ForkMigration037;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name)
    VALUES
      (33, 'ProjectSpeechProfiles'),
      (34, 'ProjectionThreadSubagents')
  `;
  yield* runMigrations();
});

const repeatedScenario = Effect.gen(function* () {
  yield* runMigrations();
  yield* applyCompatibilityTail;
  yield* applyCompatibilityTail;
  assert.deepStrictEqual(yield* runMigrations(), []);
});

it("preserves immutable migration IDs and appends upstream collision repair as migration 58", () => {
  assert.deepStrictEqual(
    migrationEntries.slice(-expectedTail.length).map(([id, name]) => [id, name] as const),
    Array.from(expectedTail),
  );
  assert.deepStrictEqual(
    migrationManifest,
    migrationEntries.map(([id, name]) => [id, name] as const),
  );
});

it.effect("enables checkpoints for projects created before migration 51", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 50 });
    yield* sql`
      INSERT INTO projection_projects (
        project_id,
        title,
        workspace_root,
        default_model_selection_json,
        default_thread_env_mode,
        favicon_path,
        scripts_json,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        'legacy-project',
        'Legacy project',
        '/tmp/legacy-project',
        NULL,
        NULL,
        NULL,
        '[]',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        NULL
      )
    `;

    yield* Migration051;
    yield* Migration051;

    const rows = yield* sql<{ readonly checkpointsEnabled: number }>`
      SELECT checkpoints_enabled AS "checkpointsEnabled"
      FROM projection_projects
      WHERE project_id = 'legacy-project'
    `;
    assert.deepStrictEqual(rows, [{ checkpointsEnabled: 1 }]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);

it.effect("converges fresh, fork, upstream-41, upstream-43, and historical ledgers", () =>
  Effect.gen(function* () {
    const fresh = yield* captureScenario(freshScenario);
    const scenarios = yield* Effect.all([
      captureScenario(fork51Scenario),
      captureScenario(upstream41Scenario),
      captureScenario(upstream43Scenario),
      captureScenario(historicalForkCollisionScenario),
      captureScenario(repeatedScenario),
    ]);

    assert.deepStrictEqual(fresh.integrity, ["ok"]);
    for (const scenario of scenarios) {
      assert.deepStrictEqual(scenario.integrity, ["ok"]);
      assert.deepStrictEqual(scenario.schema, fresh.schema);
      assert.deepStrictEqual(scenario.columns, fresh.columns);
    }
  }),
);
