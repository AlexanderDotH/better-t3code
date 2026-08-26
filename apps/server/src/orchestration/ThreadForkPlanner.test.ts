import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type ChatAttachment,
  type ThreadForkHistory,
  type ThreadForkCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { planThreadFork } from "./ThreadForkPlanner.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-08-24T10:00:00.000Z";
const projectId = ProjectId.make("project-fork");
const sourceThreadId = ThreadId.make("thread-source");
const destinationThreadId = ThreadId.make("thread-destination");

const threadCreatedEvent = (threadId: ThreadId, sequence = 1): OrchestrationEvent => ({
  sequence,
  eventId: EventId.make(`event-create-${threadId}`),
  aggregateKind: "thread",
  aggregateId: threadId,
  type: "thread.created",
  occurredAt: now,
  commandId: CommandId.make(`command-create-${threadId}`),
  causationEventId: null,
  correlationId: CommandId.make(`command-create-${threadId}`),
  metadata: {},
  payload: {
    threadId,
    projectId,
    title: "Source chat",
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

const messageEvent = (input: {
  readonly sequence: number;
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming?: boolean;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly turnId?: TurnId;
}): OrchestrationEvent => ({
  sequence: input.sequence,
  eventId: EventId.make(`event-${input.messageId}-${input.sequence}`),
  aggregateKind: "thread",
  aggregateId: sourceThreadId,
  type: "thread.message-sent",
  occurredAt: now,
  commandId: CommandId.make(`command-${input.messageId}-${input.sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`command-${input.messageId}-${input.sequence}`),
  metadata: {},
  payload: {
    threadId: sourceThreadId,
    messageId: MessageId.make(input.messageId),
    role: input.role,
    text: input.text,
    attachments: input.attachments ?? [],
    turnId: input.turnId ?? null,
    streaming: input.streaming ?? false,
    createdAt: now,
    updatedAt: now,
  },
});

const activityEvent = (input: {
  readonly sequence: number;
  readonly activityId: string;
}): OrchestrationEvent => ({
  sequence: input.sequence,
  eventId: EventId.make(`event-${input.activityId}`),
  aggregateKind: "thread",
  aggregateId: sourceThreadId,
  type: "thread.activity-appended",
  occurredAt: now,
  commandId: CommandId.make(`command-${input.activityId}`),
  causationEventId: null,
  correlationId: CommandId.make(`command-${input.activityId}`),
  metadata: {},
  payload: {
    threadId: sourceThreadId,
    activity: {
      id: EventId.make(input.activityId),
      tone: "tool",
      kind: "tool.completed",
      summary: "Completed tool call",
      payload: null,
      turnId: null,
      createdAt: now,
    },
  },
});

const forkCommand = (boundaryMessageId: string): ThreadForkCommand => ({
  type: "thread.fork",
  commandId: CommandId.make(`command-fork-${boundaryMessageId}`),
  threadId: destinationThreadId,
  sourceThreadId,
  boundary: {
    kind: "message",
    messageId: MessageId.make(boundaryMessageId),
  },
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  workspace: {
    mode: "worktree",
    baseBranch: "main",
    startFromOrigin: false,
    runSetupScript: true,
  },
  createdAt: now,
});

const proposedPlanEvent = (input: {
  readonly sequence: number;
  readonly planId: string;
  readonly markdown: string;
}): OrchestrationEvent => ({
  sequence: input.sequence,
  eventId: EventId.make(`event-plan-${input.planId}`),
  aggregateKind: "thread",
  aggregateId: sourceThreadId,
  type: "thread.proposed-plan-upserted",
  occurredAt: now,
  commandId: CommandId.make(`command-plan-${input.planId}`),
  causationEventId: null,
  correlationId: CommandId.make(`command-plan-${input.planId}`),
  metadata: {},
  payload: {
    threadId: sourceThreadId,
    proposedPlan: {
      id: input.planId,
      turnId: null,
      planMarkdown: input.markdown,
      implementedAt: null,
      implementationThreadId: null,
      createdAt: now,
      updatedAt: now,
    },
  },
});

function forkedSourceEvent(history: ThreadForkHistory): OrchestrationEvent {
  return {
    sequence: 2,
    eventId: EventId.make("event-source-was-forked"),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.forked",
    occurredAt: now,
    commandId: CommandId.make("command-source-was-forked"),
    causationEventId: null,
    correlationId: CommandId.make("command-source-was-forked"),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      fork: {
        provenance: {
          sourceThreadId: ThreadId.make("thread-grandparent"),
          sourceTitle: "Grandparent",
          boundary: { kind: "message", messageId: MessageId.make("grandparent-last") },
          forkedAt: now,
        },
        workspace: {
          spec: {
            mode: "local",
            baseBranch: null,
            startFromOrigin: false,
            runSetupScript: false,
          },
          status: "ready",
          preparedAt: now,
          lastError: null,
        },
        handoff: {
          status: "completed",
          historyInputChars: 100,
          historyAttachmentCount: 0,
          remainingInputChars: 119_898,
          remainingAttachmentCount: 8,
          completedAt: now,
        },
      },
      history,
    },
  };
}

const seedReadModel = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("event-project-fork"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("command-project-fork"),
    causationEventId: null,
    correlationId: CommandId.make("command-project-fork"),
    metadata: {},
    payload: {
      projectId,
      title: "Fork project",
      workspaceRoot: "/tmp/fork-project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });
  return yield* projectEvent(withProject, threadCreatedEvent(sourceThreadId, 2));
});

it.layer(NodeServices.layer)("thread fork planner", (it) => {
  it.effect("copies the exact completed message prefix and remaps inherited ids", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const sourceEvents = [
        threadCreatedEvent(sourceThreadId),
        messageEvent({ sequence: 2, messageId: "message-user", role: "user", text: "Question" }),
        messageEvent({
          sequence: 3,
          messageId: "message-assistant",
          role: "assistant",
          text: "Partial ",
          streaming: true,
        }),
        messageEvent({
          sequence: 4,
          messageId: "message-assistant",
          role: "assistant",
          text: "",
        }),
        messageEvent({ sequence: 5, messageId: "message-later", role: "user", text: "Later" }),
      ];

      const events = yield* planThreadFork({
        command: forkCommand("message-assistant"),
        readModel,
        sourceEvents,
      });

      expect(events.map((event) => event.type)).toEqual(["thread.created", "thread.forked"]);
      const forked = events[1];
      expect(forked?.type).toBe("thread.forked");
      if (forked?.type !== "thread.forked") return;
      expect(forked.payload.history.messages.map((message) => message.text)).toEqual([
        "Question",
        "Partial ",
      ]);
      expect(forked.payload.history.messages.map((message) => message.id)).not.toContain(
        MessageId.make("message-assistant"),
      );
      expect(forked.payload.history.messages.map((message) => message.historyOrigin)).toEqual([
        { sourceThreadId, sourceId: "message-user", ordinal: 0 },
        { sourceThreadId, sourceId: "message-assistant", ordinal: 1 },
      ]);
      expect(forked.payload.fork.workspace.status).toBe("pending");
      expect(forked.payload.fork.handoff.status).toBe("pending");
    }),
  );

  it.effect("rejects a streaming assistant message as an incomplete boundary", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const sourceEvents = [
        threadCreatedEvent(sourceThreadId),
        messageEvent({
          sequence: 2,
          messageId: "message-streaming",
          role: "assistant",
          text: "Still streaming",
          streaming: true,
        }),
      ];

      const result = yield* Effect.result(
        planThreadFork({
          command: forkCommand("message-streaming"),
          readModel,
          sourceEvents,
        }),
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.message).toContain("not complete");
      }
    }),
  );

  it.effect("forks after a user response without including later source events", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const sourceEvents = [
        threadCreatedEvent(sourceThreadId),
        messageEvent({ sequence: 2, messageId: "message-user-cutoff", role: "user", text: "Cut" }),
        messageEvent({
          sequence: 3,
          messageId: "message-after-cutoff",
          role: "assistant",
          text: "Excluded",
        }),
      ];
      const events = yield* planThreadFork({
        command: forkCommand("message-user-cutoff"),
        readModel,
        sourceEvents,
      });
      const forked = events[1];
      if (forked.type !== "thread.forked") return;
      expect(forked.payload.history.messages.map((message) => message.text)).toEqual(["Cut"]);
    }),
  );

  it.effect("forks at a finalized proposed plan boundary", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const command: ThreadForkCommand = {
        ...forkCommand("unused"),
        boundary: { kind: "proposed-plan", planId: "plan-cutoff" },
      };
      const events = yield* planThreadFork({
        command,
        readModel,
        sourceEvents: [
          threadCreatedEvent(sourceThreadId),
          messageEvent({
            sequence: 2,
            messageId: "message-before-plan",
            role: "user",
            text: "Plan",
          }),
          proposedPlanEvent({ sequence: 3, planId: "plan-cutoff", markdown: "# Do this" }),
          messageEvent({
            sequence: 4,
            messageId: "message-after-plan",
            role: "user",
            text: "Excluded",
          }),
        ],
      });
      const forked = events[1];
      if (forked.type !== "thread.forked") return;
      expect(forked.payload.history.proposedPlans.map((plan) => plan.planMarkdown)).toEqual([
        "# Do this",
      ]);
      expect(forked.payload.history.messages.map((message) => message.text)).toEqual(["Plan"]);
    }),
  );

  it.effect("remaps turn and activity relations without retaining live session state", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const turnId = TurnId.make("turn-source");
      const assistantMessageId = MessageId.make("message-turn-assistant");
      const sourceEvents: OrchestrationEvent[] = [
        threadCreatedEvent(sourceThreadId),
        messageEvent({ sequence: 2, messageId: "message-turn-user", role: "user", text: "Run" }),
        {
          sequence: 3,
          eventId: EventId.make("event-turn-start"),
          aggregateKind: "thread",
          aggregateId: sourceThreadId,
          type: "thread.turn-start-requested",
          occurredAt: now,
          commandId: CommandId.make("command-turn-start"),
          causationEventId: null,
          correlationId: CommandId.make("command-turn-start"),
          metadata: {},
          payload: {
            threadId: sourceThreadId,
            messageId: MessageId.make("message-turn-user"),
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: now,
          },
        },
        {
          sequence: 4,
          eventId: EventId.make("event-turn-session"),
          aggregateKind: "thread",
          aggregateId: sourceThreadId,
          type: "thread.session-set",
          occurredAt: now,
          commandId: CommandId.make("command-turn-session"),
          causationEventId: null,
          correlationId: CommandId.make("command-turn-session"),
          metadata: {},
          payload: {
            threadId: sourceThreadId,
            session: {
              threadId: sourceThreadId,
              status: "running",
              providerName: "codex",
              runtimeSessionId: null,
              runtimeMode: "full-access",
              activeTurnId: turnId,
              abortState: null,
              lastError: null,
              updatedAt: now,
            },
          },
        },
        messageEvent({
          sequence: 5,
          messageId: assistantMessageId,
          role: "assistant",
          text: "Done",
          streaming: true,
          turnId,
        }),
        {
          sequence: 6,
          eventId: EventId.make("event-turn-activity"),
          aggregateKind: "thread",
          aggregateId: sourceThreadId,
          type: "thread.activity-appended",
          occurredAt: now,
          commandId: CommandId.make("command-turn-activity"),
          causationEventId: null,
          correlationId: CommandId.make("command-turn-activity"),
          metadata: {},
          payload: {
            threadId: sourceThreadId,
            activity: {
              id: EventId.make("activity-source"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Tool finished",
              payload: null,
              turnId,
              createdAt: now,
            },
          },
        },
        messageEvent({
          sequence: 7,
          messageId: assistantMessageId,
          role: "assistant",
          text: "",
          turnId,
        }),
      ];
      const events = yield* planThreadFork({
        command: forkCommand(assistantMessageId),
        readModel,
        sourceEvents,
      });
      const forked = events[1];
      if (forked.type !== "thread.forked") return;
      const remappedTurn = forked.payload.history.turns[0];
      expect(remappedTurn?.turnId).not.toBe(turnId);
      expect(remappedTurn?.historyOrigin.sourceId).toBe(turnId);
      expect(forked.payload.history.messages[1]?.turnId).toBe(remappedTurn?.turnId);
      expect(forked.payload.history.activities[0]?.turnId).toBe(remappedTurn?.turnId);
      expect(forked.payload.history.activities[0]?.id).not.toBe(EventId.make("activity-source"));
    }),
  );

  it.effect("slices a nested fork by inherited global ordinal", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const grandparentId = ThreadId.make("thread-grandparent");
      const history: ThreadForkHistory = {
        messages: [
          {
            id: MessageId.make("nested-first"),
            role: "user",
            text: "First",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
            historyOrigin: {
              sourceThreadId: grandparentId,
              sourceId: "original-first",
              ordinal: 0,
            },
          },
          {
            id: MessageId.make("nested-second"),
            role: "assistant",
            text: "Second",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
            historyOrigin: {
              sourceThreadId: grandparentId,
              sourceId: "original-second",
              ordinal: 2,
            },
          },
        ],
        proposedPlans: [],
        activities: [
          {
            id: EventId.make("nested-activity"),
            tone: "tool",
            kind: "tool.completed",
            summary: "Between",
            payload: null,
            turnId: null,
            createdAt: now,
            historyOrigin: {
              sourceThreadId: grandparentId,
              sourceId: "original-activity",
              ordinal: 1,
            },
          },
        ],
        subagents: [],
        turns: [],
        checkpoints: [],
      };
      const events = yield* planThreadFork({
        command: forkCommand("nested-first"),
        readModel,
        sourceEvents: [
          threadCreatedEvent(sourceThreadId),
          forkedSourceEvent(history),
          messageEvent({
            sequence: 3,
            messageId: "native-after-nested",
            role: "user",
            text: "Later",
          }),
        ],
      });
      const forked = events[1];
      if (forked.type !== "thread.forked") return;
      expect(forked.payload.history.messages.map((message) => message.text)).toEqual(["First"]);
      expect(forked.payload.history.activities).toEqual([]);
      expect(forked.payload.history.messages[0]?.historyOrigin).toEqual({
        sourceThreadId,
        sourceId: "nested-first",
        ordinal: 0,
      });
    }),
  );

  it.effect("allows an archived source thread", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const archived = yield* projectEvent(readModel, {
        sequence: 3,
        eventId: EventId.make("event-source-archived"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        type: "thread.archived",
        occurredAt: now,
        commandId: CommandId.make("command-source-archived"),
        causationEventId: null,
        correlationId: CommandId.make("command-source-archived"),
        metadata: {},
        payload: { threadId: sourceThreadId, archivedAt: now, updatedAt: now },
      });
      const result = yield* planThreadFork({
        command: forkCommand("archived-message"),
        readModel: archived,
        sourceEvents: [
          threadCreatedEvent(sourceThreadId),
          messageEvent({
            sequence: 2,
            messageId: "archived-message",
            role: "user",
            text: "Still here",
          }),
        ],
      });
      expect(result[1]?.type).toBe("thread.forked");
    }),
  );

  it.effect("rejects deleted and missing source threads", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const deleted = yield* projectEvent(readModel, {
        sequence: 3,
        eventId: EventId.make("event-source-deleted"),
        aggregateKind: "thread",
        aggregateId: sourceThreadId,
        type: "thread.deleted",
        occurredAt: now,
        commandId: CommandId.make("command-source-deleted"),
        causationEventId: null,
        correlationId: CommandId.make("command-source-deleted"),
        metadata: {},
        payload: { threadId: sourceThreadId, deletedAt: now },
      });
      const deletedResult = yield* Effect.result(
        planThreadFork({
          command: forkCommand("message"),
          readModel: deleted,
          sourceEvents: [],
        }),
      );
      expect(deletedResult._tag).toBe("Failure");
      const missingResult = yield* Effect.result(
        planThreadFork({
          command: forkCommand("message"),
          readModel: { ...readModel, threads: [] },
          sourceEvents: [],
        }),
      );
      expect(missingResult._tag).toBe("Failure");
    }),
  );

  it.effect("rejects a missing boundary and a destination id collision", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const missing = yield* Effect.result(
        planThreadFork({
          command: forkCommand("does-not-exist"),
          readModel,
          sourceEvents: [threadCreatedEvent(sourceThreadId)],
        }),
      );
      expect(missing._tag).toBe("Failure");
      const withDestination = yield* projectEvent(
        readModel,
        threadCreatedEvent(destinationThreadId, 3),
      );
      const collision = yield* Effect.result(
        planThreadFork({
          command: forkCommand("message"),
          readModel: withDestination,
          sourceEvents: [],
        }),
      );
      expect(collision._tag).toBe("Failure");
    }),
  );

  it.effect("preserves history beyond provider handoff capacity", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const oversizedTextEvents = yield* planThreadFork({
        command: forkCommand("oversized-text"),
        readModel,
        sourceEvents: [
          threadCreatedEvent(sourceThreadId),
          messageEvent({
            sequence: 2,
            messageId: "oversized-text",
            role: "user",
            text: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
          }),
        ],
      });
      const oversizedTextFork = oversizedTextEvents[1];
      if (oversizedTextFork.type !== "thread.forked") return;
      expect(oversizedTextFork.payload.history.messages[0]?.text).toHaveLength(
        PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
      );
      expect(oversizedTextFork.payload.fork.handoff.remainingInputChars).toBe(
        PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
      );

      const attachments: ChatAttachment[] = Array.from({ length: 9 }, (_, index) => ({
        type: "image",
        id: `fork-image-${index}`,
        name: `image-${index}.png`,
        mimeType: "image/png",
        sizeBytes: 1,
      }));
      const oversizedAttachmentEvents = yield* planThreadFork({
        command: forkCommand("oversized-attachments"),
        readModel,
        sourceEvents: [
          threadCreatedEvent(sourceThreadId),
          messageEvent({
            sequence: 2,
            messageId: "oversized-attachments",
            role: "user",
            text: "Images",
            attachments,
          }),
        ],
      });
      const oversizedAttachmentFork = oversizedAttachmentEvents[1];
      if (oversizedAttachmentFork.type !== "thread.forked") return;
      expect(oversizedAttachmentFork.payload.history.messages[0]?.attachments).toHaveLength(9);
      expect(oversizedAttachmentFork.payload.fork.handoff.remainingAttachmentCount).toBe(
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
      );
    }),
  );

  it.effect("preserves activity history beyond the former retained row limit", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const activities = Array.from({ length: 1_890 }, (_, index) =>
        activityEvent({
          sequence: index + 2,
          activityId: `long-history-activity-${index}`,
        }),
      );
      const boundary = messageEvent({
        sequence: activities.length + 2,
        messageId: "long-history-boundary",
        role: "assistant",
        text: "History retained",
      });
      const events = yield* planThreadFork({
        command: forkCommand("long-history-boundary"),
        readModel,
        sourceEvents: [threadCreatedEvent(sourceThreadId), ...activities, boundary],
      });
      const forked = events[1];
      if (forked.type !== "thread.forked") return;

      expect(forked.payload.history.activities).toHaveLength(1_890);
      expect(forked.payload.history.messages.map((message) => message.text)).toEqual([
        "History retained",
      ]);
      expect(forked.payload.fork.handoff).toMatchObject({
        status: "pending",
        remainingInputChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
        remainingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
      });
    }),
  );
});
