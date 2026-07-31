import {
  ApprovalRequestId,
  EventId,
  type OrchestrationThreadActivity,
  type ThreadTurnAbortOutcome,
  type TurnId,
} from "@t3tools/contracts";

function activityRequestId(activity: OrchestrationThreadActivity): ApprovalRequestId | undefined {
  if (typeof activity.payload !== "object" || activity.payload === null) {
    return undefined;
  }
  const requestId = (activity.payload as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? ApprovalRequestId.make(requestId) : undefined;
}

function staleRequestFailure(activity: OrchestrationThreadActivity): boolean {
  if (typeof activity.payload !== "object" || activity.payload === null) {
    return false;
  }
  const detail = (activity.payload as Record<string, unknown>).detail;
  if (typeof detail !== "string") {
    return false;
  }
  const normalized = detail.toLowerCase();
  return normalized.includes("stale pending") || normalized.includes("unknown pending");
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

export function makeAbortInteractionResolutionActivities(input: {
  readonly settlementEventId: EventId;
  readonly settlementSequence: number;
  readonly targetTurnId: TurnId | null;
  readonly outcome: ThreadTurnAbortOutcome;
  readonly settledAt: string;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}): ReadonlyArray<OrchestrationThreadActivity> {
  if (input.targetTurnId === null) {
    return [];
  }

  const approvals = new Map<ApprovalRequestId, OrchestrationThreadActivity>();
  const userInputs = new Map<ApprovalRequestId, OrchestrationThreadActivity>();
  for (const activity of [...input.activities].toSorted(compareActivities)) {
    const requestId = activityRequestId(activity);
    if (requestId === undefined) {
      continue;
    }
    if (activity.kind === "approval.requested" && activity.turnId === input.targetTurnId) {
      approvals.set(requestId, activity);
      continue;
    }
    if (activity.kind === "user-input.requested" && activity.turnId === input.targetTurnId) {
      userInputs.set(requestId, activity);
      continue;
    }
    if (
      activity.kind === "approval.resolved" ||
      (activity.kind === "provider.approval.respond.failed" && staleRequestFailure(activity))
    ) {
      approvals.delete(requestId);
      continue;
    }
    if (
      activity.kind === "user-input.resolved" ||
      (activity.kind === "provider.user-input.respond.failed" && staleRequestFailure(activity))
    ) {
      userInputs.delete(requestId);
    }
  }

  return [
    ...Array.from(approvals.keys(), (requestId) => ({
      id: EventId.make(`${input.settlementEventId}:abort:approval:${requestId}`),
      tone: "approval" as const,
      kind: "approval.resolved",
      summary: "Approval cancelled because the agent interaction stopped.",
      payload: {
        requestId,
        decision: "cancel",
        reason: "turn-abort-settled",
        outcome: input.outcome,
      },
      turnId: input.targetTurnId,
      sequence: input.settlementSequence,
      createdAt: input.settledAt,
    })),
    ...Array.from(userInputs.keys(), (requestId) => ({
      id: EventId.make(`${input.settlementEventId}:abort:user-input:${requestId}`),
      tone: "approval" as const,
      kind: "user-input.resolved",
      summary: "Question cancelled because the agent interaction stopped.",
      payload: {
        requestId,
        answers: {},
        reason: "turn-abort-settled",
        outcome: input.outcome,
      },
      turnId: input.targetTurnId,
      sequence: input.settlementSequence,
      createdAt: input.settledAt,
    })),
  ];
}
