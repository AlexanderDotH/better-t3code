import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration055 from "./055_ProjectionThreadForks.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

const tableColumnNames = (tableName: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(${sql.literal(tableName)})
    `;
    return columns.map(({ name }) => name);
  });

it.effect("055 persists fork provenance and frozen-history origins", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 54 });

    const migrations = yield* runMigrations();
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[55, "ProjectionThreadForks"]],
    );

    assert.ok((yield* tableColumnNames("projection_threads")).includes("fork_json"));
    assert.ok(
      (yield* tableColumnNames("projection_thread_messages")).includes("history_origin_json"),
    );
    assert.ok(
      (yield* tableColumnNames("projection_thread_proposed_plans")).includes("history_origin_json"),
    );
    assert.ok(
      (yield* tableColumnNames("projection_thread_activities")).includes("history_origin_json"),
    );
    assert.ok(
      (yield* tableColumnNames("projection_thread_subagents")).includes("history_origin_json"),
    );
    const turnColumns = yield* tableColumnNames("projection_turns");
    assert.ok(turnColumns.includes("history_origin_json"));
    assert.ok(turnColumns.includes("checkpoint_history_origin_json"));
    assert.ok(turnColumns.includes("history_checkpoint_turn_count"));
    assert.ok(turnColumns.includes("history_checkpoint_ref"));
    assert.ok(turnColumns.includes("history_checkpoint_status"));
    assert.ok(turnColumns.includes("history_checkpoint_files_json"));

    const sql = yield* SqlClient.SqlClient;
    const forkCheckpointTable = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'projection_thread_fork_checkpoints'
    `;
    assert.deepStrictEqual(forkCheckpointTable, [{ name: "projection_thread_fork_checkpoints" }]);
  }).pipe(provideFreshDatabase),
);

it.effect("055 backfills immutable attachment references for existing messages", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 54 });
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id,
        thread_id,
        turn_id,
        role,
        text,
        attachments_json,
        is_streaming,
        created_at,
        updated_at
      ) VALUES (
        'message-1',
        'thread-1',
        NULL,
        'user',
        'with image',
        '[{"type":"image","id":"thread-1-00000000-0000-0000-0000-000000000001","name":"image.png","mimeType":"image/png"}]',
        0,
        '2026-08-24T00:00:00.000Z',
        '2026-08-24T00:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO projection_thread_subagent_messages (
        thread_id,
        subagent_id,
        message_id,
        turn_id,
        role,
        text,
        attachments_json,
        is_streaming,
        created_at,
        updated_at
      ) VALUES (
        'thread-1',
        'subagent-1',
        'message-2',
        NULL,
        'assistant',
        'with audio',
        '[{"type":"audio","id":"thread-1-00000000-0000-0000-0000-000000000002","name":"audio.mp3","mimeType":"audio/mpeg"}]',
        0,
        '2026-08-24T00:00:01.000Z',
        '2026-08-24T00:00:01.000Z'
      )
    `;

    yield* Migration055;
    yield* Migration055;

    const references = yield* sql<{
      readonly attachmentId: string;
      readonly ownerKind: string;
      readonly messageId: string;
    }>`
      SELECT
        attachment_id AS "attachmentId",
        owner_kind AS "ownerKind",
        message_id AS "messageId"
      FROM projection_attachment_references
      ORDER BY attachment_id
    `;
    assert.deepStrictEqual(references, [
      {
        attachmentId: "thread-1-00000000-0000-0000-0000-000000000001",
        ownerKind: "thread",
        messageId: "message-1",
      },
      {
        attachmentId: "thread-1-00000000-0000-0000-0000-000000000002",
        ownerKind: "subagent",
        messageId: "message-2",
      },
    ]);
  }).pipe(provideFreshDatabase),
);
