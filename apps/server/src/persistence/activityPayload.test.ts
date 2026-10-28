import { assert, it } from "@effect/vitest";
import { EventId, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ActivityPayloadFromJsonString } from "./activityPayload.ts";
import { OrchestrationEventStore } from "./Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./Layers/OrchestrationEventStore.ts";
import { ProjectionThreadActivityRepository } from "./Services/ProjectionThreadActivities.ts";
import { ProjectionThreadActivityRepositoryLive } from "./Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadSubagentActivityRepository } from "./Services/ProjectionThreadSubagentActivities.ts";
import { ProjectionThreadSubagentActivityRepositoryLive } from "./Layers/ProjectionThreadSubagentActivities.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

const encode = Schema.encodeSync(ActivityPayloadFromJsonString);
const decode = Schema.decodeUnknownSync(ActivityPayloadFromJsonString);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it("preserves legacy and independently supplied canonical data", () => {
  for (const value of [
    { data: { output: "visible" }, canonicalPayload: { data: { output: "original" } } },
    { data: undefined, canonicalPayload: { data: undefined } },
    { $t3CanonicalDataReference: 1, data: "root", canonicalPayload: { data: "original" } },
    { arbitrary: ["value", null, 1] },
  ]) {
    assert.deepStrictEqual(decode(encode(value)), JSON.parse(JSON.stringify(value)));
    assert.deepStrictEqual(decode(JSON.stringify(value)), JSON.parse(JSON.stringify(value)));
  }
});

const layer = Layer.mergeAll(
  OrchestrationEventStoreLive,
  ProjectionThreadActivityRepositoryLive,
  ProjectionThreadSubagentActivityRepositoryLive,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

it.effect(
  "stores large tool data once and restores it through event replay and both repositories",
  () =>
    Effect.gen(function* () {
      const events = yield* OrchestrationEventStore;
      const activities = yield* ProjectionThreadActivityRepository;
      const subagentActivities = yield* ProjectionThreadSubagentActivityRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("storage-thread");
      const subagentId = SubagentId.make("storage-subagent");
      const createdAt = "2026-10-28T10:00:00.000Z";
      const data = { output: "large-result".repeat(100_000) };
      const payload = {
        itemId: "storage-tool",
        data,
        canonicalPayload: { itemType: "mcp_tool_call", status: "completed", data },
      };
      const activity = {
        id: EventId.make("storage-activity"),
        kind: "tool.completed",
        summary: "Tool completed",
        tone: "tool" as const,
        turnId: null,
        createdAt,
        payload,
      };
      const appended = yield* events.append({
        type: "thread.activity-appended",
        eventId: EventId.make("storage-event"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: createdAt,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: { threadId, activity, createdAt },
      });
      const row = {
        activityId: activity.id,
        threadId,
        turnId: null,
        tone: activity.tone,
        kind: activity.kind,
        summary: activity.summary,
        payload,
        createdAt,
        sequence: appended.sequence,
      };
      yield* activities.upsert(row);
      yield* subagentActivities.upsert({ ...row, subagentId });
      const stored = yield* sql<{ json: string }>`
      SELECT payload_json AS json FROM orchestration_events
      UNION ALL SELECT payload_json AS json FROM projection_thread_activities
      UNION ALL SELECT payload_json AS json FROM projection_thread_subagent_activities
    `;
      const originalBytes = encodeJson(payload).length;
      assert.strictEqual(stored.length, 3);
      for (const value of stored) {
        assert.isBelow(value.json.length, originalBytes * 0.6);
      }
      assert.deepStrictEqual((yield* activities.listByThreadId({ threadId }))[0]?.payload, payload);
      assert.deepStrictEqual(
        (yield* subagentActivities.listBySubagentId({ threadId, subagentId }))[0]?.payload,
        payload,
      );
      assert.strictEqual(appended.type, "thread.activity-appended");
      if (appended.type === "thread.activity-appended") {
        assert.deepStrictEqual(appended.payload.activity.payload, payload);
      }
      const replayed = yield* Stream.runCollect(events.readFromSequence(0));
      assert.deepStrictEqual(Array.from(replayed), [appended]);
      assert.deepStrictEqual(decode(encode(payload)), payload);
    }).pipe(Effect.provide(layer)),
);
