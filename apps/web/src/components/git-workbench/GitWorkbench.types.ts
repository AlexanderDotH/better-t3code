import type { GitQueuedWorkflowPlan } from "@t3tools/contracts";

export type GitWorkbenchTabId = "overview" | "changes" | "history" | "branches" | "operations";

export type GitRepositoryState =
  | "clean"
  | "changed"
  | "conflicted"
  | "detached"
  | "unborn"
  | "stale"
  | "disconnected"
  | "unavailable";

export interface GitWorkbenchCommitSummary {
  readonly authoredAt: string;
  readonly oid: string;
  readonly subject: string;
}

export interface GitWorkbenchSnapshot {
  readonly additions?: number | undefined;
  readonly ahead: number;
  readonly behind: number;
  readonly branch: string | null;
  readonly changeCount: number;
  readonly conflicts: number;
  readonly deletions?: number | undefined;
  readonly generatedAt: string;
  readonly headOid: string | null;
  readonly lastCommit: GitWorkbenchCommitSummary | null;
  readonly pullRequest?:
    | {
        readonly number: number;
        readonly status: "closed" | "draft" | "merged" | "open";
        readonly title: string;
        readonly url: string;
      }
    | undefined;
  readonly repositoryState: GitRepositoryState;
  readonly staged: number;
  readonly stale: boolean;
  readonly stateToken: string;
  readonly unstaged: number;
  readonly untracked: number;
  readonly upstream: string | null;
  readonly upstreamOid?: string | null;
  readonly worktreeRoot: string;
}

export type GitChangeKind =
  | "added"
  | "conflicted"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "type-changed"
  | "unmerged"
  | "unknown"
  | "untracked";

export type GitConflictKind =
  | "added-by-both"
  | "added-by-us"
  | "added-by-them"
  | "both-modified"
  | "deleted-by-us"
  | "deleted-by-them"
  | "unknown";

export interface GitWorkbenchDiffLine {
  readonly content: string;
  readonly id: string;
  readonly kind: "addition" | "context" | "deletion" | "meta";
  readonly newLine: number | null;
  readonly oldLine: number | null;
  readonly selectable: boolean;
}

export interface GitWorkbenchDiffHunk {
  readonly header: string;
  readonly id: string;
  readonly lines: readonly GitWorkbenchDiffLine[];
}

export interface GitWorkbenchChange {
  readonly additions: number;
  readonly binary: boolean;
  readonly conflict?: GitConflictKind;
  readonly conflictVersions?: {
    readonly base: string | null;
    readonly ours: string | null;
    readonly theirs: string | null;
  };
  readonly deletions: number;
  readonly diff?: {
    readonly hunks: readonly GitWorkbenchDiffHunk[];
    readonly patchId: string;
    readonly source: "index" | "worktree";
    readonly stale?: boolean;
    readonly truncated?: boolean;
  };
  readonly id: string;
  readonly kind: GitChangeKind;
  readonly modeChanged: boolean;
  readonly path: string;
  readonly previousPath?: string;
  readonly staged: boolean;
  readonly submodule: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
}

export interface GitActivityDay {
  readonly count: number;
  readonly date: string;
}

export interface GitContributor {
  readonly commits: number;
  readonly identity: string;
  readonly name: string;
}

export interface GitCodeMixEntry {
  readonly color: string;
  readonly files: number;
  readonly label: string;
  readonly percent: number;
}

export interface GitRepositoryInsights {
  readonly activity: readonly GitActivityDay[];
  readonly codeMix: readonly GitCodeMixEntry[];
  readonly contributors: readonly GitContributor[];
  readonly coverage: {
    readonly sampledCommits: number;
    readonly sampledFiles: number;
    readonly truncated: boolean;
  };
}

