import { assert, it } from "@effect/vitest";
import { EventId, MessageId, ThreadId, OrchestrationHistoryOrigin } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as Background from "../ThreadBackgroundLiveness.ts";
import * as Plan from "../ThreadPlanProgress.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const encodeOrigin = Schema.encodeSync(Schema.fromJsonString(OrchestrationHistoryOrigin));

const layer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provide(Background.layer),
  Layer.provide(Plan.layer),
  Layer.provide(
    Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
      resolve: () => Effect.succeed(null),
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
);

it.effect("paginates completed messages by frozen provenance without decoding unrelated data", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const query = yield* ProjectionSnapshotQuery;
    const threadId = ThreadId.make("context-pages");
    const createdAt = "2026-10-28T10:00:00.000Z";
    for (let index = 0; index < 7; index++) {
      const origin =
        index === 1
          ? encodeOrigin({
              sourceThreadId: ThreadId.make("ancestor"),
              sourceId: "source-message",
              ordinal: 0,
            })
          : null;
      yield* sql`INSERT INTO projection_thread_messages
        (message_id, thread_id, role, text, is_streaming, created_at, updated_at, context_json, history_origin_json)
        VALUES (${"message-" + index}, ${threadId},
          ${index === 5 ? "system" : index === 3 ? "reasoning" : index % 2 ? "assistant" : "user"},
          ${"text " + index}, ${index === 6 ? 1 : 0}, ${createdAt}, ${createdAt}, 'invalid-json', ${origin})`;
    }
    yield* sql`INSERT INTO projection_thread_activities
      (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES ('unrelated-invalid', ${threadId}, 'info', 'unrelated', 'unrelated', 'invalid-json', ${createdAt})`;
    const first = yield* query.getThreadContextMessagePage({ threadId, limit: 3 });
    assert.deepStrictEqual(
      first.map((item) => item.messageId),
      ["message-4", "message-3", "message-2"],
    );
    const second = yield* query.getThreadContextMessagePage({
      threadId,
      limit: 3,
      before: first.at(-1)!,
    });
    assert.deepStrictEqual(
      second.map((item) => item.messageId),
      ["message-0", "source-message"],
    );
    assert.strictEqual(second[1]?.threadId, ThreadId.make("ancestor"));
    assert.deepStrictEqual(yield* query.getThreadMessageSourceThreadIds(threadId), [
      ThreadId.make("ancestor"),
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("reads only conversation messages before a queued request for Auto Reasoning", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const query = yield* ProjectionSnapshotQuery;
    const threadId = ThreadId.make("reasoning-history");
    for (let index = 0; index < 8; index++) {
      const createdAt = `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
      yield* sql`INSERT INTO projection_thread_messages
        (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES (${"recent-" + index}, ${threadId},
          ${index === 3 ? "reasoning" : index === 4 ? "system" : index % 2 ? "assistant" : "user"},
          ${"message " + index}, 0, ${createdAt}, ${createdAt})`;
    }
    const messages = yield* query.getRecentThreadMessages(threadId, 3, {
      beforeMessageId: MessageId.make("recent-6"),
      conversationOnly: true,
    });
    assert.deepStrictEqual(
      messages.map((item) => item.id),
      ["recent-1", "recent-2", "recent-5"],
    );
    const latest = yield* query.getRecentThreadMessages(threadId, 2);
    assert.deepStrictEqual(
      latest.map((item) => item.id),
      ["recent-6", "recent-7"],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("retrieves complete tool results even after the retained activity window", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const query = yield* ProjectionSnapshotQuery;
    const activities = yield* ProjectionThreadActivityRepository;
    const threadId = ThreadId.make("context-tool-reference");
    const createdAt = "2026-10-28T10:00:00.000Z";
    const data = { output: "complete tool result".repeat(2_000) };
    const payload = { itemId: "old-tool", data, canonicalPayload: { data } };
    yield* activities.upsert({
      activityId: EventId.make("old-tool-activity"),
      threadId,
      turnId: null,
      tone: "tool",
      kind: "tool.completed",
      summary: "Old tool",
      payload,
      sequence: 1,
      createdAt,
    });
    yield* sql`WITH RECURSIVE n(value) AS (
      SELECT 2 UNION ALL SELECT value + 1 FROM n WHERE value < 503
    ) INSERT INTO projection_thread_activities
      (activity_id, thread_id, tone, kind, summary, payload_json, sequence, created_at)
      SELECT 'newer-' || value, ${threadId}, 'info', 'newer', 'newer', '{}', value, ${createdAt}
      FROM n`;
    const result = yield* query.getThreadToolResultActivity(threadId, "old-tool");
    assert.deepStrictEqual(Option.getOrThrow(result).payload, payload);
    assert.isTrue(Option.isNone(yield* query.getThreadToolResultActivity(threadId, "missing")));
  }).pipe(Effect.provide(layer)),
);
