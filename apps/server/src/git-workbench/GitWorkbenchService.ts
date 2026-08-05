import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  GitWorkbenchError as ContractGitWorkbenchError,
  GitWorkbenchRestrictionError,
  GitWorkbenchStaleStateError as ContractGitWorkbenchStaleStateError,
  type GitApplyChangeSelectionInput,
  type GitApplyChangeSelectionResult,
  type GitChangesDiffInput,
  type GitChangesDiffResult,
  type GitCommitDetailInput,
  type GitCommitDetailResult,
  type GitCommitFileDiffInput,
  type GitCommitFileDiffResult,
  type GitHistoryListInput,
  type GitHistoryListResult,
  type GitInteractiveRebasePlanInput,
  type GitInteractiveRebasePlanResult,
  type GitQueuedWorkflowCancelInput,
  type GitQueuedWorkflowCancelResult,
  type GitQueuedWorkflowUpsertInput,
  type GitQueuedWorkflowUpsertResult,
  type GitRepositoryInsightsInput,
  type GitRepositoryInsightsResult,
  type GitUndoSnapshot,
  type GitUndoSnapshotCreateInput,
  type GitUndoSnapshotCreateResult,
  type GitUndoSnapshotRestoreInput,
  type GitUndoSnapshotRestoreResult,
  type GitUndoSnapshotsListResult,
  type GitWorkbenchInput,
  type GitWorkbenchOperationResult,
  type GitWorkbenchRunOperationInput,
  type GitWorkbenchServiceError,
  type GitWorkbenchSnapshot,
  type GitWorkbenchStreamEvent,
} from "@t3tools/contracts";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import {
  GitWorkbenchDriver,
  makeRegisteredGitWorkspace,
  type RegisteredGitWorkspace,
} from "./GitWorkbenchDriver.ts";
import { GitRepositoryQueryService } from "./GitRepositoryQueryService.ts";
import { GitWorkbenchOperations } from "./GitWorkbenchOperations.ts";
import {
  toContractCancelledWorkflow,
  toContractQueueEvent,
  toContractQueuedWorkflow,
} from "./GitWorkbenchQueueContracts.ts";
import { GitWorkbenchQueue } from "./GitWorkbenchQueueService.ts";
import { GitWorkbenchMutationScheduler, observedStateFromSnapshot } from "./GitWorkbenchRuntime.ts";
import {
  GitWorkbenchUndoService,
  type GitWorkbenchUndoSnapshot,
} from "./GitWorkbenchUndoService.ts";

interface GitWorkbenchRepositoryEvent {
  readonly cwd: string;
  readonly snapshot: GitWorkbenchSnapshot;
}

interface GitWorkbenchUndoEvent {
  readonly cwd: string;
  readonly snapshots: readonly GitUndoSnapshot[];
}

function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0)
    return error.message.slice(0, 4096);
  if (
    typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string" &&
    error.detail.trim().length > 0
  ) {
    return error.detail.slice(0, 4096);
  }
  return fallback;
}

function tagged(error: unknown, tag: string): boolean {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;
}

