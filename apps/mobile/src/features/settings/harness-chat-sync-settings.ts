import type { HarnessChatSessionId, ProjectId } from "@t3tools/contracts";

export type HarnessChatSelectionState =
  | {
      readonly mode: "allMatching";
      readonly excludedSessionIds: ReadonlySet<HarnessChatSessionId>;
    }
  | {
      readonly mode: "only";
      readonly sessionIds: ReadonlySet<HarnessChatSessionId>;
    };

export function supportsHarnessChatSync(version: number | undefined): boolean {
  return (version ?? 0) >= 1;
}

export function createHarnessChatSelection(): HarnessChatSelectionState {
  return { mode: "allMatching", excludedSessionIds: new Set() };
}

export function isHarnessChatSelected(
  selection: HarnessChatSelectionState,
  sessionId: HarnessChatSessionId,
): boolean {
  if (selection.mode === "allMatching") return !selection.excludedSessionIds.has(sessionId);
  return selection.sessionIds.has(sessionId);
}

export function toggleHarnessChatSelection(
  selection: HarnessChatSelectionState,
  sessionId: HarnessChatSessionId,
): HarnessChatSelectionState {
  if (selection.mode === "allMatching") {
    const excludedSessionIds = new Set(selection.excludedSessionIds);
    if (!excludedSessionIds.delete(sessionId)) excludedSessionIds.add(sessionId);
    return { mode: "allMatching", excludedSessionIds };
  }

  const sessionIds = new Set(selection.sessionIds);
  if (!sessionIds.delete(sessionId)) sessionIds.add(sessionId);
  return { mode: "only", sessionIds };
}

export function clearHarnessChatSelection(): HarnessChatSelectionState {
  return { mode: "only", sessionIds: new Set() };
}

export function selectAllHarnessChats(
  _selection?: HarnessChatSelectionState,
): HarnessChatSelectionState {
  return createHarnessChatSelection();
}

export function harnessChatSelectedCount(
  selection: HarnessChatSelectionState,
  matchingCount: number,
  knownMatchingSessionIds?: ReadonlyArray<HarnessChatSessionId>,
): number {
  if (selection.mode === "only") return selection.sessionIds.size;
  if (knownMatchingSessionIds === undefined) {
    return Math.max(0, matchingCount - selection.excludedSessionIds.size);
  }
  const excludedMatchingCount = knownMatchingSessionIds.filter((sessionId) =>
    selection.excludedSessionIds.has(sessionId),
  ).length;
  return Math.max(0, matchingCount - excludedMatchingCount);
}

export function applyHarnessChatTarget(input: {
  readonly current: ReadonlyMap<HarnessChatSessionId, ProjectId>;
  readonly sessionId: HarnessChatSessionId;
  readonly unresolvedSessionIds: ReadonlyArray<HarnessChatSessionId>;
  readonly projectId: ProjectId;
  readonly applyToAll: boolean;
}): ReadonlyMap<HarnessChatSessionId, ProjectId> {
  const next = new Map(input.current);
  const sessionIds = input.applyToAll ? input.unresolvedSessionIds : [input.sessionId];
  for (const sessionId of sessionIds) next.set(sessionId, input.projectId);
  return next;
}
