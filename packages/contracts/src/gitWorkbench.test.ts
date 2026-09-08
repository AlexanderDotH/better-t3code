import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  GitApplyChangeSelectionInput,
  GitChangesDiffResult,
  GitHistoryListInput,
  GitHistoryListResult,
  GitQueuedWorkflow,
  GitQueuedWorkflowCancelInput,
  GitQueuedWorkflowUpsertInput,
  GitRepositoryInsightsResult,
  GitUndoSnapshot,
  GitWorkbenchRunOperationInput,
  GitWorkbenchSnapshot,
  GitWorkbenchStaleStateError,
  GitWorkbenchStreamEvent,
} from "./gitWorkbench.ts";
import { WS_METHODS } from "./rpc.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";
const stateToken = "state:0123456789abcdef";
const decodeWorkbenchSnapshot = Schema.decodeUnknownSync(GitWorkbenchSnapshot);
const decodeHistoryInput = Schema.decodeUnknownSync(GitHistoryListInput);
const decodeHistoryResult = Schema.decodeUnknownSync(GitHistoryListResult);
const decodeInsightsResult = Schema.decodeUnknownSync(GitRepositoryInsightsResult);
const decodeChangesDiff = Schema.decodeUnknownSync(GitChangesDiffResult);
const decodeChangeSelection = Schema.decodeUnknownSync(GitApplyChangeSelectionInput);
const decodeOperationInput = Schema.decodeUnknownSync(GitWorkbenchRunOperationInput);
const decodeUndoSnapshot = Schema.decodeUnknownSync(GitUndoSnapshot);
const decodeQueuedWorkflow = Schema.decodeUnknownSync(GitQueuedWorkflow);
const decodeQueuedWorkflowUpsert = Schema.decodeUnknownSync(GitQueuedWorkflowUpsertInput);
const decodeQueuedWorkflowCancel = Schema.decodeUnknownSync(GitQueuedWorkflowCancelInput);
const decodeWorkbenchStreamEvent = Schema.decodeUnknownSync(GitWorkbenchStreamEvent);
const decodeStaleStateError = Schema.decodeUnknownSync(GitWorkbenchStaleStateError);

describe("GitWorkbenchSnapshot", () => {
  it("decodes index and worktree state without flattening staged changes", () => {
    const snapshot = decodeWorkbenchSnapshot({
      isRepository: true,
      registeredCwd: "/repo",
      repositoryRoot: "/repo",
      worktreeRoot: "/repo",
      gitCommonDir: "/repo/.git",
      refName: "feature/deck",
      upstreamRef: "origin/feature/deck",
      upstreamOid: oid,
      headOid: oid,
      unborn: false,
      detached: false,
      aheadCount: 2,
      behindCount: 1,
      files: [
        {
          path: "src/deck.tsx",
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
          stagedStats: { insertions: 4, deletions: 1, binary: false },
          unstagedStats: { insertions: 2, deletions: 0, binary: false },
        },
      ],
      totals: {
        staged: 1,
        unstaged: 1,
        untracked: 0,
        conflicted: 0,
        insertions: 6,
        deletions: 1,
      },
      operation: { kind: "none" },
      truncated: false,
      generatedAt: "2026-08-02T12:00:00.000Z",
      indexStateToken: "index:0123456789abcdef",
      worktreeStateToken: "worktree:0123456789abcdef",
      stateToken,
    });

    expect(snapshot.files[0]?.stagedStats.insertions).toBe(4);
    expect(snapshot.files[0]?.unstagedStats.insertions).toBe(2);
    expect(snapshot.upstreamOid).toBe(oid);
    expect(snapshot.indexStateToken).toBe("index:0123456789abcdef");
    expect(snapshot.worktreeStateToken).toBe("worktree:0123456789abcdef");
  });

  it("preserves unusual Git paths byte-for-byte", () => {
    const unusualPath = " leading space/line\nbreak.ts ";
    const snapshot = decodeWorkbenchSnapshot({
      isRepository: true,
      registeredCwd: "/repo",
      repositoryRoot: "/repo",
      worktreeRoot: "/repo",
      gitCommonDir: "/repo/.git",
      refName: "main",
      upstreamRef: null,
      headOid: oid,
      unborn: false,
      detached: false,
      aheadCount: 0,
      behindCount: 0,
      files: [
        {
          path: unusualPath,
          kind: "untracked",
          indexStatus: "unmodified",
          worktreeStatus: "untracked",
          staged: false,
          unstaged: true,
          untracked: true,
          conflicted: false,
          binary: false,
          submodule: false,
          modeChanged: false,
          stagedStats: { insertions: 0, deletions: 0, binary: false },
          unstagedStats: { insertions: 1, deletions: 0, binary: false },
        },
      ],
      totals: {
        staged: 0,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
        insertions: 1,
        deletions: 0,
      },
      operation: { kind: "none" },
      truncated: false,
      generatedAt: "2026-08-02T12:00:00.000Z",
      stateToken,
    });

    expect(snapshot.files[0]?.path).toBe(unusualPath);
  });
});

