import { copyThreadTranscript } from "@t3tools/client-runtime/thread-transcript";

import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import {
  getComposerDraftSnapshot,
  clearComposerDraftContent,
} from "../../state/use-composer-drafts";
import { useWorktreeSetup } from "./use-worktree-setup";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenHeaderButton } from "../../components/ScreenHeaderButton";
import type { ScreenHeaderAction } from "../../components/ScreenHeader.types";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Option from "effect/Option";
import {
  CommandId,
  MessageId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  resolveBetterT3FeatureFlag,
  ThreadId,
  type ProjectScript,
} from "@t3tools/contracts";
import { resolveThreadAbortPresentation } from "@t3tools/client-runtime/state/thread-abort";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { readAutoReasoningResolution } from "@t3tools/shared/model";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWorkspaceState } from "../../state/workspace";
import { useEnvironmentShellState } from "../../state/shell";
import { restoredNewTaskDraftKey } from "../../state/new-task-draft-key";
import { clearPendingThreadCreationOutcome } from "../../state/pending-thread-creation";
import { recoverFailedThreadDraft } from "../../state/recover-failed-thread-draft";
import { useEnvironmentQuery } from "../../state/query";
import { dismissGitActionResult, useGitActionProgress } from "../../state/use-vcs-action-state";
import { vcsEnvironment } from "../../state/vcs";
import { EmptyState } from "../../components/EmptyState";
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
import { ThreadDetailScreen, type ThreadDetailScreenProps } from "./ThreadDetailScreen";
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
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  useAdaptiveWorkspaceLayout,
  useAdaptiveWorkspacePaneRole,
  useRegisterWorkspaceInspector,
} from "../layout/AdaptiveWorkspaceLayout";
import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";
import {
  ThreadInspectorContentStack,
  type ThreadInspectorMode,
} from "./thread-inspector-content-stack";
import { useThreadShells } from "../../state/entities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobileKnowledgeGraphThreadEntryTarget } from "../knowledge-graph/mobile-knowledge-graph";
import { ProjectIndexChatStatus } from "../project-indexing/ProjectIndexChatStatus";
import { threadRouteIsHydrating } from "./thread-route-hydration";

