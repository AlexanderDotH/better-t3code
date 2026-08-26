import {
  CommandId,
  EventId,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type OrchestrationCommand,
  type ProjectId,
  type ThreadForkState,
  type ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type * as GitWorkflowService from "../git/GitWorkflowService.ts";
import type * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";

const isDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const forkWorkspacePreparationLock = Semaphore.makeUnsafe(1);

type DispatchCommand<DispatchError> = (
  command: OrchestrationCommand,
) => Effect.Effect<{ readonly sequence: number }, DispatchError>;

type BootstrapGitWorkflow = Pick<
  GitWorkflowService.GitWorkflowService["Service"],
  "remoteExists" | "fetchRemote" | "resolveRemoteTrackingCommit" | "createWorktree"
> &
  Partial<Pick<GitWorkflowService.GitWorkflowService["Service"], "removeWorktree">>;

type BootstrapSetupScriptRunner = Pick<
  ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"],
  "runForThread"
>;

export interface OrchestrationCommandDispatcherDependencies<
  DispatchError,
  UuidError,
  ResolverError = never,
> {
  readonly dispatch: DispatchCommand<DispatchError>;
  readonly randomUuid: Effect.Effect<string, UuidError>;
  readonly nowIso: Effect.Effect<string>;
  readonly gitWorkflow: BootstrapGitWorkflow;
  readonly projectSetupScriptRunner: BootstrapSetupScriptRunner;
  readonly refreshGitStatus: (cwd: string) => Effect.Effect<void, never>;
  readonly resolveThread?: (
    threadId: ThreadId,
  ) => Effect.Effect<DeferredForkThread | undefined, ResolverError>;
  readonly resolveProject?: (
    projectId: ProjectId,
  ) => Effect.Effect<DeferredForkProject | undefined, ResolverError>;
}

interface DeferredForkThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly fork?: ThreadForkState | undefined;
}

interface DeferredForkProject {
  readonly workspaceRoot: string;
}

export interface TurnWorkspacePreparationInput {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly messageText?: string;
  readonly attachmentCount?: number;
}

function setupFailureDescription(
  error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError,
): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return Predicate.isObject(error.cause) && Predicate.isString(error.cause.message)
        ? error.cause.message
        : String(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
  }
}

function toDispatchCommandError(cause: unknown, fallbackMessage: string) {
  return isDispatchCommandError(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message: cause instanceof Error ? cause.message : fallbackMessage,
        cause,
      });
}

function toBootstrapDispatchCommandCauseError(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause);
  return isDispatchCommandError(error)
    ? error
    : new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
        cause,
      });
}

