import {
  CommandId,
  ProjectAgentMessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-08-09T18:00:00.000Z";
const projectId = ProjectId.make("project-coordination");
const firstThreadId = ThreadId.make("thread-first");
const secondThreadId = ThreadId.make("thread-second");
const firstTurnId = TurnId.make("turn-first");
const secondTurnId = TurnId.make("turn-second");

function activeThread(threadId: ThreadId, turnId: TurnId, title: string) {
  return {
    id: threadId,
    projectId,
    title,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: "feature/coordination",
    worktreePath: null,
    latestTurn: {
      turnId,
      state: "running" as const,
      requestedAt: now,
      startedAt: now,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    titleRegeneration: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: {
      threadId,
      status: "running" as const,
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId: null,
      runtimeMode: "full-access" as const,
      activeTurnId: turnId,
      abortState: null,
      lastError: null,
      updatedAt: now,
    },
  };
}

function readModel(withLease: boolean): OrchestrationReadModel {
  return {
    snapshotSequence: 10,
    projects: [
      {
        id: projectId,
        title: "Coordination",
        workspaceRoot: "/workspace/project",
        defaultModelSelection: null,
        scripts: [],
        coordinationClaims: withLease
          ? [
              {
                projectId,
                threadId: firstThreadId,
                turnId: firstTurnId,
                summary: "Editing the server",
                claims: [{ kind: "path", path: "src/server" }],
                updatedAt: now,
              },
            ]
          : [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      activeThread(firstThreadId, firstTurnId, "First agent"),
      activeThread(secondThreadId, secondTurnId, "Second agent"),
    ],
    updatedAt: now,
  };
}

it.layer(NodeServices.layer)("project agent coordination decider", (it) => {
  it.effect("sets a turn-scoped claim lease", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: readModel(false),
        command: {
          type: "project.agent.claim.set",
          commandId: CommandId.make("cmd-claim-set"),
          projectId,
          threadId: firstThreadId,
          turnId: firstTurnId,
          summary: "Editing MCP handlers",
          claims: [{ kind: "path", path: "apps/server/src/mcp" }],
          claimedAt: now,
        },
      });

      const event = Array.isArray(result) ? result.at(-1)! : result;
      expect(event.type).toBe("project.agent-claim-set");
      expect(event.payload).toMatchObject({
        projectId,
        threadId: firstThreadId,
        turnId: firstTurnId,
        summary: "Editing MCP handlers",
      });
    }),
  );

  it.effect("uses the running turn while provider session adoption is still starting", () =>
    Effect.gen(function* () {
      const model = readModel(false);
      const firstThread = model.threads.find((thread) => thread.id === firstThreadId)!;
      const result = yield* decideOrchestrationCommand({
        readModel: {
          ...model,
          threads: model.threads.map((thread) =>
            thread.id === firstThreadId
              ? {
                  ...firstThread,
                  session: {
                    ...firstThread.session!,
                    status: "starting" as const,
                    activeTurnId: null,
                  },
                }
              : thread,
          ),
        },
        command: {
          type: "project.agent.claim.set",
          commandId: CommandId.make("cmd-claim-during-adoption"),
          projectId,
          threadId: firstThreadId,
          turnId: firstTurnId,
          summary: "Claiming before the runtime session adopts the turn",
          claims: [{ kind: "topic", topic: "coordination" }],
          claimedAt: now,
        },
      });

      const event = Array.isArray(result) ? result.at(-1)! : result;
      expect(event.type).toBe("project.agent-claim-set");
    }),
  );

  it.effect("reports an atomic business conflict without replacing the old lease", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel: readModel(true),
          command: {
            type: "project.agent.claim.set",
            commandId: CommandId.make("cmd-claim-conflict"),
            projectId,
            threadId: secondThreadId,
            turnId: secondTurnId,
            summary: "Editing an overlapping handler",
            claims: [{ kind: "path", path: "src/server/mcp" }],
            claimedAt: now,
          },
        }),
      );

      expect(error.code).toBe("project_agent_claim_conflict");
      expect(error.context).toMatchObject({
        conflicts: [
          {
            threadId: firstThreadId,
            requested: { kind: "path", path: "src/server/mcp" },
            existing: { kind: "path", path: "src/server" },
          },
        ],
      });
    }),
  );

  it.effect("emits sender and recipient activities with one canonical message event", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        readModel: readModel(false),
        command: {
          type: "project.agent.message.send",
          commandId: CommandId.make("cmd-message-send"),
          projectId,
          messageId: ProjectAgentMessageId.make("message-coordination"),
          senderThreadId: firstThreadId,
          recipientThreadIds: [secondThreadId],
          kind: "request",
          body: "Please avoid the MCP transport while I update it.",
          sentAt: now,
        },
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events.map(({ type }) => type)).toEqual([
        "thread.activity-appended",
        "thread.activity-appended",
        "project.agent-message-sent",
      ]);
      expect(events[1]?.payload).toMatchObject({
        threadId: secondThreadId,
        activity: { kind: "coordination.message.received" },
      });
    }),
  );

  it.effect("persists a direct message and wakes an inactive recipient thread", () =>
    Effect.gen(function* () {
      const model = readModel(false);
      const inactiveRecipient = activeThread(secondThreadId, secondTurnId, "Second agent");
      const result = yield* decideOrchestrationCommand({
        readModel: {
          ...model,
          threads: model.threads.map((thread) =>
            thread.id === secondThreadId
              ? {
                  ...inactiveRecipient,
                  latestTurn: {
                    ...inactiveRecipient.latestTurn,
                    state: "completed" as const,
                    completedAt: now,
                  },
                  session: {
                    ...inactiveRecipient.session,
                    status: "ready" as const,
                    activeTurnId: null,
                  },
                  settledOverride: "settled" as const,
                  settledAt: now,
                  snoozedUntil: "2026-08-10T18:00:00.000Z",
                  snoozedAt: now,
                }
              : thread,
          ),
        },
        command: {
          type: "project.agent.message.send",
          commandId: CommandId.make("cmd-message-wake"),
          projectId,
          messageId: ProjectAgentMessageId.make("message-wake"),
          senderThreadId: firstThreadId,
          recipientThreadIds: [secondThreadId],
          kind: "request",
          body: "Please review the rejected edge and report back.",
          sentAt: now,
        },
      });

      const events = Array.isArray(result) ? result : [result];
      expect(events.map(({ type }) => type)).toEqual([
        "thread.activity-appended",
        "thread.activity-appended",
        "project.agent-message-sent",
        "thread.unsettled",
        "thread.unsnoozed",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);

      const wakeMessage = events[5];
      expect(wakeMessage?.type).toBe("thread.message-sent");
      if (wakeMessage?.type !== "thread.message-sent") return;
      expect(wakeMessage.payload).toMatchObject({
        threadId: secondThreadId,
        role: "user",
        turnId: null,
        text: expect.stringContaining("Please review the rejected edge and report back."),
      });

      const wakeTurn = events[6];
      expect(wakeTurn?.type).toBe("thread.turn-start-requested");
      if (wakeTurn?.type !== "thread.turn-start-requested") return;
      expect(wakeTurn.causationEventId).toBe(wakeMessage.eventId);
      expect(wakeTurn.payload).toMatchObject({
        threadId: secondThreadId,
        messageId: wakeMessage.payload.messageId,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      });
    }),
  );

  it.effect("releases the current lease when its session becomes terminal", () =>
    Effect.gen(function* () {
      const second = activeThread(secondThreadId, secondTurnId, "Second agent");
      const result = yield* decideOrchestrationCommand({
        readModel: readModel(true),
        command: {
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-ready"),
          threadId: firstThreadId,
          session: {
            ...second.session,
            threadId: firstThreadId,
            status: "ready",
            activeTurnId: null,
          },
          createdAt: now,
        },
      });

      const events = Array.isArray(result) ? result : [result];
      expect(events.map(({ type }) => type)).toContain("project.agent-claim-released");
      expect(
        events.find(({ type }) => type === "project.agent-claim-released")?.payload,
      ).toMatchObject({ threadId: firstThreadId, expectedTurnId: firstTurnId });
    }),
  );
});
