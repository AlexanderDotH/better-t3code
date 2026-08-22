import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitChangesDiffResult,
  GitCommitDetailResult,
  GitCommitFileDiffResult,
  GitHistoryItem,
  GitInteractiveRebasePlanItem,
  GitQueuedWorkflowPlan,
  GitQueuedWorkflow as ContractQueuedWorkflow,
  GitRepositoryInsightsResult,
  GitRebaseTodoNode,
  GitUndoSnapshot as ContractUndoSnapshot,
  GitWorkbenchOperationAction,
  GitWorkbenchSnapshot as ContractWorkbenchSnapshot,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ServerProvider,
  ThreadId,
  TurnId,
  VcsStatusResult,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { ensureLocalApi } from "~/localApi";
import { requestGitActionsControl } from "~/components/gitActionsControlBus";
import { toastManager } from "~/components/ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { ChatWorkspaceDeck, type ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import { GitCompactCard, type GitCompactStatus } from "./GitCompactCard";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";
import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import { bufferedRevisionDisposition, selectBufferedPathsForScope } from "./gitWorkspaceDeck.logic";
import {
  McpWorkspaceCardController,
  McpWorkspacePeekController,
  McpWorkspaceRuntimeProvider,
} from "../mcp-workspace/McpWorkspaceController";
import { type WorkspaceDeckCardDefinition } from "../workspace-deck/WorkspaceCardDeck";
import { WorkspaceCardPeek } from "../workspace-deck/WorkspaceCardPeek";
import {
  resolveWorkspaceDeckActiveCard,
  type WorkspaceDeckPosition,
} from "../workspace-deck/workspaceCardDeck.logic";
import type {
  GitBranch,
  GitCommitDetail,
  GitCurrentFileState,
  GitHistoryState,
  GitOperationState,
  GitQueuedWorkflow,
  GitRepositoryInsights,
  GitWorkbenchChange,
  GitWorkbenchDiffHunk,
  GitWorkbenchOperationInput,
  GitWorkbenchPanelProps,
  GitWorkbenchRebaseNode,
  GitWorkbenchSnapshot,
  GitWorkbenchTabId,
  GitUndoSnapshot,
} from "./GitWorkbench.types";

const DESKTOP_WORKBENCH_MEDIA_QUERY = "(min-width: 48rem)";
const EMPTY_HISTORY: GitHistoryState = {
  commits: [],
  hasMore: false,
  loading: false,
  snapshotOid: null,
};
const CODE_MIX_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#94a3b8"];

export interface GitDeckAvailabilityInput {
  readonly cwd: string | null;
  readonly isRepository: boolean | null;
  readonly workbenchSupported: boolean;
}

export function resolveGitDeckCardIds(
  input: GitDeckAvailabilityInput,
): readonly ChatWorkspaceCardId[] {
  const gitAvailable =
    input.cwd !== null && input.isRepository === true && input.workbenchSupported;
  return gitAvailable ? ["chat", "git", "mcp"] : ["chat", "mcp"];
}

export interface GitWorkbenchDataVisibilityInput {
  readonly activeCard: ChatWorkspaceCardId;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly gitAvailable: boolean;
}

export function shouldLoadGitWorkbenchData(input: GitWorkbenchDataVisibilityInput): boolean {
  return input.gitAvailable && (input.activeCard === "git" || input.expandedCard === "git");
}

export interface GitRepositoryInsightsVisibilityInput {
  readonly activeTab: GitWorkbenchTabId;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly gitAvailable: boolean;
}

export function shouldLoadGitRepositoryInsights(
  input: GitRepositoryInsightsVisibilityInput,
): boolean {
  return input.gitAvailable && input.expandedCard === "git" && input.activeTab === "overview";
}

interface BufferedFileEdit {
  readonly baseContent: string;
  readonly baseRevision: string;
  readonly content: string;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly path: string;
  readonly conflict?: boolean;
  readonly createUndoBeforeWrite?: boolean;
  readonly error?: string;
}

const bufferedFileEdits = new Map<string, BufferedFileEdit>();
const deckSelectionByThread = new Map<string, ChatWorkspaceCardId>();
const DECK_SELECTION_LIMIT = 200;

interface ScopedWorkspaceDeckSelection {
  readonly card: ChatWorkspaceCardId;
  readonly scopeKey: string;
}

function rememberDeckSelection(scopeKey: string, card: ChatWorkspaceCardId): void {
  deckSelectionByThread.delete(scopeKey);
  deckSelectionByThread.set(scopeKey, card);
  while (deckSelectionByThread.size > DECK_SELECTION_LIMIT) {
    const oldest = deckSelectionByThread.keys().next().value;
    if (oldest === undefined) break;
    deckSelectionByThread.delete(oldest);
  }
}

export function resolveScopedWorkspaceDeckActiveCard(input: {
  readonly availableCardIds: readonly ChatWorkspaceCardId[];
  readonly currentSelection: ScopedWorkspaceDeckSelection;
  readonly rememberedCard: ChatWorkspaceCardId | null;
  readonly scopeKey: string;
}): ChatWorkspaceCardId {
  const scopedCard =
    input.currentSelection.scopeKey === input.scopeKey
      ? input.currentSelection.card
      : input.rememberedCard;
  return (
    resolveWorkspaceDeckActiveCard({
      activeCard: scopedCard,
      cardIds: input.availableCardIds,
      fallbackCard: "chat",
    }) ?? "chat"
  );
}

export interface GitWorkspaceDeckControllerProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly threadId: ThreadId | null;
  readonly turnId: TurnId | null;
  readonly workbenchSupported: boolean;
  readonly legacyStatus: VcsStatusResult | null;
  readonly legacyStatusPending: boolean;
  readonly actionRequired: boolean;
  readonly activeTurn: boolean;
  readonly isRecording: boolean;
  readonly composerRef: RefObject<ChatComposerHandle | null>;
  readonly mcpAuthorizationAvailable: boolean;
  readonly mcpConfiguredServers: readonly McpServerDefinition[];
  readonly mcpProviderAccentColor?: string;
  readonly mcpProviderDisplayName: string;
  readonly mcpProviderDriver: ProviderDriverKind | null;
  readonly mcpProviderInstanceId: ProviderInstanceId | null;
  readonly mcpProviders: readonly ServerProvider[];
  readonly mcpRuntimeSessionId: RuntimeSessionId | null;
  readonly mcpWorkspaceSupported: boolean;
  readonly renderChat: (controls: GitWorkspaceDeckChatControls) => ReactNode;
  readonly renderGitPeek: (controls: GitWorkspaceDeckGitPeekControls) => ReactNode;
  readonly drawerAvailableHeight?: number;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onNonChatActiveChange: (nonChatActive: boolean) => void;
  readonly onExpandedChange: (expanded: boolean) => void;
}

export interface GitWorkspaceDeckChatControls {
  readonly deckEnabled: boolean;
  readonly gitAvailable: boolean;
}

export interface GitWorkspaceDeckGitPeekControls {
  readonly blocked: boolean;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
  readonly status: GitCompactStatus;
}

function bufferKey(environmentId: EnvironmentId, cwd: string, path: string): string {
  return JSON.stringify([environmentId, cwd, path]);
}

function relativeAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "time unavailable";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function repositoryState(
  snapshot: ContractWorkbenchSnapshot,
): GitWorkbenchSnapshot["repositoryState"] {
  if (!snapshot.isRepository) return "unavailable";
  if (snapshot.operation.conflictingPaths?.length || snapshot.totals.conflicted > 0) {
    return "conflicted";
  }
  if (snapshot.detached) return "detached";
  if (snapshot.unborn) return "unborn";
  return snapshot.files.length === 0 ? "clean" : "changed";
}

