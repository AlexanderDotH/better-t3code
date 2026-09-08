import {
  ThreadId,
  TurnId,
  type GitQueuedWorkflow,
  type GitQueuedWorkflowReviewReason,
  type GitWorkbenchStreamEvent,
} from "@t3tools/contracts";

import type {
  GitWorkbenchQueueReviewReason,
  GitWorkbenchQueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";
import type { GitWorkbenchQueueEvent } from "./GitWorkbenchQueueService.ts";

const REVIEW_REASON_COPY: Readonly<
  Record<GitWorkbenchQueueReviewReason, GitQueuedWorkflowReviewReason>
> = {
  repository_changed: {
    code: "repository_changed",
    message: "The queued workflow belongs to a different repository worktree.",
  },
  ref_changed: {
    code: "branch_changed",
    message: "The checked-out branch changed after this workflow was queued.",
  },
  head_changed: {
    code: "head_changed",
    message: "HEAD changed after this workflow was queued.",
  },
  index_changed: {
    code: "index_changed",
    message: "The Git index changed after this workflow was queued.",
  },
  worktree_changed: {
    code: "file_changed",
    message: "Selected worktree files changed after this workflow was queued.",
  },
  operation_changed: {
    code: "operation_started",
    message: "The repository operation state changed after this workflow was queued.",
  },
  conflicts_present: {
    code: "conflicts_detected",
    message: "Repository conflicts must be resolved before this workflow can run.",
  },
  remote_changed: {
    code: "remote_changed",
    message: "The captured remote ref moved after this workflow was queued.",
  },
  selection_changed: {
    code: "patch_changed",
    message: "The selected patch changed after this workflow was queued.",
  },
  server_restarted_during_execution: {
    code: "execution_interrupted",
    message: "The server restarted while this workflow was running; review before retrying.",
  },
};

export function toContractQueuedWorkflow(workflow: GitWorkbenchQueuedWorkflow): GitQueuedWorkflow {
  return {
    id: workflow.id,
    cwd: workflow.scope.worktreeRoot,
    revision: workflow.revision,
    threadId: ThreadId.make(workflow.threadId),
    ...(workflow.turnId === null ? {} : { turnId: TurnId.make(workflow.turnId) }),
    status: workflow.status,
    expectedStateToken: workflow.preconditions.stateToken,
    plan: workflow.workflow,
    needsReviewReasons: workflow.needsReviewReasons.map((reason) => REVIEW_REASON_COPY[reason]),
    ...(workflow.lastError === null ? {} : { lastError: workflow.lastError }),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

type QueueUpdatedEvent = Extract<GitWorkbenchStreamEvent, { readonly _tag: "queueUpdated" }>;

export function toContractQueueEvent(event: GitWorkbenchQueueEvent): QueueUpdatedEvent {
  return {
    _tag: "queueUpdated",
    queuedWorkflow: event._tag === "upserted" ? toContractQueuedWorkflow(event.workflow) : null,
  };
}

export function toContractCancelledWorkflow(
  workflow: GitWorkbenchQueuedWorkflow,
  updatedAt: string,
): GitQueuedWorkflow {
  return {
    ...toContractQueuedWorkflow(workflow),
    status: "cancelled",
    revision: workflow.revision + 1,
    updatedAt,
  };
}