export function makeOrchestrationCommandDispatcher<DispatchError, UuidError, ResolverError = never>(
  dependencies: OrchestrationCommandDispatcherDependencies<DispatchError, UuidError, ResolverError>,
) {
  const serverCommandId = (tag: string) =>
    dependencies.randomUuid.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = dependencies.randomUuid.pipe(Effect.map(EventId.make));

  const appendSetupScriptActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: Record<string, unknown>;
    readonly tone: "info" | "error";
  }) =>
    Effect.all({
      commandId: serverCommandId("setup-script-activity"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        dependencies.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const dispatchForkWorkspaceUpdate = (input: {
    readonly command: TurnWorkspacePreparationInput;
    readonly status: "ready" | "error";
    readonly preparedAt: string | null;
    readonly lastError: string | null;
    readonly createdAt: string;
  }) =>
    dependencies.dispatch({
      type: "thread.fork.workspace.update",
      commandId: CommandId.make(`server:fork-workspace-${input.status}:${input.command.commandId}`),
      threadId: input.command.threadId,
      status: input.status,
      preparedAt: input.preparedAt,
      lastError: input.lastError,
      createdAt: input.createdAt,
    });

  const preparePendingForkWorkspace = (
    command: TurnWorkspacePreparationInput,
  ): Effect.Effect<void, OrchestrationDispatchCommandError> => {
    if (!dependencies.resolveThread || !dependencies.resolveProject) {
      return Effect.void;
    }

    const validateBudget = Effect.gen(function* () {
      const thread = yield* dependencies.resolveThread!(command.threadId);
      const handoff = thread?.fork?.handoff;
      if (!handoff || handoff.status !== "pending") {
        return;
      }
      if (
        command.messageText !== undefined &&
        command.messageText.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
      ) {
        return yield* new OrchestrationDispatchCommandError({
          message: `The first fork prompt is ${command.messageText.length} characters, exceeding the provider input limit of ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS}.`,
        });
      }
      if (
        command.attachmentCount !== undefined &&
        command.attachmentCount > PROVIDER_SEND_TURN_MAX_ATTACHMENTS
      ) {
        return yield* new OrchestrationDispatchCommandError({
          message: `The first fork prompt has ${command.attachmentCount} attachments, exceeding the provider attachment limit of ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}.`,
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        toDispatchCommandError(cause, "Failed to validate the first fork prompt budget."),
      ),
    );

    const prepare = Effect.gen(function* () {
      const thread = yield* dependencies.resolveThread!(command.threadId);
      const workspace = thread?.fork?.workspace;
      if (!thread || !workspace || workspace.status === "ready") {
        return;
      }

      if (workspace.spec.mode === "local") {
        const preparedAt = yield* dependencies.nowIso;
        yield* dispatchForkWorkspaceUpdate({
          command,
          status: "ready",
          preparedAt,
          lastError: null,
          createdAt: preparedAt,
        });
        return;
      }

      const baseBranch = workspace.spec.baseBranch;
      if (baseBranch === null) {
        return yield* Effect.die(
          new Error("A base branch is required to prepare a forked worktree."),
        );
      }
      const project = yield* dependencies.resolveProject!(thread.projectId);
      if (!project) {
        return yield* Effect.die(
          new Error(`Project '${thread.projectId}' was not found for fork workspace preparation.`),
        );
      }

      let worktreePath = thread.worktreePath;
      if (!worktreePath) {
        let worktreeBaseRef = baseBranch;
        const startFromOrigin =
          workspace.spec.startFromOrigin &&
          (yield* dependencies.gitWorkflow.remoteExists({
            cwd: project.workspaceRoot,
            remoteName: "origin",
          }));
        if (startFromOrigin) {
          yield* dependencies.gitWorkflow.fetchRemote({
            cwd: project.workspaceRoot,
            remoteName: "origin",
          });
          const resolvedRemoteBase = yield* dependencies.gitWorkflow.resolveRemoteTrackingCommit({
            cwd: project.workspaceRoot,
            refName: baseBranch,
            fallbackRemoteName: "origin",
          });
          worktreeBaseRef = resolvedRemoteBase.commitSha;
        }
        const uuid = yield* dependencies.randomUuid;
        const branch = buildTemporaryWorktreeBranchName(() => uuid);
        const worktree = yield* dependencies.gitWorkflow.createWorktree({
          cwd: project.workspaceRoot,
          refName: worktreeBaseRef,
          newRefName: branch,
          baseRefName: baseBranch,
          path: null,
        });
        worktreePath = worktree.worktree.path;
        yield* dependencies
          .dispatch({
            type: "thread.meta.update",
            commandId: CommandId.make(`server:fork-workspace-meta:${command.commandId}`),
            threadId: command.threadId,
            branch: worktree.worktree.refName,
            worktreePath,
          })
          .pipe(
            Effect.catchCause((cause) =>
              dependencies.gitWorkflow.removeWorktree === undefined
                ? Effect.failCause(cause)
                : dependencies.gitWorkflow
                    .removeWorktree({
                      cwd: project.workspaceRoot,
                      path: worktree.worktree.path,
                      force: true,
                    })
                    .pipe(
                      Effect.ignoreCause({ log: true }),
                      Effect.andThen(Effect.failCause(cause)),
                    ),
            ),
          );
        yield* dependencies.refreshGitStatus(worktreePath);
      }

      if (workspace.spec.runSetupScript) {
        const requestedAt = yield* dependencies.nowIso;
        const setupResult = yield* dependencies.projectSetupScriptRunner
          .runForThread({
            threadId: command.threadId,
            projectId: thread.projectId,
            projectCwd: project.workspaceRoot,
            worktreePath,
          })
          .pipe(
            Effect.catch((error) =>
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.failed",
                summary: "Setup script failed to start",
                createdAt: requestedAt,
                payload: {
                  detail: setupFailureDescription(error),
                  worktreePath,
                },
                tone: "error",
              }).pipe(Effect.ignoreCause({ log: false }), Effect.andThen(Effect.fail(error))),
            ),
          );
        if (setupResult.status === "started") {
          const payload = {
            scriptId: setupResult.scriptId,
            scriptName: setupResult.scriptName,
            terminalId: setupResult.terminalId,
            worktreePath,
          };
          yield* Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: yield* dependencies.nowIso,
              payload,
              tone: "info",
            }),
          ]);
        }
      }

      const preparedAt = yield* dependencies.nowIso;
      yield* dispatchForkWorkspaceUpdate({
        command,
        status: "ready",
        preparedAt,
        lastError: null,
        createdAt: preparedAt,
      });
    });

    const prepareWorkspace = prepare.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        const dispatchError = toBootstrapDispatchCommandCauseError(cause);
        const lastError = dispatchError.message.trim() || "Fork workspace preparation failed.";
        return dependencies.nowIso.pipe(
          Effect.flatMap((createdAt) =>
            dispatchForkWorkspaceUpdate({
              command,
              status: "error",
              preparedAt: null,
              lastError,
              createdAt,
            }),
          ),
          Effect.catchCause((updateCause) =>
            Effect.logWarning("failed to record fork workspace preparation error", {
              threadId: command.threadId,
              detail: Cause.pretty(updateCause),
            }),
          ),
          Effect.andThen(Effect.fail(dispatchError)),
        );
      }),
    );
    return forkWorkspacePreparationLock.withPermits(1)(
      validateBudget.pipe(Effect.andThen(prepareWorkspace)),
    );
  };

  const dispatchBootstrapTurnStart = Effect.fn("dispatchBootstrapTurnStart")(function* (
    command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
  ) {
    const bootstrap = command.bootstrap;
    const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
    let createdThread = false;
    let targetProjectId = bootstrap?.createThread?.projectId;
    let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
    let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

    const cleanupCreatedThread = () =>
      createdThread
        ? serverCommandId("bootstrap-thread-delete").pipe(
            Effect.flatMap((commandId) =>
              dependencies.dispatch({
                type: "thread.delete",
                commandId,
                threadId: command.threadId,
              }),
            ),
            Effect.as(true),
          )
        : Effect.succeed(false);

    const recordSetupScriptLaunchFailure = (input: {
      readonly error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError;
      readonly requestedAt: string;
      readonly worktreePath: string;
    }) => {
      const detail = setupFailureDescription(input.error);
      return appendSetupScriptActivity({
        threadId: command.threadId,
        kind: "setup-script.failed",
        summary: "Setup script failed to start",
        createdAt: input.requestedAt,
        payload: { detail, worktreePath: input.worktreePath },
        tone: "error",
      }).pipe(
        Effect.ignoreCause({ log: false }),
        Effect.flatMap(() =>
          Effect.logWarning("bootstrap turn start failed to launch setup script", {
            threadId: command.threadId,
            worktreePath: input.worktreePath,
            detail,
          }),
        ),
      );
    };

    const recordSetupScriptStarted = (input: {
      readonly requestedAt: string;
      readonly worktreePath: string;
      readonly scriptId: string;
      readonly scriptName: string;
      readonly terminalId: string;
    }) =>
      Effect.gen(function* () {
        const startedAt = yield* dependencies.nowIso;
        const payload = {
          scriptId: input.scriptId,
          scriptName: input.scriptName,
          terminalId: input.terminalId,
          worktreePath: input.worktreePath,
        };
        yield* Effect.all([
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.requested",
            summary: "Starting setup script",
            createdAt: input.requestedAt,
            payload,
            tone: "info",
          }),
          appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.started",
            summary: "Setup script started",
            createdAt: startedAt,
            payload,
            tone: "info",
          }),
        ]).pipe(
          Effect.asVoid,
          Effect.catch((error) =>
            Effect.logWarning(
              "bootstrap turn start launched setup script but failed to record setup activity",
              {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                scriptId: input.scriptId,
                terminalId: input.terminalId,
                detail: error instanceof Error ? error.message : String(error),
              },
            ),
          ),
        );
      });

    const runSetupProgram = () =>
      Effect.gen(function* () {
        if (!bootstrap?.runSetupScript || !targetWorktreePath) {
          return;
        }
        const worktreePath = targetWorktreePath;
        const requestedAt = yield* dependencies.nowIso;
        yield* dependencies.projectSetupScriptRunner
          .runForThread({
            threadId: command.threadId,
            ...(targetProjectId ? { projectId: targetProjectId } : {}),
            ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
            worktreePath,
          })
          .pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                recordSetupScriptLaunchFailure({ error, requestedAt, worktreePath }),
              onSuccess: (setupResult) =>
                setupResult.status === "started"
                  ? recordSetupScriptStarted({
                      requestedAt,
                      worktreePath,
                      scriptId: setupResult.scriptId,
                      scriptName: setupResult.scriptName,
                      terminalId: setupResult.terminalId,
                    })
                  : Effect.void,
            }),
          );
      });

    const bootstrapProgram = Effect.gen(function* () {
      if (bootstrap?.createThread) {
        yield* dependencies.dispatch({
          type: "thread.create",
          commandId: yield* serverCommandId("bootstrap-thread-create"),
          threadId: command.threadId,
          projectId: bootstrap.createThread.projectId,
          title: bootstrap.createThread.title,
          modelSelection: bootstrap.createThread.modelSelection,
          runtimeMode: bootstrap.createThread.runtimeMode,
          interactionMode: bootstrap.createThread.interactionMode,
          branch: bootstrap.createThread.branch,
          worktreePath: bootstrap.createThread.worktreePath,
          createdAt: bootstrap.createThread.createdAt,
        });
        createdThread = true;
      }

      if (bootstrap?.prepareWorktree) {
        let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
        const startFromOrigin =
          bootstrap.prepareWorktree.startFromOrigin === true &&
          (yield* dependencies.gitWorkflow.remoteExists({
            cwd: bootstrap.prepareWorktree.projectCwd,
            remoteName: "origin",
          }));
        if (startFromOrigin) {
          yield* dependencies.gitWorkflow.fetchRemote({
            cwd: bootstrap.prepareWorktree.projectCwd,
            remoteName: "origin",
          });
          const resolvedRemoteBase = yield* dependencies.gitWorkflow.resolveRemoteTrackingCommit({
            cwd: bootstrap.prepareWorktree.projectCwd,
            refName: bootstrap.prepareWorktree.baseBranch,
            fallbackRemoteName: "origin",
          });
          worktreeBaseRef = resolvedRemoteBase.commitSha;
        }
        const worktree = yield* dependencies.gitWorkflow.createWorktree({
          cwd: bootstrap.prepareWorktree.projectCwd,
          refName: worktreeBaseRef,
          newRefName: bootstrap.prepareWorktree.branch,
          baseRefName: bootstrap.prepareWorktree.baseBranch,
          path: null,
        });
        targetWorktreePath = worktree.worktree.path;
        yield* dependencies.dispatch({
          type: "thread.meta.update",
          commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
          threadId: command.threadId,
          branch: worktree.worktree.refName,
          worktreePath: targetWorktreePath,
        });
        yield* dependencies.refreshGitStatus(targetWorktreePath);
      }

      yield* runSetupProgram();
      return yield* dependencies.dispatch(finalTurnStartCommand);
    });

    return yield* bootstrapProgram.pipe(
      Effect.catchCause((cause) => {
        const dispatchError = toBootstrapDispatchCommandCauseError(cause);
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.fail(dispatchError);
        }
        return Effect.uninterruptible(cleanupCreatedThread()).pipe(
          Effect.matchCauseEffect({
            onFailure: (cleanupCause) =>
              Effect.logWarning("bootstrap thread cleanup failed", {
                threadId: command.threadId,
                detail: Cause.pretty(cleanupCause),
              }).pipe(Effect.flatMap(() => Effect.fail(dispatchError))),
            onSuccess: (threadDeleted) =>
              Effect.fail(
                threadDeleted
                  ? new OrchestrationDispatchCommandError({
                      message: dispatchError.message,
                      ...(dispatchError.cause !== undefined ? { cause: dispatchError.cause } : {}),
                      bootstrapThreadDisposition: "deleted",
                    })
                  : dispatchError,
              ),
          }),
        );
      }),
    );
  });

  const dispatch = (command: OrchestrationCommand) =>
    command.type === "thread.turn.start" && command.bootstrap
      ? dispatchBootstrapTurnStart(command)
      : command.type === "thread.turn.start"
        ? preparePendingForkWorkspace({
            commandId: command.commandId,
            threadId: command.threadId,
            messageText: command.message.text,
            attachmentCount: command.message.attachments.length,
          }).pipe(
            Effect.andThen(dependencies.dispatch(command)),
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          )
        : dependencies
            .dispatch(command)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
              ),
            );

  return { dispatch, prepareTurnWorkspace: preparePendingForkWorkspace } as const;
}
