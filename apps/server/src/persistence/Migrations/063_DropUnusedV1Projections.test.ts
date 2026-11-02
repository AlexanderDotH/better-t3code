import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));

layer("063_DropUnusedV1Projections", (it) => {
  it.effect("archives unsupported V1 history and keeps the transcript import sources", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });
      yield* sql`
        INSERT INTO projection_thread_messages
          (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES ('message-1', 'thread-1', 'user', 'hello', 0, '2026-01-01', '2026-01-01')
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans
          (plan_id, thread_id, plan_markdown, created_at, updated_at)
        VALUES ('plan-1', 'thread-1', '# Keep this plan', '2026-01-01', '2026-01-01')
      `;
      yield* sql`
        INSERT INTO checkpoint_diff_blobs (thread_id, from_turn_count, to_turn_count, diff, created_at)
        VALUES ('thread-1', 0, 1, 'diff --git preserved', '2026-01-01')
      `;
      const sources = yield* sql`SELECT * FROM projection_thread_proposed_plans`;
      const diffs = yield* sql`SELECT * FROM checkpoint_diff_blobs`;
      yield* runMigrations({ toMigrationInclusive: 63 });
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM legacy_v1_projection_thread_proposed_plans`,
        sources,
      );
      assert.deepStrictEqual(yield* sql`SELECT * FROM legacy_v1_checkpoint_diff_blobs`, diffs);
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 63 }), []);
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM legacy_v1_projection_thread_proposed_plans`,
        sources,
      );

      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `;
      const tables = new Set(rows.map((row) => row.name));
      for (const dropped of [
        "projection_thread_activities",
        "projection_turns",
        "projection_thread_proposed_plans",
        "projection_pending_approvals",
        "projection_state",
        "checkpoint_diff_blobs",
      ]) {
        assert.isFalse(tables.has(dropped), dropped);
      }
      for (const kept of [
        "projection_threads",
        "projection_thread_messages",
        "projection_thread_pull_requests",
      ]) {
        assert.isTrue(tables.has(kept), kept);
      }
      assert.deepEqual(yield* sql`SELECT message_id FROM projection_thread_messages`, [
        { message_id: "message-1" },
      ]);
    }),
  );
});
