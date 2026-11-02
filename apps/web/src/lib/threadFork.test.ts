import { MessageId, PlanId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { forkBoundaryKey, resolveForkBoundaryTimelineEntryId } from "./threadFork";

describe("inherited fork boundaries", () => {
  it("finds the inherited row matching a message or proposed-plan boundary", () => {
    const messageId = MessageId.make("copied-message");
    const planId = PlanId.make("copied-plan");
    const entries = [
      {
        id: "destination-message",
        kind: "message" as const,
        createdAt: "2026-08-24T12:00:00.000Z",
        message: {
          id: messageId,
          role: "user" as const,
          text: "Question",
          runId: null,
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:00:00.000Z",
          streaming: false,
        },
      },
      {
        id: "destination-plan",
        kind: "proposed-plan" as const,
        createdAt: "2026-08-24T12:00:01.000Z",
        proposedPlan: {
          id: planId,
          runId: null,
          planMarkdown: "# Plan",
          status: "active" as const,
          createdAt: "2026-08-24T12:00:01.000Z",
          updatedAt: "2026-08-24T12:00:01.000Z",
        },
      },
    ];

    expect(resolveForkBoundaryTimelineEntryId(entries, { kind: "message", messageId })).toBe(
      "destination-message",
    );
    expect(resolveForkBoundaryTimelineEntryId(entries, { kind: "proposed-plan", planId })).toBe(
      "destination-plan",
    );
    expect(forkBoundaryKey({ kind: "message", messageId })).toBe("message:copied-message");
  });

  it("does not confuse message and plan IDs when their source strings collide", () => {
    const sharedId = "shared-source-id";
    const entries = [
      {
        id: "destination-message",
        kind: "message" as const,
        createdAt: "2026-08-24T12:00:00.000Z",
        message: {
          id: MessageId.make(sharedId),
          role: "user" as const,
          text: "Question",
          runId: null,
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:00:00.000Z",
          streaming: false,
        },
      },
      {
        id: "destination-plan",
        kind: "proposed-plan" as const,
        createdAt: "2026-08-24T12:00:01.000Z",
        proposedPlan: {
          id: PlanId.make(sharedId),
          runId: null,
          planMarkdown: "# Plan",
          status: "active" as const,
          createdAt: "2026-08-24T12:00:01.000Z",
          updatedAt: "2026-08-24T12:00:01.000Z",
        },
      },
    ];

    expect(
      resolveForkBoundaryTimelineEntryId(entries, {
        kind: "proposed-plan",
        planId: PlanId.make(sharedId),
      }),
    ).toBe("destination-plan");
  });
});