export interface GitHistoryCommit {
  readonly author: string;
  readonly authoredAt: string;
  readonly decorations: readonly string[];
  readonly oid: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

export interface GitHistoryState {
  readonly commits: readonly GitHistoryCommit[];
  readonly error?: string;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly snapshotOid: string | null;
}

export interface GitCommitFile {
  readonly additions: number;
  readonly binary: boolean;
  readonly deletions: number;
  readonly kind: GitChangeKind;
  readonly path: string;
  readonly previousPath?: string;
  readonly unifiedDiff?: string;
  readonly truncated?: boolean;
}

export interface GitCommitDetail {
  readonly author: string;
  readonly authoredAt: string;
  readonly body: string;
  readonly committedAt: string;
  readonly committer: string;
  readonly files: readonly GitCommitFile[];
  readonly oid: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

export interface GitBranch {
  readonly ahead?: number;
  readonly behind?: number;
  readonly current: boolean;
  readonly name: string;
  readonly oid: string | null;
  readonly remote: boolean;
  readonly upstream?: string;
}

export type GitWorkbenchRebaseNode =
  | {
      readonly commitId: string;
      readonly dependencies?: readonly string[];
      readonly id: string;
      readonly kind: "drop" | "edit" | "fixup" | "pick" | "reword" | "squash";
      readonly message?: string;
      readonly subject: string;
    }
  | { readonly id: string; readonly kind: "label"; readonly label: string }
  | { readonly id: string; readonly kind: "reset"; readonly label: string }
  | {
      readonly commitId: string;
      readonly dependencies?: readonly string[];
      readonly id: string;
      readonly kind: "merge";
      readonly labels: readonly string[];
      readonly subject: string;
    };

export interface GitOperationState {
  readonly canAbort: boolean;
  readonly canContinue: boolean;
  readonly canSkip: boolean;
  readonly conflicts: readonly string[];
  readonly detail: string;
  readonly kind: "cherry-pick" | "merge" | "rebase" | "revert";
  readonly rebasePlan?: readonly GitWorkbenchRebaseNode[];
  readonly startedAt: string;
}

export interface GitQueuedWorkflow {
  readonly id: string;
  readonly label: string;
  readonly lastError?: string;
  readonly plan: GitQueuedWorkflowPlan;
  readonly revision: number;
  readonly staleReasons: readonly string[];
  readonly status: "failed" | "needs-review" | "running" | "waiting-for-turn";
}

export interface GitUndoSnapshot {
  readonly createdAt: string;
  readonly id: string;
  readonly label: string;
  readonly refName: string | null;
}

export interface GitCurrentFileState {
  readonly baseContent: string;
  readonly content: string;
  readonly error?: string;
  readonly loading: boolean;
  readonly path: string;
  readonly readOnlyReason?: string;
  readonly revision: string;
  readonly saveState: "buffered" | "conflict" | "idle" | "saving" | "saved";
  readonly serverContent?: string;
}

export type GitSelectionAction = "discard" | "stage" | "unstage";

export interface GitChangeSelectionInput {
  readonly action: GitSelectionAction;
  readonly changeId: string;
  readonly expectedPatchId?: string | undefined;
  readonly expectedStateToken: string;
  readonly hunkIds: readonly string[];
  readonly lineIds: readonly string[];
  readonly path: string;
  readonly source: "index" | "worktree";
}

export type GitWorkbenchOperationInput =
  | { readonly kind: "abort" | "continue" | "skip" }
  | { readonly commitOid: string; readonly kind: "cherry-pick" | "revert" }
  | { readonly kind: "create-pull-request" | "pull" | "push" | "stage-all-and-commit" }
  | { readonly kind: "commit-staged" }
  | { readonly branch: string; readonly kind: "guided-rebase" }
  | {
      readonly expectedRemoteOid: string;
      readonly kind: "force-with-lease";
      readonly remoteRef: string;
    }
  | { readonly kind: "reset"; readonly mode: "hard" | "mixed" | "soft"; readonly oid: string }
  | {
      readonly kind: "start-interactive-rebase";
      readonly nodes: readonly GitWorkbenchRebaseNode[];
      readonly upstreamRef: string;
    };

export interface GitWorkbenchPanelProps {
  activeTab: GitWorkbenchTabId;
  branches: readonly GitBranch[];
  changes: readonly GitWorkbenchChange[];
  currentFile: GitCurrentFileState | null;
  history: GitHistoryState;
  insights: GitRepositoryInsights | null;
  loading: boolean;
  upgradeRequired?: boolean;
  onApplySelection: (input: GitChangeSelectionInput) => void;
  onCancelQueue: (queueId: string) => void;
  onChangeTab: (tab: GitWorkbenchTabId) => void;
  onCreateBranch: (name: string) => void;
  onEditQueue?: ((queueId: string, plan: GitQueuedWorkflowPlan) => void) | undefined;
  onHistoryPathFilterChange?: (path: string) => void;
  onHistoryRefFilterChange?: (refName: string) => void;
  onLoadCommit: (oid: string) => void;
  onLoadCommitPatch?: (oid: string, path: string) => void;
  onLoadMoreHistory: () => void;
  onOpenCurrentFile: (path: string) => void;
  onPrepareInteractiveRebase?: ((upstreamRef: string) => void) | undefined;
  onRefreshChange?: ((path: string) => void) | undefined;
  onQueueWorkflow: (input: GitWorkbenchOperationInput) => void;
  onRestoreUndo: (snapshotId: string) => void;
  onRetryQueue?: ((queueId: string) => void) | undefined;
  onRunOperation: (input: GitWorkbenchOperationInput) => void;
  onSaveCurrentFile: (input: {
    readonly content: string;
    readonly expectedRevision: string;
    readonly path: string;
    readonly resolution?: "agent" | "merged" | "mine";
  }) => void;
  onSelectChange: (changeId: string | null) => void;
  onSelectCommit: (oid: string | null) => void;
  onSwitchBranch: (name: string) => void;
  onUpdateRebasePlan: (nodes: readonly GitWorkbenchRebaseNode[]) => void;
  historyPathFilter?: string;
  historyRefFilter?: string;
  operation: GitOperationState | null;
  operationProgress?: {
    readonly label: string;
    readonly status: "completed" | "failed" | "running";
  } | null;
  rebasePlan?: readonly GitWorkbenchRebaseNode[];
  rebaseUpstreamRef?: string | null;
  forcePushTarget?: { readonly expectedRemoteOid: string; readonly remoteRef: string } | undefined;
  queue: GitQueuedWorkflow | null;
  readOnly: boolean;
  selectedChangeId: string | null;
  selectedCommit: GitCommitDetail | null;
  showTabs?: boolean | undefined;
  snapshot: GitWorkbenchSnapshot | null;
  undoSnapshots: readonly GitUndoSnapshot[];
}
