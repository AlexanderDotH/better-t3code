import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-08-23T10:00:00.000Z";
const syncedAt = "2026-08-23T10:01:00.000Z";

const seedThread = Effect.gen(function* () {
  const projectId = ProjectId.make("project-harness-sync");
  const threadId = ThreadId.make("thread-harness-sync");
  const withProject = yield* projectEvent(createEmptyReadModel(createdAt), {
    sequence: 1,
    eventId: EventId.make("event-project-harness-sync"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: createdAt,
    commandId: CommandId.make("command-project-harness-sync"),
    causationEventId: null,
    correlationId: CommandId.make("command-project-harness-sync"),
    metadata: {},
    payload: {
      projectId,
      title: "Harness sync",
      workspaceRoot: "/tmp/harness-sync",
      defaultModelSelection: null,
      scripts: [],
      createdAt,
      updatedAt: createdAt,
    },
  });
  const readModel = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("event-thread-harness-sync"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: createdAt,
    commandId: CommandId.make("command-thread-harness-sync"),
    causationEventId: null,
    correlationId: CommandId.make("command-thread-harness-sync"),
    metadata: {},
    payload: {
      threadId,
      projectId,
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
  return { readModel, threadId };
});

it.layer(NodeServices.layer)("harness history sync decider", (it) => {
  it.effect("links a native harness session without starting provider work", () =>
    Effect.gen(function* () {
      const { readModel, threadId } = yield* seedThread;
      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.harness-sync.link",
          commandId: CommandId.make("command-link-harness-sync"),
          threadId,
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

      expect(Array.isArray(decided)).toBe(false);
      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.harness-sync-linked");
      if (event?.type !== "thread.harness-sync-linked") return;
      expect(event.payload).toMatchObject({
        threadId,
        continuationKey: "codex:/tmp/home",
        nativeSessionId: "native-session-1",
        lastSyncedAt: syncedAt,
      });
    }),
  );

  it.effect("imports and links one stable native message in a single event", () =>
    Effect.gen(function* () {
      const { readModel, threadId } = yield* seedThread;
      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.harness-sync.message.import",
          commandId: CommandId.make("command-import-harness-message"),
          threadId,
          nativeMessageId: "native-message-1",
          message: {
            id: MessageId.make("message-1"),
            role: "assistant",
            text: "Imported answer",
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
          linkedAt: syncedAt,
        },
      });

      expect(Array.isArray(decided)).toBe(false);
      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.harness-sync-message-imported");
      if (event?.type !== "thread.harness-sync-message-imported") return;
      expect(event.payload).toMatchObject({
        threadId,
        nativeMessageId: "native-message-1",
        messageId: MessageId.make("message-1"),
        text: "Imported answer",
        linkedAt: syncedAt,
      });
    }),
  );

  it.effect("keeps the provider instance already linked to an existing thread", () =>
    Effect.gen(function* () {
      const { readModel, threadId } = yield* seedThread;
      const first = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.harness-sync.link",
          commandId: CommandId.make("command-link-original-provider"),
          threadId,
          sourceId: "codex-home",
          continuationKey: "codex:/tmp/home",
          nativeSessionId: "native-session-1",
          providerInstanceId: ProviderInstanceId.make("codex-original"),
          providerLabel: "Codex Original",
          activity: "idle",
          sourceUpdatedAt: createdAt,
          lastSyncedAt: createdAt,
        },
      });
      if (Array.isArray(first)) return;
      const linkedReadModel = yield* projectEvent(readModel, { ...first, sequence: 3 });

      const second = yield* decideOrchestrationCommand({
        readModel: linkedReadModel,
        command: {
          type: "thread.harness-sync.link",
          commandId: CommandId.make("command-link-different-provider"),
          threadId,
          sourceId: "codex-home",
          continuationKey: "codex:/tmp/home",
          nativeSessionId: "native-session-1",
          providerInstanceId: ProviderInstanceId.make("codex-different"),
          providerLabel: "Codex Different",
          activity: "idle",
          sourceUpdatedAt: syncedAt,
          lastSyncedAt: syncedAt,
        },
      });

      if (Array.isArray(second) || second.type !== "thread.harness-sync-linked") return;
      expect(second.payload.providerInstanceId).toBe("codex-original");
      expect(second.payload.providerLabel).toBe("Codex Original");
    }),
  );

  it.effect("rejects new turns while the original harness session is confirmed active", () =>
    Effect.gen(function* () {
      const { readModel, threadId } = yield* seedThread;
      const linkedEvent = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.harness-sync.link",
          commandId: CommandId.make("command-link-active-harness-sync"),
          threadId,
          sourceId: "codex-home",
          continuationKey: "codex:/tmp/home",
          nativeSessionId: "native-session-1",
          providerInstanceId: ProviderInstanceId.make("codex-work"),
          providerLabel: "Codex Work",
          activity: "active",
          sourceUpdatedAt: createdAt,
          lastSyncedAt: syncedAt,
        },
      });
      if (Array.isArray(linkedEvent)) return;
      const linkedReadModel = yield* projectEvent(readModel, { ...linkedEvent, sequence: 3 });

      const rejected = yield* Effect.exit(
        decideOrchestrationCommand({
          readModel: linkedReadModel,
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("command-turn-while-active"),
            threadId,
            message: {
              messageId: MessageId.make("message-user-while-active"),
              role: "user",
              text: "Continue",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: syncedAt,
          },
        }),
      );

      expect(rejected._tag).toBe("Failure");
      if (rejected._tag !== "Failure") return;
      expect(String(rejected.cause)).toContain("active in another harness");
    }),
  );
});
