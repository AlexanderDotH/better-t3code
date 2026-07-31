import {
  ApprovalRequestId,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeAbortInteractionResolutionActivities } from "./abortInteractionSettlement.ts";

const turnId = TurnId.make("turn-target");

function activity(input: {
  readonly id: string;
  readonly kind: string;
  readonly requestId: string;
  readonly targetTurnId?: TurnId;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "approval",
    kind: input.kind,
    summary: input.kind,
    payload: { requestId: ApprovalRequestId.make(input.requestId) },
    turnId: input.targetTurnId ?? turnId,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("makeAbortInteractionResolutionActivities", () => {
  it("resolves only open interactions for the exact aborted turn", () => {
    const result = makeAbortInteractionResolutionActivities({
      settlementEventId: EventId.make("event-abort"),
      settlementSequence: 42,
      targetTurnId: turnId,
      outcome: "force-terminated",
      settledAt: "2026-07-30T00:00:05.000Z",
      activities: [
        activity({ id: "approval-open", kind: "approval.requested", requestId: "approval-open" }),
        activity({
          id: "approval-closed",
          kind: "approval.requested",
          requestId: "approval-closed",
        }),
        activity({
          id: "approval-resolution",
          kind: "approval.resolved",
          requestId: "approval-closed",
        }),
        activity({
          id: "input-open",
          kind: "user-input.requested",
          requestId: "input-open",
        }),
        activity({
          id: "other-turn",
          kind: "approval.requested",
          requestId: "other-turn",
          targetTurnId: TurnId.make("turn-other"),
        }),
      ],
    });

    expect(result.map((entry) => [entry.kind, entry.payload])).toEqual([
      [
        "approval.resolved",
        {
          requestId: "approval-open",
          decision: "cancel",
          reason: "turn-abort-settled",
          outcome: "force-terminated",
        },
      ],
      [
        "user-input.resolved",
        {
          requestId: "input-open",
          answers: {},
          reason: "turn-abort-settled",
          outcome: "force-terminated",
        },
      ],
    ]);
    expect(result.map((entry) => entry.id)).toEqual([
      "event-abort:abort:approval:approval-open",
      "event-abort:abort:user-input:input-open",
    ]);
  });
});
