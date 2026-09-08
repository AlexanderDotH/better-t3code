import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const REQUESTED_AT = "2026-08-26T10:00:00.000Z";
const RETRIED_AT = "2026-08-26T10:01:00.000Z";
const THREAD_ID = ThreadId.make("thread-retry");
const TURN_ID = TurnId.make("turn-interrupted");
const MESSAGE_ID = MessageId.make("message-user");

function makeThread(
  overrides: Partial<Pick<OrchestrationThread, "latestTurn" | "messages" | "session">> = {},
): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Retry",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TURN_ID,
      state: "interrupted",
      requestedAt: REQUESTED_AT,
      startedAt: REQUESTED_AT,
      completedAt: "2026-08-26T10:00:10.000Z",
      assistantMessageId: null,
    },
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: MESSAGE_ID,
        role: "user",
        text: "Try this",
        turnId: null,
        streaming: false,
        createdAt: REQUESTED_AT,
        updatedAt: REQUESTED_AT,
      },
    ],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeReadModel(thread: OrchestrationThread): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread],
    updatedAt: REQUESTED_AT,
  };
}

function retryCommand(turnId: TurnId | null = TURN_ID) {
  return {
    type: "thread.turn.retry" as const,
    commandId: CommandId.make("command-retry"),
    threadId: THREAD_ID,
    turnId,
    messageId: MESSAGE_ID,
    fetchMode: "repository-exploration" as const,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6",
    },
    createdAt: RETRIED_AT,
  };
}

it.layer(NodeServices.layer)("interrupted turn retry decider", (it) => {
  it.effect("starts only a new result turn from the existing user message", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel(makeThread()),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.turn-start-requested"]);
      expect(events).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "thread.message-sent" })]),
      );
      expect(events[0]).toMatchObject({
        type: "thread.turn-start-requested",
        payload: {
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          retryOfTurnId: TURN_ID,
          resultOnly: true,
          fetchMode: "repository-exploration",
          modelSelection: { instanceId: "codex", model: "gpt-5.6" },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: RETRIED_AT,
        },
      });
    }),
  );

  it.effect("retries a result-less start aborted before the provider assigned a turn id", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: retryCommand(null),
        readModel: makeReadModel(
          makeThread({
            latestTurn: {
              ...makeThread().latestTurn!,
              requestedAt: "2026-08-26T09:55:00.000Z",
              startedAt: "2026-08-26T09:55:00.000Z",
              completedAt: "2026-08-26T09:56:00.000Z",
              assistantMessageId: MessageId.make("previous-assistant"),
            },
            session: {
              threadId: THREAD_ID,
              status: "ready",
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeSessionId: null,
              runtimeMode: "full-access",
              activeTurnId: null,
              abortState: null,
              lastError: null,
              updatedAt: "2026-08-26T10:00:10.000Z",
            },
          }),
        ),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["thread.turn-start-requested"]);
      expect(events[0]).toMatchObject({
        type: "thread.turn-start-requested",
        payload: {
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          resultOnly: true,
          createdAt: RETRIED_AT,
        },
      });
      expect(events[0]).not.toHaveProperty("payload.retryOfTurnId");
    }),
  );

  it.effect("rejects a retry after the interrupted turn returned an assistant result", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel(
          makeThread({
            latestTurn: {
              ...makeThread().latestTurn!,
              assistantMessageId: MessageId.make("message-assistant"),
            },
          }),
        ),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a retry after the interrupted turn streamed partial assistant output", () =>
    Effect.gen(function* () {
      const original = makeThread();
      const error = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel(
          makeThread({
            messages: [
              ...original.messages,
              {
                id: MessageId.make("message-assistant-partial"),
                role: "assistant",
                text: "Partial result",
                turnId: TURN_ID,
                streaming: true,
                createdAt: "2026-08-26T10:00:05.000Z",
                updatedAt: "2026-08-26T10:00:05.000Z",
              },
            ],
          }),
        ),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a retry when a newer user message is already queued", () =>
    Effect.gen(function* () {
      const original = makeThread();
      const error = yield* decideOrchestrationCommand({
        command: retryCommand(),
        readModel: makeReadModel(
          makeThread({
            messages: [
              ...original.messages,
              {
                ...original.messages[0]!,
                id: MessageId.make("message-newer"),
                createdAt: RETRIED_AT,
                updatedAt: RETRIED_AT,
              },
            ],
          }),
        ),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
