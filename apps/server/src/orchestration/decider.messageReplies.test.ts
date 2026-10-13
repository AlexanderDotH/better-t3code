import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationSubagentSummary,
  type OrchestrationThread,
  type ThreadReplyStartCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
import { toRootThreadStreamItem } from "./threadStreamRouting.ts";

const now = "2026-10-13T10:00:00.000Z";
const threadId = ThreadId.make("main-thread");
const sourceId = MessageId.make("main-message");
const topicId = SubagentId.make("reply-topic");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "same-model" };

function thread(): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Primary task",
    modelSelection: selection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    latestTurn: {
      turnId: TurnId.make("main-turn"),
      state: "running",
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: sourceId,
    },
    messages: [
      {
        id: sourceId,
        role: "assistant",
        text: "Implementing the login.",
        turnId: TurnId.make("main-turn"),
        streaming: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    subagents: [],
    session: null,
  };
}

function topic(status: OrchestrationSubagentSummary["status"]): OrchestrationSubagentSummary {
  return {
    id: topicId,
    origin: "t3-managed",
    providerInstanceId: selection.instanceId,
    providerDriver: ProviderDriverKind.make("codex"),
    providerThreadId: "synthetic-topic",
    parentId: null,
    path: null,
    name: "Reply",
    nickname: null,
    role: null,
    task: "Why OAuth?",
    model: selection.model,
    reasoningEffort: null,
    depth: 1,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: now,
    updatedAt: now,
    completedAt: status === "completed" ? now : null,
    messageReply: {
      rootMessageId: sourceId,
      replyTo: { messageId: sourceId, role: "assistant", text: "Implementing the login." },
      modelSelection: selection,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspacePath: "/project",
    },
  };
}

function readModel(value: OrchestrationThread): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: value.projectId,
        title: "Project",
        workspaceRoot: "/project",
        defaultModelSelection: null,
        checkpointsEnabled: true,
        scripts: [],
        coordinationClaims: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [value],
    updatedAt: now,
  };
}

function startCommand(): ThreadReplyStartCommand {
  return {
    type: "thread.reply.start",
    commandId: CommandId.make("reply-start"),
    threadId,
    replyTopicId: topicId,
    replyTo: { messageId: sourceId, role: "assistant", text: "Implementing" },
    message: {
      messageId: MessageId.make("reply-user"),
      role: "user",
      text: "Why OAuth?",
      attachments: [],
    },
    createdAt: now,
  };
}

