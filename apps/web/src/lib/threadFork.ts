import type { ThreadForkBoundary } from "@t3tools/contracts";
import type { TimelineEntry } from "../session-logic";
export { forkBoundaryKey } from "@t3tools/client-runtime/thread-fork";

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
