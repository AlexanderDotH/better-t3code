import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

// Git paths are byte-oriented and may legally begin or end with whitespace.
// Never normalize them at the transport boundary.
const GitPath = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4_096));
const GitRefName = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
const GitIdentifier = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const GitMessage = TrimmedNonEmptyString.check(Schema.isMaxLength(10_000));
const GitObjectId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
);
const GitShortObjectId = TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{4,64}$/));
const GitCalendarDate = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const GitPercentage = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const GitHistoryLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(50));
const GitSelectionIds = Schema.Array(GitIdentifier).check(Schema.isMinLength(1));

export const GitWorkbenchInput = Schema.Struct({
  cwd: GitPath,
});
export type GitWorkbenchInput = typeof GitWorkbenchInput.Type;

export const GitWorkbenchDiffStats = Schema.Struct({
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  binary: Schema.Boolean,
});
export type GitWorkbenchDiffStats = typeof GitWorkbenchDiffStats.Type;

export const GitWorkbenchFileStatus = Schema.Literals([
  "unmodified",
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "conflicted",
  "unknown",
]);
export type GitWorkbenchFileStatus = typeof GitWorkbenchFileStatus.Type;

export const GitWorkbenchFileKind = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "untracked",
  "conflicted",
  "unknown",
]);
export type GitWorkbenchFileKind = typeof GitWorkbenchFileKind.Type;

export const GitWorkbenchFile = Schema.Struct({
  path: GitPath,
  oldPath: Schema.optionalKey(GitPath),
  kind: GitWorkbenchFileKind,
  indexStatus: GitWorkbenchFileStatus,
  worktreeStatus: GitWorkbenchFileStatus,
  staged: Schema.Boolean,
  unstaged: Schema.Boolean,
  untracked: Schema.Boolean,
  conflicted: Schema.Boolean,
  binary: Schema.Boolean,
  submodule: Schema.Boolean,
  modeChanged: Schema.Boolean,
  stagedStats: GitWorkbenchDiffStats,
  unstagedStats: GitWorkbenchDiffStats,
});
export type GitWorkbenchFile = typeof GitWorkbenchFile.Type;

export const GitWorkbenchOperationKind = Schema.Literals([
  "none",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "bisect",
  "apply-mailbox",
]);
export type GitWorkbenchOperationKind = typeof GitWorkbenchOperationKind.Type;

export const GitWorkbenchOperationState = Schema.Struct({
  kind: GitWorkbenchOperationKind,
  currentStep: Schema.optionalKey(PositiveInt),
  totalSteps: Schema.optionalKey(PositiveInt),
  headName: Schema.optionalKey(GitRefName),
  ontoOid: Schema.optionalKey(GitObjectId),
  conflictingPaths: Schema.optionalKey(Schema.Array(GitPath)),
});
export type GitWorkbenchOperationState = typeof GitWorkbenchOperationState.Type;

export const GitWorkbenchLastCommit = Schema.Struct({
  oid: GitObjectId,
  shortOid: GitShortObjectId,
  subject: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  committedAt: IsoDateTime,
});
export type GitWorkbenchLastCommit = typeof GitWorkbenchLastCommit.Type;

