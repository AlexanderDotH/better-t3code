import { NativeStackScreenOptions } from "../../native/StackHeader";
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Option from "effect/Option";
import {
  EnvironmentId,
  resolveBetterT3FeatureFlag,
  ThreadId,
  type ProjectScript,
} from "@t3tools/contracts";
import { resolveThreadAbortPresentation } from "@t3tools/client-runtime/state/thread-abort";
import {
  acceptReasoningRecommendation,
  deriveReasoningRecommendation,
  dismissReasoningRecommendation,
  pendingReasoningOverrideMatchesSelection,
  undoReasoningRecommendationOverride,
} from "@t3tools/client-runtime/reasoning-recommendation";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWorkspaceState } from "../../state/workspace";
import { useEnvironmentQuery } from "../../state/query";
import { dismissGitActionResult, useGitActionProgress } from "../../state/use-vcs-action-state";
import { vcsEnvironment } from "../../state/vcs";

import { EmptyState } from "../../components/EmptyState";
import {
  AndroidScreenHeader,
  type AndroidHeaderAction,
} from "../../components/AndroidScreenHeader";
import { LoadingScreen } from "../../components/LoadingScreen";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { connectionTone } from "../connection/connectionTone";

import {
  useRemoteConnections,
  useRemoteConnectionStatus,
  useRemoteEnvironmentRuntime,
} from "../../state/use-remote-environment-registry";
import { useKnownTerminalSessions } from "../../state/use-terminal-session";
import { useSelectedThreadDetailState } from "../../state/use-thread-detail";
import { useThreadSelection } from "../../state/use-thread-selection";
import { GitActionProgressOverlay } from "./GitActionProgressOverlay";
import {
  buildTerminalMenuSessions,
  nextOpenTerminalId,
  resolveProjectScriptTerminalId,
} from "../terminal/terminalMenu";
import {
  resolvePreferredThreadWorktreePath,
  stagePendingTerminalLaunch,
} from "../terminal/terminalLaunchContext";
import { terminalDebugLog } from "../terminal/terminalDebugLog";
import { ThreadDetailScreen } from "./ThreadDetailScreen";
import { readAutoReasoningStatus } from "./thread-settings-summary";
import {
  ThreadGitControls,
  useThreadGitCenterHeaderItems,
  useThreadGitRightHeaderItems,
} from "./ThreadGitControls";
import { GitOverviewSheet } from "./git/GitOverviewSheet";
import { mobileGitWorkbenchCanActivate } from "./git/mobile-git-workbench";
import { useMobileGitWorkbenchAvailability } from "./git/use-mobile-git-workbench";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectedThreadGitActions } from "../../state/use-selected-thread-git-actions";
import { useSelectedThreadGitState } from "../../state/use-selected-thread-git-state";
import { useSelectedThreadRequests } from "../../state/use-selected-thread-requests";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useThreadComposerState } from "../../state/use-thread-composer-state";
import { threadEnvironment } from "../../state/threads";
import { orchestrationEnvironment } from "../../state/orchestration";
import { projectThreadContentPresentation } from "./threadContentPresentation";
import { useThreadForkAction } from "./use-thread-fork-action";
import { mobileForkedThreadRoute, mobileThreadForkingSupported } from "./thread-fork";
import { useThreadRetryAction } from "./use-thread-retry-action";
import { mobileInterruptedTurnRetrySupported } from "./thread-retry";
import {
  useAdaptiveWorkspaceLayout,
  useAdaptiveWorkspacePaneRole,
  useRegisterWorkspaceInspector,
} from "../layout/AdaptiveWorkspaceLayout";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import {
  ThreadInspectorContentStack,
  type ThreadInspectorMode,
} from "./thread-inspector-content-stack";
import { useThreadShells } from "../../state/entities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobileKnowledgeGraphThreadEntryTarget } from "../knowledge-graph/mobile-knowledge-graph";

interface ThreadInspectorSelection {
  readonly routeThreadIdentity: string | null;
  readonly mode: ThreadInspectorMode;
}

type NativeHeaderItems = ReadonlyArray<Record<string, unknown>>;

function InspectorPaneRoleActivation() {
  useAdaptiveWorkspacePaneRole("inspector");
  return null;
}

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function OpeningThreadLoadingScreen() {
  const translator = useMobileInterfaceTranslator();
  return (
    <LoadingScreen
      message={translator.message("mobile.thread.opening")}
      messagePlacement="above-spinner"
    />
  );
}

type ThreadRouteScreenRouteProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly focusComposer?: boolean;
}>;

interface ThreadRouteScreenProps extends ThreadRouteScreenRouteProps {
  readonly onReturnToThread?: () => void;
  readonly renderInspector?: (headerInset: number) => ReactNode;
}

function ThreadUnavailableScreen() {
  const translator = useMobileInterfaceTranslator();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: 24,
        paddingVertical: 32,
      }}
      className="bg-screen flex-1"
    >
      <EmptyState
        title={translator.message("mobile.thread.unavailable")}
        detail={translator.message("mobile.thread.unavailableDetail")}
      />
    </ScrollView>
  );
}

