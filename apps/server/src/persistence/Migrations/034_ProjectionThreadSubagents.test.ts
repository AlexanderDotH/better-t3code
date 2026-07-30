import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

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

layer("034_ProjectionThreadSubagents", (it) => {
  it.effect("creates durable subagent summaries and ordered transcript tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* runMigrations({ toMigrationInclusive: 34 });

      for (const [tableName, expected] of Object.entries(expectedColumns)) {
        const columns = yield* sql.unsafe<{ readonly name: string }>(
          `PRAGMA table_info('${tableName}')`,
        );
        assert.deepStrictEqual(
          columns.map(({ name }) => name),
          expected,
        );
      }

      for (const [indexName, expected] of Object.entries(expectedIndexes)) {
        const columns = yield* sql.unsafe<{ readonly name: string }>(
          `PRAGMA index_info('${indexName}')`,
        );
        assert.deepStrictEqual(
          columns.map(({ name }) => name),
          expected,
        );
      }
    }),
  );
});