export const GitWorkbenchSnapshot = Schema.Struct({
  isRepository: Schema.Boolean,
  registeredCwd: GitPath,
  repositoryRoot: Schema.NullOr(GitPath),
  worktreeRoot: Schema.NullOr(GitPath),
  gitCommonDir: Schema.NullOr(GitPath),
  refName: Schema.NullOr(GitRefName),
  upstreamRef: Schema.NullOr(GitRefName),
  upstreamOid: Schema.optionalKey(Schema.NullOr(GitObjectId)),
  headOid: Schema.NullOr(GitObjectId),
  unborn: Schema.Boolean,
  detached: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  lastCommit: Schema.optionalKey(Schema.NullOr(GitWorkbenchLastCommit)),
  files: Schema.Array(GitWorkbenchFile),
  totals: Schema.Struct({
    staged: NonNegativeInt,
    unstaged: NonNegativeInt,
    untracked: NonNegativeInt,
    conflicted: NonNegativeInt,
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  operation: GitWorkbenchOperationState,
  truncated: Schema.Boolean,
  generatedAt: IsoDateTime,
  /** Opaque exact-index identity used for durable workflow preconditions. */
  indexStateToken: Schema.optionalKey(GitIdentifier),
  /** Opaque worktree-content identity used for durable workflow preconditions. */
  worktreeStateToken: Schema.optionalKey(GitIdentifier),
  stateToken: GitIdentifier,
});
export type GitWorkbenchSnapshot = typeof GitWorkbenchSnapshot.Type;

// Repository insights

export const GitRepositoryInsightsInput = GitWorkbenchInput;
export type GitRepositoryInsightsInput = typeof GitRepositoryInsightsInput.Type;

export const GitRepositoryContributor = Schema.Struct({
  identityKey: GitIdentifier,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  commitCount: NonNegativeInt,
});
export type GitRepositoryContributor = typeof GitRepositoryContributor.Type;

export const GitRepositoryActivityBucket = Schema.Struct({
  date: GitCalendarDate,
  commitCount: NonNegativeInt,
});
export type GitRepositoryActivityBucket = typeof GitRepositoryActivityBucket.Type;

export const GitRepositoryCodeMixEntry = Schema.Struct({
  language: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  fileCount: NonNegativeInt,
  percentage: GitPercentage,
});
export type GitRepositoryCodeMixEntry = typeof GitRepositoryCodeMixEntry.Type;

export const GitRepositoryInsightsResult = Schema.Struct({
  snapshotOid: Schema.NullOr(GitObjectId),
  windowStart: IsoDateTime,
  windowEnd: IsoDateTime,
  scannedCommits: NonNegativeInt,
  truncated: Schema.Boolean,
  contributors: Schema.Array(GitRepositoryContributor),
  activity: Schema.Array(GitRepositoryActivityBucket),
  codeMix: Schema.Struct({
    entries: Schema.Array(GitRepositoryCodeMixEntry),
    trackedFileCount: NonNegativeInt,
    classifiedFileCount: NonNegativeInt,
    excludedFileCount: NonNegativeInt,
    scannedFileCount: NonNegativeInt,
    truncated: Schema.Boolean,
  }),
});
export type GitRepositoryInsightsResult = typeof GitRepositoryInsightsResult.Type;

// Commit history

export const GitHistoryListInput = Schema.Struct({
  cwd: GitPath,
  snapshotOid: Schema.optionalKey(GitObjectId),
  cursor: Schema.optionalKey(NonNegativeInt),
  limit: GitHistoryLimit,
  refName: Schema.optionalKey(GitRefName),
  path: Schema.optionalKey(GitPath),
});
export type GitHistoryListInput = typeof GitHistoryListInput.Type;

export const GitHistoryItem = Schema.Struct({
  oid: GitObjectId,
  shortOid: GitShortObjectId,
  subject: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  authorName: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  authoredAt: IsoDateTime,
  committedAt: IsoDateTime,
  parents: Schema.Array(GitObjectId),
  decorations: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(1_024))),
});
export type GitHistoryItem = typeof GitHistoryItem.Type;

export const GitHistoryListResult = Schema.Struct({
  snapshotOid: Schema.NullOr(GitObjectId),
  items: Schema.Array(GitHistoryItem),
  nextCursor: Schema.NullOr(NonNegativeInt),
  truncated: Schema.Boolean,
});
export type GitHistoryListResult = typeof GitHistoryListResult.Type;

export const GitCommitDetailInput = Schema.Struct({
  cwd: GitPath,
  oid: GitObjectId,
});
export type GitCommitDetailInput = typeof GitCommitDetailInput.Type;