function mapSnapshot(
  snapshot: ContractWorkbenchSnapshot,
  legacyStatus: VcsStatusResult | null,
): GitWorkbenchSnapshot {
  const state = repositoryState(snapshot);
  return {
    additions: snapshot.totals.insertions,
    ahead: snapshot.aheadCount,
    behind: snapshot.behindCount,
    branch: snapshot.refName,
    changeCount: snapshot.files.length,
    conflicts: snapshot.totals.conflicted,
    deletions: snapshot.totals.deletions,
    generatedAt: snapshot.generatedAt,
    headOid: snapshot.headOid,
    lastCommit: snapshot.lastCommit
      ? {
          authoredAt: snapshot.lastCommit.committedAt,
          oid: snapshot.lastCommit.oid,
          subject: snapshot.lastCommit.subject,
        }
      : null,
    ...(legacyStatus?.pr
      ? {
          pullRequest: {
            number: legacyStatus.pr.number,
            status: legacyStatus.pr.state,
            title: legacyStatus.pr.title,
            url: legacyStatus.pr.url,
          },
        }
      : {}),
    repositoryState: state,
    staged: snapshot.totals.staged,
    stale: snapshot.truncated,
    stateToken: snapshot.stateToken,
    unstaged: snapshot.totals.unstaged,
    untracked: snapshot.totals.untracked,
    upstream: snapshot.upstreamRef,
    upstreamOid: snapshot.upstreamOid ?? null,
    worktreeRoot: snapshot.worktreeRoot ?? snapshot.registeredCwd,
  };
}

function fallbackCompactStatus(status: VcsStatusResult | null, pending: boolean): GitCompactStatus {
  const changedFiles = status?.workingTree.files.length ?? 0;
  const kind = pending
    ? "stale"
    : status === null
      ? "disconnected"
      : !status.isRepo
        ? "unavailable"
        : status.refName === null
          ? "detached"
          : status.hasWorkingTreeChanges
            ? "changed"
            : "clean";
  return {
    additions: status?.workingTree.insertions ?? 0,
    ahead: status?.aheadCount ?? 0,
    behind: status?.behindCount ?? 0,
    branch: status?.refName ?? null,
    changeCount: changedFiles,
    conflicts: 0,
    deletions: status?.workingTree.deletions ?? 0,
    detailsPending: true,
    kind,
    label:
      kind === "clean"
        ? "Clean"
        : kind === "changed"
          ? "Changed"
          : kind === "stale"
            ? "Refreshing"
            : kind === "detached"
              ? "Detached"
              : "Unavailable",
    staged: 0,
    unstaged: changedFiles,
    untracked: 0,
    updatedAtLabel: pending ? "Refreshing status" : "Compact status",
  };
}

function compactStatus(snapshot: GitWorkbenchSnapshot | null, fallback: GitCompactStatus) {
  if (!snapshot) return fallback;
  const kind = snapshot.stale ? "stale" : snapshot.repositoryState;
  return {
    additions: snapshot.additions ?? 0,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    branch: snapshot.branch,
    changeCount: snapshot.changeCount,
    conflicts: snapshot.conflicts,
    deletions: snapshot.deletions ?? 0,
    detailsPending: false,
    kind,
    label:
      kind === "stale"
        ? "Stale snapshot"
        : kind === "clean"
          ? "Clean"
          : kind === "conflicted"
            ? "Conflicted"
            : kind === "unborn"
              ? "No commits"
              : kind === "detached"
                ? "Detached"
                : kind === "changed"
                  ? "Changed"
                  : "Unavailable",
    staged: snapshot.staged,
    unstaged: snapshot.unstaged,
    untracked: snapshot.untracked,
    updatedAtLabel: `Updated ${relativeAge(snapshot.generatedAt)}`,
  } satisfies GitCompactStatus;
}

function mapInsights(result: GitRepositoryInsightsResult | null): GitRepositoryInsights | null {
  if (!result) return null;
  return {
    activity: result.activity.map((bucket) => ({ count: bucket.commitCount, date: bucket.date })),
    codeMix: result.codeMix.entries.map((entry, index) => ({
      color: CODE_MIX_COLORS[index % CODE_MIX_COLORS.length]!,
      files: entry.fileCount,
      label: entry.language,
      percent: entry.percentage,
    })),
    contributors: result.contributors.map((contributor) => ({
      commits: contributor.commitCount,
      identity: contributor.identityKey,
      name: contributor.displayName,
    })),
    coverage: {
      sampledCommits: result.scannedCommits,
      sampledFiles: result.codeMix.scannedFileCount,
      truncated: result.truncated || result.codeMix.truncated,
    },
  };
}

function mapDiff(result: GitChangesDiffResult): {
  readonly hunks: readonly GitWorkbenchDiffHunk[];
  readonly patchId: string;
  readonly source: "index" | "worktree";
  readonly truncated: boolean;
  readonly conflictVersions?: {
    readonly base: string | null;
    readonly ours: string | null;
    readonly theirs: string | null;
  };
} {
  return {
    hunks: result.hunks.map((hunk) => ({
      header: hunk.header,
      id: hunk.id,
      lines: hunk.lines.map((line) => ({
        content: line.content,
        id: line.id,
        kind: line.type === "no-newline" ? "meta" : line.type,
        newLine: line.newLine ?? null,
        oldLine: line.oldLine ?? null,
        selectable: line.selectable,
      })),
    })),
    patchId: result.patchId,
    source: result.source === "staged" ? "index" : "worktree",
    truncated: result.truncated,
    ...(result.conflictVersions ? { conflictVersions: result.conflictVersions } : {}),
  };
}

function mapChanges(
  snapshot: ContractWorkbenchSnapshot | null,
  diffs: Readonly<Record<string, ReturnType<typeof mapDiff>>>,
): readonly GitWorkbenchChange[] {
  if (!snapshot) return [];
  return snapshot.files.flatMap((file) => {
    const common = {
      binary: file.binary,
      kind: file.kind,
      modeChanged: file.modeChanged,
      path: file.path,
      ...(file.oldPath ? { previousPath: file.oldPath } : {}),
      submodule: file.submodule,
    } as const;
    if (file.conflicted) {
      const id = `${file.path}::conflict`;
      const diff = diffs[id];
      return [
        {
          ...common,
          additions: file.unstagedStats.insertions,
          conflict: "unknown" as const,
          deletions: file.unstagedStats.deletions,
          ...(diff?.conflictVersions ? { conflictVersions: diff.conflictVersions } : {}),
          ...(diff ? { diff } : {}),
          id,
          staged: false,
          unstaged: false,
          untracked: false,
        },
      ];
    }
    const changes: GitWorkbenchChange[] = [];
    if (file.staged) {
      const id = `${file.path}::index`;
      changes.push({
        ...common,
        additions: file.stagedStats.insertions,
        deletions: file.stagedStats.deletions,
        ...(diffs[id] ? { diff: diffs[id] } : {}),
        id,
        staged: true,
        unstaged: false,
        untracked: false,
      });
    }
    if (file.unstaged || file.untracked) {
      const id = `${file.path}::worktree`;
      changes.push({
        ...common,
        additions: file.unstagedStats.insertions,
        deletions: file.unstagedStats.deletions,
        ...(diffs[id] ? { diff: diffs[id] } : {}),
        id,
        staged: false,
        unstaged: file.unstaged && !file.untracked,
        untracked: file.untracked,
      });
    }
    return changes;
  });
}

function mapCommitDetail(
  detail: GitCommitDetailResult | null,
  patches: Readonly<Record<string, GitCommitFileDiffResult>>,
): GitCommitDetail | null {
  if (!detail) return null;
  return {
    author: detail.authorName,
    authoredAt: detail.authoredAt,
    body: detail.body,
    committedAt: detail.committedAt,
    committer: detail.committerName,
    files: detail.files.map((file) => {
      const patch = patches[`${detail.oid}:${file.path}`];
      return {
        additions: file.additions ?? 0,
        binary: file.binary,
        deletions: file.deletions ?? 0,
        kind: file.status,
        path: file.path,
        ...(file.oldPath ? { previousPath: file.oldPath } : {}),
        ...(patch ? { unifiedDiff: patch.patch, truncated: patch.truncated } : {}),
      };
    }),
    oid: detail.oid,
    parents: detail.parents,
    subject: detail.subject,
  };
}

