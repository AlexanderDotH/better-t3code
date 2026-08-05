import { describe, expect, it } from "@effect/vitest";

import {
  revalidateQueuedWorkflow,
  type GitWorkbenchObservedState,
  type GitWorkbenchQueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";

const scope = {
  environmentId: "environment-1",
  worktreeRoot: "/workspace/project",
} as const;

const observed: GitWorkbenchObservedState = {
  ...scope,
  headOid: "a".repeat(40),
  refName: "refs/heads/main",
  indexToken: "index-1",
  worktreeToken: "worktree-1",
  operationState: null,
  remoteOid: "b".repeat(40),
  selectionPatchToken: "patch-1",
  hasConflicts: false,
};

function queued(overrides: Partial<GitWorkbenchQueuedWorkflow> = {}): GitWorkbenchQueuedWorkflow {
  return {
    id: "queue-1",
    scope,
    threadId: "thread-1",
    turnId: "turn-1",
    status: "waiting_for_turn",
    revision: 1,
    workflow: {
      kind: "delivery",
      stage: { mode: "paths", paths: ["selection-1"] },
      push: true,
      createPullRequest: false,
    },
    preconditions: {
      stateToken: "state-1",
      headOid: observed.headOid,
      refName: observed.refName,
      indexToken: observed.indexToken,
      worktreeToken: observed.worktreeToken,
      operationState: null,
      remoteOid: observed.remoteOid,
      selectionPatchToken: observed.selectionPatchToken,
    },
    needsReviewReasons: [],
    lastError: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("revalidateQueuedWorkflow", () => {
  it("accepts an exact selected-change delivery workflow", () => {
    expect(revalidateQueuedWorkflow(queued(), observed)).toEqual({ _tag: "valid" });
  });

  it("allows final agent worktree changes only for stage-all delivery", () => {
    const result = revalidateQueuedWorkflow(
      queued({
        workflow: {
          kind: "delivery",
          stage: { mode: "all" },
          commitMessage: "Ship final changes",
          push: false,
          createPullRequest: false,
        },
      }),
      {
        ...observed,
        indexToken: "agent-index",
        worktreeToken: "agent-worktree",
        selectionPatchToken: null,
      },
    );

    expect(result).toEqual({ _tag: "valid" });
  });

  it("pauses selected changes when the patch or index became stale", () => {
    const result = revalidateQueuedWorkflow(queued(), {
      ...observed,
      indexToken: "index-2",
      selectionPatchToken: "patch-2",
    });

    expect(result).toEqual({
      _tag: "needs_review",
      reasons: ["index_changed", "selection_changed"],
    });
  });

  it("never retargets an advanced operation after HEAD or branch changes", () => {
    const result = revalidateQueuedWorkflow(
      queued({
        workflow: {
          kind: "advanced_operation",
          action: { kind: "reset", mode: "hard", targetOid: "c".repeat(40) },
        },
      }),
      {
        ...observed,
        headOid: "d".repeat(40),
        refName: "refs/heads/release",
      },
    );

    expect(result).toEqual({
      _tag: "needs_review",
      reasons: ["ref_changed", "head_changed"],
    });
  });

  it("requires a conflict-free idle repository for every workflow", () => {
    const result = revalidateQueuedWorkflow(queued(), {
      ...observed,
      operationState: "rebase",
      hasConflicts: true,
    });

    expect(result).toEqual({
      _tag: "needs_review",
      reasons: ["operation_changed", "conflicts_present"],
    });
  });

  it("pauses a delivery push when the captured remote moved", () => {
    const result = revalidateQueuedWorkflow(queued(), {
      ...observed,
      remoteOid: "f".repeat(40),
    });

    expect(result).toEqual({
      _tag: "needs_review",
      reasons: ["remote_changed"],
    });
  });

  it("keeps unstaged work out of a staged-only delivery decision", () => {
    const result = revalidateQueuedWorkflow(
      queued({
        workflow: {
          kind: "delivery",
          stage: { mode: "staged" },
          push: false,
          createPullRequest: false,
        },
      }),
      { ...observed, worktreeToken: "new-unstaged-work" },
    );

    expect(result).toEqual({ _tag: "valid" });
  });
});
