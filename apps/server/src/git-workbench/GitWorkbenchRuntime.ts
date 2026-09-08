import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { GitCommandError, ThreadId, type GitWorkbenchSnapshot } from "@t3tools/contracts";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GitWorkbenchDriver, makeRegisteredGitWorkspace } from "./GitWorkbenchDriver.ts";
import {
  GitWorkbenchOperations,
  GitWorkbenchOperationStateReader,
} from "./GitWorkbenchOperations.ts";
import type {
  GitWorkbenchObservedState,
  GitWorkbenchQueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";
import {
  GitWorkbenchQueueRuntime,
  GitWorkbenchQueueRuntimeError,
} from "./GitWorkbenchQueueService.ts";
import { GitWorkbenchUndoError, GitWorkbenchUndoStateReader } from "./GitWorkbenchUndoService.ts";

export interface GitWorkbenchMutationSchedulerShape {
  readonly withLock: <A, E, R>(
    cwd: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class GitWorkbenchMutationScheduler extends Context.Service<
  GitWorkbenchMutationScheduler,
  GitWorkbenchMutationSchedulerShape
>()("t3/git-workbench/GitWorkbenchRuntime/GitWorkbenchMutationScheduler") {}

export const GitWorkbenchMutationSchedulerLive = Layer.sync(GitWorkbenchMutationScheduler, () => {
  const locks = new Map<string, Semaphore.Semaphore>();
  const lockFor = (cwd: string) => {
    const existing = locks.get(cwd);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    locks.set(cwd, created);
    return created;
  };
  return GitWorkbenchMutationScheduler.of({
    withLock: (cwd, effect) => lockFor(cwd).withPermit(effect),
  });
});

function stableToken(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function errorDetail(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function operationToken(snapshot: GitWorkbenchSnapshot): string | null {
  return snapshot.operation.kind === "none" ? null : stableToken(snapshot.operation);
}

function selectedPathsToken(
  snapshot: GitWorkbenchSnapshot,
  workflow: GitWorkbenchQueuedWorkflow["workflow"],
): string | null {
  if (workflow.kind !== "delivery" || workflow.stage.mode !== "paths") return null;
  const paths = new Set(workflow.stage.paths);
  return stableToken({
    worktreeStateToken: snapshot.worktreeStateToken ?? snapshot.stateToken,
    files: snapshot.files
      .filter((file) => paths.has(file.path))
      .map((file) => ({
        path: file.path,
        oldPath: file.oldPath ?? null,
        indexStatus: file.indexStatus,
        worktreeStatus: file.worktreeStatus,
        stagedStats: file.stagedStats,
        unstagedStats: file.unstagedStats,
      })),
  });
}

export function observedStateFromSnapshot(
  environmentId: string,
  snapshot: GitWorkbenchSnapshot,
  workflow: GitWorkbenchQueuedWorkflow["workflow"],
): GitWorkbenchObservedState {
  const worktreeRoot = snapshot.worktreeRoot ?? snapshot.registeredCwd;
  return {
    environmentId,
    worktreeRoot,
    stateToken: snapshot.stateToken,
    headOid: snapshot.headOid,
    refName: snapshot.refName,
    indexToken:
      snapshot.indexStateToken ??
      stableToken(
        snapshot.files.map((file) => ({
          path: file.path,
          oldPath: file.oldPath ?? null,
          indexStatus: file.indexStatus,
          stagedStats: file.stagedStats,
        })),
      ),
    worktreeToken:
      snapshot.worktreeStateToken ??
      stableToken(
        snapshot.files.map((file) => ({
          path: file.path,
          oldPath: file.oldPath ?? null,
          worktreeStatus: file.worktreeStatus,
          unstagedStats: file.unstagedStats,
        })),
      ),
    operationState: operationToken(snapshot),
    remoteOid: snapshot.upstreamOid ?? null,
    selectionPatchToken: selectedPathsToken(snapshot, workflow),
    hasConflicts: snapshot.totals.conflicted > 0,
  };
}

function runtimeError(operation: string, cause: unknown): GitWorkbenchQueueRuntimeError {
  return new GitWorkbenchQueueRuntimeError({
    operation,
    detail:
      cause instanceof Error && cause.message.trim().length > 0
        ? cause.message
        : `Git workbench queue failed during ${operation}.`,
    cause,
  });
}

export const GitWorkbenchOperationStateReaderLive = Layer.effect(
  GitWorkbenchOperationStateReader,
  Effect.gen(function* () {
    const driver = yield* GitWorkbenchDriver;
    return GitWorkbenchOperationStateReader.of({
      read: (cwd) =>
        driver.getSnapshot(makeRegisteredGitWorkspace(cwd)).pipe(
          Effect.map((snapshot) => ({
            stateToken: snapshot.stateToken,
            headOid: snapshot.headOid,
            refName: snapshot.refName,
            operation: snapshot.operation,
            hasWorkingTreeChanges: snapshot.files.length > 0,
            truncated: snapshot.truncated,
          })),
          Effect.mapError(
            (cause) =>
              new GitCommandError({
                operation: "GitWorkbenchOperationStateReader.read",
                command: "git status --porcelain=v2",
                cwd,
                detail: errorDetail(cause, "Repository state could not be read."),
                cause,
              }),
          ),
        ),
    });
  }),
);

export const GitWorkbenchUndoStateReaderLive = Layer.effect(
  GitWorkbenchUndoStateReader,
  Effect.gen(function* () {
    const driver = yield* GitWorkbenchDriver;
    return GitWorkbenchUndoStateReader.of({
      readStateToken: (cwd) =>
        driver.getSnapshot(makeRegisteredGitWorkspace(cwd)).pipe(
          Effect.flatMap((snapshot) =>
            snapshot.truncated
              ? Effect.fail(
                  new GitWorkbenchUndoError({
                    operation: "restore",
                    cwd,
                    detail:
                      "Repository status is truncated; undo restore cannot safely validate newer changes.",
                  }),
                )
              : Effect.succeed(snapshot.stateToken),
          ),
          Effect.mapError(
            (cause) =>
              new GitWorkbenchUndoError({
                operation: "restore",
                cwd,
                detail: "Repository state could not be read before restore.",
                cause,
              }),
          ),
        ),
    });
  }),
);

export const GitWorkbenchQueueRuntimeLive = Layer.effect(
  GitWorkbenchQueueRuntime,
  Effect.gen(function* () {
    const driver = yield* GitWorkbenchDriver;
    const operations = yield* GitWorkbenchOperations;
    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
    const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const scheduler = yield* GitWorkbenchMutationScheduler;

    const inspect: GitWorkbenchQueueRuntime["Service"]["inspect"] = (workflow) =>
      Effect.gen(function* () {
        const environmentId = yield* serverEnvironment.getEnvironmentId;
        const snapshot = yield* driver.getSnapshot(
          makeRegisteredGitWorkspace(workflow.scope.worktreeRoot),
        );
        return observedStateFromSnapshot(environmentId, snapshot, workflow.workflow);
      }).pipe(Effect.mapError((cause) => runtimeError("inspect", cause)));

    const execute: GitWorkbenchQueueRuntime["Service"]["execute"] = (workflow) => {
      if (workflow.workflow.kind === "advanced_operation") {
        return scheduler.withLock(
          workflow.scope.worktreeRoot,
          operations
            .run({
              cwd: workflow.scope.worktreeRoot,
              expectedStateToken: workflow.preconditions.stateToken,
              action: workflow.workflow.action,
            })
            .pipe(
              Effect.asVoid,
              Effect.mapError((cause) => runtimeError("execute", cause)),
            ),
        );
      }
      return scheduler.withLock(
        workflow.scope.worktreeRoot,
        gitWorkflow
          .runStackedAction({
            actionId: workflow.id,
            cwd: workflow.scope.worktreeRoot,
            action: workflow.workflow.createPullRequest
              ? "commit_push_pr"
              : workflow.workflow.push
                ? "commit_push"
                : "commit",
            ...(workflow.workflow.commitMessage === undefined
              ? {}
              : { commitMessage: workflow.workflow.commitMessage }),
            commitSelection: workflow.workflow.stage,
          })
          .pipe(
            Effect.asVoid,
            Effect.mapError((cause) => runtimeError("execute", cause)),
          ),
      );
    };

    const isTurnQuiesced: GitWorkbenchQueueRuntime["Service"]["isTurnQuiesced"] = (
      threadId,
      turnId,
    ) =>
      projection.getThreadDetailById(ThreadId.make(threadId)).pipe(
        Effect.map(
          Option.match({
            onNone: () => false,
            onSome: (thread) =>
              thread.latestTurn?.turnId === turnId &&
              thread.latestTurn.state !== "running" &&
              thread.checkpoints.some((checkpoint) => checkpoint.turnId === turnId),
          }),
        ),
        Effect.mapError((cause) => runtimeError("is-turn-quiesced", cause)),
      );

    return GitWorkbenchQueueRuntime.of({ inspect, execute, isTurnQuiesced });
  }),
);