export function toGitWorkbenchServiceError(
  cwd: string,
  operation: string,
  error: unknown,
): GitWorkbenchServiceError {
  if (tagged(error, "GitWorkbenchStaleStateError")) {
    const stale = error as {
      readonly expectedStateToken: string;
      readonly actualStateToken: string;
      readonly reason: "repository_changed" | "patch_changed";
    };
    return new ContractGitWorkbenchStaleStateError({
      cwd,
      operation,
      expectedStateToken: stale.expectedStateToken,
      actualStateToken: stale.actualStateToken,
      reason: stale.reason,
    });
  }
  if (tagged(error, "GitWorkbenchOperationConflict")) {
    const conflict = error as {
      readonly reason: "active_operation" | "stale_state";
      readonly expectedStateToken: string;
      readonly actualStateToken: string;
      readonly activeOperation: string;
    };
    return conflict.reason === "stale_state"
      ? new ContractGitWorkbenchStaleStateError({
          cwd,
          operation,
          expectedStateToken: conflict.expectedStateToken,
          actualStateToken: conflict.actualStateToken,
          reason: "repository_changed",
        })
      : new GitWorkbenchRestrictionError({
          cwd,
          operation,
          reason: "operation_in_progress",
          detail: `A ${conflict.activeOperation} operation is already in progress.`,
        });
  }
  if (tagged(error, "GitChangeSelectionRestrictedError")) {
    const restriction = error as {
      readonly path: string;
      readonly restriction:
        | "unsupported_selection"
        | "binary_selection"
        | "conflicted_selection"
        | "destructive_confirmation_required";
      readonly reason: string;
    };
    return new GitWorkbenchRestrictionError({
      cwd,
      operation,
      reason: restriction.restriction,
      path: restriction.path,
      detail: restriction.reason,
    });
  }
  if (tagged(error, "GitWorkbenchNotRepositoryError")) {
    return new GitWorkbenchRestrictionError({ cwd, operation, reason: "not_a_repository" });
  }
  if (tagged(error, "GitWorkbenchInvalidPathError")) {
    return new ContractGitWorkbenchError({
      cwd,
      operation,
      reason: "invalid_path",
      detail: errorDetail(error, "The selected path is not valid for this repository."),
    });
  }
  if (tagged(error, "GitWorkbenchQueueAlreadyExistsError")) {
    return new GitWorkbenchRestrictionError({
      cwd,
      operation,
      reason: "operation_in_progress",
      detail: "A queued workflow already exists for this worktree.",
    });
  }
  if (tagged(error, "GitWorkbenchQueueInvalidTransitionError")) {
    return new GitWorkbenchRestrictionError({
      cwd,
      operation,
      reason: "operation_in_progress",
      detail: errorDetail(error, "The queued workflow is currently busy."),
    });
  }
  if (tagged(error, "GitWorkbenchOperationInputError")) {
    return new ContractGitWorkbenchError({
      cwd,
      operation,
      reason: "invalid_object",
      detail: errorDetail(error, "The Git operation input is invalid."),
    });
  }
  if (tagged(error, "GitWorkbenchRebasePlanError")) {
    return new ContractGitWorkbenchError({
      cwd,
      operation,
      reason: "invalid_rebase_plan",
      detail: errorDetail(error, "The interactive rebase plan is invalid."),
    });
  }
  if (
    tagged(error, "GitWorkbenchQueueRepositoryError") ||
    tagged(error, "GitWorkbenchUndoStorageError") ||
    tagged(error, "GitWorkbenchQueueRevisionConflictError")
  ) {
    return new ContractGitWorkbenchError({
      cwd,
      operation,
      reason: "persistence_failed",
      detail: errorDetail(error, "Git workbench state could not be persisted."),
    });
  }
  return new ContractGitWorkbenchError({
    cwd,
    operation,
    reason: tagged(error, "GitWorkbenchUndoError") ? "persistence_failed" : "command_failed",
    detail: errorDetail(error, `Git workbench operation '${operation}' failed.`),
  });
}

function toContractUndoSnapshot(snapshot: GitWorkbenchUndoSnapshot): GitUndoSnapshot {
  return {
    id: snapshot.id,
    cwd: snapshot.cwd,
    createdAt: DateTime.formatIso(DateTime.makeUnsafe(snapshot.createdAt)),
    reason: snapshot.reason,
    headOid: snapshot.headOid,
    headRef: snapshot.headRef,
    indexTreeOid: snapshot.indexTreeOid,
    worktreeCommitOid: snapshot.worktreeCommitOid,
    expiresAt: DateTime.formatIso(DateTime.makeUnsafe(snapshot.expiresAt)),
  };
}