export function ThreadRouteScreen(props: ThreadRouteScreenProps) {
  const { state: workspaceState } = useWorkspaceState();
  const { connectionState } = useRemoteConnectionStatus();
  const { selectedThread } = useThreadSelection();
  const params = props.route.params;
  const environmentIdRaw = firstRouteParam(params.environmentId);
  const threadIdRaw = firstRouteParam(params.threadId);
  const environmentId = environmentIdRaw ? EnvironmentId.make(environmentIdRaw) : null;
  const routeEnvironmentRuntime = useRemoteEnvironmentRuntime(environmentId);
  const routeConnectionState =
    routeEnvironmentRuntime?.connectionState ?? (environmentId ? "available" : connectionState);
  const routeThreadKey =
    environmentId !== null && threadIdRaw !== null
      ? scopedThreadKey(environmentId, ThreadId.make(threadIdRaw))
      : null;
  const selectedThreadKey =
    selectedThread === null
      ? null
      : scopedThreadKey(selectedThread.environmentId, selectedThread.id);
  const selectedThreadDetailState = useSelectedThreadDetailState();

  if (environmentId === null || threadIdRaw === null) {
    return <OpeningThreadLoadingScreen />;
  }

  // Render the full thread chrome (header, feed, composer) as soon as the
  // thread SHELL is known — no blocking on message detail. The feed shows a
  // loading placeholder while messages fetch, and the composer's connection
  // pill reports connecting/reconnecting/syncing status.
  if (selectedThread !== null && selectedThreadKey === routeThreadKey) {
    return <ThreadRouteContent {...props} selectedThreadDetailState={selectedThreadDetailState} />;
  }

  const stillHydrating =
    workspaceState.isLoadingConnections ||
    routeConnectionState === "connecting" ||
    routeConnectionState === "reconnecting";

  if (stillHydrating) {
    return <OpeningThreadLoadingScreen />;
  }

  return <ThreadUnavailableScreen />;
}