export const GitCommitFileStatus = Schema.Literals([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "unmerged",
  "unknown",
]);
export type GitCommitFileStatus = typeof GitCommitFileStatus.Type;

export const GitCommitChangedFile = Schema.Struct({
  path: GitPath,
  oldPath: Schema.optionalKey(GitPath),
  status: GitCommitFileStatus,
  additions: Schema.optionalKey(NonNegativeInt),
  deletions: Schema.optionalKey(NonNegativeInt),
  binary: Schema.Boolean,
});
export type GitCommitChangedFile = typeof GitCommitChangedFile.Type;

export const GitCommitDetailResult = Schema.Struct({
  oid: GitObjectId,
  subject: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  body: Schema.String.check(Schema.isMaxLength(100_000)),
  authorName: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  committerName: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  authoredAt: IsoDateTime,
  committedAt: IsoDateTime,
  parents: Schema.Array(GitObjectId),
  files: Schema.Array(GitCommitChangedFile),
  truncated: Schema.Boolean,
});
export type GitCommitDetailResult = typeof GitCommitDetailResult.Type;

export const GitCommitFileDiffInput = Schema.Struct({
  cwd: GitPath,
  oid: GitObjectId,
  path: GitPath,
  oldPath: Schema.optionalKey(GitPath),
});
export type GitCommitFileDiffInput = typeof GitCommitFileDiffInput.Type;

export const GitCommitFileDiffResult = Schema.Struct({
  oid: GitObjectId,
  path: GitPath,
  oldPath: Schema.optionalKey(GitPath),
  patch: Schema.String.check(Schema.isMaxLength(1_000_000)),
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
});
export type GitCommitFileDiffResult = typeof GitCommitFileDiffResult.Type;

// Staging and working-tree diffs

export const GitChangesDiffSource = Schema.Literals(["staged", "unstaged"]);
export type GitChangesDiffSource = typeof GitChangesDiffSource.Type;

export const GitChangesDiffInput = Schema.Struct({
  cwd: GitPath,
  path: GitPath,
  source: GitChangesDiffSource,
  expectedStateToken: Schema.optionalKey(GitIdentifier),
});
export type GitChangesDiffInput = typeof GitChangesDiffInput.Type;

export const GitDiffLine = Schema.Struct({
  id: GitIdentifier,
  type: Schema.Literals(["context", "addition", "deletion", "no-newline"]),
  oldLine: Schema.optionalKey(PositiveInt),
  newLine: Schema.optionalKey(PositiveInt),
  content: Schema.String,
  selectable: Schema.Boolean,
});
export type GitDiffLine = typeof GitDiffLine.Type;

export const GitDiffHunk = Schema.Struct({
  id: GitIdentifier,
  oldStart: NonNegativeInt,
  oldLines: NonNegativeInt,
  newStart: NonNegativeInt,
  newLines: NonNegativeInt,
  header: Schema.String.check(Schema.isMaxLength(4_096)),
  lines: Schema.Array(GitDiffLine),
});
export type GitDiffHunk = typeof GitDiffHunk.Type;

export const GitChangesDiffResult = Schema.Struct({
  path: GitPath,
  oldPath: Schema.optionalKey(GitPath),
  source: GitChangesDiffSource,
  stateToken: GitIdentifier,
  patchId: GitIdentifier,
  binary: Schema.Boolean,
  truncated: Schema.Boolean,
  hunks: Schema.Array(GitDiffHunk),
  conflictVersions: Schema.optionalKey(
    Schema.Struct({
      base: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000_000))),
      ours: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000_000))),
      theirs: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000_000))),
    }),
  ),
});
export type GitChangesDiffResult = typeof GitChangesDiffResult.Type;

export const GitChangeSelection = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file") }),
  Schema.Struct({ kind: Schema.Literal("hunks"), ids: GitSelectionIds }),
  Schema.Struct({ kind: Schema.Literal("lines"), ids: GitSelectionIds }),
]);
export type GitChangeSelection = typeof GitChangeSelection.Type;

