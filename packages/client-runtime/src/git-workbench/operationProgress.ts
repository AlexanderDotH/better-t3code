import type {
  GitWorkbenchOperationActionKind,
  GitWorkbenchOperationEvent,
} from "@t3tools/contracts";

export interface GitWorkbenchOperationProgress {
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly latest: GitWorkbenchOperationEvent | null;
  readonly actionKind: GitWorkbenchOperationActionKind | null;
}

export function idleGitWorkbenchOperationProgress(): GitWorkbenchOperationProgress {
  return { status: "idle", latest: null, actionKind: null };
}

export function beginGitWorkbenchOperationProgress(): GitWorkbenchOperationProgress {
  return { status: "running", latest: null, actionKind: null };
}

export function applyGitWorkbenchOperationProgress(
  current: GitWorkbenchOperationProgress,
  event: GitWorkbenchOperationEvent,
): GitWorkbenchOperationProgress {
  const activeOperationId = current.latest?.operationId;
  if (
    event._tag !== "started" &&
    activeOperationId !== undefined &&
    event.operationId !== activeOperationId
  ) {
    return current;
  }

  return {
    status:
      event._tag === "completed" ? "completed" : event._tag === "failed" ? "failed" : "running",
    latest: event,
    actionKind: event._tag === "started" ? event.actionKind : current.actionKind,
  };
}
