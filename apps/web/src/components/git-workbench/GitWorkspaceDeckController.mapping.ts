import type {
  GitChangesDiffResult,
  GitCommitDetailResult,
  GitCommitFileDiffResult,
  GitInteractiveRebasePlanItem,
  GitQueuedWorkflow as ContractQueuedWorkflow,
  GitRepositoryInsightsResult,
  GitRebaseTodoNode,
  GitUndoSnapshot as ContractUndoSnapshot,
  GitWorkbenchOperationAction,
  GitWorkbenchSnapshot as ContractWorkbenchSnapshot,
  VcsStatusResult,
} from "@t3tools/contracts";

import type { GitCompactStatus } from "./GitCompactCard";
import { CODE_MIX_COLORS, relativeAge } from "./GitWorkspaceDeckController.formatting";
import type {
  GitCommitDetail,
  GitOperationState,
  GitQueuedWorkflow,
  GitRepositoryInsights,
  GitWorkbenchChange,
  GitWorkbenchDiffHunk,
  GitWorkbenchOperationInput,
  GitWorkbenchRebaseNode,
  GitWorkbenchSnapshot,
  GitUndoSnapshot,
} from "./GitWorkbench.types";

export function repositoryState(
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

export function mapSnapshot(
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

export function fallbackCompactStatus(
  status: VcsStatusResult | null,
  pending: boolean,
): GitCompactStatus {
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

export function compactStatus(snapshot: GitWorkbenchSnapshot | null, fallback: GitCompactStatus) {
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

export function mapInsights(
  result: GitRepositoryInsightsResult | null,
): GitRepositoryInsights | null {
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

export function mapDiff(result: GitChangesDiffResult): {
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

export function mapChanges(
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

export function mapCommitDetail(
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

export function mapQueue(queue: ContractQueuedWorkflow | null): GitQueuedWorkflow | null {
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

export function mapUndo(snapshot: ContractUndoSnapshot): GitUndoSnapshot {
  return {
    createdAt: snapshot.createdAt,
    id: snapshot.id,
    label: snapshot.reason.replaceAll("_", " "),
    refName: snapshot.headRef,
  };
}

export function mapOperation(snapshot: ContractWorkbenchSnapshot | null): GitOperationState | null {
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

export function mapRebaseNode(node: GitWorkbenchRebaseNode): GitRebaseTodoNode | null {
  if (node.kind === "label") return { kind: "label", name: node.label };
  if (node.kind === "reset") return { kind: "reset", label: node.label };
  if (node.kind === "merge") {
    const label = node.labels.length === 1 ? node.labels[0] : undefined;
    return label
      ? { kind: "merge", label, originalOid: node.commitId, messageMode: "reuse" }
      : null;
  }
  if (node.kind === "reword") {
    const message = node.message?.trim();
    return { kind: "reword", oid: node.commitId, ...(message ? { message } : {}) };
  }
  return { kind: node.kind, oid: node.commitId };
}

export function mapInteractiveRebasePlan(
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

export function actionForOperation(
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
  if (input.kind === "reset") return { kind: "reset", mode: input.mode, targetOid: input.oid };
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

export function directIntent(input: GitWorkbenchOperationInput) {
  if (input.kind === "commit-staged") return "commit-staged" as const;
  if (input.kind === "stage-all-and-commit") return "stage-all-and-commit" as const;
  if (input.kind === "create-pull-request") return "create-pull-request" as const;
  if (input.kind === "pull") return "pull" as const;
  if (input.kind === "push") return "push" as const;
  return null;
}
