import { MessageId, OrchestrationProposedPlanId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { forkBoundaryKey, resolveForkBoundaryTimelineEntryId } from "./threadFork";

describe("inherited fork boundaries", () => {
  it("finds the inherited row matching a message or proposed-plan boundary", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const messageId = MessageId.make("copied-message");
    const planId = OrchestrationProposedPlanId.make("copied-plan");
    const entries = [
      {
        id: "destination-message",
        kind: "message" as const,
        createdAt: "2026-08-24T12:00:00.000Z",
        message: {
          id: MessageId.make("destination-message"),
          role: "user" as const,
          text: "Question",
          turnId: null,
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:00:00.000Z",
          streaming: false,
          historyOrigin: { sourceThreadId, sourceId: messageId, ordinal: 0 },
        },
      },
      {
        id: "destination-plan",
        kind: "proposed-plan" as const,
        createdAt: "2026-08-24T12:00:01.000Z",
        proposedPlan: {
          id: OrchestrationProposedPlanId.make("destination-plan"),
          turnId: null,
          planMarkdown: "# Plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-08-24T12:00:01.000Z",
          updatedAt: "2026-08-24T12:00:01.000Z",
          historyOrigin: { sourceThreadId, sourceId: planId, ordinal: 1 },
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
    const sourceThreadId = ThreadId.make("source-thread");
    const sharedId = "shared-source-id";
    const entries = [
      {
        id: "destination-message",
        kind: "message" as const,
        createdAt: "2026-08-24T12:00:00.000Z",
        message: {
          id: MessageId.make("destination-message"),
          role: "user" as const,
          text: "Question",
          turnId: null,
          createdAt: "2026-08-24T12:00:00.000Z",
          updatedAt: "2026-08-24T12:00:00.000Z",
          streaming: false,
          historyOrigin: { sourceThreadId, sourceId: sharedId, ordinal: 0 },
        },
      },
      {
        id: "destination-plan",
        kind: "proposed-plan" as const,
        createdAt: "2026-08-24T12:00:01.000Z",
        proposedPlan: {
          id: OrchestrationProposedPlanId.make("destination-plan"),
          turnId: null,
          planMarkdown: "# Plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-08-24T12:00:01.000Z",
          updatedAt: "2026-08-24T12:00:01.000Z",
          historyOrigin: { sourceThreadId, sourceId: sharedId, ordinal: 1 },
        },
      },
    ];

    expect(
      resolveForkBoundaryTimelineEntryId(entries, {
        kind: "proposed-plan",
        planId: OrchestrationProposedPlanId.make(sharedId),
      }),
    ).toBe("destination-plan");
  });
});