function mapQueue(queue: ContractQueuedWorkflow | null): GitQueuedWorkflow | null {
  if (!queue || queue.status === "completed" || queue.status === "cancelled") return null;
  return {
    id: queue.id,
    label:
      queue.plan.kind === "delivery"
        ? `${queue.plan.stage.mode === "all" ? "Stage all, " : "Use staged files, "}commit${queue.plan.push ? ", push" : ""}${queue.plan.createPullRequest ? ", create PR" : ""}`
        : queue.plan.action.kind.replaceAll("_", " "),
    ...(queue.lastError ? { lastError: queue.lastError } : {}),
    plan: queue.plan,
    revision: queue.revision,
    staleReasons: queue.needsReviewReasons.map((reason) => reason.message),
    status:
      queue.status === "needs_review"
        ? "needs-review"
        : queue.status === "waiting_for_turn" || queue.status === "ready"
          ? "waiting-for-turn"
          : queue.status,
  };
}

function mapUndo(snapshot: ContractUndoSnapshot): GitUndoSnapshot {
  return {
    createdAt: snapshot.createdAt,
    id: snapshot.id,
    label: snapshot.reason.replaceAll("_", " "),
    refName: snapshot.headRef,
  };
}

function mapOperation(snapshot: ContractWorkbenchSnapshot | null): GitOperationState | null {
  if (!snapshot) return null;
  const operation = snapshot.operation;
  if (
    operation.kind !== "rebase" &&
    operation.kind !== "merge" &&
    operation.kind !== "cherry-pick" &&
    operation.kind !== "revert"
  ) {
    return null;
  }
  const conflicts = operation.conflictingPaths ?? [];
  return {
    canAbort: true,
    canContinue: conflicts.length === 0,
    canSkip: operation.kind !== "merge",
    conflicts,
    detail:
      operation.currentStep && operation.totalSteps
        ? `Step ${operation.currentStep} of ${operation.totalSteps}`
        : "Repository operation is paused.",
    kind: operation.kind,
    startedAt: snapshot.generatedAt,
  };
}

function mapRebaseNode(node: GitWorkbenchRebaseNode): GitRebaseTodoNode | null {
  if (node.kind === "label") return { kind: "label", name: node.label };
  if (node.kind === "reset") return { kind: "reset", label: node.label };
  if (node.kind === "merge") {
    const label = node.labels.length === 1 ? node.labels[0] : undefined;
    return label
      ? {
          kind: "merge",
          label,
          originalOid: node.commitId,
          messageMode: "reuse",
        }
      : null;
  }
  if (node.kind === "reword") {
    const message = node.message?.trim();
    return {
      kind: "reword",
      oid: node.commitId,
      ...(message ? { message } : {}),
    };
  }
  return { kind: node.kind, oid: node.commitId };
}

function mapInteractiveRebasePlan(
  items: readonly GitInteractiveRebasePlanItem[],
): readonly GitWorkbenchRebaseNode[] {
  return items.map((item, index) => {
    const node = item.node;
    const id = `${index}:${node.kind}`;
    if (node.kind === "label") return { id, kind: "label", label: node.name };
    if (node.kind === "reset") return { id, kind: "reset", label: node.label };
    if (node.kind === "merge") {
      return {
        commitId: node.originalOid,
        ...(item.parents ? { dependencies: item.parents } : {}),
        id,
        kind: "merge",
        labels: [node.label],
        subject: item.subject ?? "Merge commit",
      };
    }
    return {
      commitId: node.oid,
      ...(item.parents ? { dependencies: item.parents } : {}),
      id,
      kind: node.kind,
      subject: item.subject ?? "(no subject)",
    };
  });
}

function actionForOperation(
  input: GitWorkbenchOperationInput,
  operation: GitOperationState | null,
): GitWorkbenchOperationAction | null {
  if (input.kind === "create-pull-request" || input.kind === "pull" || input.kind === "push") {
    return null;
  }
  if (input.kind === "commit-staged" || input.kind === "stage-all-and-commit") return null;
  if (input.kind === "cherry-pick") return { kind: "cherry_pick", commitOid: input.commitOid };
  if (input.kind === "revert") return { kind: "revert", commitOid: input.commitOid };
  if (input.kind === "guided-rebase") return { kind: "guided_rebase", ontoRef: input.branch };
  if (input.kind === "reset") {
    return { kind: "reset", mode: input.mode, targetOid: input.oid };
  }
  if (input.kind === "force-with-lease") {
    const separator = input.remoteRef.indexOf("/");
    return {
      branch: separator < 0 ? input.remoteRef : input.remoteRef.slice(separator + 1),
      expectedRemoteOid: input.expectedRemoteOid,
      kind: "force_with_lease",
      remote: separator < 0 ? "origin" : input.remoteRef.slice(0, separator),
    };
  }
  if (input.kind === "start-interactive-rebase") {
    const plan = input.nodes.map(mapRebaseNode);
    if (plan.some((node) => node === null) || plan.length === 0) return null;
    const firstCommit = input.nodes.find(
      (node): node is Extract<GitWorkbenchRebaseNode, { commitId: string }> => "commitId" in node,
    );
    if (!firstCommit) return null;
    return {
      kind: "interactive_rebase",
      plan: plan as GitRebaseTodoNode[],
      upstreamRef: input.upstreamRef,
    };
  }
  if (!operation) return null;
  if (input.kind === "skip") {
    return operation.kind === "merge" ? null : { kind: "skip", operation: operation.kind };
  }
  return input.kind === "continue"
    ? { kind: "continue", operation: operation.kind }
    : { kind: "abort", operation: operation.kind };
}

function directIntent(input: GitWorkbenchOperationInput) {
  if (input.kind === "commit-staged") return "commit-staged" as const;
  if (input.kind === "stage-all-and-commit") return "stage-all-and-commit" as const;
  if (input.kind === "create-pull-request") return "create-pull-request" as const;
  if (input.kind === "pull") return "pull" as const;
  if (input.kind === "push") return "push" as const;
  return null;
}

