import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, vi } from "vite-plus/test";

import { makeOrchestrationCommandDispatcher } from "./orchestrationCommandDispatcher.ts";

const bootstrapTurn = (): Extract<OrchestrationCommand, { type: "thread.turn.start" }> => ({
  type: "thread.turn.start",
  commandId: CommandId.make("cmd-bootstrap-turn"),
  threadId: ThreadId.make("thread-bootstrap"),
  message: {
    messageId: MessageId.make("message-bootstrap"),
    role: "user",
    text: "continue here",
    attachments: [],
  },
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: "2026-08-24T00:00:00.000Z",
  bootstrap: {
    createThread: {
      projectId: ProjectId.make("project-bootstrap"),
      title: "New thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "t3code/bootstrap",
      worktreePath: null,
      createdAt: "2026-08-24T00:00:00.000Z",
    },
    prepareWorktree: {
      projectCwd: "/repo",
      baseBranch: "main",
      branch: "t3code/bootstrap",
      startFromOrigin: true,
    },
    runSetupScript: false,
  },
});

describe("makeOrchestrationCommandDispatcher", () => {
  effectIt.effect("prepares a bootstrapped worktree before dispatching a bootstrap-free turn", () =>
    Effect.gen(function* () {
      const commands: OrchestrationCommand[] = [];
      const gitOperations: string[] = [];
      const dispatch = vi.fn((command: OrchestrationCommand) => {
        commands.push(command);
        return Effect.succeed({ sequence: commands.length });
      });
      const dispatcher = makeOrchestrationCommandDispatcher({
        dispatch,
        randomUuid: Effect.succeed("00000000-0000-4000-8000-000000000001"),
        nowIso: Effect.succeed("2026-08-24T00:00:01.000Z"),
        gitWorkflow: {
          remoteExists: () => Effect.sync(() => (gitOperations.push("remoteExists"), true)),
          fetchRemote: () => Effect.sync(() => void gitOperations.push("fetchRemote")),
          resolveRemoteTrackingCommit: () =>
            Effect.sync(() => {
              gitOperations.push("resolveRemoteTrackingCommit");
              return { commitSha: "origin-main-sha", remoteRefName: "origin/main" };
            }),
          createWorktree: () =>
            Effect.sync(() => {
              gitOperations.push("createWorktree");
              return {
                worktree: {
                  refName: "t3code/bootstrap",
                  path: "/repo-worktree",
                },
              } as never;
            }),
        },
        projectSetupScriptRunner: {
          runForThread: () => Effect.succeed({ status: "no-script" }),
        },
        refreshGitStatus: () => Effect.void,
      });

      const result = yield* dispatcher.dispatch(bootstrapTurn());

      expect(result.sequence).toBe(3);
      expect(gitOperations).toEqual([
        "remoteExists",
        "fetchRemote",
        "resolveRemoteTrackingCommit",
        "createWorktree",
      ]);
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.meta.update",
        "thread.turn.start",
      ]);
      const finalCommand = commands.at(-1);
      expect(finalCommand?.type).toBe("thread.turn.start");
      if (finalCommand?.type === "thread.turn.start") {
        expect(finalCommand.bootstrap).toBeUndefined();
      }
    }),
  );

  effectIt.effect(
    "preserves an existing thread and does not append its user turn when workspace setup fails",
    () =>
      Effect.gen(function* () {
        const commands: OrchestrationCommand[] = [];
        const command = bootstrapTurn();
        const existingThreadCommand = {
          ...command,
          bootstrap: {
            ...command.bootstrap,
            createThread: undefined,
          },
        };
        const dispatcher = makeOrchestrationCommandDispatcher({
          dispatch: (dispatched) =>
            Effect.sync(() => {
              commands.push(dispatched);
              return { sequence: commands.length };
            }),
          randomUuid: Effect.succeed("00000000-0000-4000-8000-000000000002"),
          nowIso: Effect.succeed("2026-08-24T00:00:01.000Z"),
          gitWorkflow: {
            remoteExists: () => Effect.succeed(false),
            fetchRemote: () => Effect.void,
            resolveRemoteTrackingCommit: () =>
              Effect.succeed({ commitSha: "origin-main-sha", remoteRefName: "origin/main" }),
            createWorktree: () => Effect.die(new Error("worktree creation failed")),
          },
          projectSetupScriptRunner: {
            runForThread: () => Effect.succeed({ status: "no-script" }),
          },
          refreshGitStatus: () => Effect.void,
        });

        const failure = yield* Effect.flip(dispatcher.dispatch(existingThreadCommand));

        expect(failure.message).toBe("worktree creation failed");
        expect(failure.bootstrapThreadDisposition).toBeUndefined();
        expect(commands).toEqual([]);
      }),
  );

  effectIt.effect(
    "prepares a pending fork worktree before its first user message is appended",
    () =>
      Effect.gen(function* () {
        const commands: OrchestrationCommand[] = [];
        const commandWithBootstrap = bootstrapTurn();
        const { bootstrap: _bootstrap, ...turnCommand } = commandWithBootstrap;
        const dispatcher = makeOrchestrationCommandDispatcher({
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
          randomUuid: Effect.succeed("12345678-0000-4000-8000-000000000003"),
          nowIso: Effect.succeed("2026-08-24T00:00:02.000Z"),
          resolveThread: () =>
            Effect.succeed({
              id: turnCommand.threadId,
              projectId: ProjectId.make("project-bootstrap"),
              branch: null,
              worktreePath: null,
              activities: [],
              fork: {
                provenance: {
                  sourceThreadId: ThreadId.make("source-thread"),
                  sourceTitle: "Source",
                  boundary: { kind: "message", messageId: MessageId.make("source-message") },
                  forkedAt: "2026-08-24T00:00:00.000Z",
                },
                workspace: {
                  spec: {
                    mode: "worktree",
                    baseBranch: "main",
                    startFromOrigin: false,
                    runSetupScript: false,
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
            }),
          resolveProject: () => Effect.succeed({ workspaceRoot: "/repo" }),
          gitWorkflow: {
            remoteExists: () => Effect.succeed(false),
            fetchRemote: () => Effect.void,
            resolveRemoteTrackingCommit: () =>
              Effect.succeed({ commitSha: "origin-main-sha", remoteRefName: "origin/main" }),
            createWorktree: () =>
              Effect.succeed({
                worktree: {
                  refName: "t3code/12345678",
                  path: "/repo-fork-worktree",
                },
              } as never),
          },
          projectSetupScriptRunner: {
            runForThread: () => Effect.succeed({ status: "no-script" }),
          },
          refreshGitStatus: () => Effect.void,
        });

        const budgetFailure = yield* Effect.flip(
          dispatcher.prepareTurnWorkspace({
            commandId: turnCommand.commandId,
            threadId: turnCommand.threadId,
            messageText: "u".repeat(120_001),
            attachmentCount: 0,
          }),
        );
        expect(budgetFailure.message).toContain("provider input limit of 120000");
        expect(commands).toEqual([]);

        yield* dispatcher.dispatch(turnCommand);

        expect(commands.map((command) => command.type)).toEqual([
          "thread.meta.update",
          "thread.fork.workspace.update",
          "thread.turn.start",
        ]);
        expect(commands[0]).toMatchObject({
          type: "thread.meta.update",
          branch: "t3code/12345678",
          worktreePath: "/repo-fork-worktree",
        });
        expect(commands[1]).toMatchObject({
          type: "thread.fork.workspace.update",
          status: "ready",
          preparedAt: "2026-08-24T00:00:02.000Z",
          lastError: null,
        });
      }),
  );

  effectIt.effect(
    "records an invalid pending worktree as an error without appending the user turn",
    () =>
      Effect.gen(function* () {
        const commands: OrchestrationCommand[] = [];
        const commandWithBootstrap = bootstrapTurn();
        const { bootstrap: _bootstrap, ...turnCommand } = commandWithBootstrap;
        const createWorktree = vi.fn(() => Effect.die(new Error("must not create")));
        const dispatcher = makeOrchestrationCommandDispatcher({
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
          randomUuid: Effect.succeed("12345678-0000-4000-8000-000000000004"),
          nowIso: Effect.succeed("2026-08-24T00:00:03.000Z"),
          resolveThread: () =>
            Effect.succeed({
              id: turnCommand.threadId,
              projectId: ProjectId.make("project-bootstrap"),
              branch: null,
              worktreePath: null,
              activities: [],
              fork: {
                provenance: {
                  sourceThreadId: ThreadId.make("source-thread"),
                  sourceTitle: "Source",
                  boundary: { kind: "message", messageId: MessageId.make("source-message") },
                  forkedAt: "2026-08-24T00:00:00.000Z",
                },
                workspace: {
                  spec: {
                    mode: "worktree",
                    baseBranch: null,
                    startFromOrigin: false,
                    runSetupScript: false,
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
            }),
          resolveProject: () => Effect.succeed({ workspaceRoot: "/repo" }),
          gitWorkflow: {
            remoteExists: () => Effect.succeed(false),
            fetchRemote: () => Effect.void,
            resolveRemoteTrackingCommit: () =>
              Effect.succeed({ commitSha: "origin-main-sha", remoteRefName: "origin/main" }),
            createWorktree,
          },
          projectSetupScriptRunner: {
            runForThread: () => Effect.succeed({ status: "no-script" }),
          },
          refreshGitStatus: () => Effect.void,
        });

        const failure = yield* Effect.flip(dispatcher.dispatch(turnCommand));

        expect(failure.message).toContain("base branch is required");
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          type: "thread.fork.workspace.update",
          status: "error",
          preparedAt: null,
          lastError: "A base branch is required to prepare a forked worktree.",
        });
        expect(createWorktree).not.toHaveBeenCalled();
      }),
  );
});
