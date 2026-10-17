import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useBetterT3DeviceFeature } from "~/hooks/useBetterT3Feature";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { ensureLocalApi } from "~/localApi";
import { requestGitActionsControl, type GitCommitOutcome } from "~/components/gitActionsControlBus";
import { buildMenuItems } from "~/components/GitActionsControl.logic";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "~/components/ui/toast";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import { GitCommitComposer } from "./GitCommitComposer";
import { defaultGitReviewChange, gitReviewFiles } from "./GitChangesPanel.model";
import { useGitFileNavigation } from "./useGitFileNavigation";
import { deriveGitPrimaryAction } from "./GitWorkbench.logic";
import { subscribeGitWorkbenchEntry } from "./gitWorkbenchEntryBus";
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
import { deckSelectionByThread, rememberDeckSelection } from "./GitWorkspaceDeckSessionState";
import { useGitWorkspaceDeckCards } from "./GitWorkspaceDeckCards";
import {
  useGitWorkspaceDeckSession,
  type GitWorkbenchOpenChangesOptions,
} from "./GitWorkspaceDeckController.session";
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
  const currentScopeRef = useRef<string | null>(scopeKey);
  useLayoutEffect(() => {
    currentScopeRef.current = scopeKey;
    return () => {
      currentScopeRef.current = null;
    };
  }, [scopeKey]);
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
  const selectionBlocked = props.actionRequired || props.isRecording;
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
    commitFocusRequest,
    currentFile,
    currentSelection,
    expandedCard,
    expandButtonRef,
    historyItems,
    historyNextCursor,
    historyPath,
    historyRefName,
    historySnapshotOid,
    openChanges: openSessionChanges,
    rebasePlan,
    rebasePreparedTarget,
    rebaseUpstreamRef,
    resetHistory,
    resetHistoryRef,
    selectedChangeId,
    selectedFilePath,
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
    workbenchReturnFocusRef,
  } = session;
  const resolvedActiveCard = resolveScopedWorkspaceDeckActiveCard({
    availableCardIds,
    currentSelection,
    rememberedCard: deckSelectionByThread.get(scopeKey) ?? null,
    scopeKey,
  });
  const gitExpanded = expandedCard === "git";
  const mcpExpanded = expandedCard === "mcp";
  const scopeReady = currentSelection.scopeKey === scopeKey;
  const {
    navigate: navigateFile,
    initialDraft: currentFileDraft,
    onDraftChange: onCurrentFileDraftChange,
  } = useGitFileNavigation({
    active: resolvedActiveCard === "git" && gitExpanded && activeTab === "changes",
    blocked: selectionBlocked,
    currentFile,
    cwd: props.cwd,
    environmentId: props.environmentId,
    scopeKey,
    scopeReady,
  });
  const changeTab = useCallback(
    (tab: typeof activeTab) => {
      if (tab === activeTab) return;
      navigateFile(() => setActiveTab(tab));
    },
    [activeTab, navigateFile, setActiveTab],
  );
  const changeExpandedCard = useCallback(
    (card: ChatWorkspaceCardId | null) => {
      navigateFile(() => setExpandedCard(card));
    },
    [navigateFile, setExpandedCard],
  );
  const selectCard = useCallback(
    (card: ChatWorkspaceCardId) => {
      navigateFile(() => {
        rememberDeckSelection(scopeKey, card);
        setCurrentSelection({ card, scopeKey });
      });
    },
    [navigateFile, scopeKey, setCurrentSelection],
  );

  const openChanges = useCallback(
    (options?: GitWorkbenchOpenChangesOptions): boolean => {
      if (!gitAvailable || selectionBlocked) return false;
      openSessionChanges(options);
      return true;
    },
    [gitAvailable, openSessionChanges, selectionBlocked],
  );
  useEffect(
    () =>
      subscribeGitWorkbenchEntry((request) => {
        if (
          !gitAvailable ||
          request.environmentId !== props.environmentId ||
          request.cwd !== props.cwd
        )
          return false;
        openChanges(request);
        return true;
      }),
    [gitAvailable, openChanges, props.cwd, props.environmentId],
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

  const readOnly =
    !sessionAccessQuery.data?.scopes?.includes("orchestration:operate") ||
    contractSnapshot?.truncated === true;
  const selectedPathRef = useRef<{ scopeKey: string; path: string } | null>(null);
  useEffect(() => {
    if (selectedChangeId === null) {
      selectedPathRef.current = null;
      return;
    }
    const selected = changes.find((change) => change.id === selectedChangeId);
    if (selected) {
      selectedPathRef.current = { scopeKey, path: selected.path };
      return;
    }
    const previous = selectedPathRef.current;
    if (previous?.scopeKey !== scopeKey) return;
    const file = gitReviewFiles(changes).find((entry) => entry.path === previous.path);
    setSelectedChangeId(file ? (defaultGitReviewChange(file)?.id ?? null) : null);
  }, [changes, scopeKey, selectedChangeId, setSelectedChangeId]);

  const actionInput = useMemo(
    () => ({
      activeTurn: props.activeTurn,
      changes,
      contractSnapshot,
      currentFile,
      cwd: props.cwd,
      environmentId: props.environmentId,
      queuedWorkflow: projection?.queuedWorkflow ?? null,
      readOnly,
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
      readOnly,
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
    refreshWorkbench,
    upsertQueue,
    queueWorkflow,
    resubmitQueuedWorkflow,
    restoreUndo,
    runOperation,
    runWorkbenchOperation,
    saveCurrentFile,
    setFilesStaged,
    stagingPending,
    stagingError,
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
  const commitBlocked =
    readOnly ||
    !scopeReady ||
    snapshot?.stale === true ||
    workbenchQuery.isPending ||
    operation !== null ||
    (snapshot?.conflicts ?? 0) > 0 ||
    operationProgress.status === "running" ||
    stagingPending ||
    selectionBlocked;
  const deliveryActions = buildMenuItems(
    props.legacyStatus,
    commitBlocked || props.activeTurn,
    props.legacyStatus?.hasPrimaryRemote ?? false,
  );
  const pushAction = deliveryActions.find((action) => action.id === "push");
  const changeRequestAction = deliveryActions.find((action) => action.id === "pr");
  const changeRequestLabel = getSourceControlPresentation(props.legacyStatus?.sourceControlProvider)
    .terminology.shortLabel;

  const pushAvailable = pushAction?.disabled === false;
  const pullAvailable = Boolean(
    !commitBlocked &&
    !props.activeTurn &&
    props.legacyStatus?.refName &&
    props.legacyStatus.hasUpstream &&
    !props.legacyStatus.hasWorkingTreeChanges &&
    props.legacyStatus.aheadCount === 0,
  );
  const primaryAction = deriveGitPrimaryAction(
    {
      ...status,
      blocked:
        !snapshot ||
        workbenchQuery.isPending ||
        status.kind === "stale" ||
        status.kind === "unavailable" ||
        status.kind === "disconnected",
      operation,
      pushAvailable,
      pullAvailable,
      operationRunning: operationProgress.status === "running",
      pullRequest: snapshot?.pullRequest,
      readOnly,
    },
    translate,
  );
  const compactQuickAction = {
    disabled: primaryAction.disabled || selectionBlocked,
    label: primaryAction.label,
    onSelect: () => {
      if (primaryAction.disabled || selectionBlocked) return;
      switch (primaryAction.id) {
        case "prepare-commit":
          openChanges({ focusCommit: true });
          return;
        case "resolve-conflicts":
          openChanges();
          return;
        case "review-operation":
        case "guided-sync":
          if (openChanges()) setActiveTab("operations");
          return;
        case "view-history":
          if (openChanges()) setActiveTab("history");
          return;
        case "view-pull-request":
          if (snapshot?.pullRequest) {
            void ensureLocalApi().shell.openExternal(snapshot.pullRequest.url);
          }
          return;
        case "pull":
        case "push":
          if (props.cwd) {
            requestGitActionsControl({
              cwd: props.cwd,
              environmentId: props.environmentId,
              intent: primaryAction.id,
            });
          }
          return;
        case "unavailable":
          return;
      }
    },
  };

  const openCurrentFileInWorkbench = useCallback(
    (path: string) => {
      if (selectedFilePath === path) {
        setActiveTab("changes");
        return;
      }
      navigateFile(() => {
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
      });
    },
    [navigateFile, selectedFilePath, setActiveTab, setCurrentFile, setSelectedFilePath],
  );

  const selectChange = useCallback(
    (changeId: string | null) => {
      navigateFile(() => {
        setActiveTab("changes");
        setSelectedChangeId(changeId);
        setSelectedFilePath(null);
        setCurrentFile(null);
      });
    },
    [navigateFile, setActiveTab, setCurrentFile, setSelectedChangeId, setSelectedFilePath],
  );

  async function queuePreparedCommit(message: {
    commitMessage?: string;
  }): Promise<GitCommitOutcome> {
    if (!props.cwd || !snapshot || commitBlocked || queue !== null) {
      return { status: "blocked", reason: "busy" };
    }
    const refreshed = await refreshWorkbench({
      environmentId: props.environmentId,
      input: { cwd: props.cwd },
    });
    if (currentScopeRef.current !== scopeKey) return { status: "cancelled" };
    if (refreshed._tag === "Failure") {
      if (isAtomCommandInterrupted(refreshed)) return { status: "cancelled" };
      const error = squashAtomCommandFailure(refreshed);
      return {
        status: "failure",
        message: error instanceof Error ? error.message : translate("git.common.errorOccurred"),
      };
    }
    if (!refreshed.value.isRepository || refreshed.value.truncated) {
      return { status: "blocked", reason: "unavailable" };
    }
    if (refreshed.value.stateToken !== snapshot.stateToken) {
      return { status: "blocked", reason: "changed" };
    }
    if (refreshed.value.totals.staged === 0) return { status: "blocked", reason: "empty" };
    if (refreshed.value.operation.kind !== "none" || refreshed.value.totals.conflicted > 0) {
      return { status: "blocked", reason: "operation" };
    }
    const result = await upsertQueue({
      environmentId: props.environmentId,
      input: {
        cwd: props.cwd,
        expectedStateToken: snapshot.stateToken,
        plan: {
          kind: "delivery",
          stage: { mode: "staged" },
          push: false,
          createPullRequest: false,
          ...message,
        },
        ...(props.threadId ? { threadId: props.threadId } : {}),
        ...(props.turnId ? { turnId: props.turnId } : {}),
      },
    });
    if (result._tag === "Success") return { status: "queued" };
    if (isAtomCommandInterrupted(result)) return { status: "cancelled" };
    const error = squashAtomCommandFailure(result);
    return {
      status: "failure",
      message: error instanceof Error ? error.message : translate("git.common.errorOccurred"),
    };
  }

  const panel = (
    <GitWorkbenchPanel
      activeTab={activeTab}
      branches={branches}
      changes={changes}
      commitComposer={
        props.cwd && snapshot ? (
          <GitCommitComposer
            activeTurn={props.activeTurn}
            blocked={commitBlocked}
            changeRequest={
              changeRequestAction
                ? {
                    enabled: !changeRequestAction.disabled,
                    label: translate(
                      changeRequestAction.kind === "open_pr"
                        ? "git.commit.viewRequest"
                        : "git.commit.createRequest",
                      { kind: changeRequestLabel },
                    ),
                    openExisting: changeRequestAction.kind === "open_pr",
                  }
                : undefined
            }
            cwd={props.cwd}
            environmentId={props.environmentId}
            focusRequest={commitFocusRequest}
            hasQueuedWorkflow={queue !== null}
            nextAction={primaryAction.id === "prepare-commit" ? undefined : compactQuickAction}
            onQueueCommit={queuePreparedCommit}
            onSettled={workbenchQuery.refresh}
            partialStagedCount={
              gitReviewFiles(changes).filter((file) => file.staging === "partial").length
            }
            pushAvailable={pushAvailable}
            stagedCount={snapshot.staged}
            stateToken={snapshot.stateToken}
          />
        ) : undefined
      }
      currentFile={scopeReady ? currentFile : null}
      currentFileDraft={currentFileDraft}
      editorPath={scopeReady ? selectedFilePath : null}
      indexReadOnly={
        props.activeTurn ||
        snapshot?.stale === true ||
        workbenchQuery.isPending ||
        operationProgress.status === "running"
      }
      onCurrentFileDraftChange={onCurrentFileDraftChange}
      onCloseCurrentFile={() =>
        navigateFile(() => {
          setSelectedFilePath(null);
          setCurrentFile(null);
        })
      }
      onSetFilesStaged={setFilesStaged}
      stagingPending={stagingPending}
      stagingError={stagingError}
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
      onChangeTab={changeTab}
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
      pushAvailable={pushAvailable}
      pullAvailable={pullAvailable}
      readOnly={readOnly}
      rebasePlan={rebasePlan}
      rebasePreparedTarget={rebasePreparedTarget}
      rebaseUpstreamRef={rebaseUpstreamRef}
      selectedChangeId={selectedChangeId}
      selectedCommit={selectedCommit}
      showTabs={false}
      snapshot={snapshot}
      undoSnapshots={undoSnapshots}
      upgradeRequired={!props.workbenchSupported}
    />
  );

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
      onActiveTabChange={changeTab}
      onExpand={() => openChanges()}
      onExpandedChange={(open) => {
        if (open) openChanges();
        else changeExpandedCard(null);
      }}
      panel={panel}
      quickAction={compactQuickAction}
      repositoryLabel={
        snapshot?.worktreeRoot ?? props.cwd ?? translate("git.workbench.repositoryFallback")
      }
      returnFocusRef={workbenchReturnFocusRef}
      showOperationsTab={Boolean(operation || queue || undoSnapshots.length || rebasePlan.length)}
      status={status}
    />
  );

  const cards = useGitWorkspaceDeckCards({
    controller: props,
    gitAvailable,
    gitCard,
    mcpExpanded,
    onExpandedCardChange: changeExpandedCard,
    onOpenChanges: openChanges,
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
    onExpandedCardChange: changeExpandedCard,
    onRestoreChatFocus: () => props.composerRef.current?.focusAtEnd(),
    resetKey: deckResetKey,
  };
}
