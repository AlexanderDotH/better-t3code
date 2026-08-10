import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration043 from "./043_ProjectionThreadSubagentFetchMetadata.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect(
  "043 defaults legacy subagents to provider-native and adds nullable Fetch routing metadata",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_thread_subagents (
          thread_id,
          subagent_id,
          provider_thread_id,
          name,
          depth,
          status,
          started_at,
          updated_at
        )
        VALUES (
          'thread-legacy',
          'agent-legacy',
          'provider-agent-legacy',
          'legacy',
          1,
          'completed',
          '2026-08-08T00:00:00.000Z',
          '2026-08-08T00:01:00.000Z'
        )
      `;

      const migrations = yield* runMigrations({ toMigrationInclusive: 43 });
      assert.deepStrictEqual(
        migrations.map(([id, name]) => [id, name]),
        [[43, "ProjectionThreadSubagentFetchMetadata"]],
      );

      const rows = yield* sql<{
        readonly origin: string;
        readonly providerInstanceId: string | null;
        readonly providerDriver: string | null;
      }>`
        SELECT
          origin,
          provider_instance_id AS "providerInstanceId",
          provider_driver AS "providerDriver"
        FROM projection_thread_subagents
        WHERE thread_id = 'thread-legacy'
      `;
      assert.deepStrictEqual(rows, [
        {
          origin: "provider-native",
          providerInstanceId: null,
          providerDriver: null,
        },
      ]);
    }).pipe(provideFreshDatabase),
);

it.effect("043 is idempotent and constrains the Fetch origin", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 42 });
    yield* Migration043;
    yield* Migration043;

    const invalid = yield* Effect.exit(sql`
      INSERT INTO projection_thread_subagents (
        thread_id,
        subagent_id,
        provider_thread_id,
        name,
        depth,
        status,
        origin,
        started_at,
        updated_at
      )
      VALUES (
        'thread-invalid',
        'agent-invalid',
        'provider-agent-invalid',
        'invalid',
        1,
        'running',
        'unknown',
        '2026-08-08T00:00:00.000Z',
        '2026-08-08T00:00:00.000Z'
      )
    `);
    assert.strictEqual(invalid._tag, "Failure");
  }).pipe(provideFreshDatabase),
);
