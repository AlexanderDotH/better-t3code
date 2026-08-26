import { MessageId, OrchestrationProposedPlanId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  forkBoundaryKey,
  resolveFirstTurnForkBudget,
  resolveForkBoundaryTimelineEntryId,
  resolveForkWorkspaceSpec,
} from "./threadFork";

describe("thread fork presentation", () => {
  it("builds a worktree spec from ordinary new-thread defaults", () => {
    expect(
      resolveForkWorkspaceSpec({
        defaultMode: "worktree",
        isGitRepository: true,
        projectRootBranch: "main",
        newWorktreesStartFromOrigin: true,
      }),
    ).toEqual({
      mode: "worktree",
      baseBranch: "main",
      startFromOrigin: true,
      runSetupScript: true,
    });
  });

  it("forces non-Git projects onto the local workspace", () => {
    expect(
      resolveForkWorkspaceSpec({
        defaultMode: "worktree",
        isGitRepository: false,
        projectRootBranch: "main",
        newWorktreesStartFromOrigin: true,
      }),
    ).toEqual({
      mode: "local",
      baseBranch: null,
      startFromOrigin: false,
      runSetupScript: false,
    });
  });

  it("keeps the ordinary composer budget while the adaptive handoff is pending", () => {
    expect(
      resolveFirstTurnForkBudget({
        status: "pending",
        historyInputChars: 800,
        historyAttachmentCount: 2,
        remainingInputChars: 1_200,
        remainingAttachmentCount: 3,
        completedAt: null,
      }),
    ).toEqual({ remainingInputChars: 120_000, remainingAttachmentCount: 8 });
    expect(
      resolveFirstTurnForkBudget({
        status: "completed",
        historyInputChars: 800,
        historyAttachmentCount: 2,
        remainingInputChars: 1_200,
        remainingAttachmentCount: 3,
        completedAt: "2026-08-24T12:00:00.000Z",
      }),
    ).toBeNull();
  });

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
