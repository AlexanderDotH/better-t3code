import { useAtomValue } from "@effect/atom-react";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useBetterT3DeviceFeature } from "~/hooks/useBetterT3Feature";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { ensureLocalApi } from "~/localApi";
import { requestGitActionsControl } from "~/components/gitActionsControlBus";
import { toastManager } from "~/components/ui/toast";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import type { GitBranch, GitHistoryState } from "./GitWorkbench.types";
import {
  compactStatus,
  DESKTOP_WORKBENCH_MEDIA_QUERY,
  EMPTY_HISTORY,
  fallbackCompactStatus,
  mapCommitDetail,
  mapOperation,
  mapQueue,
  mapUndo,
  relativeAge,
  resolveGitDeckCardIds,
  resolveScopedWorkspaceDeckActiveCard,
  type GitWorkspaceDeckControllerProps,
} from "./GitWorkspaceDeckController.model";
import {
  bufferedFileEdits,
  deckSelectionByThread,
  rememberDeckSelection,
} from "./GitWorkspaceDeckSessionState";
import { useGitWorkspaceDeckCards } from "./GitWorkspaceDeckCards";
import { useGitWorkspaceDeckSession } from "./GitWorkspaceDeckController.session";
import { useGitWorkspaceDeckActions } from "./GitWorkspaceDeckController.actions";
import { useGitWorkspaceDeckEffects } from "./GitWorkspaceDeckController.effects";
import { useGitWorkspaceDeckQueries } from "./GitWorkspaceDeckController.queries";
import { GitWorkspaceDeckGitCard } from "./GitWorkspaceDeckController.presentation";

