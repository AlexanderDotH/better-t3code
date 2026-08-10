import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect("044 creates durable claims, messages, recipients, and inbox cursors", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 43 });
    const migrations = yield* runMigrations({ toMigrationInclusive: 44 });

    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[44, "ProjectAgentCoordination"]],
    );

    const tables = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name LIKE 'projection_project_agent_%'
      ORDER BY name
    `;
    assert.deepStrictEqual(
      tables.map(({ name }) => name),
      [
        "projection_project_agent_claims",
        "projection_project_agent_inbox_cursors",
        "projection_project_agent_message_recipients",
        "projection_project_agent_messages",
      ],
    );

    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name LIKE 'idx_projection_project_agent_%'
      ORDER BY name
    `;
    assert.deepStrictEqual(
      indexes.map(({ name }) => name),
      [
        "idx_projection_project_agent_claims_project",
        "idx_projection_project_agent_messages_project_sequence",
        "idx_projection_project_agent_recipients_inbox",
      ],
    );
  }).pipe(provideFreshDatabase),
);
