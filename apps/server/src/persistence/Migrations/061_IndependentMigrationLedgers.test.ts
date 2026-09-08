import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  forkMigrationTable,
  makeMigrationLoader,
  runMigrations,
  upstreamMigrationTable,
} from "../Migrations.ts";
import Migration0036 from "./036_ProjectSpeechProfilesCompatibility.ts";
import { runMigrations as runLegacyForkMigrations } from "./LegacyForkMigrations.ts";

const isolatedDatabase = Effect.acquireRelease(
  Effect.sync(() => {
    const root = NodePath.resolve(".t3/migration-tests");
    NodeFS.mkdirSync(root, { recursive: true });
    return NodeFS.mkdtempSync(NodePath.join(root, "ledgers-"));
  }),
  (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
);

const readSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'effect_sql_%' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `;
  const schema = [];
  for (const { name } of tables) {
    const columns = yield* sql<{
      readonly name: string;
      readonly type: string;
      readonly notnull: number;
      readonly dflt_value: string | null;
      readonly pk: number;
    }>`
      SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${name}) ORDER BY name
    `;
    schema.push({ name, columns });
  }
  return schema;
});

const assertCurrent = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  assert.deepStrictEqual(yield* sql`PRAGMA integrity_check`, [{ integrity_check: "ok" }]);
  assert.deepStrictEqual(yield* sql`PRAGMA foreign_key_check`, []);
  assert.deepStrictEqual(
    yield* sql`SELECT MAX(migration_id) AS id FROM ${sql(upstreamMigrationTable)}`,
    [{ id: 49 }],
  );
  assert.deepStrictEqual(yield* sql`SELECT migration_id, name FROM ${sql(forkMigrationTable)}`, [
    { migration_id: 61, name: "IndependentMigrationLedgers" },
  ]);
  const before = yield* readSchema;
  const changes = yield* sql`SELECT total_changes() AS changes`;
  assert.deepStrictEqual(yield* runMigrations(), []);
  assert.deepStrictEqual(yield* sql`SELECT total_changes() AS changes`, changes);
  assert.deepStrictEqual(yield* readSchema, before);
});

for (const source of ["fresh", "upstream49", "fork60", "collision33"] as const) {
  it.effect(`converges ${source} without rewriting its history and is a no-op on restart`, () =>
    Effect.gen(function* () {
      const directory = yield* isolatedDatabase;
      const filename = NodePath.join(directory, "state.sqlite");
      const database = NodeSqliteClient.layer({ filename });
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (source === "upstream49") yield* runMigrations({ toMigrationInclusive: 49 });
        if (source === "fork60") yield* runLegacyForkMigrations();
        if (source === "collision33") {
          yield* runLegacyForkMigrations({ toMigrationInclusive: 32 });
          yield* Migration0036;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (33, 'ProjectSpeechProfiles')`;
        }
        const history =
          source === "fresh"
            ? []
            : yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        yield* runMigrations();
        if (source !== "fresh") {
          assert.deepStrictEqual(
            yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
            history,
          );
        }
        yield* assertCurrent;
      }).pipe(Effect.provide(database));
      const expected = yield* Effect.gen(function* () {
        yield* runMigrations();
        return yield* readSchema;
      }).pipe(
        Effect.provide(
          NodeSqliteClient.layer({ filename: NodePath.join(directory, "expected.sqlite") }),
        ),
      );
      const actual = yield* readSchema.pipe(Effect.provide(database));
      assert.deepStrictEqual(actual, expected);
    }).pipe(Effect.scoped),
  );
}

