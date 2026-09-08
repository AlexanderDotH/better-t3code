import {
  ApprovalRequestId,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findOpenPendingInteractions } from "./pendingInteractionLifecycle.ts";

const firstTurnId = TurnId.make("turn-first");
const secondTurnId = TurnId.make("turn-second");

function activity(input: {
  readonly id: string;
  readonly kind: string;
  readonly requestId: string;
  readonly turnId?: TurnId;
  readonly detail?: string;
  readonly sequence: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "approval",
    kind: input.kind,
    summary: input.kind,
    payload: {
      requestId: ApprovalRequestId.make(input.requestId),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    },
    turnId: input.turnId ?? firstTurnId,
    sequence: input.sequence,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("findOpenPendingInteractions", () => {
  it("returns only requests without a later resolution in deterministic request order", () => {
    const result = findOpenPendingInteractions({
      activities: [
        activity({
          id: "input-open",
          kind: "user-input.requested",
          requestId: "input-open",
          sequence: 4,
        }),
        activity({
          id: "approval-resolved",
          kind: "approval.resolved",
          requestId: "approval-closed",
          sequence: 3,
        }),
        activity({
          id: "approval-open",
          kind: "approval.requested",
          requestId: "approval-open",
          sequence: 1,
        }),
        activity({
          id: "approval-closed",
          kind: "approval.requested",
          requestId: "approval-closed",
          sequence: 2,
        }),
      ],
    });

    expect(result).toEqual({
      approvals: [
        {
          requestId: ApprovalRequestId.make("approval-open"),
          requestActivityId: EventId.make("approval-open"),
          turnId: firstTurnId,
        },
      ],
      userInputs: [
        {
          requestId: ApprovalRequestId.make("input-open"),
          requestActivityId: EventId.make("input-open"),
          turnId: firstTurnId,
        },
      ],
    });
  });

  it("uses the provider-specific stale and unknown failure rules", () => {
    const result = findOpenPendingInteractions({
      activities: [
        activity({
          id: "approval-stale",
          kind: "approval.requested",
          requestId: "approval-stale",
          sequence: 1,
        }),
        activity({
          id: "approval-stale-failure",
          kind: "provider.approval.respond.failed",
          requestId: "approval-stale",
          detail: "Unknown pending permission request",
          sequence: 2,
        }),
        activity({
          id: "input-stale",
          kind: "user-input.requested",
          requestId: "input-stale",
          sequence: 3,
        }),
        activity({
          id: "input-stale-failure",
          kind: "provider.user-input.respond.failed",
          requestId: "input-stale",
          detail: "Unknown pending Codex user input request",
          sequence: 4,
        }),
        activity({
          id: "input-retryable",
          kind: "user-input.requested",
          requestId: "input-retryable",
          sequence: 5,
        }),
        activity({
          id: "input-retryable-failure",
          kind: "provider.user-input.respond.failed",
          requestId: "input-retryable",
          detail: "Provider temporarily unavailable",
          sequence: 6,
        }),
      ],
    });

    expect(result).toEqual({
      approvals: [],
      userInputs: [
        {
          requestId: ApprovalRequestId.make("input-retryable"),
          requestActivityId: EventId.make("input-retryable"),
          turnId: firstTurnId,
        },
      ],
    });
  });

  it("scopes requests to one turn while later resolutions still close that turn", () => {
    const result = findOpenPendingInteractions({
      targetTurnId: firstTurnId,
      activities: [
        activity({
          id: "first-open",
          kind: "approval.requested",
          requestId: "first-open",
          sequence: 1,
        }),
        activity({
          id: "second-open",
          kind: "approval.requested",
          requestId: "second-open",
          turnId: secondTurnId,
          sequence: 2,
        }),
        activity({
          id: "first-resolved",
          kind: "approval.resolved",
          requestId: "first-open",
          turnId: secondTurnId,
          sequence: 3,
        }),
      ],
    });

    expect(result).toEqual({ approvals: [], userInputs: [] });
  });
});