export const GitApplyChangeSelectionInput = Schema.Struct({
  cwd: GitPath,
  path: GitPath,
  source: GitChangesDiffSource,
  action: Schema.Literals(["stage", "unstage", "discard"]),
  selection: GitChangeSelection,
  expectedStateToken: GitIdentifier,
  expectedPatchId: GitIdentifier,
  confirmedUntrackedDeletion: Schema.optionalKey(Schema.Boolean),
});
export type GitApplyChangeSelectionInput = typeof GitApplyChangeSelectionInput.Type;

export const GitApplyChangeSelectionResult = Schema.Struct({
  snapshot: GitWorkbenchSnapshot,
});
export type GitApplyChangeSelectionResult = typeof GitApplyChangeSelectionResult.Type;

// Typed Git operations and interactive rebase

const GitRebaseCommitNode = (kind: "pick" | "edit" | "squash" | "fixup" | "drop") =>
  Schema.Struct({ kind: Schema.Literal(kind), oid: GitObjectId });

export const GitRebaseTodoNode = Schema.Union([
  GitRebaseCommitNode("pick"),
  Schema.Struct({
    kind: Schema.Literal("reword"),
    oid: GitObjectId,
    message: Schema.optionalKey(GitMessage),
  }),
  GitRebaseCommitNode("edit"),
  GitRebaseCommitNode("squash"),
  GitRebaseCommitNode("fixup"),
  GitRebaseCommitNode("drop"),
  Schema.Struct({ kind: Schema.Literal("label"), name: GitRefName }),
  Schema.Struct({ kind: Schema.Literal("reset"), label: GitRefName }),
  Schema.Struct({
    kind: Schema.Literal("merge"),
    label: GitRefName,
    originalOid: GitObjectId,
    messageMode: Schema.Literals(["reuse", "edit"]),
  }),
]);
export type GitRebaseTodoNode = typeof GitRebaseTodoNode.Type;

export const GitInteractiveRebasePlanInput = Schema.Struct({
  cwd: GitPath,
  upstreamRef: GitRefName,
});
export type GitInteractiveRebasePlanInput = typeof GitInteractiveRebasePlanInput.Type;

export const GitInteractiveRebasePlanItem = Schema.Struct({
  node: GitRebaseTodoNode,
  subject: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(1_000))),
  parents: Schema.optionalKey(Schema.Array(GitObjectId).check(Schema.isMaxLength(2))),
});
export type GitInteractiveRebasePlanItem = typeof GitInteractiveRebasePlanItem.Type;

export const GitInteractiveRebasePlanResult = Schema.Struct({
  upstreamRef: GitRefName,
  upstreamOid: GitObjectId,
  items: Schema.Array(GitInteractiveRebasePlanItem).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(10_000),
  ),
});
export type GitInteractiveRebasePlanResult = typeof GitInteractiveRebasePlanResult.Type;

const GitResetAction = Schema.Struct({
  kind: Schema.Literal("reset"),
  mode: Schema.Literals(["soft", "mixed", "hard"]),
  targetOid: GitObjectId,
});
const GitRevertAction = Schema.Struct({ kind: Schema.Literal("revert"), commitOid: GitObjectId });
const GitCherryPickAction = Schema.Struct({
  kind: Schema.Literal("cherry_pick"),
  commitOid: GitObjectId,
});
const GitGuidedRebaseAction = Schema.Struct({
  kind: Schema.Literal("guided_rebase"),
  ontoRef: GitRefName,
});
const GitInteractiveRebaseAction = Schema.Struct({
  kind: Schema.Literal("interactive_rebase"),
  upstreamRef: GitRefName,
  plan: Schema.Array(GitRebaseTodoNode).check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
});