it.effect(
  "preserves fork events, settings, and subagent data in a consistent fork60 snapshot",
  () =>
    Effect.gen(function* () {
      const directory = yield* isolatedDatabase;
      const source = NodePath.join(directory, "fork60.sqlite");
      const filename = NodePath.join(directory, "snapshot.sqlite");
      const payload = JSON.stringify({
        defaultModelSelection: { provider: "opencode", model: "custom" },
        forkMetadata: { retained: true },
      });
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runLegacyForkMigrations();
        yield* sql`
        INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json)
        VALUES ('event-preserved', 'project', 'project-preserved', 1, 'project.created', '2026-09-01T00:00:00Z', 'command-preserved', NULL, NULL, 'user', ${payload}, '{}')
      `;
        yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at, deleted_at, checkpoints_enabled)
        VALUES ('project-preserved', 'Fork', '/workspace/fork', ${JSON.stringify({ provider: "opencode", model: "custom" })}, '[]', '2026-09-01', '2026-09-01', NULL, 0)
      `;
        yield* sql`
        INSERT INTO projection_thread_subagents (thread_id, subagent_id, provider_thread_id, name, depth, status, started_at, updated_at, origin, service_tier, history_origin_json)
        VALUES ('thread-preserved', 'agent-preserved', 'native-preserved', 'Agent', 1, 'completed', '2026-09-01', '2026-09-01', 't3-managed', 'fast', '{"preserved":true}')
      `;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: source })));
      yield* Effect.sync(() => {
        const original = new NodeSqlite.DatabaseSync(source, { readOnly: true });
        try {
          original.prepare("VACUUM INTO ?").run(filename);
        } finally {
          original.close();
        }
      });
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const events = yield* sql`SELECT * FROM orchestration_events`;
        const projects =
          yield* sql`SELECT project_id, default_model_selection_json, checkpoints_enabled FROM projection_projects`;
        const subagents = yield* sql`SELECT * FROM projection_thread_subagents`;
        yield* runMigrations();
        assert.deepStrictEqual(yield* sql`SELECT * FROM orchestration_events`, events);
        assert.deepStrictEqual(
          yield* sql`SELECT project_id, default_model_selection_json, checkpoints_enabled FROM projection_projects`,
          projects,
        );
        assert.deepStrictEqual(yield* sql`SELECT * FROM projection_thread_subagents`, subagents);
        yield* assertCurrent;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
    }).pipe(Effect.scoped),
);

it.effect(
  "rolls back schema changes and bootstrap ledgers if convergence fails, then retries",
  () =>
    Effect.gen(function* () {
      const directory = yield* isolatedDatabase;
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 49 });
        yield* sql`CREATE VIEW knowledge_graph_nodes AS SELECT 1 AS incompatible`;
        const before = yield* sql`SELECT * FROM sqlite_master ORDER BY name`;
        const history = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(runMigrations())));
        assert.deepStrictEqual(yield* sql`SELECT * FROM sqlite_master ORDER BY name`, before);
        assert.deepStrictEqual(
          yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
          history,
        );
        yield* sql`DROP VIEW knowledge_graph_nodes`;
      }).pipe(
        Effect.provide(
          NodeSqliteClient.layer({ filename: NodePath.join(directory, "state.sqlite") }),
        ),
      );
      yield* Effect.gen(function* () {
        yield* runMigrations();
        yield* assertCurrent;
      }).pipe(
        Effect.provide(
          NodeSqliteClient.layer({ filename: NodePath.join(directory, "state.sqlite") }),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "executes a future upstream50 despite fork61 and rolls back failed future migrations",
  () =>
    Effect.gen(function* () {
      const directory = yield* isolatedDatabase;
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        const migrate = Migrator.make({});
        const future = Migrator.fromRecord({
          "50_FutureUpstream": sql`CREATE TABLE future_upstream (value TEXT)`,
        });
        const loader = Effect.map(
          Effect.all([makeMigrationLoader(), future]),
          ([current, next]) => [...current, ...next],
        );
        assert.deepStrictEqual(yield* migrate({ table: upstreamMigrationTable, loader }), [
          [50, "FutureUpstream"],
        ]);
        assert.deepStrictEqual(yield* migrate({ table: upstreamMigrationTable, loader }), []);
        const broken = Migrator.fromRecord({
          "51_BrokenUpstream": Effect.gen(function* () {
            yield* sql`CREATE TABLE rolled_back (value TEXT)`;
            yield* sql`INSERT INTO nonexistent_table VALUES (1)`;
          }),
        });
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(migrate({ table: upstreamMigrationTable, loader: broken })),
          ),
        );
        assert.deepStrictEqual(
          yield* sql`SELECT name FROM sqlite_master WHERE name = 'rolled_back'`,
          [],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT MAX(migration_id) AS id FROM ${sql(upstreamMigrationTable)}`,
          [{ id: 50 }],
        );
        assert.deepStrictEqual(
          yield* sql`SELECT MAX(migration_id) AS id FROM ${sql(forkMigrationTable)}`,
          [{ id: 61 }],
        );
      }).pipe(
        Effect.provide(
          NodeSqliteClient.layer({ filename: NodePath.join(directory, "state.sqlite") }),
        ),
      );
    }).pipe(Effect.scoped),
);
