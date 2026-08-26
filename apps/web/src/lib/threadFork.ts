import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ThreadForkBoundary,
  type ThreadForkHandoffState,
  type ThreadForkWorkspace,
} from "@t3tools/contracts";

import type { TimelineEntry } from "../session-logic";

export interface FirstTurnForkBudget {
  readonly remainingInputChars: number;
  readonly remainingAttachmentCount: number;
}

export function forkBoundaryKey(boundary: ThreadForkBoundary): string {
  return boundary.kind === "message"
    ? `message:${boundary.messageId}`
    : `proposed-plan:${boundary.planId}`;
}

export function resolveFirstTurnForkBudget(
  handoff: ThreadForkHandoffState | null | undefined,
): FirstTurnForkBudget | null {
  if (handoff?.status !== "pending") return null;
  return {
    remainingInputChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    remainingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  };
}

export function resolveForkWorkspaceSpec(input: {
  readonly defaultMode: ThreadForkWorkspace["mode"];
  readonly isGitRepository: boolean;
  readonly projectRootBranch: string | null;
  readonly newWorktreesStartFromOrigin: boolean;
}): ThreadForkWorkspace {
  const mode = input.isGitRepository ? input.defaultMode : "local";
  return {
    mode,
    baseBranch: mode === "worktree" ? input.projectRootBranch : null,
    startFromOrigin: mode === "worktree" && input.newWorktreesStartFromOrigin,
    runSetupScript: mode === "worktree",
  };
}

export function resolveForkBoundaryTimelineEntryId(
  entries: ReadonlyArray<TimelineEntry>,
  boundary: ThreadForkBoundary,
): string | null {
  if (boundary.kind === "message") {
    return (
      entries.find(
        (entry) =>
          entry.kind === "message" && entry.message.historyOrigin?.sourceId === boundary.messageId,
      )?.id ?? null
    );
  }
  return (
    entries.find(
      (entry) =>
        entry.kind === "proposed-plan" &&
        entry.proposedPlan.historyOrigin?.sourceId === boundary.planId,
    )?.id ?? null
  );
}
