import type {
  HarnessChatSessionId,
  HarnessChatSummary,
  HarnessChatSyncRunInput,
  HarnessChatSyncSourceId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

export const HARNESS_CHAT_SYNC_PAGE_SIZE = 10;

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

export function harnessChatStatusState(
  chat: Pick<HarnessChatSummary, "activity" | "hasChanges" | "archived"> & {
    readonly link: null | Pick<NonNullable<HarnessChatSummary["link"]>, "threadId">;
  },
) {
  return {
    activeElsewhere: chat.activity === "active",
    linkedThreadId: chat.link?.threadId ?? null,
    changesAvailable: chat.hasChanges,
    archived: chat.archived,
  } as const;
}

export function harnessChatNeedsTargetResolution(input: {
  readonly chat: Pick<HarnessChatSummary, "sessionId" | "targetProject">;
  readonly selection: HarnessChatSelectionState;
  readonly targetResolutions: ReadonlyMap<HarnessChatSessionId, ProjectId>;
  readonly unresolvedTargetProjectId: ProjectId | null;
}): boolean {
  return (
    isHarnessChatSelected(input.selection, input.chat.sessionId) &&
    input.chat.targetProject.kind === "unresolved" &&
    !input.targetResolutions.has(input.chat.sessionId) &&
    input.unresolvedTargetProjectId === null
  );
}

export function harnessChatSyncOutcome(input: {
  readonly syncedCount: number;
  readonly failedCount: number;
  readonly messagesImported: number;
}) {
  return {
    kind: input.failedCount > 0 ? ("partial" as const) : ("complete" as const),
    syncedCount: input.syncedCount,
    failedCount: input.failedCount,
    messagesImported: input.messagesImported,
  };
}

export function buildHarnessChatSyncRunInput(input: {
  readonly sourceId: HarnessChatSyncSourceId;
  readonly preferredInstanceId: ProviderInstanceId | null;
  readonly selection: HarnessChatSelectionState;
  readonly query: string;
  readonly includeArchived: boolean;
  readonly targetResolutions: ReadonlyMap<HarnessChatSessionId, ProjectId>;
  readonly unresolvedTargetProjectId: ProjectId | null;
}): HarnessChatSyncRunInput {
  return {
    sourceId: input.sourceId,
    selection:
      input.selection.mode === "allMatching"
        ? {
            mode: "allMatching",
            query: input.query,
            includeArchived: input.includeArchived,
            excludedSessionIds: [...input.selection.excludedSessionIds],
          }
        : { mode: "only", sessionIds: [...input.selection.sessionIds] },
    ...(input.preferredInstanceId === null
      ? {}
      : { providerInstanceId: input.preferredInstanceId }),
    targetResolutions: [...input.targetResolutions].map(([sessionId, projectId]) => ({
      sessionId,
      projectId,
    })),
    ...(input.unresolvedTargetProjectId === null
      ? {}
      : { unresolvedTargetProjectId: input.unresolvedTargetProjectId }),
  };
}