export class GitWorkbenchService extends Context.Service<
  GitWorkbenchService,
  {
    readonly snapshot: (
      input: GitWorkbenchInput,
    ) => Effect.Effect<GitWorkbenchSnapshot, GitWorkbenchServiceError>;
    readonly subscribe: (
      input: GitWorkbenchInput,
    ) => Stream.Stream<GitWorkbenchStreamEvent, GitWorkbenchServiceError, Scope.Scope>;
    readonly insights: (
      input: GitRepositoryInsightsInput,
    ) => Effect.Effect<GitRepositoryInsightsResult, GitWorkbenchServiceError>;
    readonly history: (
      input: GitHistoryListInput,
    ) => Effect.Effect<GitHistoryListResult, GitWorkbenchServiceError>;
    readonly commitDetail: (
      input: GitCommitDetailInput,
    ) => Effect.Effect<GitCommitDetailResult, GitWorkbenchServiceError>;
    readonly commitFileDiff: (
      input: GitCommitFileDiffInput,
    ) => Effect.Effect<GitCommitFileDiffResult, GitWorkbenchServiceError>;
    readonly changesDiff: (
      input: GitChangesDiffInput,
    ) => Effect.Effect<GitChangesDiffResult, GitWorkbenchServiceError>;
    readonly interactiveRebasePlan: (
      input: GitInteractiveRebasePlanInput,
    ) => Effect.Effect<GitInteractiveRebasePlanResult, GitWorkbenchServiceError>;
    readonly applySelection: (
      input: GitApplyChangeSelectionInput,
    ) => Effect.Effect<GitApplyChangeSelectionResult, GitWorkbenchServiceError>;
    readonly runOperation: (
      input: GitWorkbenchRunOperationInput,
    ) => Effect.Effect<GitWorkbenchOperationResult, GitWorkbenchServiceError>;
    readonly listUndo: (
      input: GitWorkbenchInput,
    ) => Effect.Effect<GitUndoSnapshotsListResult, GitWorkbenchServiceError>;
    readonly createUndo: (
      input: GitUndoSnapshotCreateInput,
    ) => Effect.Effect<GitUndoSnapshotCreateResult, GitWorkbenchServiceError>;
    readonly restoreUndo: (
      input: GitUndoSnapshotRestoreInput,
    ) => Effect.Effect<GitUndoSnapshotRestoreResult, GitWorkbenchServiceError>;
    readonly upsertQueue: (
      input: GitQueuedWorkflowUpsertInput,
    ) => Effect.Effect<GitQueuedWorkflowUpsertResult, GitWorkbenchServiceError>;
    readonly cancelQueue: (
      input: GitQueuedWorkflowCancelInput,
    ) => Effect.Effect<GitQueuedWorkflowCancelResult, GitWorkbenchServiceError>;
  }
>()("t3/git-workbench/GitWorkbenchService") {}