describe("Git history and insights", () => {
  it("accepts anchored history pages and rejects invalid object IDs and oversized pages", () => {
    expect(
      decodeHistoryInput({
        cwd: "/repo",
        snapshotOid: oid,
        cursor: 50,
        limit: 50,
        refName: "feature/deck",
        path: "src/deck.tsx",
      }),
    ).toMatchObject({ snapshotOid: oid, cursor: 50, limit: 50, refName: "feature/deck" });

    expect(() => decodeHistoryInput({ cwd: "/repo", snapshotOid: "HEAD", limit: 50 })).toThrow();
    expect(() => decodeHistoryInput({ cwd: "/repo", snapshotOid: oid, limit: 51 })).toThrow();
  });

  it("decodes stable history cursors and privacy-safe contributor insights", () => {
    const history = decodeHistoryResult({
      snapshotOid: oid,
      items: [
        {
          oid,
          shortOid: "0123456",
          subject: "feat: add Git deck",
          authorName: "Alex",
          authoredAt: "2026-08-01T12:00:00.000Z",
          committedAt: "2026-08-01T12:05:00.000Z",
          parents: [],
          decorations: ["HEAD -> feature/deck"],
        },
      ],
      nextCursor: null,
      truncated: false,
    });
    const insights = decodeInsightsResult({
      snapshotOid: oid,
      windowStart: "2025-08-02T00:00:00.000Z",
      windowEnd: "2026-08-02T00:00:00.000Z",
      scannedCommits: 123,
      truncated: false,
      contributors: [
        {
          identityKey: "author:ff02",
          displayName: "Alex",
          commitCount: 57,
          email: "must-not-cross-the-wire@example.com",
        },
      ],
      activity: [{ date: "2026-08-01", commitCount: 3 }],
      codeMix: {
        entries: [{ language: "TypeScript", fileCount: 20, percentage: 80 }],
        trackedFileCount: 25,
        classifiedFileCount: 20,
        excludedFileCount: 3,
        scannedFileCount: 23,
        truncated: false,
      },
    });

    expect(history.nextCursor).toBeNull();
    expect(insights.contributors[0]).not.toHaveProperty("email");
  });

  it("represents an unborn repository without inventing a snapshot object", () => {
    const history = decodeHistoryResult({
      snapshotOid: null,
      items: [],
      nextCursor: null,
      truncated: false,
    });

    expect(history.snapshotOid).toBeNull();
  });
});

describe("Git change selection", () => {
  it("decodes server-derived hunks and line selections", () => {
    const diff = decodeChangesDiff({
      path: "src/deck.tsx",
      source: "unstaged",
      stateToken,
      patchId: "patch:012345",
      binary: false,
      truncated: false,
      hunks: [
        {
          id: "hunk:1",
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          header: "@@ -10 +10,2 @@",
          lines: [
            {
              id: "line:1",
              type: "addition",
              newLine: 11,
              content: "+new line",
              selectable: true,
            },
          ],
        },
      ],
    });
    const input = decodeChangeSelection({
      cwd: "/repo",
      path: "src/deck.tsx",
      source: "unstaged",
      action: "stage",
      selection: { kind: "lines", ids: ["line:1"] },
      expectedStateToken: stateToken,
      expectedPatchId: "patch:012345",
    });

    expect(diff.hunks[0]?.lines[0]?.selectable).toBe(true);
    expect(input.selection.kind).toBe("lines");
  });

  it("rejects an empty hunk or line selection", () => {
    expect(() =>
      decodeChangeSelection({
        cwd: "/repo",
        path: "src/deck.tsx",
        source: "unstaged",
        action: "stage",
        selection: { kind: "hunks", ids: [] },
        expectedStateToken: stateToken,
        expectedPatchId: "patch:012345",
      }),
    ).toThrow();
  });
});