it.layer(NodeServices.layer)("message reply command isolation", (it) => {
  it.effect("keeps reply coordination available after the main turn ends", () =>
    Effect.gen(function* () {
      const replyTurnId = TurnId.make("reply-turn");
      const activeTopic = {
        ...topic("running"),
        latestTurn: {
          turnId: replyTurnId,
          state: "running" as const,
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
      };
      const main = { ...thread(), latestTurn: null, subagents: [activeTopic] };
      const model: OrchestrationReadModel = {
        ...readModel(main),
        projects: [
          {
            id: main.projectId,
            title: "Project",
            workspaceRoot: "/project",
            defaultModelSelection: null,
            checkpointsEnabled: true,
            scripts: [],
            coordinationClaims: [],
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
      };
      const command = {
        type: "project.agent.claim.set" as const,
        commandId: CommandId.make("reply-claim"),
        projectId: main.projectId,
        threadId,
        turnId: replyTurnId,
        summary: "Implementing the follow-up",
        claims: [{ kind: "path" as const, path: "src/theme" }],
        claimedAt: now,
      };
      const result = yield* decideOrchestrationCommand({ command, readModel: model });
      const events = Array.isArray(result) ? result : [result];
      expect(events.at(-1)?.type).toBe("project.agent-claim-set");
      const stale = yield* decideOrchestrationCommand({
        command: { ...command, turnId: TurnId.make("old-reply-turn") },
        readModel: model,
      }).pipe(Effect.flip);
      expect(stale._tag).toBe("OrchestrationCommandInvariantError");
      const completed = yield* decideOrchestrationCommand({
        command,
        readModel: {
          ...model,
          threads: [{ ...main, subagents: [{ ...activeTopic, status: "completed" }] }],
        },
      }).pipe(Effect.flip);
      expect(completed._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
  for (const role of ["user", "assistant"] as const) {
    it.effect(`starts a reply to a ${role} while the primary turn keeps running`, () =>
      Effect.gen(function* () {
        const main = thread();
        const source = { ...main.messages[0]!, role };
        const original = { ...main, messages: [source] };
        const command = { ...startCommand(), replyTo: { ...startCommand().replyTo, role } };
        const result = yield* decideOrchestrationCommand({
          command,
          readModel: readModel(original),
        });
        const events = Array.isArray(result) ? result : [result];
        expect(events.map((event) => event.type)).toEqual([
          "thread.subagent-upserted",
          "thread.reply-start-requested",
        ]);
        expect(events[1]!.payload).toEqual({
          commandId: command.commandId,
          threadId,
          replyTopicId: topicId,
          replyTo: command.replyTo,
          message: command.message,
          createdAt: now,
        });
        let projected = readModel(original);
        for (const event of events) {
          projected = yield* projectEvent(projected, {
            ...event,
            sequence: projected.snapshotSequence + 1,
          });
        }
        expect(projected.threads[0]!.latestTurn).toEqual(original.latestTurn);
        expect(projected.threads[0]!.messages).toEqual(original.messages);
        expect(projected.threads[0]!.subagents[0]).toMatchObject({
          status: "starting",
          messageReply: {
            modelSelection: selection,
            runtimeMode: original.runtimeMode,
            interactionMode: original.interactionMode,
            workspacePath: "/project",
            replyTo: command.replyTo,
          },
        });
        const restore = yield* decideOrchestrationCommand({
          command: {
            type: "thread.checkpoint.revert",
            commandId: CommandId.make("immediate-revert"),
            threadId,
            turnCount: 0,
            createdAt: now,
          },
          readModel: projected,
        }).pipe(Effect.flip);
        expect(restore._tag).toBe("OrchestrationCommandInvariantError");
      }),
    );
  }

  it.effect("continues the selected topic without borrowing another topic's message", () =>
    Effect.gen(function* () {
      const replyId = MessageId.make("topic-assistant");
      const main = {
        ...thread(),
        subagents: [topic("running")],
        replyMessages: [
          {
            id: replyId,
            role: "assistant" as const,
            text: "OAuth delegates authentication.",
            replyTopicId: topicId,
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      const command = {
        ...startCommand(),
        replyTo: {
          messageId: replyId,
          role: "assistant" as const,
          text: "OAuth delegates authentication.",
        },
      };
      const result = yield* decideOrchestrationCommand({ command, readModel: readModel(main) });
      const events = Array.isArray(result) ? result : [result];
      expect(events.at(-1)?.type).toBe("thread.reply-start-requested");
      const wrongTopic = yield* decideOrchestrationCommand({
        command: { ...command, replyTopicId: SubagentId.make("another-topic") },
        readModel: readModel(main),
      }).pipe(Effect.flip);
      expect(wrongTopic._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects missing references, duplicate message ids and archived chats", () =>
    Effect.gen(function* () {
      const command = startCommand();
      const invalidCases = [
        {
          main: thread(),
          command: {
            ...command,
            replyTo: { ...command.replyTo, messageId: MessageId.make("missing") },
          },
        },
        {
          main: thread(),
          command: { ...command, message: { ...command.message, messageId: sourceId } },
        },
        { main: { ...thread(), archivedAt: now }, command },
      ];
      for (const entry of invalidCases) {
        const error = yield* decideOrchestrationCommand({
          command: entry.command,
          readModel: readModel(entry.main),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("retries only an interrupted or failed topic", () =>
    Effect.gen(function* () {
      for (const status of ["interrupted", "error", "running", "completed"] as const) {
        const command = {
          type: "thread.reply.retry" as const,
          commandId: CommandId.make("retry"),
          threadId,
          replyTopicId: topicId,
          createdAt: now,
        };
        const effect = decideOrchestrationCommand({
          command,
          readModel: readModel({ ...thread(), subagents: [topic(status)] }),
        });
        if (status === "interrupted" || status === "error") {
          const result = yield* effect;
          const events = Array.isArray(result) ? result : [result];
          expect(events.at(-1)?.type).toBe("thread.reply-retry-requested");
        } else {
          expect((yield* effect.pipe(Effect.flip))._tag).toBe("OrchestrationCommandInvariantError");
        }
      }
    }),
  );

  it.effect("blocks restoration while a reply is starting, running or awaiting input", () =>
    Effect.gen(function* () {
      for (const status of ["starting", "running", "waiting"] as const) {
        const error = yield* decideOrchestrationCommand({
          command: {
            type: "thread.checkpoint.revert",
            commandId: CommandId.make("revert"),
            threadId,
            turnCount: 0,
            createdAt: now,
          },
          readModel: readModel({ ...thread(), subagents: [topic(status)] }),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("delivers reply deltas inline while native subagent output remains scoped", () =>
    Effect.gen(function* () {
      const reference = {
        messageId: MessageId.make("reply-user"),
        role: "user" as const,
        text: "Why OAuth?",
      };
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.message.assistant.delta",
          commandId: CommandId.make("delta"),
          threadId,
          subagentId: topicId,
          replyTopicId: topicId,
          replyTo: reference,
          messageId: MessageId.make("reply-assistant"),
          delta: "Because",
          createdAt: now,
        },
        readModel: readModel({ ...thread(), subagents: [topic("running")] }),
      });
      const events = Array.isArray(result) ? result : [result];
      const event = { ...events[0]!, sequence: 1 };
      expect(toRootThreadStreamItem(event).kind).toBe("event");
      if (event.type !== "thread.message-sent") throw new Error("Expected message event");
      expect(event.payload.replyTo).toEqual(reference);
      const { replyTo: _replyTo, replyTopicId: _replyTopicId, ...nativePayload } = event.payload;
      expect(toRootThreadStreamItem({ ...event, payload: nativePayload }).kind).toBe("cursor");
    }),
  );
});