export const GitWorkbenchOperationAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create_branch"),
    name: GitRefName,
    startPoint: Schema.optionalKey(GitRefName),
  }),
  Schema.Struct({ kind: Schema.Literal("switch_branch"), refName: GitRefName }),
  GitResetAction,
  GitRevertAction,
  GitCherryPickAction,
  GitGuidedRebaseAction,
  GitInteractiveRebaseAction,
  Schema.Struct({
    kind: Schema.Literal("continue"),
    operation: Schema.Literals(["rebase", "merge", "cherry-pick", "revert"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("skip"),
    operation: Schema.Literals(["rebase", "cherry-pick", "revert"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("abort"),
    operation: Schema.Literals(["rebase", "merge", "cherry-pick", "revert"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("force_with_lease"),
    remote: GitRefName,
    branch: GitRefName,
    expectedRemoteOid: GitObjectId,
  }),
]);
export type GitWorkbenchOperationAction = typeof GitWorkbenchOperationAction.Type;

export const GitWorkbenchOperationActionKind = Schema.Literals([
  "create_branch",
  "switch_branch",
  "reset",
  "revert",
  "cherry_pick",
  "guided_rebase",
  "interactive_rebase",
  "continue",
  "skip",
  "abort",
  "force_with_lease",
]);
export type GitWorkbenchOperationActionKind = typeof GitWorkbenchOperationActionKind.Type;

export const GitWorkbenchRunOperationInput = Schema.Struct({
  cwd: GitPath,
  expectedStateToken: GitIdentifier,
  action: GitWorkbenchOperationAction,
});
export type GitWorkbenchRunOperationInput = typeof GitWorkbenchRunOperationInput.Type;

export const GitWorkbenchOperationResult = Schema.Struct({
  status: Schema.Literals(["succeeded", "conflicts", "needs_edit"]),
  headOid: Schema.NullOr(GitObjectId),
  operation: GitWorkbenchOperationState,
});
export type GitWorkbenchOperationResult = typeof GitWorkbenchOperationResult.Type;

export const GitWorkbenchOperationEvent = Schema.Union([
  Schema.TaggedStruct("started", {
    operationId: GitIdentifier,
    actionKind: GitWorkbenchOperationActionKind,
  }),
  Schema.TaggedStruct("progress", {
    operationId: GitIdentifier,
    phase: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    label: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  }),
  Schema.TaggedStruct("completed", {
    operationId: GitIdentifier,
    result: GitWorkbenchOperationResult,
  }),
  Schema.TaggedStruct("failed", {
    operationId: GitIdentifier,
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  }),
]);
export type GitWorkbenchOperationEvent = typeof GitWorkbenchOperationEvent.Type;

// Local recovery snapshots

export const GitUndoSnapshotReason = Schema.Literals([
  "before_discard",
  "before_mixed_reset",
  "before_hard_reset",
  "before_rebase",
  "before_cherry_pick",
  "before_revert",
  "before_branch_switch",
  "before_restore",
  "manual",
]);
export type GitUndoSnapshotReason = typeof GitUndoSnapshotReason.Type;

export const GitUndoSnapshot = Schema.Struct({
  id: GitIdentifier,
  cwd: GitPath,
  createdAt: IsoDateTime,
  reason: GitUndoSnapshotReason,
  headOid: Schema.NullOr(GitObjectId),
  headRef: Schema.NullOr(GitRefName),
  indexTreeOid: GitObjectId,
  worktreeCommitOid: GitObjectId,
  expiresAt: IsoDateTime,
});
export type GitUndoSnapshot = typeof GitUndoSnapshot.Type;

export const GitUndoSnapshotsListInput = GitWorkbenchInput;
export type GitUndoSnapshotsListInput = typeof GitUndoSnapshotsListInput.Type;

export const GitUndoSnapshotsListResult = Schema.Struct({
  snapshots: Schema.Array(GitUndoSnapshot),
});
export type GitUndoSnapshotsListResult = typeof GitUndoSnapshotsListResult.Type;

export const GitUndoSnapshotCreateInput = Schema.Struct({
  cwd: GitPath,
  expectedStateToken: GitIdentifier,
});
export type GitUndoSnapshotCreateInput = typeof GitUndoSnapshotCreateInput.Type;

export const GitUndoSnapshotCreateResult = Schema.Struct({
  snapshot: GitUndoSnapshot,
});
export type GitUndoSnapshotCreateResult = typeof GitUndoSnapshotCreateResult.Type;

export const GitUndoSnapshotRestoreInput = Schema.Struct({
  cwd: GitPath,
  snapshotId: GitIdentifier,
  expectedStateToken: GitIdentifier,
});
export type GitUndoSnapshotRestoreInput = typeof GitUndoSnapshotRestoreInput.Type;

export const GitUndoSnapshotRestoreResult = Schema.Struct({
  restoredSnapshotId: GitIdentifier,
  snapshot: GitWorkbenchSnapshot,
});
export type GitUndoSnapshotRestoreResult = typeof GitUndoSnapshotRestoreResult.Type;

// One durable post-turn workflow per worktree

export const GitQueuedDeliveryStage = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("staged") }),
  Schema.Struct({ mode: Schema.Literal("all") }),
  Schema.Struct({ mode: Schema.Literal("paths"), paths: GitSelectionIds }),
]);
export type GitQueuedDeliveryStage = typeof GitQueuedDeliveryStage.Type;

