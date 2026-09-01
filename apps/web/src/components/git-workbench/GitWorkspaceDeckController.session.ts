import type { EnvironmentId, GitCommitFileDiffResult, GitHistoryItem } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

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
  type ScopedWorkspaceDeckSelection,
} from "./GitWorkspaceDeckSessionState";

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
  const [activeTab, setActiveTab] = useState<GitWorkbenchTabId>("overview");
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Readonly<Record<string, ReturnType<typeof mapDiff>>>>({});
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<GitCurrentFileState | null>(null);
  const [bufferFlushQueue, setBufferFlushQueue] = useState<readonly string[]>([]);
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
  const [rebaseUpstreamRef, setRebaseUpstreamRef] = useState<string | null>(null);
  const previousActiveTurnRef = useRef(input.activeTurn);
  const resetScopeRef = useRef<string | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const flushingBufferKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (resetScopeRef.current === input.scopeKey) return;
    resetScopeRef.current = input.scopeKey;
    previousActiveTurnRef.current = input.activeTurn;
    setCurrentSelection({
      card: deckSelectionByThread.get(input.scopeKey) ?? "chat",
      scopeKey: input.scopeKey,
    });
    setExpandedCard(null);
    setActiveTab("overview");
    setSelectedChangeId(null);
    setSelectedFilePath(null);
    setCurrentFile(null);
    setBufferFlushQueue(
      !input.activeTurn && input.cwd
        ? selectBufferedPathsForScope(bufferedFileEdits.values(), input.environmentId, input.cwd)
        : [],
    );
    flushingBufferKeyRef.current = null;
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
    setRebaseUpstreamRef(null);
  }, [input.activeTurn, input.cwd, input.environmentId, input.scopeKey]);

  const resetHistory = useCallback((path: string) => {
    setHistoryPath(path);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  }, []);

  const resetHistoryRef = useCallback((refName: string) => {
    setHistoryRefName(refName);
    setHistoryCursor(0);
    setHistorySnapshotOid(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setSelectedCommitOid(null);
  }, []);

  return {
    activeTab,
    bufferFlushQueue,
    commitPatches,
    commitPatchTarget,
    currentFile,
    currentSelection,
    diffs,
    expandedCard,
    expandButtonRef,
    flushingBufferKeyRef,
    historyCursor,
    historyItems,
    historyNextCursor,
    historyPath,
    historyRefName,
    historySnapshotOid,
    previousActiveTurnRef,
    rebasePlan,
    rebasePlanTarget,
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
    setRebaseUpstreamRef,
    setSelectedChangeId,
    setSelectedCommitOid,
    setSelectedFilePath,
  };
}
