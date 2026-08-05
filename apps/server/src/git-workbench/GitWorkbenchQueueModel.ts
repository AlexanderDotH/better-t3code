import { GitQueuedWorkflowPlan } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const GitWorkbenchQueueScope = Schema.Struct({
  environmentId: Schema.NonEmptyString,
  worktreeRoot: Schema.NonEmptyString,
});
export type GitWorkbenchQueueScope = typeof GitWorkbenchQueueScope.Type;

export const GitWorkbenchQueueStatus = Schema.Literals([
  "waiting_for_turn",
  "ready",
  "running",
  "needs_review",
  "failed",
]);
export type GitWorkbenchQueueStatus = typeof GitWorkbenchQueueStatus.Type;

export const GitWorkbenchQueueWorkflow = GitQueuedWorkflowPlan;
export type GitWorkbenchQueueWorkflow = typeof GitWorkbenchQueueWorkflow.Type;

export const GitWorkbenchQueuePreconditions = Schema.Struct({
  stateToken: Schema.NonEmptyString,
  headOid: Schema.NullOr(Schema.NonEmptyString),
  refName: Schema.NullOr(Schema.NonEmptyString),
  indexToken: Schema.NonEmptyString,
  worktreeToken: Schema.NonEmptyString,
  operationState: Schema.NullOr(Schema.NonEmptyString),
  remoteOid: Schema.NullOr(Schema.NonEmptyString),
  selectionPatchToken: Schema.NullOr(Schema.NonEmptyString),
});
export type GitWorkbenchQueuePreconditions = typeof GitWorkbenchQueuePreconditions.Type;

export const GitWorkbenchQueueReviewReason = Schema.Literals([
  "repository_changed",
  "ref_changed",
  "head_changed",
  "index_changed",
  "worktree_changed",
  "operation_changed",
  "conflicts_present",
  "remote_changed",
  "selection_changed",
  "server_restarted_during_execution",
]);
export type GitWorkbenchQueueReviewReason = typeof GitWorkbenchQueueReviewReason.Type;

export const GitWorkbenchQueuedWorkflow = Schema.Struct({
  id: Schema.NonEmptyString,
  scope: GitWorkbenchQueueScope,
  threadId: Schema.NonEmptyString,
  turnId: Schema.NullOr(Schema.NonEmptyString),
  status: GitWorkbenchQueueStatus,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  workflow: GitWorkbenchQueueWorkflow,
  preconditions: GitWorkbenchQueuePreconditions,
  needsReviewReasons: Schema.Array(GitWorkbenchQueueReviewReason),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});
export type GitWorkbenchQueuedWorkflow = typeof GitWorkbenchQueuedWorkflow.Type;

export interface GitWorkbenchObservedState extends GitWorkbenchQueueScope {
  readonly stateToken: string;
  readonly headOid: string | null;
  readonly refName: string | null;
  readonly indexToken: string;
  readonly worktreeToken: string;
  readonly operationState: string | null;
  readonly remoteOid: string | null;
  readonly selectionPatchToken: string | null;
  readonly hasConflicts: boolean;
}

export type GitWorkbenchQueueRevalidation =
  | { readonly _tag: "valid" }
  | {
      readonly _tag: "needs_review";
      readonly reasons: ReadonlyArray<GitWorkbenchQueueReviewReason>;
    };

function pushIf(
  reasons: Array<GitWorkbenchQueueReviewReason>,
  condition: boolean,
  reason: GitWorkbenchQueueReviewReason,
): void {
  if (condition) reasons.push(reason);
}

function requiresRemoteIdentity(workflow: GitWorkbenchQueueWorkflow): boolean {
  return workflow.kind === "delivery" && (workflow.push || workflow.createPullRequest);
}

export function revalidateQueuedWorkflow(
  queued: GitWorkbenchQueuedWorkflow,
  observed: GitWorkbenchObservedState,
): GitWorkbenchQueueRevalidation {
  const reasons: Array<GitWorkbenchQueueReviewReason> = [];
  const expected = queued.preconditions;
  const sameRepository =
    queued.scope.environmentId === observed.environmentId &&
    queued.scope.worktreeRoot === observed.worktreeRoot;

  pushIf(reasons, !sameRepository, "repository_changed");
  pushIf(reasons, expected.refName !== observed.refName, "ref_changed");
  pushIf(reasons, expected.headOid !== observed.headOid, "head_changed");
  pushIf(reasons, expected.operationState !== observed.operationState, "operation_changed");
  pushIf(reasons, observed.hasConflicts, "conflicts_present");

  if (queued.workflow.kind === "advanced_operation") {
    pushIf(reasons, expected.indexToken !== observed.indexToken, "index_changed");
    pushIf(reasons, expected.worktreeToken !== observed.worktreeToken, "worktree_changed");
  } else if (queued.workflow.stage.mode === "staged") {
    pushIf(reasons, expected.indexToken !== observed.indexToken, "index_changed");
  } else if (queued.workflow.stage.mode === "paths") {
    pushIf(reasons, expected.indexToken !== observed.indexToken, "index_changed");
    pushIf(reasons, expected.worktreeToken !== observed.worktreeToken, "worktree_changed");
    pushIf(
      reasons,
      expected.selectionPatchToken !== observed.selectionPatchToken,
      "selection_changed",
    );
  }

  if (requiresRemoteIdentity(queued.workflow) && expected.remoteOid !== null) {
    pushIf(reasons, expected.remoteOid !== observed.remoteOid, "remote_changed");
  }

  return reasons.length === 0 ? { _tag: "valid" } : { _tag: "needs_review", reasons };
}