function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const navigation = useNavigation();
  const { layout, panes, toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const { onOpenTerminal } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderActions = useMemo<ReadonlyArray<ScreenHeaderAction>>(() => {
    const actions: ScreenHeaderAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    if (props.hasWorkspaceRoot) {
      actions.push({
        accessibilityLabel: "Open terminal",
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    if (props.gitControls.knowledgeGraphControl)
      actions.push({
        accessibilityLabel: props.gitControls.knowledgeGraphControl.accessibilityLabel,
        icon: "point.3.connected.trianglepath.dotted",
        onPress: props.gitControls.knowledgeGraphControl.onPress,
      });
    if (props.gitControls.gitEnabled)
      actions.push({
        accessibilityLabel: "Open git controls",
        icon: "point.topleft.down.curvedto.point.bottomright.up",
        onPress: props.onOpenGitInspector,
      });
    return actions;
  }, [
    props.gitControls.knowledgeGraphControl,
    props.gitControls.gitEnabled,
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onOpenTerminal,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
  ]);

  return (
    <>
      <ScreenHeader
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={props.gitControls.projectScripts}
        trailing={
          props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? "Hide inspector"
                  : "Show inspector"
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={
          layout.usesSplitView
            ? undefined
            : () => {
                // A deep link or cold start has no previous route; Home is the way out.
                // Read the history at press time: it changes without re-rendering this screen.
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.dispatch(StackActions.replace("Home"));
              }
        }
        actions={androidHeaderActions}
        hideBottomBorder
      />
      {native.fallback}
    </>
  );
}

interface ThreadInspectorSelection {
  readonly routeThreadIdentity: string | null;
  readonly mode: ThreadInspectorMode;
}

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

function ThreadUnavailableScreen(props: {
  readonly actionLabel: string;
  readonly onAction: () => void;
}) {
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
        actionLabel={props.actionLabel}
        onAction={props.onAction}
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
  const routeEnvironmentShellState = useEnvironmentShellState(environmentId);
  const { onReconnectEnvironment } = useRemoteConnections();
  const navigation = useNavigation();
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
  // loading placeholder while messages fetch, the floating pill above the
  // composer reports loading/syncing, and the composer's connection pill
  // reports connecting/reconnecting status.
  if (selectedThread !== null && selectedThreadKey === routeThreadKey) {
    return <ThreadRouteContent {...props} selectedThreadDetailState={selectedThreadDetailState} />;
  }

  const stillHydrating = threadRouteIsHydrating({
    isLoadingConnections: workspaceState.isLoadingConnections,
    connectionState: routeConnectionState,
    shellStatus: routeEnvironmentShellState.status,
    shellHasError: Option.isSome(routeEnvironmentShellState.error),
    detailStatus: selectedThreadDetailState.status,
    detailHasError: Option.isSome(selectedThreadDetailState.error),
  });

  if (stillHydrating) {
    return <OpeningThreadLoadingScreen />;
  }

  return (
    <ThreadUnavailableScreen
      actionLabel={
        routeEnvironmentRuntime === null ? "Manage environments" : "Reconnect environment"
      }
      onAction={() => {
        if (routeEnvironmentRuntime !== null) {
          onReconnectEnvironment(environmentId);
          return;
        }
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "SettingsEnvironments" },
        });
      }}
    />
  );
}

function ThreadRouteContent(
  props: ThreadRouteScreenProps & {
    readonly selectedThreadDetailState: ReturnType<typeof useSelectedThreadDetailState>;
  },
) {
  const translator = useMobileInterfaceTranslator();
  const { fileInspector, layout, panes, showAuxiliaryPane, toggleAuxiliaryPane } =
    useAdaptiveWorkspaceLayout();
  const { themeVariables } = useAppearancePreferences();
  const headerColor = themeVariables["--color-header"];
  const { connectionState } = useRemoteConnectionStatus();
  const { onReconnectEnvironment } = useRemoteConnections();
  const {
    selectedThread,
    selectedThreadCreation,
    selectedThreadProject,
    selectedEnvironmentConnection,
  } = useThreadSelection();
  const gitWorkbenchAvailability = useMobileGitWorkbenchAvailability({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
  const gitWorkbenchEnabled = mobileGitWorkbenchCanActivate(gitWorkbenchAvailability);
  const selectedThreadDetailState = props.selectedThreadDetailState;
  const selectedThreadDetail = Option.getOrNull(selectedThreadDetailState.data);
  const latestAutoReasoningEffort = useMemo(
    () =>
      readAutoReasoningResolution(
        selectedThreadDetail?.activities.filter(
          (activity) => activity.historyOrigin === undefined,
        ) ?? [],
      )?.effectiveEffort ?? null,
    [selectedThreadDetail?.activities],
  );
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
      projectIndexingVersion: serverConfig.environment.capabilities.projectIndexingVersion,
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
  const handleOpenProjectIndexSettings = useCallback(() => {
    if (selectedThread === null) return;
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: {
        screen: "SettingsProjectIndexing",
        params: {
          environmentId: String(selectedThread.environmentId),
          projectId: String(selectedThread.projectId),
        },
      },
    });
  }, [navigation, selectedThread]);
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
          resetKeys={[routeThreadIdentity, selectedThreadCwd]}
          Route={props.renderInspector ? RouteInspector : undefined}
        />
      ),
    [
      FilesInspector,
      GitInspector,
      RouteInspector,
      inspectorMode,
      props.renderInspector,
      routeThreadIdentity,
      selectedThreadCwd,
    ],
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
    let interrupted = false;
    let writingClipboard = false;
    try {
      await copyThreadTranscript({
        threadId: selectedThread.id,
        exportThreadTranscript: async (input) => {
          const result = await exportThreadTranscript({
            environmentId: selectedThread.environmentId,
            input,
          });
          if (result._tag === "Failure") {
            interrupted = isAtomCommandInterrupted(result);
            throw squashAtomCommandFailure(result);
          }
          return result.value;
        },
        writeText: async (content) => {
          writingClipboard = true;
          await Clipboard.setStringAsync(content);
        },
      });
      void Haptics.selectionAsync().catch(() => undefined);
      Alert.alert(
        "Transcript copied",
        "The complete, unredacted Markdown transcript is now on your clipboard.",
      );
    } catch (error) {
      if (!interrupted) {
        Alert.alert(
          "Could not copy transcript",
          writingClipboard
            ? "The clipboard could not be updated."
            : error instanceof Error
              ? error.message
              : "The transcript export failed.",
        );
      }
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
    DEFAULT_SERVER_SETTINGS,
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
  const handleEditFailedCreation = useCallback(async () => {
    const creation = selectedThreadCreation?.message;
    if (!creation?.creation || routeThreadIdentity === null) {
      return;
    }
    // The drain restored the prompt and attachments into the recovery draft
    // the rejected creation owns. Open that draft by id: without it the sheet
    // mints a fresh empty one and the restored content is unreachable.
    try {
      await recoverFailedThreadDraft(creation);
    } catch (error) {
      Alert.alert(
        "Could not restore draft",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    clearPendingThreadCreationOutcome(routeThreadIdentity);
    navigation.dispatch(
      StackActions.replace("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          draftId: restoredNewTaskDraftKey(creation.messageId),
          environmentId: String(creation.environmentId),
          projectId: String(creation.creation.projectId),
          ...(selectedThreadProject ? { title: selectedThreadProject.title } : {}),
        },
      }),
    );
  }, [navigation, routeThreadIdentity, selectedThreadCreation, selectedThreadProject]);
  const worktreeSetup = useWorktreeSetup({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
    activities: selectedThreadDetail?.activities ?? [],
    preparing:
      selectedThreadCreation?.message.creation?.workspaceMode === "worktree" &&
      selectedThreadCreation.outcome == null,
    turnStarted: selectedThreadDetail?.latestTurn?.startedAt != null,
    followUpSent:
      composer.selectedThreadFeed.filter(
        (entry) => entry.type === "message" && entry.message.role === "user",
      ).length +
        composer.selectedThreadQueuedMessages.length >
      1,
  });
  const awaitingBootstrapTurn =
    worktreeSetup?.phase === "running" && !worktreeSetupAgentStarted(worktreeSetup);
  const cancelWorktreeSetup = useAtomCommand(vcsEnvironment.cancelWorktreeSetup);
  const handleCancelWorktreeSetup = useCallback(() => {
    if (!selectedThread) return;
    void cancelWorktreeSetup({
      environmentId: selectedThread.environmentId,
      input: { threadId: selectedThread.id },
    });
  }, [cancelWorktreeSetup, selectedThread]);
  const [localResendMessageId, setLocalResendMessageId] = useState<string | null>(null);
  const handleWorkLocally = useCallback(async () => {
    if (!selectedThread || !selectedThreadCreation) return;
    const result = await cancelWorktreeSetup({
      environmentId: selectedThread.environmentId,
      input: { threadId: selectedThread.id },
    });
    if (result._tag === "Success" && result.value.cancelled) {
      setLocalResendMessageId(selectedThreadCreation.message.messageId);
    }
  }, [cancelWorktreeSetup, selectedThread, selectedThreadCreation]);
  // Wait for the outbox to restore the cancelled send before queuing its replacement.
  useEffect(() => {
    const pending = selectedThreadCreation;
    if (
      !localResendMessageId ||
      pending?.message.messageId !== localResendMessageId ||
      pending.outcome?.kind !== "failed"
    )
      return;
    setLocalResendMessageId(null);
    const original = pending.message;
    if (!original.creation) return;
    const metadata = makeTurnCommandMetadata();
    const replacement = {
      ...original,
      commandId: CommandId.make(metadata.commandId),
      messageId: MessageId.make(metadata.messageId),
      threadId: ThreadId.make(metadata.threadId),
      createdAt: metadata.createdAt,
      creation: {
        ...original.creation,
        workspaceMode: "local" as const,
        branch: null,
        worktreePath: null,
      },
    };
    void enqueueThreadOutboxMessage(replacement)
      .then(() => {
        const draftKey = restoredNewTaskDraftKey(original.messageId);
        const restored = getComposerDraftSnapshot(draftKey);
        // Leave any edits made during cancellation in their recovery draft.
        if (
          restored.text === original.text &&
          JSON.stringify(restored.context) === JSON.stringify(original.context) &&
          restored.attachments.length === original.attachments.length &&
          restored.attachments.every(
            (attachment, index) => attachment.id === original.attachments[index]?.id,
          )
        ) {
          clearComposerDraftContent(draftKey, { deferAttachmentCleanup: true });
        }
        clearPendingThreadCreationOutcome(
          scopedThreadKey(original.environmentId, original.threadId),
        );
        navigation.dispatch(
          StackActions.replace("Thread", {
            environmentId: String(replacement.environmentId),
            threadId: String(replacement.threadId),
          }),
        );
      })
      .catch((error) =>
        Alert.alert(
          "Could not work locally",
          error instanceof Error ? error.message : String(error),
        ),
      );
  }, [localResendMessageId, navigation, selectedThreadCreation]);
  const creationState = ((): ThreadDetailScreenProps["creationState"] => {
    if (selectedThreadCreation === null) {
      return awaitingBootstrapTurn ? { kind: "preparing", preparingWorktree: true } : null;
    }
    if (selectedThreadCreation.outcome?.kind === "failed") {
      return {
        kind: "failed",
        reason: selectedThreadCreation.outcome.reason,
        onEditTask: handleEditFailedCreation,
      };
    }
    return {
      kind: "preparing",
      preparingWorktree: selectedThreadCreation.message.creation?.workspaceMode === "worktree",
    };
  })();
  if (!environmentId || !threadId) {
    return <OpeningThreadLoadingScreen />;
  }

  if (!selectedThread) {
    return <OpeningThreadLoadingScreen />;
  }

  // A queued creation renders as ready content: its prompt is the whole
  // conversation until the server creates the thread. The subscription's
  // not-found error for that window is expected, not a load failure.
  const contentPresentation =
    creationState !== null
      ? { kind: "ready" as const }
      : projectThreadContentPresentation({
          hasDetail: selectedThreadDetail !== null,
          detailError: Option.getOrNull(selectedThreadDetailState.error),
          detailDeleted: selectedThreadDetailState.status === "deleted",
          connectionState: routeConnectionState,
        });
  const renderThreadRouteBody = () => (
    <>
      {creationState === null &&
      serverConfig !== null &&
      (serverConfig.environment.capabilities.projectIndexingVersion ?? 0) >= 1 &&
      ((serverConfig.environment.capabilities.projectIndexingDefaultsVersion ?? 0) < 1 ||
        serverConfig.settings.projectIndexingEnabled) ? (
        <ProjectIndexChatStatus
          environmentId={selectedThread.environmentId}
          projectId={selectedThread.projectId}
          projectLabel={selectedThreadProject?.title ?? serverConfig.environment.label}
          threadId={selectedThread.id}
          config={serverConfig}
          onOpenIndex={handleOpenKnowledgeGraph}
          onOpenSettings={handleOpenProjectIndexSettings}
        />
      ) : null}

      {gitWorkbenchEnabled ? (
        <GitActionProgressOverlay progress={gitActionProgress} onDismiss={dismissGitActionResult} />
      ) : null}

      <View className="flex-1 bg-screen android:overflow-hidden android:rounded-t-[28px] android:bg-thread-canvas">
        <ThreadDetailScreen
          selectedThread={selectedThreadWithDraftSettings ?? selectedThread}
          contentPresentation={contentPresentation}
          screenTone={connectionTone(routeConnectionState)}
          connectionError={routeConnectionError}
          environmentLabel={selectedEnvironmentConnection?.environmentLabel ?? null}
          feedbackSubmissions={composer.feedbackSubmissions}
          onDismissFeedback={composer.dismissFeedback}
          selectedThreadFeed={composer.selectedThreadFeed}
          subagents={selectedThreadDetail?.subagents ?? []}
          activeWorkStartedAt={composer.activeWorkStartedAt}
          isCompacting={composer.isCompacting}
          creationState={creationState}
          setupWorkingStartedAt={
            composer.activeWorkStartedAt !== null &&
            selectedThreadDetail?.activities.some(
              (activity) => activity.kind === "worktree-setup",
            ) &&
            composer.selectedThreadFeed.filter(
              (entry) => entry.type === "message" && entry.message.role === "user",
            ).length <= 1
              ? composer.activeWorkStartedAt
              : null
          }
          worktreeSetup={
            worktreeSetup
              ? {
                  snapshot: worktreeSetup,
                  turnStartedAt: selectedThreadDetail?.latestTurn?.startedAt ?? null,
                  working: composer.activeWorkStartedAt !== null,
                  turnStarted: selectedThreadDetail?.latestTurn?.startedAt != null,
                  onCancel: handleCancelWorktreeSetup,
                  onWorkLocally:
                    selectedThreadCreation?.outcome == null && selectedThreadCreation
                      ? handleWorkLocally
                      : null,
                }
              : null
          }
          activePendingApproval={requests.activePendingApproval}
          respondingApprovalId={requests.respondingApprovalId}
          activePendingUserInput={requests.activePendingUserInput}
          activePendingUserInputDrafts={requests.activePendingUserInputDrafts}
          activePendingUserInputAnswers={requests.activePendingUserInputAnswers}
          respondingUserInputId={requests.respondingUserInputId}
          draftMessage={composer.draftMessage}
          draftVoiceFileReferences={composer.draftVoiceFileReferences}
          readDraftText={composer.readDraftText}
          draftAttachments={composer.draftAttachments}
          connectionStateLabel={routeConnectionState}
          threadSyncStatus={selectedThreadDetailState.status}
          loadEarlier={loadEarlierTurns}
          environmentId={selectedThread.environmentId}
          projectWorkspaceRoot={selectedThreadProject?.workspaceRoot ?? null}
          threadCwd={selectedThreadCwd}
          selectedThreadQueueCount={composer.selectedThreadQueueCount}
          queuedMessages={composer.selectedThreadQueuedMessages}
          dispatchingMessageId={composer.dispatchingQueuedMessageId}
          activeThreadBusy={composer.activeThreadBusy}
          autoReasoningEffort={latestAutoReasoningEffort}
          layoutVariant={layout.variant}
          usesAutomaticContentInsets={usesNativeHeaderGlass}
          onOpenConnectionEditor={handleOpenConnectionEditor}
          onChangeDraftMessage={composer.onChangeDraftMessage}
          onPickDraftMedia={composer.onPickDraftMedia}
          onPickDraftFiles={composer.onPickDraftFiles}
          onNativePasteImages={composer.onNativePasteImages}
          onNativePasteText={composer.onNativePasteText}
          onRemoveDraftImage={composer.onRemoveDraftImage}
          serverConfig={serverConfig}
          onStopThread={awaitingBootstrapTurn ? handleCancelWorktreeSetup : handleStopThread}
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
          onDismissUserInput={requests.onDismissUserInput}
        />
      </View>
    </>
  );

  return (
    <>
      {activeInspectorRenderer ? <InspectorPaneRoleActivation /> : null}
      <ThreadHeader
        title={selectedThread.title}
        subtitle={headerSubtitle}
        headerColor={headerColor}
        usesNativeHeaderGlass={usesNativeHeaderGlass}
        gitControls={threadGitControlProps}
        hasThreadCwd={selectedThreadCwd !== null}
        hasWorkspaceRoot={Boolean(selectedThreadProject?.workspaceRoot)}
        fileInspectorSupported={fileInspector.supported}
        inspectorMode={inspectorMode}
        onToggleInspector={handleToggleInspector}
        onOpenGitInspector={handleOpenGitInspector}
        onOpenFilesInspector={handleOpenFilesInspector}
        onReturnToThread={props.onReturnToThread}
      />

      {renderThreadRouteBody()}
    </>
  );
}
