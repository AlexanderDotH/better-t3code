import {
  EventId,
  type OrchestrationThreadActivity,
  type ThreadTurnAbortOutcome,
  type TurnId,
} from "@t3tools/contracts";

import { findOpenPendingInteractions } from "./pendingInteractionLifecycle.ts";

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

  const pending = findOpenPendingInteractions({
    activities: input.activities,
    targetTurnId: input.targetTurnId,
  });

  return [
    ...pending.approvals.map(({ requestId }) => ({
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
    ...pending.userInputs.map(({ requestId }) => ({
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