function ThreadRouteContent(
  props: ThreadRouteScreenProps & {
    readonly selectedThreadDetailState: ReturnType<typeof useSelectedThreadDetailState>;
  },
) {
  const translator = useMobileInterfaceTranslator();
  const {
    fileInspector,
    layout,
    panes,
    showAuxiliaryPane,
    toggleAuxiliaryPane,
    togglePrimarySidebar,
  } = useAdaptiveWorkspaceLayout();
  const { connectionState } = useRemoteConnectionStatus();
  const { onReconnectEnvironment } = useRemoteConnections();
  const { selectedThread, selectedThreadProject, selectedEnvironmentConnection } =
    useThreadSelection();
  const gitWorkbenchAvailability = useMobileGitWorkbenchAvailability({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
  const gitWorkbenchEnabled = mobileGitWorkbenchCanActivate(gitWorkbenchAvailability);
  const selectedThreadDetailState = props.selectedThreadDetailState;
  const selectedThreadDetail = Option.getOrNull(selectedThreadDetailState.data);
  // "Load earlier turns" header state for windowed (paginated) thread loads.
  const loadEarlierTurns = useMemo(() => {
    if (selectedThread === null || !threadHasOlderTurns(selectedThreadDetailState)) {
      return null;
    }
    return {
      loading:
        selectedThreadDetailState.page._tag === "Some" &&
        selectedThreadDetailState.page.value.loadingOlder,
      onLoadEarlier: () => {
        requestOlderThreadTurns(selectedThread.environmentId, selectedThread.id);
      },
    };
  }, [selectedThread, selectedThreadDetailState]);
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const composer = useThreadComposerState();
  const reasoningRecommendationState = composer.reasoningRecommendationState;
  const setReasoningRecommendation = composer.onSetReasoningRecommendation;
  const gitState = useSelectedThreadGitState();
  const gitActions = useSelectedThreadGitActions();
  const requests = useSelectedThreadRequests();
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, "thread interrupt");
  const exportThreadTranscript = useAtomCommand(orchestrationEnvironment.exportThreadTranscript, {
    reportFailure: false,
  });
  const [transcriptExportBusy, setTranscriptExportBusy] = useState(false);
  const navigation = useNavigation();
  const params = props.route.params;
  const environmentIdRaw = firstRouteParam(params.environmentId);
  const environmentId = environmentIdRaw ? EnvironmentId.make(environmentIdRaw) : null;
  const threadId = firstRouteParam(params.threadId);
  const routeThreadIdentity =
    environmentIdRaw !== null && threadId !== null ? `${environmentIdRaw}:${threadId}` : null;
  const [inspectorSelection, setInspectorSelection] = useState<ThreadInspectorSelection | null>(
    () => (props.renderInspector ? { routeThreadIdentity, mode: "route" } : null),
  );
  const inspectorMode = (() => {
    if (inspectorSelection?.routeThreadIdentity === routeThreadIdentity) {
      if (inspectorSelection.mode === "git" && !gitWorkbenchEnabled) {
        return null;
      }
      if (inspectorSelection.mode === "files" && selectedThreadCwd === null) {
        return null;
      }
      return inspectorSelection.mode;
    }
    return null;
  })();
  useEffect(() => {
    if (gitWorkbenchEnabled || inspectorSelection?.mode !== "git") return;
    setInspectorSelection(null);
    if (panes.auxiliaryPaneVisible) toggleAuxiliaryPane();
  }, [
    gitWorkbenchEnabled,
    inspectorSelection?.mode,
    panes.auxiliaryPaneVisible,
    toggleAuxiliaryPane,
  ]);
  useEffect(() => {
    if (
      fileInspector.supported &&
      selectedThreadCwd === null &&
      inspectorMode === null &&
      panes.auxiliaryPaneVisible
    ) {
      toggleAuxiliaryPane();
    }
  }, [
    fileInspector.supported,
    inspectorMode,
    panes.auxiliaryPaneVisible,
    selectedThreadCwd,
    toggleAuxiliaryPane,
  ]);

  useEffect(() => {
    setInspectorSelection((current) => {
      if (props.renderInspector === undefined) {
        if (current === null || current.mode === "route") {
          return null;
        }
        return { ...current, routeThreadIdentity };
      }

      if (current === null || current.mode === "route") {
        return { routeThreadIdentity, mode: "route" };
      }

      return { ...current, routeThreadIdentity };
    });
  }, [props.renderInspector, routeThreadIdentity]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (props.renderInspector === undefined) {
          // Inspectors are contextual to this chat destination. Clear the
          // hidden chat copy after a native push so returning from Files,
          // Review, or Terminal cannot reserve an empty trailing pane.
          setInspectorSelection(null);
        }
      };
    }, [props.renderInspector]),
  );
  const routeEnvironmentRuntime = useRemoteEnvironmentRuntime(environmentId);
  const serverConfig = routeEnvironmentRuntime?.serverConfig ?? null;
  const knowledgeGraphEntryTarget = useMemo(() => {
    if (selectedThread === null || serverConfig === null) return null;
    return mobileKnowledgeGraphThreadEntryTarget({
      knowledgeGraphVersion: serverConfig.environment.capabilities.knowledgeGraphVersion,
      enabled: resolveBetterT3FeatureFlag(
        serverConfig.settings.betterT3Environment,
        "knowledge.graph",
      ),
      environmentId: selectedThread.environmentId,
      projectId: selectedThread.projectId,
      threadId: selectedThread.id,
    });
  }, [selectedThread, serverConfig]);
  const handleOpenKnowledgeGraph = useCallback(() => {
    if (knowledgeGraphEntryTarget === null) return;
    navigation.navigate(knowledgeGraphEntryTarget.screen, knowledgeGraphEntryTarget.params);
  }, [knowledgeGraphEntryTarget, navigation]);
  const threadForkingSupported = mobileThreadForkingSupported(
    serverConfig?.environment.capabilities ?? {},
  );
  const interruptedTurnRetrySupported = mobileInterruptedTurnRetrySupported(
    serverConfig?.environment.capabilities ?? {},
  );
  const transcriptExportSupported =
    (serverConfig?.environment.capabilities.agentWorkflowVersion ?? 0) >= 1;
  const routeConnectionState =
    routeEnvironmentRuntime?.connectionState ?? (environmentId ? "available" : connectionState);
  const routeConnectionError = routeEnvironmentRuntime?.connectionError ?? null;
  const selectedThreadWithDraftSettings = useMemo(
    () =>
      selectedThread
        ? {
            ...selectedThread,
            modelSelection: composer.modelSelection ?? selectedThread.modelSelection,
            runtimeMode: composer.runtimeMode ?? selectedThread.runtimeMode,
            interactionMode: composer.interactionMode ?? selectedThread.interactionMode,
            harnessSync: selectedThreadDetail?.harnessSync ?? selectedThread.harnessSync,
          }
        : null,
    [
      composer.interactionMode,
      composer.modelSelection,
      composer.runtimeMode,
      selectedThread,
      selectedThreadDetail?.harnessSync,
    ],
  );
  const threadShells = useThreadShells();
  const forkSourceThreadId = selectedThread?.fork?.provenance.sourceThreadId ?? null;
  const forkSourceAvailable =
    forkSourceThreadId !== null &&
    threadShells.some(
      (thread) =>
        thread.environmentId === selectedThread?.environmentId && thread.id === forkSourceThreadId,
    );
  const handleForked = useCallback(
    (destinationThreadId: ThreadId) => {
      if (selectedThread === null) return;
      const route = mobileForkedThreadRoute({
        environmentId: selectedThread.environmentId,
        destinationThreadId,
      });
      navigation.dispatch(StackActions.replace(route.screen, route.params));
    },
    [navigation, selectedThread],
  );
  const handleOpenForkSource = useCallback(() => {
    if (!forkSourceAvailable || forkSourceThreadId === null || selectedThread === null) return;
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(selectedThread.environmentId),
        threadId: String(forkSourceThreadId),
      }),
    );
  }, [forkSourceAvailable, forkSourceThreadId, navigation, selectedThread]);
  const forkAction = useThreadForkAction({
    thread: selectedThreadWithDraftSettings,
    project: selectedThreadProject,
    serverConfig,
    supported: threadForkingSupported,
    connected: routeConnectionState === "connected",
    onForked: handleForked,
  });
  const retryMessages = useMemo(
    () =>
      composer.selectedThreadFeed.flatMap((entry) =>
        entry.type === "message" ? [entry.message] : [],
      ),
    [composer.selectedThreadFeed],
  );
  const retryAction = useThreadRetryAction({
    thread: selectedThreadWithDraftSettings,
    messages: retryMessages,
    supported: interruptedTurnRetrySupported,
    connected: routeConnectionState === "connected",
    busy: composer.activeThreadBusy,
    fetchEnabled: composer.fetchEnabled,
  });
  const reasoningRecommendationSelection = selectedThreadWithDraftSettings?.modelSelection ?? null;
  const autoReasoningStatus = readAutoReasoningStatus(selectedThreadDetail?.activities ?? []);
  const reasoningRecommendationCapabilities = useMemo(() => {
    if (reasoningRecommendationSelection === null) {
      return null;
    }
    const provider = serverConfig?.providers.find(
      (candidate) => candidate.instanceId === reasoningRecommendationSelection.instanceId,
    );
    return (
      provider?.models.find((model) => model.slug === reasoningRecommendationSelection.model)
        ?.capabilities ?? null
    );
  }, [reasoningRecommendationSelection, serverConfig]);
  const validPendingReasoningOverride =
    reasoningRecommendationSelection !== null &&
    pendingReasoningOverrideMatchesSelection(
      reasoningRecommendationState?.pendingOverride,
      reasoningRecommendationSelection,
    )
      ? (reasoningRecommendationState?.pendingOverride ?? null)
      : null;
  const reasoningRecommendation = useMemo(
    () =>
      reasoningRecommendationSelection === null || selectedThreadDetail === null
        ? null
        : deriveReasoningRecommendation({
            activities: selectedThreadDetail.activities,
            capabilities: reasoningRecommendationCapabilities,
            durableSelection: reasoningRecommendationSelection,
            latestCompletedTurnId:
              selectedThreadDetail.latestTurn?.state === "completed"
                ? selectedThreadDetail.latestTurn.turnId
                : null,
            threadIdle: !composer.activeThreadBusy && composer.selectedThreadQueueCount === 0,
            handledEvidenceTurnId: reasoningRecommendationState?.handledEvidenceTurnId ?? null,
          }),
    [
      composer.activeThreadBusy,
      composer.selectedThreadQueueCount,
      reasoningRecommendationCapabilities,
      reasoningRecommendationSelection,
      reasoningRecommendationState?.handledEvidenceTurnId,
      selectedThreadDetail,
    ],
  );
  const handleAcceptReasoningRecommendation = useCallback(() => {
    if (reasoningRecommendation === null) {
      return;
    }
    setReasoningRecommendation(
      acceptReasoningRecommendation(reasoningRecommendationState, reasoningRecommendation),
    );
  }, [reasoningRecommendation, reasoningRecommendationState, setReasoningRecommendation]);
  const handleDismissReasoningRecommendation = useCallback(() => {
    if (reasoningRecommendation === null) {
      return;
    }
    setReasoningRecommendation(
      dismissReasoningRecommendation(reasoningRecommendationState, reasoningRecommendation),
    );
  }, [reasoningRecommendation, reasoningRecommendationState, setReasoningRecommendation]);
  const handleUndoReasoningRecommendation = useCallback(() => {
    if (reasoningRecommendationState === null) {
      return;
    }
    setReasoningRecommendation(undoReasoningRecommendationOverride(reasoningRecommendationState));
  }, [reasoningRecommendationState, setReasoningRecommendation]);

  /* ─── Native header theming ──────────────────────────────────────── */
  const usesNativeHeaderGlass = NATIVE_LIQUID_GLASS_SUPPORTED;
  const headerSubtitle = [
    selectedThreadProject?.title ?? null,
    selectedEnvironmentConnection?.environmentLabel ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  /* ─── Git status for native header trigger ───────────────────────── */
  const gitStatus = useEnvironmentQuery(
    gitWorkbenchEnabled && selectedThread !== null && selectedThreadCwd !== null
      ? vcsEnvironment.status({
          environmentId: selectedThread.environmentId,
          input: { cwd: selectedThreadCwd },
        })
      : null,
  );
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
  const terminalMenuSessions = useMemo(
    () =>
      buildTerminalMenuSessions({
        knownSessions: knownTerminalSessions,
        workspaceRoot: selectedThreadProject?.workspaceRoot ?? null,
      }),
    [knownTerminalSessions, selectedThreadProject?.workspaceRoot],
  );
  const selectedThreadDetailWorktreePath = selectedThreadDetail?.worktreePath ?? null;
  const handleReconnectEnvironment = useCallback(() => {
    if (!environmentId) {
      return;
    }
    onReconnectEnvironment(environmentId);
  }, [environmentId, onReconnectEnvironment]);

  /* ─── Git action progress (for overlay banner) ──────────────────── */
  const gitActionProgressTarget = useMemo(
    () => ({
      environmentId: gitWorkbenchEnabled ? (selectedThread?.environmentId ?? null) : null,
      cwd: gitWorkbenchEnabled ? selectedThreadCwd : null,
    }),
    [gitWorkbenchEnabled, selectedThread?.environmentId, selectedThreadCwd],
  );
  const gitActionProgress = useGitActionProgress(gitActionProgressTarget);

  const handleOpenGitInspector = useCallback(() => {
    if (!gitWorkbenchEnabled) return;
    if (!fileInspector.supported) {
      if (selectedThread === null) {
        return;
      }
      navigation.navigate("GitOverview", {
        environmentId: String(selectedThread.environmentId),
        threadId: String(selectedThread.id),
      });
      return;
    }
    setInspectorSelection({ routeThreadIdentity, mode: "git" });
    showAuxiliaryPane("inspector");
  }, [
    fileInspector.supported,
    gitWorkbenchEnabled,
    navigation,
    routeThreadIdentity,
    selectedThread,
    showAuxiliaryPane,
  ]);
  const handleOpenFilesInspector = useCallback(() => {
    if (selectedThread === null || selectedThreadCwd === null) {
      return;
    }
    if (!fileInspector.supported) {
      navigation.navigate("ThreadFiles", {
        environmentId: String(selectedThread.environmentId),
        threadId: String(selectedThread.id),
      });
      return;
    }
    setInspectorSelection({
      routeThreadIdentity,
      mode: props.renderInspector === undefined ? "files" : "route",
    });
    showAuxiliaryPane("inspector");
  }, [
    fileInspector.supported,
    navigation,
    props.renderInspector,
    routeThreadIdentity,
    selectedThread,
    selectedThreadCwd,
    showAuxiliaryPane,
  ]);
  const inspectorToggleActionRef = useRef({
    inspectorMode,
    openFilesInspector: handleOpenFilesInspector,
    toggleAuxiliaryPane,
  });
  inspectorToggleActionRef.current = {
    inspectorMode,
    openFilesInspector: handleOpenFilesInspector,
    toggleAuxiliaryPane,
  };
  const handleToggleInspector = useCallback(() => {
    const action = inspectorToggleActionRef.current;
    if (action.inspectorMode === null) {
      action.openFilesInspector();
      return;
    }
    action.toggleAuxiliaryPane();
  }, []);
  const handleSelectInspectorFile = useCallback(
    (path: string) => {
      if (selectedThread === null) {
        return;
      }
      const params = {
        environmentId: String(selectedThread.environmentId),
        threadId: String(selectedThread.id),
        path: path.split("/").filter((segment) => segment.length > 0),
      };
      if (fileInspector.supported) {
        navigation.navigate("ThreadFile", params);
        return;
      }
      navigation.navigate("ThreadFile", params);
    },
    [fileInspector.supported, navigation, selectedThread],
  );
  // The workspace inspector column spans the full window height. On iOS the
  // panes bring their own nested native headers (which underlap the status
  // bar); elsewhere the pane content pads itself below the top inset.
  const safeAreaInsets = useSafeAreaInsets();
  const inspectorHeaderInset = Platform.OS === "ios" ? 0 : safeAreaInsets.top;
  const GitInspector = useCallback(
    () =>
      gitWorkbenchEnabled ? (
        <GitOverviewSheet
          headerInset={inspectorHeaderInset}
          presentation="inspector"
          route={{ params: props.route.params }}
        />
      ) : null,
    [gitWorkbenchEnabled, inspectorHeaderInset, props.route.params],
  );
  const FilesInspector = useCallback(
    () =>
      selectedThread !== null && selectedThreadCwd !== null ? (
        <ThreadFileNavigatorPane
          cwd={selectedThreadCwd}
          environmentId={selectedThread.environmentId}
          headerInset={inspectorHeaderInset}
          projectName={selectedThreadProject?.title ?? "Files"}
          selectedPath={null}
          onSelectFile={handleSelectInspectorFile}
        />
      ) : null,
    [
      handleSelectInspectorFile,
      inspectorHeaderInset,
      selectedThread,
      selectedThreadCwd,
      selectedThreadProject?.title,
    ],
  );
  const RouteInspector = useCallback(
    () => props.renderInspector?.(inspectorHeaderInset),
    [inspectorHeaderInset, props.renderInspector],
  );
  const renderInspectorStack = useCallback(
    () =>
      inspectorMode === null ? null : (
        <ThreadInspectorContentStack
          Files={FilesInspector}
          Git={GitInspector}
          mode={inspectorMode}
          Route={props.renderInspector ? RouteInspector : undefined}
        />
      ),
    [FilesInspector, GitInspector, RouteInspector, inspectorMode, props.renderInspector],
  );
  const activeInspectorRenderer = inspectorMode === null ? undefined : renderInspectorStack;
  // Hand the inspector to the workspace so it renders beside the navigator,
  // outside this screen's native header — the terminal/git/files toolbar
  // stays anchored to the chat pane instead of floating above the inspector.
  useRegisterWorkspaceInspector(activeInspectorRenderer);

  const handleOpenConnectionEditor = useCallback(() => {
    void navigation.navigate("Connections");
  }, [navigation]);
  const handleStopThread = useCallback(() => {
    if (!selectedThread) {
      return;
    }
    const session = selectedThread.session;
    const stopAction = resolveThreadAbortPresentation(session);
    if (session === null || !stopAction.showStopAction || stopAction.phase === "force-stopping") {
      return;
    }
    return interruptThreadTurn({
      environmentId: selectedThread.environmentId,
      input: {
        threadId: selectedThread.id,
        ...(session.activeTurnId ? { turnId: session.activeTurnId } : {}),
      },
    });
  }, [interruptThreadTurn, selectedThread]);

  const handleOpenTerminal = useCallback(
    (nextTerminalId?: string | null) => {
      terminalDebugLog("terminal-menu:open-existing", {
        terminalId: nextTerminalId ?? null,
        hasThread: Boolean(selectedThread),
        hasWorkspaceRoot: Boolean(selectedThreadProject?.workspaceRoot),
      });

      if (!selectedThread || !selectedThreadProject?.workspaceRoot) {
        return;
      }

      void navigation.navigate("ThreadTerminal", {
        environmentId: String(selectedThread.environmentId),
        threadId: String(selectedThread.id),
        ...(nextTerminalId ? { terminalId: nextTerminalId } : {}),
      });
    },
    [navigation, selectedThread, selectedThreadProject?.workspaceRoot],
  );

  const handleOpenNewTerminal = useCallback(() => {
    terminalDebugLog("terminal-menu:open-new", {
      hasThread: Boolean(selectedThread),
      hasWorkspaceRoot: Boolean(selectedThreadProject?.workspaceRoot),
      listedTerminalIds: terminalMenuSessions.map((session) => session.terminalId),
    });

    if (!selectedThread || !selectedThreadProject?.workspaceRoot) {
      return;
    }

    const nextId = nextOpenTerminalId({
      listedTerminalIds: terminalMenuSessions.map((session) => session.terminalId),
    });
    void navigation.navigate("ThreadTerminal", {
      environmentId: String(selectedThread.environmentId),
      threadId: String(selectedThread.id),
      terminalId: nextId,
    });
  }, [navigation, selectedThread, selectedThreadProject?.workspaceRoot, terminalMenuSessions]);

  const handleRunProjectScript = useCallback(
    async (script: ProjectScript) => {
      terminalDebugLog("project-script:press", {
        scriptId: script.id,
        command: script.command,
        hasThread: Boolean(selectedThread),
        hasWorkspaceRoot: Boolean(selectedThreadProject?.workspaceRoot),
      });

      if (!selectedThread || !selectedThreadProject?.workspaceRoot) {
        terminalDebugLog("project-script:abort", {
          scriptId: script.id,
          reason: "no-thread-or-workspace",
        });
        return;
      }

      const targetTerminalId = resolveProjectScriptTerminalId({
        existingTerminalIds: terminalMenuSessions.map((session) => session.terminalId),
        hasRunningTerminal: terminalMenuSessions.some(
          (session) => session.status === "running" || session.status === "starting",
        ),
      });
      const preferredWorktreePath = resolvePreferredThreadWorktreePath({
        threadShellWorktreePath: selectedThread.worktreePath ?? null,
        threadDetailWorktreePath: selectedThreadDetailWorktreePath,
      });
      const cwd = projectScriptCwd({
        project: { cwd: selectedThreadProject.workspaceRoot },
        worktreePath: preferredWorktreePath,
      });
      const env = projectScriptRuntimeEnv({
        project: { cwd: selectedThreadProject.workspaceRoot },
        worktreePath: preferredWorktreePath,
      });
      stagePendingTerminalLaunch({
        target: {
          environmentId: selectedThread.environmentId,
          threadId: selectedThread.id,
          terminalId: targetTerminalId,
        },
        launch: {
          cwd,
          worktreePath: preferredWorktreePath,
          env,
          initialInput: `${script.command}\r`,
        },
      });
      terminalDebugLog("project-script:staged", {
        scriptId: script.id,
        terminalId: targetTerminalId,
        cwd,
        worktreePath: preferredWorktreePath,
      });

      void navigation.navigate("ThreadTerminal", {
        environmentId: String(selectedThread.environmentId),
        threadId: String(selectedThread.id),
        terminalId: targetTerminalId,
      });
    },
    [
      navigation,
      selectedThread,
      selectedThreadDetailWorktreePath,
      selectedThreadProject,
      terminalMenuSessions,
    ],
  );
  const handleCopyTranscript = useCallback(async () => {
    if (
      selectedThread === null ||
      !transcriptExportSupported ||
      transcriptExportBusy ||
      composer.activeThreadBusy
    ) {
      return;
    }

    setTranscriptExportBusy(true);
    try {
      const result = await exportThreadTranscript({
        environmentId: selectedThread.environmentId,
        input: { threadId: selectedThread.id },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Alert.alert(
            "Could not copy transcript",
            error instanceof Error ? error.message : "The transcript export failed.",
          );
        }
        return;
      }

      try {
        await Clipboard.setStringAsync(result.value.content);
      } catch {
        Alert.alert("Could not copy transcript", "The clipboard could not be updated.");
        return;
      }
      void Haptics.selectionAsync().catch(() => undefined);
      Alert.alert(
        "Transcript copied",
        "The complete, unredacted Markdown transcript is now on your clipboard.",
      );
    } finally {
      setTranscriptExportBusy(false);
    }
  }, [
    composer.activeThreadBusy,
    exportThreadTranscript,
    selectedThread,
    transcriptExportBusy,
    transcriptExportSupported,
  ]);
  const threadGitControlProps = {
    environmentId: environmentIdRaw ?? "",
    threadId: threadId ?? "",
    auxiliaryPaneControl:
      !layout.usesSplitView && fileInspector.supported && selectedThreadCwd !== null
        ? {
            accessibilityLabel: translator.message("mobile.thread.toggleInspector"),
            onPress: handleToggleInspector,
          }
        : undefined,
    onOpenFilesInspector:
      fileInspector.supported && selectedThreadCwd !== null ? handleOpenFilesInspector : undefined,
    onOpenGitInspector:
      gitWorkbenchEnabled && fileInspector.supported ? handleOpenGitInspector : undefined,
    currentBranch: selectedThread?.branch ?? null,
    gitStatus: gitStatus.data,
    gitOperationLabel: gitState.gitOperationLabel,
    gitEnabled: gitWorkbenchEnabled,
    canOpenTerminal: Boolean(selectedThreadProject?.workspaceRoot),
    canOpenFiles: Boolean(selectedThreadProject?.workspaceRoot),
    knowledgeGraphControl:
      knowledgeGraphEntryTarget === null
        ? undefined
        : {
            accessibilityLabel: translator.message("knowledgeGraph.title"),
            onPress: handleOpenKnowledgeGraph,
          },
    projectScripts: selectedThreadProject?.scripts ?? [],
    terminalSessions: terminalMenuSessions,
    showDirectFileControl: layout.usesSplitView,
    onOpenTerminal: handleOpenTerminal,
    onOpenNewTerminal: handleOpenNewTerminal,
    onRunProjectScript: handleRunProjectScript,
    onPull: gitActions.onPullSelectedThreadBranch,
    onRunAction: gitActions.onRunSelectedThreadGitAction,
  };
  const threadCenterHeaderItems = useThreadGitCenterHeaderItems(threadGitControlProps);
  const compactRightHeaderItems = useThreadGitRightHeaderItems(threadGitControlProps);
  const splitLeftHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      {
        // Match Mail's split-view detail toolbar: the first detail action sits
        // inside the content pane, not flush against the sidebar divider.
        spacing: 18,
        type: "spacing" as const,
      },
      ...(props.onReturnToThread
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: translator.message("mobile.thread.returnToChat"),
              icon: { name: "chevron.left", type: "sfSymbol" as const },
              identifier: "thread-left-return",
              onPress: props.onReturnToThread,
              type: "button" as const,
            }),
          ]
        : []),
      withNativeGlassHeaderItem({
        accessibilityLabel: panes.primarySidebarVisible
          ? translator.message("mobile.thread.maximizeContent")
          : translator.message("mobile.thread.showSidebar"),
        icon: {
          name: panes.primarySidebarVisible ? "arrow.up.left.and.arrow.down.right" : "sidebar.left",
          type: "sfSymbol" as const,
        },
        identifier: "thread-left-sidebar",
        onPress: togglePrimarySidebar,
        type: "button" as const,
      }),
      withNativeGlassHeaderItem({
        accessibilityLabel: translator.message("mobile.navigation.newTask"),
        icon: { name: "square.and.pencil", type: "sfSymbol" as const },
        identifier: "thread-left-new-task",
        onPress: () => navigation.navigate("NewTaskSheet", { screen: "NewTask" }),
        type: "button" as const,
      }),
    ],
    [
      panes.primarySidebarVisible,
      props.onReturnToThread,
      navigation,
      togglePrimarySidebar,
      translator,
    ],
  );
  const androidHeaderActions = useMemo<ReadonlyArray<AndroidHeaderAction>>(() => {
    if (Platform.OS !== "android") return [];

    const actions: AndroidHeaderAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.returnToChat"),
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (selectedThreadCwd !== null) {
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.openFiles"),
        icon: "folder",
        onPress: handleOpenFilesInspector,
      });
    }
    if (selectedThreadProject?.workspaceRoot) {
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.openTerminal"),
        icon: "terminal",
        onPress: () => handleOpenTerminal(null),
      });
    }
    if (knowledgeGraphEntryTarget !== null) {
      actions.push({
        accessibilityLabel: translator.message("knowledgeGraph.title"),
        icon: "point.3.connected.trianglepath.dotted",
        onPress: handleOpenKnowledgeGraph,
      });
    }
    if (gitWorkbenchEnabled) {
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.openGit"),
        icon: "point.topleft.down.curvedto.point.bottomright.up",
        onPress: handleOpenGitInspector,
      });
    }
    if (fileInspector.supported && selectedThreadCwd !== null) {
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.toggleInspector"),
        icon: "sidebar.right",
        onPress: handleToggleInspector,
      });
    }
    return actions;
  }, [
    fileInspector.supported,
    gitWorkbenchEnabled,
    handleOpenFilesInspector,
    handleOpenTerminal,
    handleOpenGitInspector,
    handleOpenKnowledgeGraph,
    handleToggleInspector,
    props.onReturnToThread,
    knowledgeGraphEntryTarget,
    selectedThreadCwd,
    selectedThreadProject?.workspaceRoot,
    translator,
  ]);

  // Deep links / cold starts land with Thread as the ONLY route, where the
  // native back button does not render. Provide an explicit Home escape for
  // that case; when history exists the native back button is used instead.
  const canGoBack = navigation.canGoBack();
  const compactHomeHeaderItems = useMemo<NativeHeaderItems>(
    () => [
      withNativeGlassHeaderItem({
        accessibilityLabel: translator.message("mobile.thread.goToList"),
        icon: { name: "list.bullet", type: "sfSymbol" as const },
        identifier: "thread-left-home",
        onPress: () => navigation.dispatch(StackActions.replace("Home")),
        type: "button" as const,
      }),
    ],
    [navigation, translator],
  );

  if (!environmentId || !threadId) {
    return <OpeningThreadLoadingScreen />;
  }

  if (!selectedThread) {
    return <OpeningThreadLoadingScreen />;
  }

  const contentPresentation = projectThreadContentPresentation({
    hasDetail: selectedThreadDetail !== null,
    detailError: Option.getOrNull(selectedThreadDetailState.error),
    detailDeleted: selectedThreadDetailState.status === "deleted",
    connectionState: routeConnectionState,
  });
  const renderThreadRouteBody = (showActionControls: boolean) => (
    <>
      <ThreadGitControls {...threadGitControlProps} showActionControls={showActionControls} />

      {gitWorkbenchEnabled ? (
        <GitActionProgressOverlay progress={gitActionProgress} onDismiss={dismissGitActionResult} />
      ) : null}

      <View className="flex-1 bg-screen">
        <ThreadDetailScreen
          selectedThread={selectedThreadWithDraftSettings ?? selectedThread}
          contentPresentation={contentPresentation}
          screenTone={connectionTone(routeConnectionState)}
          connectionError={routeConnectionError}
          environmentLabel={selectedEnvironmentConnection?.environmentLabel ?? null}
          selectedThreadFeed={composer.selectedThreadFeed}
          subagents={selectedThreadDetail?.subagents ?? []}
          activeWorkStartedAt={composer.activeWorkStartedAt}
          activePendingApproval={requests.activePendingApproval}
          respondingApprovalId={requests.respondingApprovalId}
          activePendingUserInput={requests.activePendingUserInput}
          activePendingUserInputDrafts={requests.activePendingUserInputDrafts}
          activePendingUserInputAnswers={requests.activePendingUserInputAnswers}
          respondingUserInputId={requests.respondingUserInputId}
          reasoningRecommendation={reasoningRecommendation}
          pendingReasoningOverride={validPendingReasoningOverride}
          draftMessage={composer.draftMessage}
          draftAttachments={composer.draftAttachments}
          connectionStateLabel={routeConnectionState}
          threadSyncStatus={selectedThreadDetailState.status}
          loadEarlier={loadEarlierTurns}
          environmentId={selectedThread.environmentId}
          projectWorkspaceRoot={selectedThreadProject?.workspaceRoot ?? null}
          threadCwd={selectedThreadCwd}
          selectedThreadQueueCount={composer.selectedThreadQueueCount}
          activeThreadBusy={composer.activeThreadBusy}
          {...(autoReasoningStatus ? { autoReasoningStatus } : {})}
          layoutVariant={layout.variant}
          usesAutomaticContentInsets={usesNativeHeaderGlass}
          onOpenConnectionEditor={handleOpenConnectionEditor}
          onChangeDraftMessage={composer.onChangeDraftMessage}
          onPickDraftImages={composer.onPickDraftImages}
          onNativePasteImages={composer.onNativePasteImages}
          onRemoveDraftImage={composer.onRemoveDraftImage}
          serverConfig={serverConfig}
          onStopThread={handleStopThread}
          onSendMessage={composer.onSendMessage}
          retryAction={retryAction.retryAction}
          fetchSupported={composer.fetchSupported}
          fetchEnabled={composer.fetchEnabled}
          isImprovingPrompt={composer.isImprovingPrompt}
          onImproveDraft={composer.onImproveDraft}
          onUpdateFetchEnabled={composer.onUpdateFetchEnabled}
          onCopyTranscript={transcriptExportSupported ? handleCopyTranscript : undefined}
          transcriptExportBusy={transcriptExportBusy || composer.activeThreadBusy}
          parallelPlanImplementationEnabled={composer.parallelPlanImplementationEnabled}
          onImplementPlan={composer.onImplementPlan}
          forkActionSupported={forkAction.supported}
          forkActionEnabled={forkAction.enabled}
          pendingForkBoundaryKey={forkAction.pendingBoundaryKey}
          onFork={(boundary) => void forkAction.onFork(boundary)}
          forkSourceAvailable={forkSourceAvailable}
          onOpenForkSource={handleOpenForkSource}
          focusComposerOnMount={props.route.params.focusComposer === true}
          onReconnectEnvironment={handleReconnectEnvironment}
          onUpdateThreadModelSelection={composer.onUpdateModelSelection}
          onUpdateThreadRuntimeMode={composer.onUpdateRuntimeMode}
          onUpdateThreadInteractionMode={composer.onUpdateInteractionMode}
          onRespondToApproval={requests.onRespondToApproval}
          onSelectUserInputOption={requests.onSelectUserInputOption}
          onChangeUserInputCustomAnswer={requests.onChangeUserInputCustomAnswer}
          onSubmitUserInput={requests.onSubmitUserInput}
          onAcceptReasoningRecommendation={handleAcceptReasoningRecommendation}
          onDismissReasoningRecommendation={handleDismissReasoningRecommendation}
          onUndoReasoningRecommendation={handleUndoReasoningRecommendation}
        />
      </View>
    </>
  );

  return (
    <>
      {activeInspectorRenderer ? <InspectorPaneRoleActivation /> : null}
      <NativeStackScreenOptions
        options={{
          // Android draws its own in-flow header (AndroidScreenHeader below);
          // the native stack header stays iOS-only.
          headerShown: Platform.OS !== "android",
          headerTitle: selectedThread.title,
          headerTitleStyle: usesNativeHeaderGlass
            ? {
                fontSize: 17,
                fontWeight: "800",
              }
            : undefined,
          title: selectedThread.title,
          headerBackVisible: !layout.usesSplitView,
          // Compact uses the NATIVE back button when a previous route exists;
          // deep links / cold starts get an explicit Home button instead.
          // Split view always uses its custom left items.
          unstable_headerLeftItems:
            Platform.OS === "ios"
              ? layout.usesSplitView
                ? () => splitLeftHeaderItems
                : canGoBack
                  ? undefined
                  : () => compactHomeHeaderItems
              : undefined,
          // Search lives in the persistent sidebar, so the split header keeps
          // the git controls on the RIGHT (no center items — center space is
          // reserved for future breadcrumbs/status).
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () => (layout.usesSplitView ? threadCenterHeaderItems : compactRightHeaderItems)
              : undefined,
          unstable_headerSubtitle: usesNativeHeaderGlass ? headerSubtitle : undefined,
        }}
      />

      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={selectedThread.title}
          subtitle={headerSubtitle}
          onBack={layout.usesSplitView ? undefined : () => navigation.goBack()}
          actions={androidHeaderActions}
        />
      ) : null}

      {/* Android surfaces the git/files/inspector actions in its in-flow
          header above, so the fallback action toolbar stays iOS-only. */}
      {renderThreadRouteBody(
        Platform.OS !== "android" && !layout.usesSplitView && !usesNativeHeaderGlass,
      )}
    </>
  );
}