export const GitQueuedAdvancedOperation = Schema.Union([
  GitResetAction,
  GitRevertAction,
  GitCherryPickAction,
  GitGuidedRebaseAction,
  GitInteractiveRebaseAction,
]);
export type GitQueuedAdvancedOperation = typeof GitQueuedAdvancedOperation.Type;

export const GitQueuedWorkflowPlan = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("delivery"),
    stage: GitQueuedDeliveryStage,
    commitMessage: Schema.optionalKey(GitMessage),
    push: Schema.Boolean,
    createPullRequest: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("advanced_operation"),
    action: GitQueuedAdvancedOperation,
  }),
]);
export type GitQueuedWorkflowPlan = typeof GitQueuedWorkflowPlan.Type;

export const GitQueuedWorkflowStatus = Schema.Literals([
  "waiting_for_turn",
  "ready",
  "running",
  "needs_review",
  "failed",
  "completed",
  "cancelled",
]);
export type GitQueuedWorkflowStatus = typeof GitQueuedWorkflowStatus.Type;

export const GitQueuedWorkflowReviewReason = Schema.Struct({
  code: Schema.Literals([
    "repository_changed",
    "branch_changed",
    "head_changed",
    "index_changed",
    "operation_started",
    "remote_changed",
    "conflicts_detected",
    "file_changed",
    "patch_changed",
    "permission_changed",
    "execution_interrupted",
  ]),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type GitQueuedWorkflowReviewReason = typeof GitQueuedWorkflowReviewReason.Type;

export const GitQueuedWorkflow = Schema.Struct({
  id: GitIdentifier,
  cwd: GitPath,
  revision: PositiveInt,
  threadId: Schema.optionalKey(ThreadId),
  turnId: Schema.optionalKey(TurnId),
  status: GitQueuedWorkflowStatus,
  expectedStateToken: GitIdentifier,
  plan: GitQueuedWorkflowPlan,
  needsReviewReasons: Schema.Array(GitQueuedWorkflowReviewReason),
  lastError: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type GitQueuedWorkflow = typeof GitQueuedWorkflow.Type;

export const GitQueuedWorkflowUpsertInput = Schema.Struct({
  cwd: GitPath,
  workflowId: Schema.optionalKey(GitIdentifier),
  expectedRevision: Schema.optionalKey(PositiveInt),
  threadId: Schema.optionalKey(ThreadId),
  turnId: Schema.optionalKey(TurnId),
  expectedStateToken: GitIdentifier,
  plan: GitQueuedWorkflowPlan,
  replaceExisting: Schema.optionalKey(Schema.Boolean),
});
export type GitQueuedWorkflowUpsertInput = typeof GitQueuedWorkflowUpsertInput.Type;

export const GitQueuedWorkflowUpsertResult = Schema.Struct({
  queuedWorkflow: GitQueuedWorkflow,
});
export type GitQueuedWorkflowUpsertResult = typeof GitQueuedWorkflowUpsertResult.Type;

export const GitQueuedWorkflowCancelInput = Schema.Struct({
  cwd: GitPath,
  workflowId: GitIdentifier,
  expectedRevision: PositiveInt,
});
export type GitQueuedWorkflowCancelInput = typeof GitQueuedWorkflowCancelInput.Type;

export const GitQueuedWorkflowCancelResult = Schema.Struct({
  cancelledWorkflow: GitQueuedWorkflow,
});
export type GitQueuedWorkflowCancelResult = typeof GitQueuedWorkflowCancelResult.Type;

// Subscription events combine the bounded, frequently changing projections.

export const GitWorkbenchStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    snapshot: GitWorkbenchSnapshot,
    queuedWorkflow: Schema.NullOr(GitQueuedWorkflow),
    undoSnapshots: Schema.Array(GitUndoSnapshot),
  }),
  Schema.TaggedStruct("repositoryUpdated", {
    snapshot: GitWorkbenchSnapshot,
  }),
  Schema.TaggedStruct("operationUpdated", {
    operation: GitWorkbenchOperationState,
  }),
  Schema.TaggedStruct("queueUpdated", {
    queuedWorkflow: Schema.NullOr(GitQueuedWorkflow),
  }),
  Schema.TaggedStruct("undoUpdated", {
    undoSnapshots: Schema.Array(GitUndoSnapshot),
  }),
]);
export type GitWorkbenchStreamEvent = typeof GitWorkbenchStreamEvent.Type;

