import { expect, it } from "@effect/vitest";

import type { GitWorkbenchQueuedWorkflow } from "./GitWorkbenchQueueModel.ts";
import {
  toContractCancelledWorkflow,
  toContractQueueEvent,
  toContractQueuedWorkflow,
} from "./GitWorkbenchQueueContracts.ts";

const queued: GitWorkbenchQueuedWorkflow = {
  id: "queue-1",
  scope: { environmentId: "environment-1", worktreeRoot: "/workspace/project" },
  threadId: "thread-1",
  turnId: "turn-1",
  status: "needs_review",
  revision: 4,
  workflow: {
    kind: "advanced_operation",
    action: { kind: "revert", commitOid: "a".repeat(40) },
  },
  preconditions: {
    stateToken: "state-1",
    headOid: "b".repeat(40),
    refName: "refs/heads/main",
    indexToken: "index-1",
    worktreeToken: "worktree-1",
    operationState: null,
    remoteOid: null,
    selectionPatchToken: null,
  },
  needsReviewReasons: ["head_changed", "server_restarted_during_execution"],
  lastError: null,
  createdAt: "2026-08-02T10:00:00.000Z",
  updatedAt: "2026-08-02T10:05:00.000Z",
};

it("maps durable private state to the public queue contract without exposing internals", () => {
  expect(toContractQueuedWorkflow(queued)).toEqual({
    id: "queue-1",
    cwd: "/workspace/project",
    revision: 4,
    threadId: "thread-1",
    turnId: "turn-1",
    status: "needs_review",
    expectedStateToken: "state-1",
    plan: queued.workflow,
    needsReviewReasons: [
      { code: "head_changed", message: "HEAD changed after this workflow was queued." },
      {
        code: "execution_interrupted",
        message: "The server restarted while this workflow was running; review before retrying.",
      },
    ],
    createdAt: queued.createdAt,
    updatedAt: queued.updatedAt,
  });
});

it("maps private broadcasts to queueUpdated and produces a terminal cancellation result", () => {
  expect(toContractQueueEvent({ _tag: "upserted", workflow: queued })).toMatchObject({
    _tag: "queueUpdated",
    queuedWorkflow: { id: "queue-1" },
  });
  expect(
    toContractQueueEvent({
      _tag: "removed",
      scope: queued.scope,
      workflowId: queued.id,
      revision: queued.revision + 1,
    }),
  ).toEqual({ _tag: "queueUpdated", queuedWorkflow: null });
  expect(toContractCancelledWorkflow(queued, "2026-08-02T10:06:00.000Z")).toMatchObject({
    status: "cancelled",
    revision: 5,
    updatedAt: "2026-08-02T10:06:00.000Z",
  });
});
