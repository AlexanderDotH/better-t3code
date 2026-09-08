import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-08-24T11:00:00.000Z";
const projectId = ProjectId.make("project-fork-state");
const sourceThreadId = ThreadId.make("thread-fork-state-source");
const threadId = ThreadId.make("thread-fork-state");
const historicalTurnId = TurnId.make("turn-history");

function baseEvent(input: {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: OrchestrationEvent["type"];
}) {
  return {
    sequence: input.sequence,
    eventId: EventId.make(input.eventId),
    aggregateKind: "thread" as const,
    aggregateId: threadId,
    type: input.type,
    occurredAt: now,
    commandId: CommandId.make(`command-${input.eventId}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-${input.eventId}`),
    metadata: {},
  };
}

const seedForkReadModel = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("event-fork-state-project"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("command-fork-state-project"),
    causationEventId: null,
    correlationId: CommandId.make("command-fork-state-project"),
    metadata: {},
    payload: {
      projectId,
      title: "Fork state project",
      workspaceRoot: "/tmp/fork-state",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
  const withThread = yield* projectEvent(withProject, {
    ...baseEvent({ sequence: 2, eventId: "event-fork-state-create", type: "thread.created" }),
    type: "thread.created",
    payload: {
      threadId,
      projectId,
      title: "Forked chat",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  return yield* projectEvent(withThread, {
    ...baseEvent({ sequence: 3, eventId: "event-fork-state-forked", type: "thread.forked" }),
    type: "thread.forked",
    payload: {
      threadId,
      fork: {
        provenance: {
          sourceThreadId,
          sourceTitle: "Source",
          boundary: { kind: "message", messageId: MessageId.make("source-message") },
          forkedAt: now,
        },
        workspace: {
          spec: {
            mode: "worktree",
            baseBranch: "main",
            startFromOrigin: false,
            runSetupScript: true,
          },
          status: "pending",
          preparedAt: null,
          lastError: null,
        },
        handoff: {
          status: "pending",
          historyInputChars: 100,
          historyAttachmentCount: 0,
          remainingInputChars: 119_898,
          remainingAttachmentCount: 8,
          completedAt: null,
        },
      },
      history: {
        messages: [
          {
            id: MessageId.make("history-message"),
            role: "user",
            text: "Inherited",
            attachments: [],
            turnId: historicalTurnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
            historyOrigin: { sourceThreadId, sourceId: "source-message", ordinal: 0 },
          },
        ],
        proposedPlans: [
          {
            id: "history-plan",
            turnId: historicalTurnId,
            planMarkdown: "# Inherited plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: now,
            updatedAt: now,
            historyOrigin: { sourceThreadId, sourceId: "source-plan", ordinal: 1 },
          },
        ],
        activities: [
          {
            id: EventId.make("history-activity"),
            tone: "tool",
            kind: "tool.completed",
            summary: "Inherited work",
            payload: null,
            turnId: historicalTurnId,
            createdAt: now,
            historyOrigin: { sourceThreadId, sourceId: "source-activity", ordinal: 2 },
          },
        ],
        subagents: [],
        turns: [],
        checkpoints: [
          {
            turnId: historicalTurnId,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/history/1"),
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: now,
            historyOrigin: { sourceThreadId, sourceId: "source-checkpoint", ordinal: 3 },
          },
        ],
      },
    },
  });
});

it.layer(NodeServices.layer)("thread fork state", (it) => {
  it.effect("projects immutable inherited history and fork provenance", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      expect(thread?.fork?.provenance.sourceThreadId).toBe(sourceThreadId);
      expect(thread?.messages.map((message) => message.text)).toEqual(["Inherited"]);
      expect(thread?.messages[0]?.historyOrigin?.ordinal).toBe(0);
      expect(thread?.session).toBeNull();
      expect(thread?.latestTurn).toBeNull();
    }),
  );

  it.effect("emits and projects monotonic workspace readiness", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.fork.workspace.update",
          commandId: CommandId.make("command-workspace-ready"),
          threadId,
          status: "ready",
          preparedAt: "2026-08-24T11:01:00.000Z",
          lastError: null,
          createdAt: "2026-08-24T11:01:00.000Z",
        },
      });
      expect(Array.isArray(decided)).toBe(false);
      if (Array.isArray(decided)) return;
      expect(decided.type).toBe("thread.fork-workspace-updated");
      const ready = yield* projectEvent(readModel, { ...decided, sequence: 4 });
      const staleError: OrchestrationEvent = {
        ...baseEvent({
          sequence: 5,
          eventId: "event-stale-workspace-error",
          type: "thread.fork-workspace-updated",
        }),
        type: "thread.fork-workspace-updated",
        payload: {
          threadId,
          status: "error",
          preparedAt: null,
          lastError: "late failure",
          createdAt: "2026-08-24T11:02:00.000Z",
        },
      };
      const afterStaleError = yield* projectEvent(ready, staleError);
      expect(afterStaleError.threads[0]?.fork?.workspace).toMatchObject({
        status: "ready",
        preparedAt: "2026-08-24T11:01:00.000Z",
        lastError: null,
      });
    }),
  );

  it.effect("marks handoff complete once and keeps the first success timestamp", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.fork.handoff.complete",
          commandId: CommandId.make("command-handoff-complete"),
          threadId,
          completedAt: "2026-08-24T11:03:00.000Z",
        },
      });
      if (Array.isArray(decided)) return;
      const completed = yield* projectEvent(readModel, { ...decided, sequence: 4 });
      const duplicate: OrchestrationEvent = {
        ...baseEvent({
          sequence: 5,
          eventId: "event-handoff-duplicate",
          type: "thread.fork-handoff-completed",
        }),
        type: "thread.fork-handoff-completed",
        payload: {
          threadId,
          completedAt: "2026-08-24T11:04:00.000Z",
        },
      };
      const afterDuplicate = yield* projectEvent(completed, duplicate);
      expect(afterDuplicate.threads[0]?.fork?.handoff).toMatchObject({
        status: "completed",
        completedAt: "2026-08-24T11:03:00.000Z",
      });
    }),
  );

  it.effect("rejects invalid workspace transition fields", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const result = yield* Effect.result(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.fork.workspace.update",
            commandId: CommandId.make("command-workspace-invalid"),
            threadId,
            status: "ready",
            preparedAt: null,
            lastError: null,
            createdAt: now,
          },
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("keeps frozen history while reverting later native work", () =>
    Effect.gen(function* () {
      let readModel = yield* seedForkReadModel;
      const nativeTurnId = TurnId.make("turn-native");
      const nativeMessageId = MessageId.make("message-native");
      readModel = yield* projectEvent(readModel, {
        ...baseEvent({ sequence: 4, eventId: "event-native-message", type: "thread.message-sent" }),
        type: "thread.message-sent",
        payload: {
          threadId,
          messageId: nativeMessageId,
          role: "user",
          text: "Native work",
          attachments: [],
          turnId: nativeTurnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      readModel = yield* projectEvent(readModel, {
        ...baseEvent({
          sequence: 5,
          eventId: "event-native-plan",
          type: "thread.proposed-plan-upserted",
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId,
          proposedPlan: {
            id: "native-plan",
            turnId: nativeTurnId,
            planMarkdown: "# Native plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: now,
            updatedAt: now,
          },
        },
      });
      readModel = yield* projectEvent(readModel, {
        ...baseEvent({
          sequence: 6,
          eventId: "event-native-activity",
          type: "thread.activity-appended",
        }),
        type: "thread.activity-appended",
        payload: {
          threadId,
          activity: {
            id: EventId.make("native-activity"),
            tone: "tool",
            kind: "tool.completed",
            summary: "Native activity",
            payload: null,
            turnId: nativeTurnId,
            createdAt: now,
          },
        },
      });
      readModel = yield* projectEvent(readModel, {
        ...baseEvent({
          sequence: 7,
          eventId: "event-native-checkpoint",
          type: "thread.turn-diff-completed",
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId,
          turnId: nativeTurnId,
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/native/1"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: now,
        },
      });
      const reverted = yield* projectEvent(readModel, {
        ...baseEvent({ sequence: 8, eventId: "event-native-reverted", type: "thread.reverted" }),
        type: "thread.reverted",
        payload: { threadId, turnCount: 0 },
      });
      const thread = reverted.threads[0];
      expect(thread?.messages.map((message) => message.id)).toEqual([
        MessageId.make("history-message"),
      ]);
      expect(thread?.proposedPlans.map((plan) => plan.id)).toEqual(["history-plan"]);
      expect(thread?.activities.map((activity) => activity.id)).toEqual([
        EventId.make("history-activity"),
      ]);
      expect(thread?.checkpoints.map((checkpoint) => checkpoint.checkpointRef)).toEqual([
        CheckpointRef.make("refs/t3/history/1"),
      ]);
      expect(thread?.latestTurn).toBeNull();
    }),
  );

  it.effect("rejects checkpoint revert commands targeting frozen history", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const result = yield* Effect.result(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.checkpoint.revert",
            commandId: CommandId.make("command-revert-frozen-checkpoint"),
            threadId,
            turnCount: 1,
            createdAt: now,
          },
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("frozen fork history");
      }
    }),
  );

  it.effect("rejects implementation turns targeting a frozen proposed plan", () =>
    Effect.gen(function* () {
      const readModel = yield* seedForkReadModel;
      const result = yield* Effect.result(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("command-implement-frozen-plan"),
            threadId,
            message: {
              messageId: MessageId.make("message-implement-frozen-plan"),
              role: "user",
              text: "Implement this plan",
              attachments: [],
            },
            sourceProposedPlan: { threadId, planId: "history-plan" },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: now,
          },
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("frozen fork history");
      }
    }),
  );
});
