import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const TestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "harness-sync-pipeline-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("harness chat sync projection", (it) => {
  it.effect("projects a native session link and imports each native message only once", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-08-23T10:00:00.000Z";
      const syncedAt = "2026-08-23T10:01:00.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("event-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-1"),
        occurredAt: createdAt,
        commandId: CommandId.make("command-project"),
        causationEventId: null,
        correlationId: CommandId.make("command-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.make("event-thread"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: createdAt,
        commandId: CommandId.make("command-thread"),
        causationEventId: null,
        correlationId: CommandId.make("command-thread"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          title: "Imported session",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex-work"),
            model: "gpt-5.6",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      yield* eventStore.append({
        type: "thread.harness-sync-linked",
        eventId: EventId.make("event-link"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: syncedAt,
        commandId: CommandId.make("command-link"),
        causationEventId: null,
        correlationId: CommandId.make("command-link"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: ProjectId.make("project-1"),
          sourceId: "codex-home",
          continuationKey: "codex:/tmp/home",
          nativeSessionId: "native-session-1",
          providerInstanceId: ProviderInstanceId.make("codex-work"),
          providerLabel: "Codex Work",
          activity: "idle",
          sourceUpdatedAt: createdAt,
          lastSyncedAt: syncedAt,
        },
      });
      yield* eventStore.append({
        type: "thread.harness-sync-message-imported",
        eventId: EventId.make("event-message-original"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: createdAt,
        commandId: CommandId.make("command-message-original"),
        causationEventId: null,
        correlationId: CommandId.make("command-message-original"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("message-original"),
          nativeMessageId: "native-message-1",
          role: "assistant",
          text: "Original imported answer",
          turnId: null,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
          linkedAt: syncedAt,
        },
      });
      yield* pipeline.bootstrap;

      yield* eventStore.append({
        type: "thread.harness-sync-message-imported",
        eventId: EventId.make("event-message-replay"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        occurredAt: syncedAt,
        commandId: CommandId.make("command-message-replay"),
        causationEventId: null,
        correlationId: CommandId.make("command-message-replay"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          messageId: MessageId.make("message-replayed"),
          nativeMessageId: "native-message-1",
          role: "assistant",
          text: "Edited at source and replayed",
          turnId: null,
          streaming: false,
          createdAt,
          updatedAt: syncedAt,
          linkedAt: syncedAt,
        },
      });
      yield* pipeline.bootstrap;

      const links = yield* sql<{
        readonly projectId: string;
        readonly nativeSessionId: string;
        readonly activity: string;
      }>`
        SELECT
          project_id AS "projectId",
          native_session_id AS "nativeSessionId",
          activity
        FROM projection_harness_chat_sync_links
      `;
      const messageLinks = yield* sql<{
        readonly nativeMessageId: string;
        readonly messageId: string;
      }>`
        SELECT
          native_message_id AS "nativeMessageId",
          message_id AS "messageId"
        FROM projection_harness_chat_sync_message_links
      `;
      const messages = yield* sql<{ readonly messageId: string; readonly text: string }>`
        SELECT message_id AS "messageId", text
        FROM projection_thread_messages
        ORDER BY message_id
      `;

      assert.deepStrictEqual(links, [
        { projectId: "project-1", nativeSessionId: "native-session-1", activity: "idle" },
      ]);
      assert.deepStrictEqual(messageLinks, [
        { nativeMessageId: "native-message-1", messageId: "message-original" },
      ]);
      assert.deepStrictEqual(messages, [
        { messageId: "message-original", text: "Original imported answer" },
      ]);
    }),
  );
});