export function useGitWorkspaceDeckController(props: GitWorkspaceDeckControllerProps) {
  const translate = useInterfaceTranslator().message;
  const isDesktop = useMediaQuery(DESKTOP_WORKBENCH_MEDIA_QUERY);
  const workspaceCardDeckEnabled = useBetterT3DeviceFeature("chat.workspaceCardDeck");
  const gitWorkbenchEnabled = useBetterT3DeviceFeature("workspace.gitWorkbench");
  const scopeKey = `${props.environmentId}:${props.cwd ?? ""}:${props.threadId ?? ""}`;
  const availableCardIds = useMemo(() => {
    if (!workspaceCardDeckEnabled) return ["chat"] as const;
    return resolveGitDeckCardIds({
      cwd: props.cwd,
      isRepository: props.legacyStatus?.isRepo ?? null,
      workbenchSupported: props.workbenchSupported && gitWorkbenchEnabled,
    });
  }, [
    gitWorkbenchEnabled,
    props.cwd,
    props.legacyStatus?.isRepo,
    props.workbenchSupported,
    workspaceCardDeckEnabled,
  ]);
  const gitAvailable = workspaceCardDeckEnabled && isDesktop && availableCardIds.includes("git");
  const deckResetKey = scopeKey;
  const session = useGitWorkspaceDeckSession({
    activeTurn: props.activeTurn,
    cwd: props.cwd,
    environmentId: props.environmentId,
    scopeKey,
  });
  const {
    activeTab,
    commitPatches,
    currentFile,
    currentSelection,
    expandedCard,
    expandButtonRef,
    historyItems,
    historyNextCursor,
    historyPath,
    historyRefName,
    historySnapshotOid,
    rebasePlan,
    rebaseUpstreamRef,
    resetHistory,
    resetHistoryRef,
    selectedChangeId,
    setActiveTab,
    setCommitPatchTarget,
    setCurrentFile,
    setCurrentSelection,
    setDiffs,
    setExpandedCard,
    setHistoryCursor,
    setRebasePlan,
    setRebasePlanTarget,
    setSelectedChangeId,
    setSelectedCommitOid,
    setSelectedFilePath,
  } = session;
  const resolvedActiveCard = resolveScopedWorkspaceDeckActiveCard({
    availableCardIds,
    currentSelection,
    rememberedCard: deckSelectionByThread.get(scopeKey) ?? null,
    scopeKey,
  });
  const gitExpanded = expandedCard === "git";
  const mcpExpanded = expandedCard === "mcp";
  const confirmBufferedNavigation = useCallback(async () => {
    if (bufferedFileEdits.size === 0) return false;
    const leave = await ensureLocalApi().dialogs.confirm(
      "You have Git workbench edits waiting for the active agent turn to settle. Leave this view? The edits will stay in memory for this session.",
    );
    return !leave;
  }, []);
  useBlocker({
    shouldBlockFn: confirmBufferedNavigation,
    enableBeforeUnload: () => bufferedFileEdits.size > 0,
  });
  const selectCard = useCallback(
    (card: ChatWorkspaceCardId) => {
      rememberDeckSelection(scopeKey, card);
      setCurrentSelection({ card, scopeKey });
    },
    [scopeKey],
  );

  const queries = useGitWorkspaceDeckQueries({
    gitAvailable,
    isDesktop,
    props,
    resolvedActiveCard,
    session,
  });
  const {
    changes,
    changesDiffQuery,
    commitDetailQuery,
    contractSnapshot,
    fileQuery,
    historyQuery,
    insights,
    projection,
    refsQuery,
    sessionAccessQuery,
    snapshot,
    workbenchQuery,
  } = queries;

  const actionInput = useMemo(
    () => ({
      activeTurn: props.activeTurn,
      changes,
      contractSnapshot,
      currentFile,
      cwd: props.cwd,
      environmentId: props.environmentId,
      queuedWorkflow: projection?.queuedWorkflow ?? null,
      refreshChangesDiff: changesDiffQuery.refresh,
      refreshFile: fileQuery.refresh,
      refreshWorkbenchQuery: workbenchQuery.refresh,
      setCurrentFile,
      setDiffs,
      snapshot,
      threadId: props.threadId ?? null,
      translate,
      turnId: props.turnId ?? null,
    }),
    [
      changes,
      changesDiffQuery.refresh,
      contractSnapshot,
      currentFile,
      fileQuery.refresh,
      projection?.queuedWorkflow,
      props.activeTurn,
      props.cwd,
      props.environmentId,
      props.threadId,
      props.turnId,
      setCurrentFile,
      setDiffs,
      snapshot,
      translate,
      workbenchQuery.refresh,
    ],
  );

  const actions = useGitWorkspaceDeckActions(actionInput);
  const {
    applyChangeSelection,
    cancelQueue,
    queueWorkflow,
    resubmitQueuedWorkflow,
    restoreUndo,
    runOperation,
    runWorkbenchOperation,
    saveCurrentFile,
  } = actions;
  const operationProgress = useAtomValue(
    gitWorkbenchEnvironment.operationProgress({
      environmentId: props.environmentId,
      cwd: props.cwd ?? "",
    }),
  );

  useGitWorkspaceDeckEffects({
    actions,
    availableCardIds,
    isDesktop,
    props,
    queries,
    resolvedActiveCard,
    scopeKey,
    session,
  });

  const queue = mapQueue(projection?.queuedWorkflow ?? null);
  const operation = mapOperation(contractSnapshot);
  const undoSnapshots = (projection?.undoSnapshots ?? []).map(mapUndo);
  const readOnly =
    sessionAccessQuery.data?.scopes !== undefined &&
    !sessionAccessQuery.data.scopes.includes("orchestration:operate");
  const branches: readonly GitBranch[] =
    refsQuery.data?.refs.map((ref) => ({
      current: ref.current,
      name: ref.name,
      oid: ref.current ? (contractSnapshot?.headOid ?? null) : null,
      remote: ref.isRemote ?? false,
    })) ?? [];
  const history: GitHistoryState = {
    ...EMPTY_HISTORY,
    commits: historyItems.map((commit) => ({
      author: commit.authorName,
      authoredAt: commit.authoredAt,
      decorations: commit.decorations,
      oid: commit.oid,
      parents: commit.parents,
      subject: commit.subject,
    })),
    ...(historyQuery.error ? { error: historyQuery.error } : {}),
    hasMore: historyNextCursor !== null,
    loading: historyQuery.isPending,
    snapshotOid: historySnapshotOid,
  };
  const selectedCommit = mapCommitDetail(commitDetailQuery.data, commitPatches);
  const fallbackStatus = fallbackCompactStatus(props.legacyStatus, props.legacyStatusPending);
  const status = compactStatus(snapshot, fallbackStatus);
  const compactQuickAction = (() => {
    if (status.conflicts > 0) {
      return {
        label: translate("git.quick.resolveConflicts"),
        onSelect: () => {
          selectCard("git");
          setActiveTab("changes");
          setExpandedCard("git");
        },
      };
    }
    const intent =
      status.staged > 0
        ? "commit-staged"
        : status.unstaged + status.untracked > 0
          ? "stage-all-and-commit"
          : status.behind > 0
            ? "pull"
            : status.ahead > 0
              ? "push"
              : null;
    return intent
      ? {
          label:
            intent === "commit-staged"
              ? "Commit staged"
              : intent === "stage-all-and-commit"
                ? "Stage all & commit"
                : intent === "pull"
                  ? "Pull"
                  : "Push",
          onSelect: () =>
            props.cwd &&
            requestGitActionsControl({
              cwd: props.cwd,
              environmentId: props.environmentId,
              intent,
            }),
        }
      : null;
  })();

  const openCurrentFileInWorkbench = useCallback((path: string) => {
    setSelectedFilePath(path);
    setCurrentFile({
      baseContent: "",
      content: "",
      loading: true,
      path,
      revision: "loading",
      saveState: "idle",
    });
    setActiveTab("changes");
  }, []);

  const selectChange = useCallback(
    (changeId: string | null) => {
      setSelectedChangeId(changeId);
      const change = changes.find((candidate) => candidate.id === changeId);
      if (change) openCurrentFileInWorkbench(change.path);
    },
    [changes, openCurrentFileInWorkbench],
  );

  const panel = (
    <GitWorkbenchPanel
      activeTab={activeTab}
      branches={branches}
      changes={changes}
      currentFile={currentFile}
      forcePushTarget={
        operationProgress.status === "completed" &&
        (operationProgress.actionKind === "guided_rebase" ||
          operationProgress.actionKind === "interactive_rebase" ||
          operationProgress.actionKind === "reset") &&
        contractSnapshot?.upstreamRef &&
        contractSnapshot.upstreamOid
          ? {
              expectedRemoteOid: contractSnapshot.upstreamOid,
              remoteRef: contractSnapshot.upstreamRef,
            }
          : undefined
      }
      history={history}
      historyPathFilter={historyPath}
      historyRefFilter={historyRefName}
      insights={insights}
      loading={workbenchQuery.isPending}
      onApplySelection={applyChangeSelection}
      onCancelQueue={(queueId) => {
        const existing = projection?.queuedWorkflow;
        if (!props.cwd || !existing || existing.id !== queueId) return;
        void cancelQueue({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, expectedRevision: existing.revision, workflowId: queueId },
        });
      }}
      onChangeTab={setActiveTab}
      onCreateBranch={(name) => {
        if (!props.cwd || !snapshot) return;
        void runOperation({
          environmentId: props.environmentId,
          input: {
            action: { kind: "create_branch", name },
            cwd: props.cwd,
            expectedStateToken: snapshot.stateToken,
          },
        });
      }}
      onEditQueue={resubmitQueuedWorkflow}
      onHistoryPathFilterChange={resetHistory}
      onHistoryRefFilterChange={resetHistoryRef}
      onLoadCommit={setSelectedCommitOid}
      onLoadCommitPatch={(oid, path) => setCommitPatchTarget({ oid, path })}
      onLoadMoreHistory={() => {
        if (historyNextCursor !== null && !historyQuery.isPending) {
          setHistoryCursor(historyNextCursor);
        }
      }}
      onOpenCurrentFile={openCurrentFileInWorkbench}
      onPrepareInteractiveRebase={setRebasePlanTarget}
      onQueueWorkflow={queueWorkflow}
      onRefreshChange={() => changesDiffQuery.refresh()}
      onRestoreUndo={(snapshotId) => {
        if (!props.cwd || !snapshot) return;
        void restoreUndo({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, expectedStateToken: snapshot.stateToken, snapshotId },
        });
      }}
      onRetryQueue={(queueId) => {
        const existing = projection?.queuedWorkflow;
        if (!existing || existing.id !== queueId) return;
        resubmitQueuedWorkflow(queueId, existing.plan);
      }}
      onRunOperation={runWorkbenchOperation}
      onSaveCurrentFile={saveCurrentFile}
      onSelectChange={selectChange}
      onSelectCommit={setSelectedCommitOid}
      onSwitchBranch={(refName) => {
        if (!props.cwd || !snapshot) return;
        void runOperation({
          environmentId: props.environmentId,
          input: {
            action: { kind: "switch_branch", refName },
            cwd: props.cwd,
            expectedStateToken: snapshot.stateToken,
          },
        });
      }}
      onUpdateRebasePlan={setRebasePlan}
      operation={operation}
      operationProgress={
        operationProgress.status === "idle"
          ? null
          : {
              label:
                operationProgress.latest?._tag === "progress"
                  ? operationProgress.latest.label
                  : operationProgress.latest?._tag === "failed"
                    ? operationProgress.latest.message
                    : operationProgress.latest?._tag === "started"
                      ? `Starting ${operationProgress.latest.actionKind.replaceAll("_", " ")}`
                      : operationProgress.status === "completed"
                        ? "Git operation completed"
                        : "Starting Git operation",
              status: operationProgress.status,
            }
      }
      queue={queue}
      readOnly={readOnly}
      rebasePlan={rebasePlan}
      rebaseUpstreamRef={rebaseUpstreamRef}
      selectedChangeId={selectedChangeId}
      selectedCommit={selectedCommit}
      showTabs={false}
      snapshot={snapshot}
      undoSnapshots={undoSnapshots}
      upgradeRequired={!props.workbenchSupported}
    />
  );

  const selectionBlocked = props.actionRequired || props.isRecording;
  const gitCard = (
    <GitWorkspaceDeckGitCard
      activeTab={activeTab}
      {...(props.drawerAvailableHeight === undefined
        ? {}
        : { availableHeight: props.drawerAvailableHeight })}
      blocked={selectionBlocked}
      expanded={gitExpanded}
      expandButtonRef={expandButtonRef}
      lastCommit={
        snapshot?.lastCommit
          ? {
              ageLabel: relativeAge(snapshot.lastCommit.authoredAt),
              summary: snapshot.lastCommit.subject,
            }
          : null
      }
      onActiveTabChange={setActiveTab}
      onExpand={() => {
        if (selectionBlocked) return;
        selectCard("git");
        setExpandedCard("git");
      }}
      onExpandedChange={(open) => setExpandedCard(open ? "git" : null)}
      panel={panel}
      quickAction={compactQuickAction}
      repositoryLabel={
        snapshot?.worktreeRoot ?? props.cwd ?? translate("git.workbench.repositoryFallback")
      }
      showOperationsTab={Boolean(operation || queue || undoSnapshots.length || rebasePlan.length)}
      status={status}
    />
  );

  const cards = useGitWorkspaceDeckCards({
    controller: props,
    gitAvailable,
    gitCard,
    mcpExpanded,
    onExpandedCardChange: setExpandedCard,
    selectCard,
    selectionBlocked,
    status,
  });

  return {
    actionRequired: props.actionRequired,
    activeCard: resolvedActiveCard,
    cards,
    deckEnabled: workspaceCardDeckEnabled,
    expandedCard,
    fallback: props.renderChat({ deckEnabled: false, gitAvailable: false }),
    isDesktop,
    isRecording: props.isRecording,
    mcpExpanded,
    mcpRuntime: props,
    onActiveCardChange: selectCard,
    onBeforeHideChat: () => props.composerRef.current?.dismissTransientUi(),
    onCardSelectionBlocked: (reason: "recording" | "action-required") =>
      toastManager.add({
        type: "info",
        title: translate(
          reason === "recording" ? "git.cards.blockedRecording" : "git.cards.blockedAction",
        ),
      }),
    onExpandedCardChange: setExpandedCard,
    onRestoreChatFocus: () => props.composerRef.current?.focusAtEnd(),
    resetKey: deckResetKey,
  };
}
