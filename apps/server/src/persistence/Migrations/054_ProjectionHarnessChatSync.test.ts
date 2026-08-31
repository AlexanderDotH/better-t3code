import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration054 from "./054_ProjectionHarnessChatSync.ts";

const provideFreshDatabase = Effect.provide(NodeSqliteClient.layerMemory());

it.effect("054 creates stable harness session and native message link projections", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 53 });

    const migrations = yield* runMigrations({ toMigrationInclusive: 54 });
    assert.deepStrictEqual(
      migrations.map(([id, name]) => [id, name]),
      [[54, "ProjectionHarnessChatSync"]],
    );

    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_harness_chat_sync_links (
        thread_id,
        project_id,
        source_id,
        continuation_key,
        native_session_id,
        provider_instance_id,
        provider_label,
        activity,
        source_updated_at,
        last_synced_at
      ) VALUES (
        'thread-1',
        'project-1',
        'codex-home',
        'codex:/tmp/home',
        'native-session-1',
        'codex-work',
        'Codex Work',
        'active',
        '2026-08-23T10:00:00.000Z',
        '2026-08-23T10:01:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO projection_harness_chat_sync_message_links (
        thread_id,
        native_message_id,
        message_id,
        linked_at
      ) VALUES (
        'thread-1',
        'native-message-1',
        'message-1',
        '2026-08-23T10:01:00.000Z'
      )
    `;

    const links = yield* sql<{
      readonly threadId: string;
      readonly activity: string;
      readonly nativeMessageId: string;
      readonly messageId: string;
    }>`
      SELECT
        links.thread_id AS "threadId",
        links.activity,
        messages.native_message_id AS "nativeMessageId",
        messages.message_id AS "messageId"
      FROM projection_harness_chat_sync_links AS links
      JOIN projection_harness_chat_sync_message_links AS messages
        ON messages.thread_id = links.thread_id
    `;
    assert.deepStrictEqual(links, [
      {
        threadId: "thread-1",
        activity: "active",
        nativeMessageId: "native-message-1",
        messageId: "message-1",
      },
    ]);
  }).pipe(provideFreshDatabase),
);

it.effect("054 rejects duplicate native sessions and invalid activity", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 53 });
    yield* Migration054;
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      INSERT INTO projection_harness_chat_sync_links (
        thread_id, project_id, source_id, continuation_key, native_session_id,
        provider_instance_id, provider_label, activity, source_updated_at, last_synced_at
      ) VALUES (
        'thread-1', 'project-1', 'source-a', 'continuation-a', 'session-a',
        'codex', 'Codex', 'idle',
        '2026-08-23T10:00:00.000Z', '2026-08-23T10:00:00.000Z'
      )
    `;

    const duplicate = yield* Effect.exit(sql`
      INSERT INTO projection_harness_chat_sync_links (
        thread_id, project_id, source_id, continuation_key, native_session_id,
        provider_instance_id, provider_label, activity, source_updated_at, last_synced_at
      ) VALUES (
        'thread-2', 'project-1', 'source-b', 'continuation-a', 'session-a',
        'codex', 'Codex', 'idle',
        '2026-08-23T10:00:00.000Z', '2026-08-23T10:00:00.000Z'
      )
    `);
    const invalidActivity = yield* Effect.exit(sql`
      UPDATE projection_harness_chat_sync_links
      SET activity = 'busy'
      WHERE thread_id = 'thread-1'
    `);

    assert.strictEqual(duplicate._tag, "Failure");
    assert.strictEqual(invalidActivity._tag, "Failure");
  }).pipe(provideFreshDatabase),
);

it.effect("054 is idempotent when repair runs directly", () =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 53 });
    yield* Migration054;
    yield* Migration054;
  }).pipe(provideFreshDatabase),
);
