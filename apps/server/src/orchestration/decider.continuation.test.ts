import {
  ClientOrchestrationCommand,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  ThreadTurnStartCommand,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const decodeClientCommand = Schema.decodeEffect(ClientOrchestrationCommand);
const decodeTurnStart = Schema.decodeUnknownEffect(ThreadTurnStartCommand);

const createdAt = "2026-10-19T20:56:00.000Z";
const resumedAt = "2026-10-19T20:56:11.159Z";
const threadId = ThreadId.make("deep-plan-thread");
const turnId = TurnId.make("completed-turn");
const messageId = MessageId.make("previous-request");

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Deep Plan",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: createdAt,
      startedAt: createdAt,
      completedAt: createdAt,
      assistantMessageId: null,
    },
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: messageId,
        role: "user",
        text: "Implement the approved plan",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    pullRequests: [],
    session: null,
    ...overrides,
  };
}

function readModel(thread = makeThread()): OrchestrationReadModel {
  return { snapshotSequence: 0, projects: [], threads: [thread], updatedAt: createdAt };
}

function continuation(id: string) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make(id),
    threadId,
    message: {
      messageId: MessageId.make(id),
      role: "user" as const,
      text: "CONTINUE THE EXISTING APPROVED DEEPPLAN IMPLEMENTATION.",
      attachments: [],
    },
    idleGuard: { latestTurnId: turnId, latestUserMessageId: messageId },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    createdAt: resumedAt,
  };
}

it.layer(NodeServices.layer)("guarded continuation", (it) => {
  it.effect(
    "appends one continuation before any provider startup receipt, even from an error state",
    () =>
      Effect.gen(function* () {
        const thread = makeThread({
          session: {
            threadId,
            status: "error",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeSessionId: null,
            runtimeMode: "full-access",
            activeTurnId: null,
            abortState: null,
            lastError: "Previous writer failed",
            updatedAt: createdAt,
          },
        });
        let current = readModel(thread);
        for (const id of ["manual-resume", "automatic-resume", "reconnected-client"]) {
          const clientCommand = yield* decodeClientCommand(continuation(id));
          const command = yield* decodeTurnStart(clientCommand);
          const result = yield* decideOrchestrationCommand({ command, readModel: current });
          const events = Array.isArray(result) ? result : [result];
          for (const event of events) {
            current = yield* projectEvent(current, {
              ...event,
              sequence: current.snapshotSequence + 1,
            });
          }
        }
        expect(current.threads[0]?.messages.map((message) => message.id)).toEqual([
          messageId,
          MessageId.make("manual-resume"),
        ]);
      }),
  );

  for (const status of ["starting", "running"] as const) {
    it.effect(`ignores continuation while the provider is ${status}`, () =>
      Effect.gen(function* () {
        const thread = makeThread({
          session: {
            threadId,
            status,
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeSessionId: null,
            runtimeMode: "full-access",
            activeTurnId: null,
            abortState: null,
            lastError: null,
            updatedAt: resumedAt,
          },
        });
        const result = yield* decideOrchestrationCommand({
          command: continuation("duplicate"),
          readModel: readModel(thread),
        });
        expect(result).toEqual([]);
      }),
    );
  }

  it.effect("ignores an idle continuation after a different turn has already finished", () =>
    Effect.gen(function* () {
      const thread = makeThread({
        latestTurn: { ...makeThread().latestTurn!, turnId: TurnId.make("newer-completed-turn") },
      });
      const result = yield* decideOrchestrationCommand({
        command: continuation("stale"),
        readModel: readModel(thread),
      });
      expect(result).toEqual([]);
    }),
  );

  it.effect("keeps ordinary user messages available while the agent is working", () =>
    Effect.gen(function* () {
      const thread = makeThread({
        latestTurn: { ...makeThread().latestTurn!, state: "running" },
      });
      const { idleGuard: _idleGuard, ...command } = continuation("user-follow-up");
      const result = yield* decideOrchestrationCommand({ command, readModel: readModel(thread) });
      expect(Array.isArray(result) && result.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
    }),
  );

  it.effect("allows continuation after newly completed work", () =>
    Effect.gen(function* () {
      const nextTurnId = TurnId.make("next-completed-turn");
      const nextMessageId = MessageId.make("previous-continuation");
      const thread = makeThread({
        latestTurn: { ...makeThread().latestTurn!, turnId: nextTurnId },
        messages: [{ ...makeThread().messages[0]!, id: nextMessageId }],
      });
      const result = yield* decideOrchestrationCommand({
        command: {
          ...continuation("next-resume"),
          idleGuard: { latestTurnId: nextTurnId, latestUserMessageId: nextMessageId },
        },
        readModel: readModel(thread),
      });
      expect(Array.isArray(result) && result.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
    }),
  );
});
