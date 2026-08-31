import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration053 from "./053_ProjectionThreadSubagentManagedOrigin.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect("053 preserves existing rows and admits only the managed origin", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* sql`
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
      VALUES
        (
          'thread-existing',
          'agent-native',
          'provider-native',
          'native',
          1,
          'completed',
          'provider-native',
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:01:00.000Z'
        ),
        (
          'thread-existing',
          'agent-fetch',
          'provider-fetch',
          'fetch',
          1,
          'completed',
          't3-fetch',
          '2026-08-22T00:00:00.000Z',
          '2026-08-22T00:01:00.000Z'
        )
    `;

    const migrations = yield* runMigrations({ toMigrationInclusive: 53 });
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[53, "ProjectionThreadSubagentManagedOrigin"]],
    );

    yield* sql`
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
        'thread-managed',
        'agent-managed',
        'provider-managed',
        'managed',
        1,
        'running',
        't3-managed',
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z'
      )
    `;

    const origins = yield* sql<{ readonly origin: string }>`
      SELECT origin
      FROM projection_thread_subagents
      ORDER BY subagent_id
    `;
    assert.deepStrictEqual(origins, [
      { origin: "t3-fetch" },
      { origin: "t3-managed" },
      { origin: "provider-native" },
    ]);

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
        'provider-invalid',
        'invalid',
        1,
        'running',
        'unknown',
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z'
      )
    `);
    assert.strictEqual(invalid._tag, "Failure");
  }).pipe(provideFreshDatabase),
);

it.effect("053 is idempotent when repair runs directly", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* Migration053;
    yield* Migration053;
  }).pipe(provideFreshDatabase),
);
