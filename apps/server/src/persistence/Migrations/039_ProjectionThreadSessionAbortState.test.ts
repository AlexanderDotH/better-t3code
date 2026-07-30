import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration039 from "./039_ProjectionThreadSessionAbortState.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect(
  "039 adds nullable runtime lease and abort state columns without changing legacy rows",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, runtime_mode, active_turn_id, last_error, updated_at
      )
      VALUES (
        'thread-legacy', 'running', 'codex', 'full-access', 'turn-legacy', NULL,
        '2026-07-30T00:00:00.000Z'
      )
    `;

      const migrations = yield* runMigrations({ toMigrationInclusive: 39 });
      assert.deepStrictEqual(
        migrations.map(([id, name]) => [id, name]),
        [[39, "ProjectionThreadSessionAbortState"]],
      );

      const columns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_thread_sessions)
    `;
      assert.isTrue(columns.some(({ name }) => name === "runtime_session_id"));
      assert.isTrue(columns.some(({ name }) => name === "abort_state_json"));

      const rows = yield* sql<{
        readonly runtimeSessionId: string | null;
        readonly abortStateJson: string | null;
      }>`
      SELECT
        runtime_session_id AS "runtimeSessionId",
        abort_state_json AS "abortStateJson"
      FROM projection_thread_sessions
      WHERE thread_id = 'thread-legacy'
    `;
      assert.deepStrictEqual(rows, [{ runtimeSessionId: null, abortStateJson: null }]);
    }).pipe(provideFreshDatabase),
);

it.effect("039 rejects malformed abort state JSON at the database boundary", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 39 });
    yield* Migration039;
    yield* Migration039;

    const result = yield* Effect.exit(sql`
      INSERT INTO projection_thread_sessions (
        thread_id, status, runtime_mode, abort_state_json, updated_at
      )
      VALUES (
        'thread-invalid-abort', 'running', 'full-access', '{not-json',
        '2026-07-30T00:00:00.000Z'
      )
    `);
    assert.strictEqual(result._tag, "Failure");
  }).pipe(provideFreshDatabase),
);