describe("Git operations, undo, and queue", () => {
  it("decodes a topology-preserving interactive rebase plan", () => {
    const input = decodeOperationInput({
      cwd: "/repo",
      expectedStateToken: stateToken,
      action: {
        kind: "interactive_rebase",
        upstreamRef: "origin/main",
        plan: [
          { kind: "label", name: "onto" },
          { kind: "pick", oid },
          { kind: "reset", label: "onto" },
          { kind: "merge", label: "onto", originalOid: oid, messageMode: "reuse" },
        ],
      },
    });

    expect(input.action.kind).toBe("interactive_rebase");
  });

  it("decodes exact undo metadata and one durable queued delivery workflow", () => {
    const undo = decodeUndoSnapshot({
      id: "undo:1",
      cwd: "/repo",
      createdAt: "2026-08-02T12:00:00.000Z",
      reason: "before_hard_reset",
      headOid: oid,
      headRef: "feature/deck",
      indexTreeOid: oid,
      worktreeCommitOid: oid,
      expiresAt: "2026-08-09T12:00:00.000Z",
    });
    const workflow = decodeQueuedWorkflow({
      id: "queue:1",
      cwd: "/repo",
      revision: 1,
      status: "waiting_for_turn",
      expectedStateToken: stateToken,
      plan: {
        kind: "delivery",
        stage: { mode: "all" },
        commitMessage: "feat: ship Git workspace deck",
        push: true,
        createPullRequest: true,
      },
      needsReviewReasons: [
        {
          code: "execution_interrupted",
          message: "The server restarted while this workflow was running.",
        },
      ],
      createdAt: "2026-08-02T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:00.000Z",
    });

    expect(undo.indexTreeOid).toBe(oid);
    expect(workflow.plan.kind).toBe("delivery");
    expect(workflow.needsReviewReasons[0]?.code).toBe("execution_interrupted");
  });

  it("requires optimistic revisions for queue edits and cancellation", () => {
    const upsert = decodeQueuedWorkflowUpsert({
      cwd: "/repo",
      workflowId: "queue:1",
      expectedRevision: 1,
      expectedStateToken: stateToken,
      plan: {
        kind: "delivery",
        stage: { mode: "staged" },
        push: false,
        createPullRequest: false,
      },
    });
    const cancel = decodeQueuedWorkflowCancel({
      cwd: "/repo",
      workflowId: "queue:1",
      expectedRevision: 2,
    });

    expect(upsert.expectedRevision).toBe(1);
    expect(cancel.expectedRevision).toBe(2);
  });

  it("decodes partial subscription updates and structured stale-state errors", () => {
    const event = decodeWorkbenchStreamEvent({
      _tag: "queueUpdated",
      queuedWorkflow: null,
    });
    const stale = decodeStaleStateError({
      _tag: "GitWorkbenchStaleStateError",
      cwd: "/repo",
      operation: "stage",
      expectedStateToken: "old",
      actualStateToken: "new",
      reason: "repository_changed",
      message: "The repository changed. Refresh before retrying.",
    });

    expect(event._tag).toBe("queueUpdated");
    expect(stale.actualStateToken).toBe("new");
  });
});

describe("Git workbench RPC registry", () => {
  it("publishes the complete version-one method surface", () => {
    expect(WS_METHODS.gitSubscribeWorkbench).toBe("git.subscribeWorkbench");
    expect(WS_METHODS.gitGetRepositoryInsights).toBe("git.getRepositoryInsights");
    expect(WS_METHODS.gitRunWorkbenchOperation).toBe("git.runWorkbenchOperation");
    expect(WS_METHODS.gitUpsertQueuedWorkflow).toBe("git.upsertQueuedWorkflow");
  });
});
