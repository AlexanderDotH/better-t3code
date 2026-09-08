import type {
  HarnessChatSelection,
  HarnessChatSessionId,
  HarnessChatSummary,
} from "@t3tools/contracts";

export type HarnessChatSelectionState =
  | {
      readonly mode: "allMatching";
      readonly excludedSessionIds: ReadonlyArray<HarnessChatSessionId>;
    }
  | {
      readonly mode: "only";
      readonly sessionIds: ReadonlyArray<HarnessChatSessionId>;
    };

export type HarnessChatSelectionCheckState = boolean | "indeterminate";

export function createDefaultHarnessChatSelection(): HarnessChatSelectionState {
  return { mode: "allMatching", excludedSessionIds: [] };
}

export function clearHarnessChatSelection(): HarnessChatSelectionState {
  return { mode: "only", sessionIds: [] };
}

export function selectAllHarnessChats(): HarnessChatSelectionState {
  return createDefaultHarnessChatSelection();
}

export function isHarnessChatSelected(
  selection: HarnessChatSelectionState,
  sessionId: HarnessChatSessionId,
): boolean {
  if (selection.mode === "allMatching") {
    return !selection.excludedSessionIds.includes(sessionId);
  }
  return selection.sessionIds.includes(sessionId);
}

function addUnique(
  values: ReadonlyArray<HarnessChatSessionId>,
  value: HarnessChatSessionId,
): ReadonlyArray<HarnessChatSessionId> {
  return values.includes(value) ? values : [...values, value];
}

function without(
  values: ReadonlyArray<HarnessChatSessionId>,
  value: HarnessChatSessionId,
): ReadonlyArray<HarnessChatSessionId> {
  return values.filter((candidate) => candidate !== value);
}

export function setHarnessChatSelected(
  selection: HarnessChatSelectionState,
  sessionId: HarnessChatSessionId,
  selected: boolean,
): HarnessChatSelectionState {
  if (selection.mode === "allMatching") {
    return {
      mode: "allMatching",
      excludedSessionIds: selected
        ? without(selection.excludedSessionIds, sessionId)
        : addUnique(selection.excludedSessionIds, sessionId),
    };
  }

  return {
    mode: "only",
    sessionIds: selected
      ? addUnique(selection.sessionIds, sessionId)
      : without(selection.sessionIds, sessionId),
  };
}

export function getHarnessChatSelectionState(
  selection: HarnessChatSelectionState,
  visibleSessionIds: ReadonlyArray<HarnessChatSessionId>,
): HarnessChatSelectionCheckState {
  if (visibleSessionIds.length === 0) return false;

  const selectedCount = visibleSessionIds.filter((sessionId) =>
    isHarnessChatSelected(selection, sessionId),
  ).length;
  if (selectedCount === 0) return false;
  if (selectedCount === visibleSessionIds.length) return true;
  return "indeterminate";
}

export function toHarnessChatSelection(
  selection: HarnessChatSelectionState,
  options: { readonly includeArchived: boolean },
): HarnessChatSelection {
  if (selection.mode === "only") {
    return selection;
  }

  return {
    ...selection,
    query: "",
    includeArchived: options.includeArchived,
  };
}

export function getSelectedUnresolvedHarnessChats(
  chats: ReadonlyArray<HarnessChatSummary>,
  selection: HarnessChatSelectionState,
): ReadonlyArray<HarnessChatSummary> {
  return chats.filter(
    (chat) =>
      chat.targetProject.kind === "unresolved" && isHarnessChatSelected(selection, chat.sessionId),
  );
}
