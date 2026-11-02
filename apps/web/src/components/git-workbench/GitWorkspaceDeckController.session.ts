import type { EnvironmentId, GitCommitFileDiffResult, GitHistoryItem } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import type {
  GitCurrentFileState,
  GitWorkbenchRebaseNode,
  GitWorkbenchTabId,
} from "./GitWorkbench.types";
import { selectBufferedPathsForScope } from "./gitWorkspaceDeck.logic";
import { mapDiff } from "./GitWorkspaceDeckController.model";
import {
  bufferedFileEdits,
  deckSelectionByThread,
  rememberDeckSelection,
  type ScopedWorkspaceDeckSelection,
} from "./GitWorkspaceDeckSessionState";

export interface GitWorkbenchOpenChangesOptions {
  readonly focusCommit?: boolean;
  readonly returnFocusTarget?: HTMLElement | null;
}

export function useGitWorkspaceDeckSession(input: {
  readonly activeTurn: boolean;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId;
  readonly scopeKey: string;
}) {
  const [currentSelection, setCurrentSelection] = useState<ScopedWorkspaceDeckSelection>(() => ({
    card: deckSelectionByThread.get(input.scopeKey) ?? "chat",
    scopeKey: input.scopeKey,
  }));
  const [expandedCard, setExpandedCard] = useState<ChatWorkspaceCardId | null>(null);
  const [activeTab, setActiveTab] = useState<GitWorkbenchTabId>("changes");
  const [commitFocusRequest, setCommitFocusRequest] = useState(0);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Readonly<Record<string, ReturnType<typeof mapDiff>>>>({});
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<GitCurrentFileState | null>(null);
  const [bufferFlushQueue, setBufferFlushQueue] = useState<readonly string[]>(() =>
    !input.activeTurn && input.cwd
      ? selectBufferedPathsForScope(bufferedFileEdits.values(), input.environmentId, input.cwd)
      : [],
  );
  const [historyPath, setHistoryPath] = useState("");
  const [historyRefName, setHistoryRefName] = useState("");
  const [historyCursor, setHistoryCursor] = useState(0);
  const [historySnapshotOid, setHistorySnapshotOid] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<readonly GitHistoryItem[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<number | null>(null);
  const [selectedCommitOid, setSelectedCommitOid] = useState<string | null>(null);
  const [commitPatches, setCommitPatches] = useState<
    Readonly<Record<string, GitCommitFileDiffResult>>
  >({});
  const [commitPatchTarget, setCommitPatchTarget] = useState<{
    readonly oid: string;
    readonly path: string;
  } | null>(null);
  const [rebasePlan, setRebasePlan] = useState<readonly GitWorkbenchRebaseNode[]>([]);
  const [rebasePlanTarget, setRebasePlanTarget] = useState<string | null>(null);
  const [rebasePreparedTarget, setRebasePreparedTarget] = useState<string | null>(null);
  const [rebaseUpstreamRef, setRebaseUpstreamRef] = useState<string | null>(null);
  const [resetScope, setResetScope] = useState(input.scopeKey);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const entryReturnFocusTargetRef = useRef<{
    readonly scopeKey: string;
    readonly element: HTMLElement | null;
  } | null>(null);
  const [workbenchReturnFocusRef] = useState(() => ({
    get current() {
      const origin = entryReturnFocusTargetRef.current?.element;
      return origin?.isConnected &&
        origin !== origin.ownerDocument.body &&
        !origin.closest("[inert]")
        ? origin
        : expandButtonRef.current;
    },
  }));

  if (resetScope !== input.scopeKey) {
    setResetScope(input.scopeKey);
    setCurrentSelection({
      card: deckSelectionByThread.get(input.scopeKey) ?? "chat",
      scopeKey: input.scopeKey,
    });
    setExpandedCard(null);
    setActiveTab("changes");
    setCommitFocusRequest(0);
    setSelectedChangeId(null);
    setSelectedFilePath(null);
    setCurrentFile(null);
    setBufferFlushQueue(
      !input.activeTurn && input.cwd
        ? selectBufferedPathsForScope(bufferedFileEdits.values(), input.environmentId, input.cwd)
        : [],
    );
    setDiffs({});
    setHistoryPath("");
    setHistoryRefName("");
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
    setCommitPatches({});
    setRebasePlan([]);
    setRebasePlanTarget(null);
    setRebasePreparedTarget(null);
    setRebaseUpstreamRef(null);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the previous workspace's DOM return-focus target when navigation changes the mounted scope
  useEffect(() => {
    if (entryReturnFocusTargetRef.current?.scopeKey !== input.scopeKey)
      entryReturnFocusTargetRef.current = null;
  }, [input.scopeKey]);

  const openChanges = (options: GitWorkbenchOpenChangesOptions = {}) => {
    if (expandedCard !== "git") {
      const activeElement = typeof document === "undefined" ? null : document.activeElement;
      entryReturnFocusTargetRef.current = {
        scopeKey: input.scopeKey,
        element:
          options.returnFocusTarget ??
          (typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement
            ? activeElement
            : null),
      };
    }
    rememberDeckSelection(input.scopeKey, "git");
    setCurrentSelection({ card: "git", scopeKey: input.scopeKey });
    setActiveTab("changes");
    setExpandedCard("git");
    if (options.focusCommit) setCommitFocusRequest((request) => request + 1);
  };

  const resetHistory = (path: string) => {
    setHistoryPath(path);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  };

  const resetHistoryRef = (refName: string) => {
    setHistoryRefName(refName);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  };

  return {
    activeTab,
    bufferFlushQueue,
    commitFocusRequest,
    commitPatches,
    commitPatchTarget,
    currentFile,
    currentSelection,
    diffs,
    expandedCard,
    expandButtonRef,
    historyCursor,
    historyItems,
    historyNextCursor,
    historyPath,
    historyRefName,
    historySnapshotOid,
    openChanges,
    rebasePlan,
    rebasePlanTarget,
    rebasePreparedTarget,
    rebaseUpstreamRef,
    resetHistory,
    resetHistoryRef,
    selectedChangeId,
    selectedCommitOid,
    selectedFilePath,
    setActiveTab,
    setBufferFlushQueue,
    setCommitPatches,
    setCommitPatchTarget,
    setCurrentFile,
    setCurrentSelection,
    setDiffs,
    setExpandedCard,
    setHistoryCursor,
    setHistoryItems,
    setHistoryNextCursor,
    setHistorySnapshotOid,
    setRebasePlan,
    setRebasePlanTarget,
    setRebasePreparedTarget,
    setRebaseUpstreamRef,
    setSelectedChangeId,
    setSelectedCommitOid,
    setSelectedFilePath,
    workbenchReturnFocusRef,
  };
}