export function ChatWorkspaceDeckController(props: GitWorkspaceDeckControllerProps) {
  const isDesktop = useMediaQuery(DESKTOP_WORKBENCH_MEDIA_QUERY);
  const scopeKey = `${props.environmentId}:${props.cwd ?? ""}:${props.threadId ?? ""}`;
  const availableCardIds = useMemo(
    () =>
      resolveGitDeckCardIds({
        cwd: props.cwd,
        isRepository: props.legacyStatus?.isRepo ?? null,
        workbenchSupported: props.workbenchSupported,
      }),
    [props.cwd, props.legacyStatus?.isRepo, props.workbenchSupported],
  );
  const gitAvailable = isDesktop && availableCardIds.includes("git");
  const deckResetKey = scopeKey;
  const [currentSelection, setCurrentSelection] = useState<ScopedWorkspaceDeckSelection>(() => ({
    card: deckSelectionByThread.get(scopeKey) ?? "chat",
    scopeKey,
  }));
  const resolvedActiveCard = resolveScopedWorkspaceDeckActiveCard({
    availableCardIds,
    currentSelection,
    rememberedCard: deckSelectionByThread.get(scopeKey) ?? null,
    scopeKey,
  });
  const [expandedCard, setExpandedCard] = useState<ChatWorkspaceCardId | null>(null);
  const gitExpanded = expandedCard === "git";
  const mcpExpanded = expandedCard === "mcp";
  const [activeTab, setActiveTab] = useState<GitWorkbenchTabId>("overview");
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Readonly<Record<string, ReturnType<typeof mapDiff>>>>({});
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<GitCurrentFileState | null>(null);
  const [bufferFlushQueue, setBufferFlushQueue] = useState<readonly string[]>([]);
  const [historyPath, setHistoryPath] = useState("");
  const [historyRefName, setHistoryRefName] = useState("");
  const [historyCursor, setHistoryCursor] = useState(0);
  const [historySnapshotOid, setHistorySnapshotOid] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<readonly GitHistoryItem[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<number | null>(null);
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null);
  const [commitPatches, setCommitPatches] = useState<
    Readonly<Record<string, GitCommitFileDiffResult>>
  >({});
  const [commitPatchTarget, setCommitPatchTarget] = useState<{
    readonly oid: string;
    readonly path: string;
  } | null>(null);
  const [rebasePlan, setRebasePlan] = useState<readonly GitWorkbenchRebaseNode[]>([]);
  const [rebasePlanTarget, setRebasePlanTarget] = useState<string | null>(null);
  const [rebaseUpstreamRef, setRebaseUpstreamRef] = useState<string | null>(null);
  const previousActiveTurnRef = useRef(props.activeTurn);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const flushingBufferKeyRef = useRef<string | null>(null);
  const confirmBufferedNavigation = useCallback(async () => {
    if (bufferedFileEdits.size === 0) return false;
    const leave = await ensureLocalApi().dialogs.confirm(
      "You have Git workbench edits waiting for the active agent turn to settle. Leave this view? The edits will stay in memory for this session.",
    );
    return !leave;
  }, []);
  useBlocker({
    shouldBlockFn: confirmBufferedNavigation,
    enableBeforeUnload: () => bufferedFileEdits.size > 0,
  });
  const selectCard = useCallback(
    (card: ChatWorkspaceCardId) => {
      rememberDeckSelection(scopeKey, card);
      setCurrentSelection({ card, scopeKey });
    },
    [scopeKey],
  );

  const wantsWorkbenchData = shouldLoadGitWorkbenchData({
    activeCard: resolvedActiveCard,
    expandedCard,
    gitAvailable,
  });
  const workbenchQuery = useEnvironmentQuery(
    wantsWorkbenchData && props.cwd
      ? gitWorkbenchEnvironment.workbench({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const projection = workbenchQuery.data;
  const contractSnapshot = projection?.snapshot ?? null;
  const snapshot = useMemo(
    () => (contractSnapshot ? mapSnapshot(contractSnapshot, props.legacyStatus) : null),
    [contractSnapshot, props.legacyStatus],
  );
  const insightsQuery = useEnvironmentQuery(
    shouldLoadGitRepositoryInsights({ activeTab, expandedCard, gitAvailable }) && props.cwd
      ? gitWorkbenchEnvironment.insights({
          environmentId: props.environmentId,
          input: { cwd: props.cwd },
        })
      : null,
  );
  const insights = useMemo(() => mapInsights(insightsQuery.data), [insightsQuery.data]);

  const changes = useMemo(() => mapChanges(contractSnapshot, diffs), [contractSnapshot, diffs]);
  const selectedChange = changes.find((candidate) => candidate.id === selectedChangeId) ?? null;
  const changesDiffQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && activeTab === "changes" && props.cwd && selectedChange
      ? gitWorkbenchEnvironment.changesDiff({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            ...(contractSnapshot?.stateToken
              ? { expectedStateToken: contractSnapshot.stateToken }
              : {}),
            path: selectedChange.path,
            source: selectedChange.id.endsWith("::index") ? "staged" : "unstaged",
          },
        })
      : null,
  );

  const fileQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && props.cwd && selectedFilePath
      ? projectEnvironment.readFile({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, relativePath: selectedFilePath },
        })
      : null,
  );
  const flushBufferedPath = bufferFlushQueue[0] ?? null;
  const bufferedFileQuery = useEnvironmentQuery(
    isDesktop && !props.activeTurn && props.cwd && flushBufferedPath
      ? projectEnvironment.readFile({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, relativePath: flushBufferedPath },
        })
      : null,
  );

  const historyQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && activeTab === "history" && props.cwd
      ? gitWorkbenchEnvironment.history({
          environmentId: props.environmentId,
          input: {
            cwd: props.cwd,
            cursor: historyCursor,
            limit: 50,
            ...(historyRefName.trim() && historyCursor === 0
              ? { refName: historyRefName.trim() }
              : {}),
            ...(historyPath.trim() ? { path: historyPath.trim() } : {}),
            ...(historySnapshotOid ? { snapshotOid: historySnapshotOid } : {}),
          },
        })
      : null,
  );
  const commitDetailQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && selectedCommitOid && props.cwd
      ? gitWorkbenchEnvironment.commitDetail({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, oid: selectedCommitOid },
        })
      : null,
  );
  const commitPatchQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && commitPatchTarget && props.cwd
      ? gitWorkbenchEnvironment.commitFileDiff({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, oid: commitPatchTarget.oid, path: commitPatchTarget.path },
        })
      : null,
  );
  const refsQuery = useEnvironmentQuery(
    wantsWorkbenchData &&
      gitExpanded &&
      (activeTab === "branches" || activeTab === "history") &&
      props.cwd
      ? vcsEnvironment.listRefs({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, limit: 100, refKind: "all" },
        })
      : null,
  );
  const interactiveRebasePlanQuery = useEnvironmentQuery(
    wantsWorkbenchData && gitExpanded && props.cwd && rebasePlanTarget
      ? gitWorkbenchEnvironment.interactiveRebasePlan({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, upstreamRef: rebasePlanTarget },
        })
      : null,
  );

  const applySelection = useAtomCommand(gitWorkbenchEnvironment.applyChangeSelection, {
    reportFailure: false,
  });
  const runOperation = useAtomCommand(gitWorkbenchEnvironment.runOperation, {
    reportFailure: false,
  });
  const restoreUndo = useAtomCommand(gitWorkbenchEnvironment.restoreUndoSnapshot, {
    reportFailure: false,
  });
  const createUndo = useAtomCommand(gitWorkbenchEnvironment.createUndoSnapshot, {
    reportFailure: false,
  });
  const refreshWorkbench = useAtomCommand(gitWorkbenchEnvironment.refresh, {
    reportFailure: false,
  });
  const upsertQueue = useAtomCommand(gitWorkbenchEnvironment.upsertQueuedWorkflow, {
    reportFailure: false,
  });
  const cancelQueue = useAtomCommand(gitWorkbenchEnvironment.cancelQueuedWorkflow, {
    reportFailure: false,
  });
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const operationProgress = useAtomValue(
    gitWorkbenchEnvironment.operationProgress({
      environmentId: props.environmentId,
      cwd: props.cwd ?? "",
    }),
  );

  useEffect(() => {
    previousActiveTurnRef.current = props.activeTurn;
    setCurrentSelection({ card: deckSelectionByThread.get(scopeKey) ?? "chat", scopeKey });
    setExpandedCard(null);
    setActiveTab("overview");
    setSelectedChangeId(null);
    setSelectedFilePath(null);
    setCurrentFile(null);
    setBufferFlushQueue(
      !props.activeTurn && props.cwd
        ? selectBufferedPathsForScope(bufferedFileEdits.values(), props.environmentId, props.cwd)
        : [],
    );
    flushingBufferKeyRef.current = null;
    setDiffs({});
    setHistoryPath("");
    setHistoryRefName("");
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
    setCommitPatches({});
    setRebasePlan([]);
    setRebasePlanTarget(null);
    setRebaseUpstreamRef(null);
  }, [scopeKey]);

  useEffect(() => {
    const rememberedCard = deckSelectionByThread.get(scopeKey) ?? "chat";
    const nextCard =
      resolveWorkspaceDeckActiveCard({
        activeCard: rememberedCard,
        cardIds: availableCardIds,
        fallbackCard: "chat",
      }) ?? "chat";
    if (nextCard !== rememberedCard) rememberDeckSelection(scopeKey, nextCard);
    setCurrentSelection({ card: nextCard, scopeKey });
    if (expandedCard !== null && !availableCardIds.includes(expandedCard)) {
      setExpandedCard(null);
    }
  }, [availableCardIds, expandedCard, scopeKey]);

  useEffect(() => {
    props.onNonChatActiveChange(isDesktop && resolvedActiveCard !== "chat");
  }, [isDesktop, props.onNonChatActiveChange, resolvedActiveCard]);
  useEffect(() => {
    props.onExpandedChange(isDesktop && expandedCard !== null);
  }, [expandedCard, isDesktop, props.onExpandedChange]);
  useEffect(
    () => () => {
      props.onNonChatActiveChange(false);
      props.onExpandedChange(false);
    },
    [props.onExpandedChange, props.onNonChatActiveChange],
  );

  useEffect(() => {
    const result = changesDiffQuery.data;
    if (!result || !selectedChange || result.path !== selectedChange.path) return;
    const expectedSource = selectedChange.id.endsWith("::index") ? "staged" : "unstaged";
    if (result.source !== expectedSource || result.stateToken !== contractSnapshot?.stateToken)
      return;
    setDiffs((current) => ({ ...current, [selectedChange.id]: mapDiff(result) }));
  }, [changesDiffQuery.data, contractSnapshot?.stateToken, selectedChange]);

  useEffect(() => {
    const data = fileQuery.data;
    if (!data || !props.cwd || data.relativePath !== selectedFilePath) return;
    const key = bufferKey(props.environmentId, props.cwd, data.relativePath);
    const buffered = bufferedFileEdits.get(key);
    if (buffered?.conflict) {
      setCurrentFile({
        baseContent: buffered.baseContent,
        content: buffered.content,
        ...(buffered.error ? { error: buffered.error } : {}),
        loading: false,
        path: data.relativePath,
        revision: data.revision ?? buffered.baseRevision,
        saveState: "conflict",
        serverContent: data.contents,
      });
      return;
    }
    setCurrentFile({
      baseContent: buffered?.baseContent ?? data.contents,
      content: buffered?.content ?? data.contents,
      ...(buffered?.error ? { error: buffered.error } : {}),
      loading: false,
      path: data.relativePath,
      ...(data.truncated ? { readOnlyReason: "Files over the preview limit are read-only" } : {}),
      revision: buffered?.baseRevision ?? data.revision ?? "legacy-no-revision",
      saveState: buffered ? "buffered" : "idle",
    });
  }, [fileQuery.data, props.cwd, props.environmentId, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath || !fileQuery.error || fileQuery.data) return;
    setCurrentFile({
      baseContent: "",
      content: "",
      loading: false,
      path: selectedFilePath,
      readOnlyReason: fileQuery.error,
      revision: "unavailable",
      saveState: "idle",
    });
  }, [fileQuery.data, fileQuery.error, selectedFilePath]);

  useEffect(() => {
    const wasActive = previousActiveTurnRef.current;
    previousActiveTurnRef.current = props.activeTurn;
    if (!wasActive || props.activeTurn || !props.cwd) return;
    setBufferFlushQueue(
      selectBufferedPathsForScope(bufferedFileEdits.values(), props.environmentId, props.cwd),
    );
  }, [props.activeTurn, props.cwd, props.environmentId]);

  useEffect(() => {
    const path = bufferFlushQueue[0];
    const data = bufferedFileQuery.data;
    if (!path || !data || !props.cwd || data.relativePath !== path) return;
    const key = bufferKey(props.environmentId, props.cwd, path);
    const buffered = bufferedFileEdits.get(key);
    const dequeue = () => {
      flushingBufferKeyRef.current = null;
      setBufferFlushQueue((current) => (current[0] === path ? current.slice(1) : current));
    };
    if (!buffered) {
      dequeue();
      return;
    }
    if (bufferedRevisionDisposition(buffered.baseRevision, data.revision) === "conflict") {
      const conflicted = { ...buffered, conflict: true };
      bufferedFileEdits.set(key, conflicted);
      if (selectedFilePath === path) {
        setCurrentFile({
          baseContent: buffered.baseContent,
          content: buffered.content,
          loading: false,
          path,
          revision: data.revision ?? buffered.baseRevision,
          saveState: "conflict",
          serverContent: data.contents,
        });
      }
      dequeue();
      return;
    }
    if (flushingBufferKeyRef.current === key) return;
    flushingBufferKeyRef.current = key;
    void (async () => {
      if (buffered.createUndoBeforeWrite) {
        const refreshed = await refreshWorkbench({
          environmentId: props.environmentId,
          input: { cwd: props.cwd! },
        });
        if (refreshed._tag !== "Success") {
          const failure = isAtomCommandInterrupted(refreshed)
            ? null
            : squashAtomCommandFailure(refreshed);
          if (failure && bufferedFileEdits.get(key) === buffered) {
            bufferedFileEdits.set(key, {
              ...buffered,
              error:
                failure instanceof Error
                  ? failure.message
                  : "Could not create an undo snapshot before saving.",
            });
          }
          dequeue();
          return;
        }
        const captured = await createUndo({
          environmentId: props.environmentId,
          input: { cwd: props.cwd!, expectedStateToken: refreshed.value.stateToken },
        });
        if (captured._tag !== "Success") {
          const failure = isAtomCommandInterrupted(captured)
            ? null
            : squashAtomCommandFailure(captured);
          if (failure && bufferedFileEdits.get(key) === buffered) {
            bufferedFileEdits.set(key, {
              ...buffered,
              error:
                failure instanceof Error
                  ? failure.message
                  : "Could not create an undo snapshot before saving.",
            });
          }
          dequeue();
          return;
        }
      }
      const result = await writeFile({
        environmentId: props.environmentId,
        input: {
          contents: buffered.content,
          cwd: props.cwd!,
          expectedRevision: buffered.baseRevision,
          relativePath: path,
        },
      });
      if (result._tag === "Success") {
        if (bufferedFileEdits.get(key) === buffered) bufferedFileEdits.delete(key);
        if (selectedFilePath === path) {
          setCurrentFile((current) =>
            current ? { ...current, content: buffered.content, saveState: "saved" } : current,
          );
          fileQuery.refresh();
        }
        void refreshVcsStatus({
          environmentId: props.environmentId,
          input: { cwd: props.cwd! },
        });
        workbenchQuery.refresh();
        dequeue();
        return;
      }
      if (isAtomCommandInterrupted(result)) {
        dequeue();
        return;
      }
      const failure = squashAtomCommandFailure(result);
      const conflict =
        typeof failure === "object" &&
        failure !== null &&
        "_tag" in failure &&
        failure._tag === "ProjectWriteConflictError";
      if (bufferedFileEdits.get(key) === buffered) {
        bufferedFileEdits.set(key, {
          ...buffered,
          ...(conflict ? { conflict: true } : {}),
          error: failure instanceof Error ? failure.message : "Buffered file save failed.",
        });
      }
      if (selectedFilePath === path) {
        setCurrentFile((current) =>
          current
            ? {
                ...current,
                error: failure instanceof Error ? failure.message : "Buffered file save failed.",
                saveState: conflict ? "conflict" : "buffered",
              }
            : current,
        );
        fileQuery.refresh();
      }
      dequeue();
    })();
  }, [
    bufferFlushQueue,
    bufferedFileQuery.data,
    createUndo,
    fileQuery.refresh,
    props.cwd,
    props.environmentId,
    refreshVcsStatus,
    refreshWorkbench,
    selectedFilePath,
    workbenchQuery.refresh,
    writeFile,
  ]);

  useEffect(() => {
    const page = historyQuery.data;
    if (!page) return;
    if (historyCursor === 0) {
      setHistoryItems(page.items);
      setHistorySnapshotOid(page.snapshotOid);
    } else if (page.snapshotOid === historySnapshotOid) {
      setHistoryItems((current) => {
        const seen = new Set(current.map((item) => item.oid));
        return [...current, ...page.items.filter((item) => !seen.has(item.oid))];
      });
    }
    setHistoryNextCursor(page.nextCursor);
  }, [historyCursor, historyQuery.data, historySnapshotOid]);

  useEffect(() => {
    const patch = commitPatchQuery.data;
    if (!patch || !commitPatchTarget) return;
    if (patch.oid !== commitPatchTarget.oid || patch.path !== commitPatchTarget.path) return;
    setCommitPatches((current) => ({ ...current, [`${patch.oid}:${patch.path}`]: patch }));
  }, [commitPatchQuery.data, commitPatchTarget]);

  useEffect(() => {
    const prepared = interactiveRebasePlanQuery.data;
    if (!prepared || prepared.upstreamRef !== rebasePlanTarget) return;
    setRebasePlan(mapInteractiveRebasePlan(prepared.items));
    setRebaseUpstreamRef(prepared.upstreamOid);
    setRebasePlanTarget(null);
    setActiveTab("operations");
  }, [interactiveRebasePlanQuery.data, rebasePlanTarget]);

  const resetHistory = useCallback((path: string) => {
    setHistoryPath(path);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  }, []);

  const resetHistoryRef = useCallback((refName: string) => {
    setHistoryRefName(refName);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  }, []);

  const applyChangeSelection = useCallback<GitWorkbenchPanelProps["onApplySelection"]>(
    (input) => {
      if (!props.cwd || !input.expectedPatchId) return;
      const change = changes.find((candidate) => candidate.id === input.changeId);
      if (!change) return;
      void (async () => {
        const result = await applySelection({
          environmentId: props.environmentId,
          input: {
            action: input.action,
            ...(input.action === "discard" && change.untracked
              ? { confirmedUntrackedDeletion: true }
              : {}),
            cwd: props.cwd!,
            expectedPatchId: input.expectedPatchId!,
            expectedStateToken: input.expectedStateToken,
            path: input.path,
            selection:
              input.lineIds.length > 0
                ? { ids: input.lineIds, kind: "lines" as const }
                : input.hunkIds.length > 0
                  ? { ids: input.hunkIds, kind: "hunks" as const }
                  : { kind: "file" as const },
            source: input.source === "index" ? "staged" : "unstaged",
          },
        });
        if (result._tag === "Success") {
          setDiffs((current) => {
            const next = { ...current };
            delete next[input.changeId];
            return next;
          });
          changesDiffQuery.refresh();
          return;
        }
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "GitWorkbenchStaleStateError"
        ) {
          setDiffs((current) => {
            const existing = current[input.changeId];
            return existing
              ? { ...current, [input.changeId]: { ...existing, stale: true } }
              : current;
          });
          changesDiffQuery.refresh();
        }
      })();
    },
    [applySelection, changes, changesDiffQuery.refresh, props.cwd, props.environmentId],
  );

  const runWorkbenchOperation = useCallback<GitWorkbenchPanelProps["onRunOperation"]>(
    (input) => {
      if (!props.cwd || !snapshot) return;
      const intent = directIntent(input);
      if (intent) {
        requestGitActionsControl({
          cwd: props.cwd,
          environmentId: props.environmentId,
          intent,
        });
        return;
      }
      const action = actionForOperation(input, mapOperation(contractSnapshot));
      if (!action) {
        toastManager.add({
          type: "info",
          title: "This operation needs a refreshed Git plan.",
        });
        return;
      }
      void runOperation({
        environmentId: props.environmentId,
        input: { action, cwd: props.cwd, expectedStateToken: snapshot.stateToken },
      });
    },
    [contractSnapshot, props.cwd, props.environmentId, runOperation, snapshot],
  );

  const queueWorkflow = useCallback<GitWorkbenchPanelProps["onQueueWorkflow"]>(
    (input) => {
      if (!props.cwd || !snapshot) return;
      const advanced = actionForOperation(input, mapOperation(contractSnapshot));
      const plan = (() => {
        if (input.kind === "stage-all-and-commit") {
          return {
            createPullRequest: false,
            kind: "delivery" as const,
            push: false,
            stage: { mode: "all" as const },
          };
        }
        if (input.kind === "push" || input.kind === "create-pull-request") {
          return {
            createPullRequest: input.kind === "create-pull-request",
            kind: "delivery" as const,
            push: true,
            stage: { mode: "staged" as const },
          };
        }
        if (
          advanced &&
          (advanced.kind === "reset" ||
            advanced.kind === "revert" ||
            advanced.kind === "cherry_pick" ||
            advanced.kind === "guided_rebase" ||
            advanced.kind === "interactive_rebase")
        ) {
          return { action: advanced, kind: "advanced_operation" as const };
        }
        return null;
      })();
      if (!plan) return;
      const existing = projection?.queuedWorkflow ?? null;
      void upsertQueue({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          ...(existing
            ? {
                expectedRevision: existing.revision,
                replaceExisting: true,
                workflowId: existing.id,
              }
            : {}),
          expectedStateToken: snapshot.stateToken,
          plan,
          ...(props.threadId ? { threadId: props.threadId } : {}),
          ...(props.turnId ? { turnId: props.turnId } : {}),
        },
      });
    },
    [
      contractSnapshot,
      projection?.queuedWorkflow,
      props.cwd,
      props.environmentId,
      props.threadId,
      props.turnId,
      snapshot,
      upsertQueue,
    ],
  );

  const resubmitQueuedWorkflow = useCallback(
    (queueId: string, plan: GitQueuedWorkflowPlan) => {
      const existing = projection?.queuedWorkflow;
      if (!props.cwd || !snapshot || !existing?.threadId || existing.id !== queueId) return;
      void upsertQueue({
        environmentId: props.environmentId,
        input: {
          cwd: props.cwd,
          expectedRevision: existing.revision,
          expectedStateToken: snapshot.stateToken,
          plan,
          replaceExisting: true,
          threadId: existing.threadId,
          ...(existing.turnId ? { turnId: existing.turnId } : {}),
          workflowId: existing.id,
        },
      });
    },
    [projection?.queuedWorkflow, props.cwd, props.environmentId, snapshot, upsertQueue],
  );

  const saveCurrentFile = useCallback<GitWorkbenchPanelProps["onSaveCurrentFile"]>(
    (input) => {
      if (!props.cwd || !currentFile) return;
      const key = bufferKey(props.environmentId, props.cwd, input.path);
      if (input.resolution === "agent") {
        bufferedFileEdits.delete(key);
        setCurrentFile((current) => {
          if (!current) return current;
          const { serverContent, ...rest } = current;
          const content = serverContent ?? current.content;
          return { ...rest, baseContent: content, content, saveState: "idle" };
        });
        return;
      }
      if (props.activeTurn) {
        bufferedFileEdits.set(key, {
          baseContent: currentFile.baseContent,
          baseRevision: input.expectedRevision,
          content: input.content,
          ...(input.resolution === "mine" ? { createUndoBeforeWrite: true } : {}),
          cwd: props.cwd,
          environmentId: props.environmentId,
          path: input.path,
        });
        setCurrentFile({ ...currentFile, content: input.content, saveState: "buffered" });
        return;
      }
      setCurrentFile((current) => (current ? { ...current, saveState: "saving" } : current));
      void (async () => {
        if (input.resolution === "mine") {
          if (!snapshot) return;
          const captured = await createUndo({
            environmentId: props.environmentId,
            input: {
              cwd: props.cwd!,
              expectedStateToken: snapshot.stateToken,
            },
          });
          if (captured._tag !== "Success") {
            if (!isAtomCommandInterrupted(captured)) {
              toastManager.add({
                type: "error",
                title: "Could not create an undo snapshot",
                description: "The file was not overwritten.",
              });
            }
            setCurrentFile((current) =>
              current ? { ...current, saveState: "conflict" } : current,
            );
            return;
          }
        }
        const result = await writeFile({
          environmentId: props.environmentId,
          input: {
            contents: input.content,
            cwd: props.cwd!,
            expectedRevision: input.expectedRevision,
            relativePath: input.path,
          },
        });
        if (result._tag === "Success") {
          bufferedFileEdits.delete(key);
          setCurrentFile((current) =>
            current ? { ...current, content: input.content, saveState: "saved" } : current,
          );
          fileQuery.refresh();
          void refreshVcsStatus({
            environmentId: props.environmentId,
            input: { cwd: props.cwd! },
          });
          workbenchQuery.refresh();
          return;
        }
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        const conflict =
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "ProjectWriteConflictError";
        if (conflict) {
          bufferedFileEdits.set(key, {
            baseContent: currentFile.baseContent,
            baseRevision: input.expectedRevision,
            conflict: true,
            content: input.content,
            cwd: props.cwd!,
            environmentId: props.environmentId,
            error: error instanceof Error ? error.message : "File changed before it was saved.",
            path: input.path,
          });
        }
        setCurrentFile((current) =>
          current
            ? {
                ...current,
                error: error instanceof Error ? error.message : "File save failed.",
                saveState: conflict ? "conflict" : "idle",
              }
            : current,
        );
        fileQuery.refresh();
      })();
    },
    [
      currentFile,
      createUndo,
      fileQuery.refresh,
      props.activeTurn,
      props.cwd,
      props.environmentId,
      refreshVcsStatus,
      snapshot,
      workbenchQuery.refresh,
      writeFile,
    ],
  );

  const queue = mapQueue(projection?.queuedWorkflow ?? null);
  const operation = mapOperation(contractSnapshot);
  const undoSnapshots = (projection?.undoSnapshots ?? []).map(mapUndo);
  const sessionAccessQuery = useEnvironmentQuery(
    wantsWorkbenchData
      ? gitWorkbenchEnvironment.sessionAccess({
          environmentId: props.environmentId,
          input: {},
        })
      : null,
  );
  const readOnly =
    sessionAccessQuery.data?.scopes !== undefined &&
    !sessionAccessQuery.data.scopes.includes("orchestration:operate");
  const branches: readonly GitBranch[] =
    refsQuery.data?.refs.map((ref) => ({
      current: ref.current,
      name: ref.name,
      oid: ref.current ? (contractSnapshot?.headOid ?? null) : null,
      remote: ref.isRemote ?? false,
    })) ?? [];
  const history: GitHistoryState = {
    ...EMPTY_HISTORY,
    commits: historyItems.map((commit) => ({
      author: commit.authorName,
      authoredAt: commit.authoredAt,
      decorations: commit.decorations,
      oid: commit.oid,
      parents: commit.parents,
      subject: commit.subject,
    })),
    ...(historyQuery.error ? { error: historyQuery.error } : {}),
    hasMore: historyNextCursor !== null,
    loading: historyQuery.isPending,
    snapshotOid: historySnapshotOid,
  };
  const selectedCommit = mapCommitDetail(commitDetailQuery.data, commitPatches);
  const fallbackStatus = fallbackCompactStatus(props.legacyStatus, props.legacyStatusPending);
  const status = compactStatus(snapshot, fallbackStatus);
  const compactQuickAction = (() => {
    if (status.conflicts > 0) {
      return {
        label: "Resolve conflicts",
        onSelect: () => {
          selectCard("git");
          setActiveTab("changes");
          setExpandedCard("git");
        },
      };
    }
    const intent =
      status.staged > 0
        ? "commit-staged"
        : status.unstaged + status.untracked > 0
          ? "stage-all-and-commit"
          : status.behind > 0
            ? "pull"
            : status.ahead > 0
              ? "push"
              : null;
    return intent
      ? {
          label:
            intent === "commit-staged"
              ? "Commit staged"
              : intent === "stage-all-and-commit"
                ? "Stage all & commit"
                : intent === "pull"
                  ? "Pull"
                  : "Push",
          onSelect: () =>
            props.cwd &&
            requestGitActionsControl({
              cwd: props.cwd,
              environmentId: props.environmentId,
              intent,
            }),
        }
      : null;
  })();

  const openCurrentFileInWorkbench = useCallback((path: string) => {
    setSelectedFilePath(path);
    setCurrentFile({
      baseContent: "",
      content: "",
      loading: true,
      path,
      revision: "loading",
      saveState: "idle",
    });
    setActiveTab("changes");
  }, []);

  const selectChange = useCallback(
    (changeId: string | null) => {
      setSelectedChangeId(changeId);
      const change = changes.find((candidate) => candidate.id === changeId);
      if (change) openCurrentFileInWorkbench(change.path);
    },
    [changes, openCurrentFileInWorkbench],
  );

  const panel = (
    <GitWorkbenchPanel
      activeTab={activeTab}
      branches={branches}
      changes={changes}
      currentFile={currentFile}
      forcePushTarget={
        operationProgress.status === "completed" &&
        (operationProgress.actionKind === "guided_rebase" ||
          operationProgress.actionKind === "interactive_rebase" ||
          operationProgress.actionKind === "reset") &&
        contractSnapshot?.upstreamRef &&
        contractSnapshot.upstreamOid
          ? {
              expectedRemoteOid: contractSnapshot.upstreamOid,
              remoteRef: contractSnapshot.upstreamRef,
            }
          : undefined
      }
      history={history}
      historyPathFilter={historyPath}
      historyRefFilter={historyRefName}
      insights={insights}
      loading={workbenchQuery.isPending}
      onApplySelection={applyChangeSelection}
      onCancelQueue={(queueId) => {
        const existing = projection?.queuedWorkflow;
        if (!props.cwd || !existing || existing.id !== queueId) return;
        void cancelQueue({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, expectedRevision: existing.revision, workflowId: queueId },
        });
      }}
      onChangeTab={setActiveTab}
      onCreateBranch={(name) => {
        if (!props.cwd || !snapshot) return;
        void runOperation({
          environmentId: props.environmentId,
          input: {
            action: { kind: "create_branch", name },
            cwd: props.cwd,
            expectedStateToken: snapshot.stateToken,
          },
        });
      }}
      onEditQueue={resubmitQueuedWorkflow}
      onHistoryPathFilterChange={resetHistory}
      onHistoryRefFilterChange={resetHistoryRef}
      onLoadCommit={setSelectedCommitOid}
      onLoadCommitPatch={(oid, path) => setCommitPatchTarget({ oid, path })}
      onLoadMoreHistory={() => {
        if (historyNextCursor !== null && !historyQuery.isPending) {
          setHistoryCursor(historyNextCursor);
        }
      }}
      onOpenCurrentFile={openCurrentFileInWorkbench}
      onPrepareInteractiveRebase={setRebasePlanTarget}
      onQueueWorkflow={queueWorkflow}
      onRefreshChange={() => changesDiffQuery.refresh()}
      onRestoreUndo={(snapshotId) => {
        if (!props.cwd || !snapshot) return;
        void restoreUndo({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, expectedStateToken: snapshot.stateToken, snapshotId },
        });
      }}
      onRetryQueue={(queueId) => {
        const existing = projection?.queuedWorkflow;
        if (!existing || existing.id !== queueId) return;
        resubmitQueuedWorkflow(queueId, existing.plan);
      }}
      onRunOperation={runWorkbenchOperation}
      onSaveCurrentFile={saveCurrentFile}
      onSelectChange={selectChange}
      onSelectCommit={setSelectedCommitOid}
      onSwitchBranch={(refName) => {
        if (!props.cwd || !snapshot) return;
        void runOperation({
          environmentId: props.environmentId,
          input: {
            action: { kind: "switch_branch", refName },
            cwd: props.cwd,
            expectedStateToken: snapshot.stateToken,
          },
        });
      }}
      onUpdateRebasePlan={setRebasePlan}
      operation={operation}
      operationProgress={
        operationProgress.status === "idle"
          ? null
          : {
              label:
                operationProgress.latest?._tag === "progress"
                  ? operationProgress.latest.label
                  : operationProgress.latest?._tag === "failed"
                    ? operationProgress.latest.message
                    : operationProgress.latest?._tag === "started"
                      ? `Starting ${operationProgress.latest.actionKind.replaceAll("_", " ")}`
                      : operationProgress.status === "completed"
                        ? "Git operation completed"
                        : "Starting Git operation",
              status: operationProgress.status,
            }
      }
      queue={queue}
      readOnly={readOnly}
      rebasePlan={rebasePlan}
      rebaseUpstreamRef={rebaseUpstreamRef}
      selectedChangeId={selectedChangeId}
      selectedCommit={selectedCommit}
      showTabs={false}
      snapshot={snapshot}
      undoSnapshots={undoSnapshots}
      upgradeRequired={!props.workbenchSupported}
    />
  );

  const selectionBlocked = props.actionRequired || props.isRecording;
  const gitCard = (
    <GitCompactCard
      expanded={gitExpanded}
      expansionBlocked={selectionBlocked}
      expandButtonRef={expandButtonRef}
      lastCommit={
        snapshot?.lastCommit
          ? {
              ageLabel: relativeAge(snapshot.lastCommit.authoredAt),
              summary: snapshot.lastCommit.subject,
            }
          : null
      }
      onExpand={() => {
        if (selectionBlocked) return;
        selectCard("git");
        setExpandedCard("git");
      }}
      quickAction={compactQuickAction}
      status={status}
      workbench={
        <GitWorkbenchDrawerShell
          activeTab={activeTab}
          className="workspace-card-deck__card-content git-workbench-drawer--embedded"
          {...(props.drawerAvailableHeight === undefined
            ? {}
            : { availableHeight: props.drawerAvailableHeight })}
          onActiveTabChange={setActiveTab}
          onOpenChange={(open) => setExpandedCard(open ? "git" : null)}
          open={gitExpanded}
          repositoryLabel={snapshot?.worktreeRoot ?? props.cwd ?? "Repository"}
          returnFocusRef={expandButtonRef}
          showOperationsTab={Boolean(
            operation || queue || undoSnapshots.length || rebasePlan.length,
          )}
        >
          {panel}
        </GitWorkbenchDrawerShell>
      }
    />
  );

  const cards = useMemo<readonly WorkspaceDeckCardDefinition<ChatWorkspaceCardId>[]>(() => {
    const chatCard: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "chat",
      label: "Chat workspace",
      renderBody: () =>
        props.renderChat({
          deckEnabled: true,
          gitAvailable,
        }),
      renderPeek: ({ blocked, position, requestActivation }) => (
        <WorkspaceCardPeek
          blocked={blocked}
          cardId="chat"
          label="Chat workspace"
          position={position}
          onActivate={requestActivation}
        >
          <span
            className="flex h-full items-center px-3 text-xs font-medium text-muted-foreground"
            data-workspace-card-peek-id="chat"
          >
            Chat
          </span>
        </WorkspaceCardPeek>
      ),
    };
    const mcpCard: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "mcp",
      label: "MCP workspace",
      renderBody: ({ active }) => (
        <McpWorkspaceCardController
          active={active}
          authorizationAvailable={props.mcpAuthorizationAvailable}
          configuredServers={props.mcpConfiguredServers}
          environmentId={props.environmentId}
          expanded={mcpExpanded}
          expansionBlocked={selectionBlocked}
          projectCwd={props.cwd}
          providerDisplayName={props.mcpProviderDisplayName}
          providerDriver={props.mcpProviderDriver}
          providerInstanceId={props.mcpProviderInstanceId}
          providers={props.mcpProviders}
          runtimeSessionId={props.mcpRuntimeSessionId}
          threadId={props.threadId}
          workspaceSupported={props.mcpWorkspaceSupported}
          {...(props.mcpProviderAccentColor === undefined
            ? {}
            : { providerAccentColor: props.mcpProviderAccentColor })}
          {...(props.drawerAvailableHeight === undefined
            ? {}
            : { drawerAvailableHeight: props.drawerAvailableHeight })}
          onExpandedChange={(nextExpanded) => {
            if (selectionBlocked && nextExpanded) return;
            if (nextExpanded) selectCard("mcp");
            setExpandedCard(nextExpanded ? "mcp" : null);
          }}
        />
      ),
      renderPeek: ({ blocked, position, requestActivation }) => (
        <McpWorkspacePeekController
          blocked={blocked || selectionBlocked}
          configuredServers={props.mcpConfiguredServers}
          environmentId={props.environmentId}
          position={position}
          projectCwd={props.cwd}
          providerDisplayName={props.mcpProviderDisplayName}
          providerInstanceId={props.mcpProviderInstanceId}
          runtimeSessionId={props.mcpRuntimeSessionId}
          threadId={props.threadId}
          workspaceSupported={props.mcpWorkspaceSupported}
          requestActivation={requestActivation}
        />
      ),
    };
    if (!gitAvailable) return [chatCard, mcpCard];

    const gitCardDefinition: WorkspaceDeckCardDefinition<ChatWorkspaceCardId> = {
      id: "git",
      label: "Git workspace",
      renderBody: () => gitCard,
      renderPeek: ({ blocked, position, requestActivation }) => (
        <WorkspaceCardPeek
          blocked={blocked}
          cardId="git"
          label="Git workspace"
          position={position}
          onActivate={requestActivation}
        >
          {props.renderGitPeek({
            blocked: blocked || selectionBlocked,
            position,
            status,
          })}
        </WorkspaceCardPeek>
      ),
    };
    return [chatCard, gitCardDefinition, mcpCard];
  }, [
    gitAvailable,
    gitCard,
    mcpExpanded,
    props.cwd,
    props.drawerAvailableHeight,
    props.environmentId,
    props.mcpAuthorizationAvailable,
    props.mcpConfiguredServers,
    props.mcpProviderAccentColor,
    props.mcpProviderDisplayName,
    props.mcpProviderDriver,
    props.mcpProviderInstanceId,
    props.mcpProviders,
    props.mcpRuntimeSessionId,
    props.mcpWorkspaceSupported,
    props.renderChat,
    props.renderGitPeek,
    props.threadId,
    selectCard,
    selectionBlocked,
    status,
  ]);

  if (!isDesktop) {
    return props.renderChat({
      deckEnabled: false,
      gitAvailable: false,
    });
  }

  return (
    <McpWorkspaceRuntimeProvider
      environmentId={props.environmentId}
      active={resolvedActiveCard === "mcp"}
      expanded={mcpExpanded}
      projectCwd={props.cwd}
      providerInstanceId={props.mcpProviderInstanceId}
      providers={props.mcpProviders}
      runtimeSessionId={props.mcpRuntimeSessionId}
      threadId={props.threadId}
      workspaceSupported={props.mcpWorkspaceSupported}
    >
      <ChatWorkspaceDeck
        actionRequired={props.actionRequired}
        activeCard={resolvedActiveCard}
        cards={cards}
        expandedCard={expandedCard}
        isRecording={props.isRecording}
        resetKey={deckResetKey}
        onActiveCardChange={selectCard}
        onBeforeHideChat={() => props.composerRef.current?.dismissTransientUi()}
        onCardSelectionBlocked={(reason) =>
          toastManager.add({
            type: "info",
            title:
              reason === "recording"
                ? "Finish or cancel voice recording before switching workspace cards."
                : "Respond to the agent before switching workspace cards.",
          })
        }
        onExpandedCardChange={setExpandedCard}
        onRestoreChatFocus={() => props.composerRef.current?.focusAtEnd()}
      />
    </McpWorkspaceRuntimeProvider>
  );
}

/** @deprecated Import the neutral ChatWorkspaceDeckController composition instead. */
export const GitWorkspaceDeckController = ChatWorkspaceDeckController;