// Structured failures let clients refresh only stale projections instead of treating every
// rejected mutation as a transport failure.

export class GitWorkbenchStaleStateError extends Schema.TaggedErrorClass<GitWorkbenchStaleStateError>()(
  "GitWorkbenchStaleStateError",
  {
    cwd: GitPath,
    operation: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    expectedStateToken: GitIdentifier,
    actualStateToken: Schema.NullOr(GitIdentifier),
    reason: Schema.Literals([
      "repository_changed",
      "patch_changed",
      "head_changed",
      "index_changed",
      "remote_changed",
    ]),
  },
) {
  override get message(): string {
    return `Git workbench state changed before '${this.operation}' could run in '${this.cwd}'.`;
  }
}

export class GitWorkbenchRestrictionError extends Schema.TaggedErrorClass<GitWorkbenchRestrictionError>()(
  "GitWorkbenchRestrictionError",
  {
    cwd: GitPath,
    operation: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    reason: Schema.Literals([
      "not_a_repository",
      "unsupported_selection",
      "binary_selection",
      "conflicted_selection",
      "destructive_confirmation_required",
      "operation_in_progress",
      "read_only",
    ]),
    path: Schema.optionalKey(GitPath),
    detail: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  },
) {
  override get message(): string {
    return `Git workbench operation '${this.operation}' is not allowed in '${this.cwd}': ${this.reason}.`;
  }
}

export class GitWorkbenchError extends Schema.TaggedErrorClass<GitWorkbenchError>()(
  "GitWorkbenchError",
  {
    cwd: GitPath,
    operation: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    reason: Schema.Literals([
      "not_a_repository",
      "invalid_path",
      "invalid_object",
      "invalid_rebase_plan",
      "output_too_large",
      "command_failed",
      "persistence_failed",
      "unsupported",
    ]),
    detail: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Git workbench operation '${this.operation}' failed in '${this.cwd}': ${this.reason}.`;
  }
}

export const GitWorkbenchServiceError = Schema.Union([
  GitWorkbenchStaleStateError,
  GitWorkbenchRestrictionError,
  GitWorkbenchError,
]);
export type GitWorkbenchServiceError = typeof GitWorkbenchServiceError.Type;
