import type {
  GitRunStackedActionResult,
  GitWorkbenchSnapshot,
  VcsStatusResult,
} from "@t3tools/contracts";

export function commitResult(
  overrides: Partial<GitRunStackedActionResult> = {},
): GitRunStackedActionResult {
  return {
    action: "commit",
    branch: { status: "skipped_not_requested" },
    commit: { status: "created", commitSha: "abc123", subject: "Chosen changes" },
    push: { status: "skipped_not_requested" },
    pr: { status: "skipped_not_requested" },
    toast: { title: "Changes committed", cta: { kind: "none" } },
    ...overrides,
  };
}

export function workbenchSnapshot(
  overrides: Partial<GitWorkbenchSnapshot> = {},
): GitWorkbenchSnapshot {
  return {
    isRepository: true,
    registeredCwd: "/repo",
    repositoryRoot: "/repo",
    worktreeRoot: "/repo",
    gitCommonDir: "/repo/.git",
    refName: "feature/test",
    upstreamRef: "origin/feature/test",
    headOid: "a".repeat(40),
    unborn: false,
    detached: false,
    aheadCount: 0,
    behindCount: 0,
    files: [
      {
        path: "src/partial.ts",
        kind: "modified",
        indexStatus: "modified",
        worktreeStatus: "modified",
        staged: true,
        unstaged: true,
        untracked: false,
        conflicted: false,
        binary: false,
        submodule: false,
        modeChanged: false,
        stagedStats: { insertions: 2, deletions: 1, binary: false },
        unstagedStats: { insertions: 3, deletions: 0, binary: false },
      },
    ],
    totals: {
      staged: 1,
      unstaged: 1,
      untracked: 0,
      conflicted: 0,
      insertions: 5,
      deletions: 1,
    },
    operation: { kind: "none" },
    truncated: false,
    generatedAt: "2026-10-17T12:00:00.000Z",
    indexStateToken: "index-1",
    worktreeStateToken: "worktree-1",
    stateToken: "state-1",
    ...overrides,
  };
}

export function vcsStatus(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/test",
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "src/partial.ts", insertions: 2, deletions: 1 }],
      insertions: 2,
      deletions: 1,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

export function deferredResult<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
