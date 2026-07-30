import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration041 from "./041_ProjectionThreadSubagents.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const expectedColumns = {
  projection_thread_subagents: [
    "thread_id",
    "subagent_id",
    "provider_thread_id",
    "parent_subagent_id",
    "path",
    "name",
    "nickname",
    "role",
    "task",
    "model",
    "reasoning_effort",
    "depth",
    "status",
    "status_message",
    "latest_progress_json",
    "latest_turn_json",
    "started_at",
    "updated_at",
    "completed_at",
  ],
  projection_thread_subagent_messages: [
    "thread_id",
    "subagent_id",
    "message_id",
    "turn_id",
    "role",
    "text",
    "attachments_json",
    "is_streaming",
    "created_at",
    "updated_at",
  ],
  projection_thread_subagent_proposed_plans: [
    "thread_id",
    "subagent_id",
    "plan_id",
    "turn_id",
    "plan_markdown",
    "implemented_at",
    "implementation_thread_id",
    "created_at",
    "updated_at",
  ],
  projection_thread_subagent_activities: [
    "thread_id",
    "subagent_id",
    "activity_id",
    "turn_id",
    "tone",
    "kind",
    "summary",
    "payload_json",
    "sequence",
    "created_at",
  ],
} as const;

const expectedIndexes = {
  idx_projection_thread_subagents_thread_status_updated: [
    "thread_id",
    "status",
    "updated_at",
    "subagent_id",
  ],
  idx_projection_thread_subagents_thread_parent_updated: [
    "thread_id",
    "parent_subagent_id",
    "updated_at",
    "subagent_id",
  ],
  idx_projection_thread_subagent_messages_agent_created: [
    "thread_id",
    "subagent_id",
    "created_at",
    "message_id",
  ],
  idx_projection_thread_subagent_plans_agent_created: [
    "thread_id",
    "subagent_id",
    "created_at",
    "plan_id",
  ],
  idx_projection_thread_subagent_activities_agent_sequence_created: [
    "thread_id",
    "subagent_id",
    "sequence",
    "created_at",
    "activity_id",
  ],
} as const;

const assertSubagentSchema = Effect.fn("assertSubagentSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const columns = yield* sql.unsafe<{ readonly name: string }>(
      `PRAGMA table_info('${tableName}')`,
    );
    assert.deepStrictEqual(
      columns.map(({ name }) => name),
      [...expected],
    );
  }

  for (const [indexName, expected] of Object.entries(expectedIndexes)) {
    const columns = yield* sql.unsafe<{ readonly name: string }>(
      `PRAGMA index_info('${indexName}')`,
    );
    assert.deepStrictEqual(
      columns.map(({ name }) => name),
      [...expected],
    );
  }
});

it.effect("041_ProjectionThreadSubagents creates durable summaries and transcript tables", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 40 });

    const migrations = yield* runMigrations({ toMigrationInclusive: 41 });

    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[41, "ProjectionThreadSubagents"]],
    );
    yield* assertSubagentSchema();
  }).pipe(provideFreshDatabase),
);

it.effect("041_ProjectionThreadSubagents preserves existing live rows when reapplied", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 32 });
    yield* Migration041;
    yield* sql`
      INSERT INTO projection_thread_subagents (
        thread_id,
        subagent_id,
        provider_thread_id,
        parent_subagent_id,
        path,
        name,
        nickname,
        role,
        task,
        model,
        reasoning_effort,
        depth,
        status,
        status_message,
        latest_progress_json,
        latest_turn_json,
        started_at,
        updated_at,
        completed_at
      )
      VALUES (
        'thread-existing',
        'agent-existing',
        'provider-existing',
        NULL,
        '/root/existing',
        'existing',
        NULL,
        NULL,
        'Preserve this row',
        NULL,
        NULL,
        1,
        'completed',
        NULL,
        NULL,
        NULL,
        '2026-07-30T00:00:00.000Z',
        '2026-07-30T00:01:00.000Z',
        '2026-07-30T00:01:00.000Z'
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

    yield* Migration041;
    const migrations = yield* runMigrations({ toMigrationInclusive: 41 });
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [
        [39, "ProjectionThreadSessionAbortState"],
        [40, "ProjectionCompatibility"],
        [41, "ProjectionThreadSubagents"],
      ],
    );

    const rows = yield* sql<{ readonly subagentId: string; readonly task: string | null }>`
      SELECT subagent_id AS "subagentId", task
      FROM projection_thread_subagents
    `;
    assert.deepStrictEqual(rows, [
      {
        subagentId: "agent-existing",
        task: "Preserve this row",
      },
    ]);
    yield* assertSubagentSchema();
  }).pipe(provideFreshDatabase),
);
