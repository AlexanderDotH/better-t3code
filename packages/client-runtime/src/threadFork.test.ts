import { MessageId, OrchestrationProposedPlanId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  forkBoundaryKey,
  resolveFirstTurnForkBudget,
  resolveForkWorkspaceSpec,
} from "./threadFork.js";

describe("thread fork presentation", () => {
  it("distinguishes message and plan boundaries", () => {
    expect(forkBoundaryKey({ kind: "message", messageId: MessageId.make("same") })).toBe(
      "message:same",
    );
    expect(
      forkBoundaryKey({ kind: "proposed-plan", planId: OrchestrationProposedPlanId.make("same") }),
    ).toBe("proposed-plan:same");
  });
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

  it("keeps the ordinary composer budget while the complete handoff is pending", () => {
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
});