export const make = Effect.gen(function* () {
  const driver = yield* GitWorkbenchDriver;
  const query = yield* GitRepositoryQueryService;
  const operations = yield* GitWorkbenchOperations;
  const undo = yield* GitWorkbenchUndoService;
  const queue = yield* GitWorkbenchQueue;
  const scheduler = yield* GitWorkbenchMutationScheduler;
  const vcsStatus = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const repositoryEvents = yield* Effect.acquireRelease(
    PubSub.unbounded<GitWorkbenchRepositoryEvent>(),
    PubSub.shutdown,
  );
  const undoEvents = yield* Effect.acquireRelease(
    PubSub.unbounded<GitWorkbenchUndoEvent>(),
    PubSub.shutdown,
  );

  const resolveWorkspace = Effect.fn("GitWorkbenchService.resolveWorkspace")(function* (
    cwd: string,
    operation: string,
  ) {
    const normalized = yield* workspacePaths
      .normalizeWorkspaceRoot(cwd)
      .pipe(Effect.mapError((error) => toGitWorkbenchServiceError(cwd, operation, error)));
    const shell = yield* projection
      .getShellSnapshot()
      .pipe(Effect.mapError((error) => toGitWorkbenchServiceError(cwd, operation, error)));
    const registeredRoots = [
      ...shell.projects.map((project) => project.workspaceRoot),
      ...shell.threads.flatMap((thread) =>
        thread.worktreePath === null ? [] : [thread.worktreePath],
      ),
    ].map((root) => root.replace(/[\\/]+$/, ""));
    const normalizedComparable = normalized.replace(/[\\/]+$/, "");
    if (!registeredRoots.includes(normalizedComparable)) {
      return yield* new ContractGitWorkbenchError({
        cwd,
        operation,
        reason: "invalid_path",
        detail: "The requested Git workbench path is not registered to an active project.",
      });
    }
    return makeRegisteredGitWorkspace(normalized);
  });

  const loadSnapshot = (workspace: RegisteredGitWorkspace, operation: string) =>
    driver
      .getSnapshot(workspace)
      .pipe(
        Effect.mapError((error) => toGitWorkbenchServiceError(workspace.cwd, operation, error)),
      );

  const publishSnapshot = (cwd: string, snapshot: GitWorkbenchSnapshot) =>
    PubSub.publish(repositoryEvents, { cwd, snapshot }).pipe(Effect.asVoid);

  const loadUndo = (cwd: string, operation: string) =>
    undo.list(cwd).pipe(
      Effect.map((snapshots) => snapshots.map(toContractUndoSnapshot)),
      Effect.mapError((error) => toGitWorkbenchServiceError(cwd, operation, error)),
    );

  const publishUndo = Effect.fn("GitWorkbenchService.publishUndo")(function* (cwd: string) {
    const snapshots = yield* loadUndo(cwd, "list-undo-snapshots");
    yield* PubSub.publish(undoEvents, { cwd, snapshots });
  });

  const refreshLegacyStatus = (cwd: string) =>
    vcsStatus
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const snapshot: GitWorkbenchService["Service"]["snapshot"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "refresh-workbench");
      const next = yield* loadSnapshot(workspace, "refresh-workbench");
      yield* publishSnapshot(workspace.cwd, next);
      return next;
    });

  const subscribe: GitWorkbenchService["Service"]["subscribe"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const workspace = yield* resolveWorkspace(input.cwd, "subscribe-workbench");
        const repositorySubscription = yield* PubSub.subscribe(repositoryEvents);
        const undoSubscription = yield* PubSub.subscribe(undoEvents);
        const initialSnapshot = yield* loadSnapshot(workspace, "subscribe-workbench");
        const environmentId = yield* serverEnvironment.getEnvironmentId;
        const worktreeRoot = initialSnapshot.worktreeRoot ?? workspace.cwd;
        const queueSubscription = yield* queue
          .subscribe({ environmentId, worktreeRoot })
          .pipe(
            Effect.mapError((error) =>
              toGitWorkbenchServiceError(workspace.cwd, "subscribe-workbench", error),
            ),
          );
        const undoSnapshots = yield* loadUndo(workspace.cwd, "subscribe-workbench");
        const initial: GitWorkbenchStreamEvent = {
          _tag: "snapshot",
          snapshot: initialSnapshot,
          queuedWorkflow:
            queueSubscription.latest === null
              ? null
              : toContractQueuedWorkflow(queueSubscription.latest),
          undoSnapshots,
        };

        const directRepositoryChanges = Stream.fromSubscription(repositorySubscription).pipe(
          Stream.filter((event) => event.cwd === workspace.cwd),
          Stream.map(
            (event): GitWorkbenchStreamEvent => ({
              _tag: "repositoryUpdated",
              snapshot: event.snapshot,
            }),
          ),
        );
        const externalRepositoryChanges = vcsStatus.streamStatus({ cwd: workspace.cwd }).pipe(
          Stream.drop(1),
          Stream.mapEffect(() => loadSnapshot(workspace, "subscribe-workbench")),
          Stream.map(
            (next): GitWorkbenchStreamEvent => ({ _tag: "repositoryUpdated", snapshot: next }),
          ),
          Stream.mapError((error) =>
            toGitWorkbenchServiceError(workspace.cwd, "subscribe-workbench", error),
          ),
        );
        const queueChanges = queueSubscription.changes.pipe(Stream.map(toContractQueueEvent));
        const undoChanges = Stream.fromSubscription(undoSubscription).pipe(
          Stream.filter((event) => event.cwd === workspace.cwd),
          Stream.map(
            (event): GitWorkbenchStreamEvent => ({
              _tag: "undoUpdated",
              undoSnapshots: event.snapshots,
            }),
          ),
        );

        return Stream.concat(
          Stream.make(initial),
          Stream.merge(
            Stream.merge(directRepositoryChanges, externalRepositoryChanges),
            Stream.merge(queueChanges, undoChanges),
          ),
        );
      }),
    );

  const withValidatedQuery = <A, E>(
    cwd: string,
    operation: string,
    run: (normalizedCwd: string) => Effect.Effect<A, E>,
  ): Effect.Effect<A, GitWorkbenchServiceError> =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(cwd, operation);
      return yield* run(workspace.cwd).pipe(
        Effect.mapError((error) => toGitWorkbenchServiceError(workspace.cwd, operation, error)),
      );
    });

  const changesDiff: GitWorkbenchService["Service"]["changesDiff"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "get-changes-diff");
      return yield* driver
        .getChangesDiff({
          workspace,
          path: input.path,
          source: input.source,
          ...(input.expectedStateToken === undefined
            ? {}
            : { expectedStateToken: input.expectedStateToken }),
        })
        .pipe(
          Effect.mapError((error) =>
            toGitWorkbenchServiceError(workspace.cwd, "get-changes-diff", error),
          ),
        );
    });

  const applySelection: GitWorkbenchService["Service"]["applySelection"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "apply-change-selection");
      return yield* scheduler.withLock(
        workspace.cwd,
        Effect.gen(function* () {
          if (input.action === "discard") {
            yield* driver.getChangesDiff({
              workspace,
              path: input.path,
              source: input.source,
              expectedStateToken: input.expectedStateToken,
            });
            yield* undo.capture({
              cwd: workspace.cwd,
              reason: "before_discard",
              capturedStateToken: input.expectedStateToken,
            });
          }
          const next = yield* driver.applyChangeSelection({
            workspace,
            path: input.path,
            source: input.source,
            action: input.action,
            selection: input.selection,
            expectedStateToken: input.expectedStateToken,
            expectedPatchId: input.expectedPatchId,
            ...(input.confirmedUntrackedDeletion === undefined
              ? {}
              : { confirmedUntrackedDeletion: input.confirmedUntrackedDeletion }),
          });
          yield* publishSnapshot(workspace.cwd, next);
          if (input.action === "discard") yield* publishUndo(workspace.cwd);
          yield* refreshLegacyStatus(workspace.cwd);
          return { snapshot: next } satisfies GitApplyChangeSelectionResult;
        }),
      );
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "apply-change-selection", error),
      ),
    );

  const runOperation: GitWorkbenchService["Service"]["runOperation"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "run-workbench-operation");
      const result = yield* scheduler.withLock(
        workspace.cwd,
        operations.run({ ...input, cwd: workspace.cwd }),
      );
      const next = yield* loadSnapshot(workspace, "run-workbench-operation");
      yield* publishSnapshot(workspace.cwd, next);
      yield* publishUndo(workspace.cwd);
      yield* refreshLegacyStatus(workspace.cwd);
      return result;
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "run-workbench-operation", error),
      ),
    );

  const listUndo: GitWorkbenchService["Service"]["listUndo"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "list-undo-snapshots");
      return { snapshots: yield* loadUndo(workspace.cwd, "list-undo-snapshots") };
    });

  const createUndo: GitWorkbenchService["Service"]["createUndo"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "create-undo-snapshot");
      return yield* scheduler.withLock(
        workspace.cwd,
        Effect.gen(function* () {
          const current = yield* loadSnapshot(workspace, "create-undo-snapshot");
          if (current.stateToken !== input.expectedStateToken) {
            return yield* new ContractGitWorkbenchStaleStateError({
              cwd: workspace.cwd,
              operation: "create-undo-snapshot",
              expectedStateToken: input.expectedStateToken,
              actualStateToken: current.stateToken,
              reason: "repository_changed",
            });
          }
          const captured = yield* undo.capture({
            cwd: workspace.cwd,
            reason: "manual",
            capturedStateToken: input.expectedStateToken,
          });
          yield* publishUndo(workspace.cwd);
          return { snapshot: toContractUndoSnapshot(captured) };
        }),
      );
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "create-undo-snapshot", error),
      ),
    );

  const restoreUndo: GitWorkbenchService["Service"]["restoreUndo"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "restore-undo-snapshot");
      yield* scheduler.withLock(
        workspace.cwd,
        undo.restore({
          cwd: workspace.cwd,
          snapshotId: input.snapshotId,
          expectedStateToken: input.expectedStateToken,
        }),
      );
      const next = yield* loadSnapshot(workspace, "restore-undo-snapshot");
      yield* publishSnapshot(workspace.cwd, next);
      yield* publishUndo(workspace.cwd);
      yield* refreshLegacyStatus(workspace.cwd);
      return { restoredSnapshotId: input.snapshotId, snapshot: next };
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "restore-undo-snapshot", error),
      ),
    );

  const upsertQueue: GitWorkbenchService["Service"]["upsertQueue"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "upsert-queued-workflow");
      if (
        input.threadId === undefined ||
        (input.turnId !== undefined && input.threadId === undefined)
      ) {
        return yield* new ContractGitWorkbenchError({
          cwd: workspace.cwd,
          operation: "upsert-queued-workflow",
          reason: "unsupported",
          detail: "Queued workflows require a thread association.",
        });
      }
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const currentSnapshot = yield* loadSnapshot(workspace, "upsert-queued-workflow");
      if (currentSnapshot.truncated) {
        return yield* new ContractGitWorkbenchError({
          cwd: workspace.cwd,
          operation: "upsert-queued-workflow",
          reason: "unsupported",
          detail:
            "Repository status is truncated; queued workflow preconditions cannot be captured safely.",
        });
      }
      if (currentSnapshot.stateToken !== input.expectedStateToken) {
        return yield* new ContractGitWorkbenchStaleStateError({
          cwd: workspace.cwd,
          operation: "upsert-queued-workflow",
          expectedStateToken: input.expectedStateToken,
          actualStateToken: currentSnapshot.stateToken,
          reason: "repository_changed",
        });
      }
      const worktreeRoot = currentSnapshot.worktreeRoot ?? workspace.cwd;
      const scope = { environmentId, worktreeRoot };
      const queued =
        input.expectedRevision !== undefined && input.workflowId !== undefined
          ? yield* queue.edit({
              scope,
              workflowId: input.workflowId,
              expectedRevision: input.expectedRevision,
              workflow: input.plan,
              preconditions: observedStateFromSnapshot(environmentId, currentSnapshot, input.plan),
            })
          : yield* queue.createOrReplace({
              scope,
              threadId: input.threadId,
              turnId: input.turnId ?? null,
              workflow: input.plan,
              preconditions: observedStateFromSnapshot(environmentId, currentSnapshot, input.plan),
              ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
              ...(input.replaceExisting === undefined
                ? {}
                : { replaceExisting: input.replaceExisting }),
            });
      if (queued.status === "ready") {
        yield* queue.drain(scope).pipe(Effect.forkDetach, Effect.asVoid);
      }
      return { queuedWorkflow: toContractQueuedWorkflow(queued) };
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "upsert-queued-workflow", error),
      ),
    );

  const cancelQueue: GitWorkbenchService["Service"]["cancelQueue"] = (input) =>
    Effect.gen(function* () {
      const workspace = yield* resolveWorkspace(input.cwd, "cancel-queued-workflow");
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const currentSnapshot = yield* loadSnapshot(workspace, "cancel-queued-workflow");
      const cancelled = yield* queue.cancel({
        scope: {
          environmentId,
          worktreeRoot: currentSnapshot.worktreeRoot ?? workspace.cwd,
        },
        workflowId: input.workflowId,
        expectedRevision: input.expectedRevision,
      });
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      return { cancelledWorkflow: toContractCancelledWorkflow(cancelled, updatedAt) };
    }).pipe(
      Effect.mapError((error) =>
        toGitWorkbenchServiceError(input.cwd, "cancel-queued-workflow", error),
      ),
    );

  return GitWorkbenchService.of({
    snapshot,
    subscribe,
    insights: (input) =>
      withValidatedQuery(input.cwd, "get-repository-insights", (cwd) =>
        query.getRepositoryInsights({ ...input, cwd }),
      ),
    history: (input) =>
      withValidatedQuery(input.cwd, "list-history", (cwd) => query.listHistory({ ...input, cwd })),
    commitDetail: (input) =>
      withValidatedQuery(input.cwd, "get-commit-detail", (cwd) =>
        query.getCommitDetail({ ...input, cwd }),
      ),
    commitFileDiff: (input) =>
      withValidatedQuery(input.cwd, "get-commit-file-diff", (cwd) =>
        query.getCommitFileDiff({ ...input, cwd }),
      ),
    interactiveRebasePlan: (input) =>
      withValidatedQuery(input.cwd, "get-interactive-rebase-plan", (cwd) =>
        query.getInteractiveRebasePlan({ ...input, cwd }),
      ),
    changesDiff,
    applySelection,
    runOperation,
    listUndo,
    createUndo,
    restoreUndo,
    upsertQueue,
    cancelQueue,
  });
});

export const layer = Layer.effect(GitWorkbenchService, make);
