import {
  ApprovalRequestId,
  type EventId,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@t3tools/contracts";

export interface OpenPendingInteraction {
  readonly requestId: ApprovalRequestId;
  readonly requestActivityId: EventId;
  readonly turnId: TurnId | null;
}

export interface OpenPendingInteractions {
  readonly approvals: ReadonlyArray<OpenPendingInteraction>;
  readonly userInputs: ReadonlyArray<OpenPendingInteraction>;
}

function activityRequestId(activity: OrchestrationThreadActivity): ApprovalRequestId | undefined {
  if (typeof activity.payload !== "object" || activity.payload === null) {
    return undefined;
  }
  const requestId = (activity.payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : undefined;
}

function activityFailureDetail(activity: OrchestrationThreadActivity): string | undefined {
  if (typeof activity.payload !== "object" || activity.payload === null) {
    return undefined;
  }
  const detail = (activity.payload as Record<string, unknown>).detail;
  return typeof detail === "string" ? detail.toLowerCase() : undefined;
}

function isStaleApprovalFailure(activity: OrchestrationThreadActivity): boolean {
  const detail = activityFailureDetail(activity);
  return (
    detail !== undefined &&
    (detail.includes("stale pending approval request") ||
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request"))
  );
}

function isStaleUserInputFailure(activity: OrchestrationThreadActivity): boolean {
  const detail = activityFailureDetail(activity);
  return (
    detail !== undefined &&
    (detail.includes("stale pending user-input request") ||
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request") ||
      detail.includes("unknown pending codex user input request"))
  );
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined || right.sequence !== undefined) {
    const sequenceOrder = (left.sequence ?? 0) - (right.sequence ?? 0);
    if (sequenceOrder !== 0) return sequenceOrder;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function findOpenPendingInteractions(input: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly targetTurnId?: TurnId;
}): OpenPendingInteractions {
  const approvals = new Map<ApprovalRequestId, OpenPendingInteraction>();
  const userInputs = new Map<ApprovalRequestId, OpenPendingInteraction>();

  for (const activity of [...input.activities].toSorted(compareActivities)) {
    const requestId = activityRequestId(activity);
    if (requestId === undefined) {
      continue;
    }

    const belongsToTargetTurn =
      input.targetTurnId === undefined || activity.turnId === input.targetTurnId;
    if (activity.kind === "approval.requested" && belongsToTargetTurn) {
      approvals.set(requestId, {
        requestId,
        requestActivityId: activity.id,
        turnId: activity.turnId,
      });
      continue;
    }
    if (activity.kind === "user-input.requested" && belongsToTargetTurn) {
      userInputs.set(requestId, {
        requestId,
        requestActivityId: activity.id,
        turnId: activity.turnId,
      });
      continue;
    }
    if (
      activity.kind === "approval.resolved" ||
      (activity.kind === "provider.approval.respond.failed" && isStaleApprovalFailure(activity))
    ) {
      approvals.delete(requestId);
      continue;
    }
    if (
      activity.kind === "user-input.resolved" ||
      (activity.kind === "provider.user-input.respond.failed" && isStaleUserInputFailure(activity))
    ) {
      userInputs.delete(requestId);
    }
  }

  return {
    approvals: Array.from(approvals.values()),
    userInputs: Array.from(userInputs.values()),
  };
}
