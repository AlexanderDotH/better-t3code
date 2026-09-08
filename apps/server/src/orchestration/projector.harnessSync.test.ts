import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-08-23T10:00:00.000Z";

function linkEvent(input: {
  readonly sequence: number;
  readonly lastSyncedAt: string;
  readonly activity: "active" | "idle" | "unknown";
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-link-${input.sequence}`),
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    type: "thread.harness-sync-linked",
    occurredAt: input.lastSyncedAt,
    commandId: CommandId.make(`command-link-${input.sequence}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-link-${input.sequence}`),
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      sourceId: "codex-home",
      continuationKey: "codex:/tmp/home",
      nativeSessionId: "native-session-1",
      providerInstanceId: ProviderInstanceId.make("codex-work"),
      providerLabel: "Codex Work",
      activity: input.activity,
      sourceUpdatedAt: input.lastSyncedAt,
      lastSyncedAt: input.lastSyncedAt,
    },
  };
}

it.effect("keeps the newest harness sync state when an older status event arrives later", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-1");
    const created = yield* projectEvent(createEmptyReadModel(createdAt), {
      sequence: 1,
      eventId: EventId.make("event-thread"),
      aggregateKind: "thread",
      aggregateId: threadId,
      type: "thread.created",
      occurredAt: createdAt,
      commandId: CommandId.make("command-thread"),
      causationEventId: null,
      correlationId: CommandId.make("command-thread"),
      metadata: {},
      payload: {
        threadId,
        projectId: ProjectId.make("project-1"),
        title: "Imported chat",
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
    const newest = yield* projectEvent(
      created,
      linkEvent({
        sequence: 2,
        activity: "idle",
        lastSyncedAt: "2026-08-23T10:02:00.000Z",
      }),
    );
    const stale = yield* projectEvent(
      newest,
      linkEvent({
        sequence: 3,
        activity: "active",
        lastSyncedAt: "2026-08-23T10:01:00.000Z",
      }),
    );

    expect(stale.threads[0]?.harnessSync?.activity).toBe("idle");
    expect(stale.threads[0]?.harnessSync?.lastSyncedAt).toBe("2026-08-23T10:02:00.000Z");
    expect(stale.snapshotSequence).toBe(3);

    const refreshedStatus = yield* projectEvent(
      stale,
      linkEvent({
        sequence: 4,
        activity: "active",
        lastSyncedAt: "2026-08-23T10:02:00.000Z",
      }),
    );
    expect(refreshedStatus.threads[0]?.harnessSync?.activity).toBe("active");
    expect(refreshedStatus.snapshotSequence).toBe(4);
  }),
);
