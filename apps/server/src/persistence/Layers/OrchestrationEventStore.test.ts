import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
const isPersistenceDecodeError = Schema.is(PersistenceDecodeError);

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays decoded events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.make("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
        },
        payload: {
          projectId: ProjectId.make("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-01-01T00:00:00.000Z";

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.make("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.make("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.make("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(isPersistenceDecodeError(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );

  it.effect("reads one thread stream in persisted order without unrelated events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const now = "2026-01-01T00:00:00.000Z";
      const threadA = ThreadId.make("thread-a");
      const threadB = ThreadId.make("thread-b");

      for (const [index, threadId] of [threadA, threadB, threadA].entries()) {
        yield* eventStore.append({
          type: index < 2 ? "thread.created" : "thread.meta-updated",
          eventId: EventId.make(`evt-thread-stream-${index}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.make(`cmd-thread-stream-${index}`),
          causationEventId: null,
          correlationId: CommandId.make(`cmd-thread-stream-${index}`),
          metadata: {},
          payload:
            index < 2
              ? {
                  threadId,
                  projectId: ProjectId.make("project-thread-stream"),
                  title: `Thread ${index}`,
                  modelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-5-codex",
                  },
                  runtimeMode: "approval-required",
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: null,
                  worktreePath: null,
                  createdAt: now,
                  updatedAt: now,
                }
              : {
                  threadId,
                  title: "Thread A updated",
                  updatedAt: now,
                },
        });
      }

      const events = yield* Stream.runCollect(eventStore.readByThreadId(threadA)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );

      assert.deepEqual(
        events.map((event) => [event.type, event.aggregateId]),
        [
          ["thread.created", threadA],
          ["thread.meta-updated", threadA],
        ],
      );
    }),
  );

  it.effect("reads complete thread streams across storage pages", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const threadId = ThreadId.make("thread-paged");
      const now = "2026-01-01T00:00:00.000Z";

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("evt-thread-paged-create"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-paged-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-paged-create"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.make("project-thread-paged"),
          title: "Paged thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* Effect.forEach(
        Array.from({ length: 501 }, (_, index) => index),
        (index) =>
          eventStore.append({
            type: "thread.meta-updated",
            eventId: EventId.make(`evt-thread-paged-${index}`),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: now,
            commandId: CommandId.make(`cmd-thread-paged-${index}`),
            causationEventId: null,
            correlationId: CommandId.make(`cmd-thread-paged-${index}`),
            metadata: {},
            payload: {
              threadId,
              title: `Paged thread ${index}`,
              updatedAt: now,
            },
          }),
        { concurrency: 1 },
      );

      const events = yield* Stream.runCollect(eventStore.readByThreadId(threadId)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(events.length, 502);
      assert.equal(events[0]?.type, "thread.created");
      assert.equal(events.at(-1)?.eventId, EventId.make("evt-thread-paged-500"));
    }),
  );
});
