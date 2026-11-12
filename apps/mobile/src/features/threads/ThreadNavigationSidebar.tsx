import { AsyncResult } from "effect/reactivity";
import { useAtomSet } from "@effect/atom-react";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { ProjectFolder } from "../home/ProjectFolder";
import { ProjectOrderMenu } from "../home/ProjectOrderMenu";
import { useThreadBulkSelection } from "../home/useThreadBulkSelection";
import { useActiveNewTask } from "../../state/active-new-task";
import { ThreadUndoNotice } from "../home/ThreadUndoNotice";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import {
  pickableProjectGroups,
  resolveScratchProjectScopeKey,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  useAppearancePreferences,
  useAndroidFloatingTabs,
} from "../settings/appearance/AppearancePreferencesProvider";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { THREAD_SIDEBAR_ROW_LAYOUT } from "./threadListAnimations";
import type { MenuAction } from "@react-native-menu/menu";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent, TextInputInstance } from "react-native";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { GestureDetector, useNativeGesture } from "react-native-gesture-handler";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { FLOATING_TABS } from "../workspace/floating-workspace-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SearchBarCommands } from "react-native-screens";

import { AppText as Text } from "../../components/ui/AppText";
import { CompactBrandTitle } from "../../components/CompactBrandTitle";
import { Menu } from "../../components/ui/Menu";
import { SymbolView } from "../../components/ui/AppSymbol";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { useThreadSearch } from "../../state/queries";
import { useThreadListV2ShelfPreferences } from "./use-thread-list-v2-shelf-preferences";
import { useThreadListNow } from "./use-thread-list-now";
import { usePendingThreadOrder } from "../../state/thread-order";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { usePendingNewTasks, type PendingNewTask } from "../../state/use-pending-new-tasks";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useThreadListV2 } from "./useThreadListV2";
import { useThreadJumpShortcuts } from "../keyboard/threadKeyboardShortcuts";
import { requestThreadMessageJump } from "./threadMessageJump";
import { useThreadListSearchMatches } from "./useThreadListSearchMatches";
import { useHomeListOptions } from "../home/home-list-options";
import { buildHomeListFilterMenu } from "../home/home-list-filter-menu";
import {
  buildGroupedThreadListItems,
  resolveHomeProjectFilter,
  buildHomeProjectScopes,
} from "../home/homeThreadList";
import { SwipeableScrollGateProvider, useSwipeableScrollGate } from "../home/thread-swipe-actions";
import { usePendingTaskListActions } from "../home/usePendingTaskListActions";
import { useThreadListActions } from "../home/useThreadListActions";
import {
  getConnectionAwareBrandHeaderOptions,
  WorkspaceConnectionTitle,
} from "../home/WorkspaceConnectionTitle";
import { SidebarHeaderActions } from "./sidebar-header-actions";
import { ThreadListToolbar } from "../home/ThreadListToolbar";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";
import { useFabScroll } from "../home/FabScrollContext";
import { SidebarFilterButton } from "./sidebar-filter-button";
import { createSidebarHeaderItems } from "./sidebar-native-header-items";
import { SidebarNavigationShell } from "./sidebar-navigation-shell";
import {
  ThreadListV2ProjectSettledRow,
  ThreadListV2PendingRow,
  ThreadListV2Row,
  ThreadListV2OlderProjectsShelfHeader,
  ThreadListV2SettledShelfHeader,
  ThreadListV2ShowMoreRow,
  ThreadListV2SnoozedShelfHeader,
  ThreadListV2WorkingShelfHeader,
} from "./thread-list-v2-items";
import { useThreadRowProviderInstanceResolver } from "./thread-provider-instance";
import type { ThreadPrPresentation } from "../../state/thread-pr-presentation";
import { ThreadPrDemandProvider } from "../../state/thread-pr-demand";
import {
  isThreadListV2ListItem,
  threadListV2ListItemsAreEqual,
  THREAD_LIST_V2_SETTLED_INITIAL_COUNT,
  THREAD_LIST_V2_SETTLED_PAGE_COUNT,
  type ThreadListV2ListItem,
} from "./threadListV2";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

type SidebarListItem =
  | ThreadListV2ListItem
  | {
      readonly type: "v2-show-more";
      readonly key: string;
      readonly hiddenCount: number;
      readonly state?: "loading" | "failed";
    };

const SIDEBAR_STICKY_HEADER_HEIGHT = 106;

interface ThreadNavigationSidebarProps {
  readonly width: number;
  readonly visible: boolean;
  readonly selectedThreadKey: string | null;
  readonly onOpenSettings: () => void;
  readonly onOpenEnvironmentSettings: () => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
  readonly onOpenPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenThreadPullRequests: (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => void;
  readonly onRequestVisibility: () => void;
  readonly searchQuery: string;
}

export function ThreadNavigationSidebar(props: ThreadNavigationSidebarProps) {
  return (
    <ThreadPrDemandProvider visible={props.visible}>
      {Platform.OS !== "ios" ? (
        <ThreadNavigationSidebarPane {...props} nativeChrome={false} />
      ) : (
        <NativeSidebarContainer {...props} />
      )}
    </ThreadPrDemandProvider>
  );
}

function NativeSidebarContainer(props: ThreadNavigationSidebarProps) {
  return (
    <View
      testID="thread-navigation-sidebar"
      className="flex-1 border-border bg-drawer"
      style={{ borderRightWidth: StyleSheet.hairlineWidth, width: props.width }}
    >
      <SidebarNavigationShell>
        <ThreadNavigationSidebarPane {...props} nativeChrome />
      </SidebarNavigationShell>
    </View>
  );
}

function ThreadNavigationSidebarPane(
  props: ThreadNavigationSidebarProps & { readonly nativeChrome: boolean },
) {
  const translator = useMobileInterfaceTranslator();
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { themeVariables: materialTheme, appearance } = useAppearancePreferences();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : undefined;
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const groupingSettings = useMobileProjectGroupingSettings();
  const boring = preferences?.boringThreadListEnabled === true;
  const classic = preferences?.legacyThreadListEnabled === true || boring;
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());
  const drawerColor = materialTheme["--color-drawer"];

  const insets = useSafeAreaInsets();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  const projects = useProjects();
  const threads = useNavigationThreadShells();
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const searchInputRef = useRef<TextInputInstance>(null);
  const searchBarRef = useRef<SearchBarCommands>(null);
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const sidebarScrollGesture = useNativeGesture();
  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    unsettleThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const activeNewTask = useActiveNewTask();
  const queuedThreadKeys = useQueuedThreadKeys();
  const selectDetail = useSelectWorkspaceDetail();
  const { confirmDeletePendingTask } = usePendingTaskListActions((params) =>
    selectDetail({ name: "Thread", params }),
  );
  const environments = Object.values(savedConnectionsById)
    .map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const availableEnvironmentIds = new Set(
    environments.map((environment) => environment.environmentId),
  );
  const {
    options,
    setSelectedEnvironmentId,
    toggleSelectedProjectKey: setSelectedProjectKey,
  } = useHomeListOptions(availableEnvironmentIds);
  const searchEnvironmentIds =
    options.selectedEnvironmentId === null
      ? workspaceEnvironments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => environment.environmentId)
      : workspaceEnvironments.some(
            (environment) =>
              environment.environmentId === options.selectedEnvironmentId &&
              environment.connectionState === "connected",
          )
        ? [options.selectedEnvironmentId]
        : [];
  const resolvedProjectKeys = options.selectedProjectKeys.map(
    (key) => resolveScratchProjectScopeKey(key, projects, groupingSettings) ?? key,
  );
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: options.selectedEnvironmentId,
        projectGroupingMode: options.projectGroupingMode,
        projectGroupingOverrides: groupingSettings.sidebarProjectGroupingOverrides,
      }),
    [
      projects,
      options.selectedEnvironmentId,
      options.projectGroupingMode,
      groupingSettings.sidebarProjectGroupingOverrides,
    ],
  );
  const projectFilterOptions = pickableProjectGroups(projectScopes).map((scope) => ({
    key: scope.key,
    label: scope.title,
  }));
  const projectTitleByProjectKey = useMemo(
    () =>
      new Map(
        projectScopes.flatMap((scope) =>
          scope.projectRefs.map(
            (projectRef) =>
              [
                scopedProjectKey(projectRef.environmentId, projectRef.projectId),
                scope.title,
              ] as const,
          ),
        ),
      ),
    [projectScopes],
  );
  const projectFilter = resolveHomeProjectFilter(
    pickableProjectGroups(projectScopes),
    resolvedProjectKeys,
  );
  const selectedProjectScope = projectFilter.scopes.length === 1 ? projectFilter.scopes[0]! : null;
  const selectedProjectKeys = projectFilter.keys;
  const threadSearch = useThreadSearch(
    searchEnvironmentIds,
    props.searchQuery,
    projectFilter.projectRefs === null
      ? {}
      : { projectIds: projectFilter.projectRefs.map((ref) => ref.projectId) },
  );
  // This map reaches LegendList's extraData, which re-renders every row whenever it changes
  // identity; the hook keeps it stable.
  const threadSearchMatchByKey = useThreadListSearchMatches(threads, threadSearch);
  const selectedProjectKey = selectedProjectScope?.key ?? null;
  const projectByKey = useMemo(() => {
    const map = new Map<string, EnvironmentProject>();
    for (const project of projects) {
      map.set(scopedProjectKey(project.environmentId, project.id), project);
    }
    return map;
  }, [projects]);

  const [settledVisibleCount, setSettledVisibleCount] = useState(
    THREAD_LIST_V2_SETTLED_INITIAL_COUNT,
  );
  const settledResetKey = `${options.selectedEnvironmentId ?? "all"}:${selectedProjectKeys.join("|") || "all"}:${props.searchQuery.trim()}`;
  const [lastSettledResetKey, setLastSettledResetKey] = useState(settledResetKey);
  if (lastSettledResetKey !== settledResetKey) {
    setLastSettledResetKey(settledResetKey);
    setSettledVisibleCount(THREAD_LIST_V2_SETTLED_INITIAL_COUNT);
  }
  const showMoreSettled = () =>
    setSettledVisibleCount((count) => count + THREAD_LIST_V2_SETTLED_PAGE_COUNT);
  const {
    loaded: shelfPreferencesLoaded,
    olderProjectsExpanded,
    settledShelfExpanded,
    snoozedShelfExpanded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleOlderProjects,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } = useThreadListV2ShelfPreferences();
  const now = useThreadListNow(threads);
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const {
    providersByEnvironmentId,
    machineByEnvironmentId,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    snoozePresetsByEnvironmentId,
    pinningEnvironmentIds,
    autoSettleOptOutEnvironmentIds,
    pinReorderEnvironmentIds,
    activeReorderEnvironmentIds,
    titleRegenerationEnvironmentIds,
  } = listEnvironments;
  const resolveProviderInstance = useThreadRowProviderInstanceResolver(providersByEnvironmentId);
  const pendingOrder = usePendingThreadOrder();
  const {
    layout: threadListV2Layout,
    items: flatThreadListItems,
    contentOnlyThreadKeys,
    olderSettledShelf,
  } = useThreadListV2({
    threads,
    pendingTasks,
    environmentId: options.selectedEnvironmentId,
    projectRefs: projectFilter.projectRefs,
    searchQuery: props.searchQuery,
    searchMatches: threadSearchMatchByKey,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    pinReorderEnvironmentIds,
    activeReorderEnvironmentIds,
    queuedThreadKeys,
    settledLimit: settledVisibleCount,
    listAllLoadedSettled: classic,
    now,
    pendingOrder,
    shelfPreferencesLoaded,
    workingShelfEnabled: classic ? false : workingShelfEnabled,
    workingShelfExpanded,
    snoozedShelfExpanded: classic || snoozedShelfExpanded,
    settledShelfExpanded: classic || settledShelfExpanded,
    olderProjectGroups: classic || projectFilter.projectRefs !== null ? null : projectScopes,
    olderProjectsExpanded,
    selectedThreadKey: props.selectedThreadKey ?? null,
  });
  const selection = useThreadBulkSelection(
    threadListV2Layout.items.map((item) => item.thread),
    now,
  );
  const grouped = classic
    ? buildGroupedThreadListItems({
        rows: flatThreadListItems,
        scopes: projectFilter.scopes.length > 0 ? projectFilter.scopes : projectScopes,
        boring,
        searching: props.searchQuery.trim().length > 0,
        previewCount: appearance.projectThreadPreviewCount,
        projectSortField:
          preferences?.sidebarProjectSortOrder === "created_at" ? "createdAt" : "updatedAt",
        threadSortField:
          preferences?.sidebarThreadSortOrder === "created_at" ? "createdAt" : "updatedAt",
        projectSortOrder: preferences?.sidebarProjectSortOrder ?? options.projectSortOrder,
        projectOrder: preferences?.sidebarProjectOrder,
        collapsedGroups: preferences?.collapsedProjectGroups,
        openSettledGroups: preferences?.openSettledProjectGroups,
        expandedGroups: expandedProjects,
        selectedProjectKeys,
        selectedThreadKey: props.selectedThreadKey,
      })
    : null;
  const threadListV2Items = grouped?.items ?? flatThreadListItems;
  const listItems: readonly SidebarListItem[] =
    (classic || settledShelfExpanded) && threadListV2Layout.hiddenSettledCount > 0
      ? [
          ...threadListV2Items,
          {
            type: "v2-show-more",
            key: "v2-show-more",
            hiddenCount: threadListV2Layout.hiddenSettledCount,
            ...(olderSettledShelf.loading
              ? { state: "loading" as const }
              : olderSettledShelf.failed
                ? { state: "failed" as const }
                : {}),
          },
        ]
      : threadListV2Items;
  const listMenuActions = [
    {
      id: "environment",
      title: translator.message("mobile.navigation.environment"),
      subactions: [
        {
          id: "environment:all",
          title: translator.message("mobile.navigation.allEnvironments"),
          subtitle: translator.message("mobile.navigation.allEnvironmentsDescription"),
          state: options.selectedEnvironmentId === null ? "on" : "off",
        },
        ...environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          state:
            options.selectedEnvironmentId === environment.environmentId
              ? ("on" as const)
              : ("off" as const),
        })),
      ],
    },
    ...(projectFilterOptions.length === 0
      ? []
      : ([
          {
            id: "project",
            title: translator.message("mobile.navigation.project"),
            subactions: [
              {
                id: "project:all",
                title: translator.message("mobile.navigation.allProjects"),
                subtitle: translator.message("mobile.navigation.allProjectsDescription"),
                state: selectedProjectKeys.length === 0 ? "on" : "off",
              },
              ...projectFilterOptions.map((project) => ({
                id: `project:${project.key}`,
                title: project.label,
                state: selectedProjectKeys.includes(project.key)
                  ? ("on" as const)
                  : ("off" as const),
              })),
            ],
          },
        ] satisfies MenuAction[])),
  ] satisfies MenuAction[];
  const handleListMenuAction = ({
    nativeEvent,
  }: {
    readonly nativeEvent: { readonly event: string };
  }) => {
    const event = nativeEvent.event;
    if (event === "environment:all") {
      setSelectedEnvironmentId(null);
      return;
    }
    if (event.startsWith("environment:")) {
      const environment = environments.find(
        (candidate) => String(candidate.environmentId) === event.slice("environment:".length),
      );
      if (environment) setSelectedEnvironmentId(environment.environmentId);
      return;
    }
    if (event === "project:all") {
      setSelectedProjectKey(null);
      return;
    }
    if (event.startsWith("project:")) {
      const projectKey = event.slice("project:".length);
      if (projectFilterOptions.some((project) => project.key === projectKey)) {
        setSelectedProjectKey(projectKey);
      }
      return;
    }
  };

  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState<number | null>(null);
  const { height, paddingTop, paddingBottom } = useToolbarLayout();
  const stickyHeaderHeight =
    measuredHeaderHeight ??
    (Platform.OS === "android"
      ? paddingTop + height + paddingBottom
      : insets.top + SIDEBAR_STICKY_HEADER_HEIGHT);
  const topListInset = stickyHeaderHeight + 6;
  const handleStickyHeaderLayout = (event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setMeasuredHeaderHeight((current) => (current === nextHeight ? current : nextHeight));
  };
  const handleSwipeableWillOpen = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current !== methods) {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = methods;
    }
  };
  const handleSwipeableClose = (methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) {
      openSwipeableRef.current = null;
    }
  };
  // Destructure callback props; capturing all props would invalidate these row-closing handlers on unrelated changes.
  const { onSelectThread, onOpenThreadPullRequests } = props;
  // A row listed for a message match opens the thread at that message, by
  // tap or by shortcut.
  const handleSelectThread = (thread: EnvironmentThreadShell) => {
    const key = threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id });
    const messageId = contentOnlyThreadKeys.has(key)
      ? threadSearchMatchByKey.get(key)?.messageId
      : undefined;
    if (messageId) {
      requestThreadMessageJump(scopedThreadKey(thread.environmentId, thread.id), messageId);
    }
    onSelectThread(thread);
    openSwipeableRef.current?.close();
  };
  const handleOpenThreadPullRequests = (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => {
    onOpenThreadPullRequests(thread, pr);
    openSwipeableRef.current?.close();
  };
  const handleScrollBeginDrag = () => {
    openSwipeableRef.current?.close();
  };
  const onFabScroll = useFabScroll();
  const { swipeEnabled, scrollGateHandlers } = useSwipeableScrollGate({
    onScroll: onFabScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
  });
  // Recycle equality needs project/search data for titles and favicons; keep the minute clock on items to limit updates.
  const listExtraData = {
    selection,
    grouped,
    activeNewTask,
    selectedThreadKey: props.selectedThreadKey ?? "",
    projectByKey,
    projectTitleByProjectKey,
    savedConnectionsById,
    listEnvironments,
    threadSearchMatchByKey,
    workingShelfEnabled,
  };
  useThreadJumpShortcuts(listItems, handleSelectThread);
  const sidebarItemsAreEqual = (previous: SidebarListItem, item: SidebarListItem): boolean => {
    if (isThreadListV2ListItem(previous) && isThreadListV2ListItem(item)) {
      return threadListV2ListItemsAreEqual(previous, item);
    }
    if (previous.type === "v2-show-more" && item.type === "v2-show-more") {
      return previous.hiddenCount === item.hiddenCount && previous.state === item.state;
    }
    return false;
  };
  const focusSearch = () => {
    if (Platform.OS === "android") return false;
    const focus = () => {
      if (props.nativeChrome) {
        searchBarRef.current?.focus();
        return;
      }
      searchInputRef.current?.focus();
    };
    if (!props.visible) {
      props.onRequestVisibility();
      setTimeout(focus, 240);
    } else {
      focus();
    }
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const renderFlatListItem = ({ item }: { readonly item: SidebarListItem }) => {
    switch (item.type) {
      case "v2-pending": {
        const pendingScopeKey = scopedProjectKey(
          item.pendingTask.environmentId,
          item.pendingTask.projectId,
        );
        return (
          <ThreadListV2PendingRow
            pendingTask={item.pendingTask}
            selected={
              activeNewTask?.pendingKey === item.pendingTask.key ||
              (item.pendingTask.kind === "pending" &&
                scopedThreadKey(
                  item.pendingTask.environmentId,
                  item.pendingTask.message.threadId,
                ) === props.selectedThreadKey)
            }
            project={projectByKey.get(pendingScopeKey) ?? null}
            projectTitle={projectTitleByProjectKey.get(pendingScopeKey)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[item.pendingTask.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(item.pendingTask.environmentId)}
            pane="sidebar"
            showPendingDivider={item.showPendingDivider}
            onSelectPendingTask={props.onOpenPendingTask}
            onDeletePendingTask={confirmDeletePendingTask}
            fullSwipeWidth={props.width - 20}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-thread": {
        const thread = item.item.thread;
        const scopeKey = scopedProjectKey(thread.environmentId, thread.projectId);
        return (
          <ThreadListV2Row
            onNewThreadOnBranch={props.onNewThreadOnBranch}
            thread={thread}
            variant={item.item.variant}
            hasQueuedMessages={item.hasQueuedMessages}
            snoozed={item.item.snoozed}
            pinned={item.item.pinned}
            wokeAt={item.item.wokeAt}
            snoozePresetMinute={item.snoozePresetMinute ?? ""}
            snoozeWakeLabelText={item.snoozeWakeLabelText}
            timeLabel={item.timeLabel}
            project={projectByKey.get(scopeKey) ?? null}
            providerInstance={resolveProviderInstance(thread)}
            providers={providersByEnvironmentId.get(thread.environmentId)}
            environmentLabel={
              Object.keys(savedConnectionsById).length > 1
                ? (savedConnectionsById[thread.environmentId]?.environmentLabel ?? null)
                : null
            }
            environmentMachine={machineByEnvironmentId.get(thread.environmentId)}
            searchMatch={
              // Only rows listed for their messages show one and open at it.
              contentOnlyThreadKeys.has(
                threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
              )
                ? threadSearchMatchByKey.get(
                    threadSearchMatchKey({
                      environmentId: thread.environmentId,
                      threadId: thread.id,
                    }),
                  )
                : undefined
            }
            searchQuery={threadSearch.query}
            pane="sidebar"
            selected={
              !activeNewTask &&
              scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey
            }
            fullSwipeWidth={props.width - 20}
            selectionMode={selection.active}
            selectionChecked={selection.selectedKeys.has(
              scopedThreadKey(thread.environmentId, thread.id),
            )}
            onToggleSelection={selection.toggle}
            onSelectThread={handleSelectThread}
            onOpenThreadPullRequests={handleOpenThreadPullRequests}
            onDeleteThread={confirmDeleteThread}
            onArchiveThread={archiveThread}
            onRenameThread={renameThread}
            onRegenerateThreadTitle={regenerateThreadTitle}
            titleRegenerationSupported={titleRegenerationEnvironmentIds.has(thread.environmentId)}
            settlementSupported={settlementEnvironmentIds.has(thread.environmentId)}
            onSettleThread={settleThread}
            snoozeSupported={snoozeEnvironmentIds.has(thread.environmentId)}
            snoozePresets={snoozePresetsByEnvironmentId.get(thread.environmentId)}
            pinningSupported={pinningEnvironmentIds.has(thread.environmentId)}
            autoSettleOptOutSupported={autoSettleOptOutEnvironmentIds.has(thread.environmentId)}
            reorderSupported={
              item.item.pinned
                ? pinReorderEnvironmentIds.has(thread.environmentId)
                : !workingShelfEnabled && activeReorderEnvironmentIds.has(thread.environmentId)
            }
            canMoveUp={item.canMoveUp}
            canMoveDown={item.canMoveDown}
            onSnoozeThread={snoozeThread}
            onUnsnoozeThread={unsnoozeThread}
            onUnsettleThread={unsettleThread}
            onPinThread={pinThread}
            onUnpinThread={unpinThread}
            onSetThreadAutoSettle={setThreadAutoSettle}
            onMoveThread={moveThread}
            onSwipeableClose={handleSwipeableClose}
            onSwipeableWillOpen={handleSwipeableWillOpen}
            simultaneousSwipeGesture={sidebarScrollGesture}
          />
        );
      }
      case "v2-project-header":
        return null;
      case "v2-project-settled":
        return (
          <ThreadListV2ProjectSettledRow
            count={item.count}
            open={item.open}
            onToggle={() =>
              savePreferences({
                transform: (current) => ({
                  openSettledProjectGroups: current.openSettledProjectGroups?.includes(
                    item.scopeKey,
                  )
                    ? current.openSettledProjectGroups.filter((key) => key !== item.scopeKey)
                    : [...(current.openSettledProjectGroups ?? []), item.scopeKey],
                }),
              })
            }
          />
        );
      case "v2-older-projects-shelf":
        return (
          <ThreadListV2OlderProjectsShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleOlderProjects}
            pane="sidebar"
          />
        );
      case "v2-working-shelf":
        return (
          <ThreadListV2WorkingShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleWorkingShelf}
            pane="sidebar"
          />
        );
      case "v2-snoozed-shelf":
        return (
          <ThreadListV2SnoozedShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleSnoozedShelf}
            pane="sidebar"
          />
        );
      case "v2-settled-shelf":
        return (
          <ThreadListV2SettledShelfHeader
            count={item.count}
            disabled={item.disabled}
            expanded={item.expanded}
            onToggle={toggleSettledShelf}
            pane="sidebar"
          />
        );
      case "v2-show-more":
        return (
          <ThreadListV2ShowMoreRow
            pane="sidebar"
            hiddenCount={item.hiddenCount}
            {...(item.state === undefined ? {} : { state: item.state })}
            onPress={() => {
              olderSettledShelf.retry();
              showMoreSettled();
            }}
          />
        );
    }
  };
  const renderListItem = ({ item }: { readonly item: SidebarListItem }) => {
    const group = grouped?.groups.get(item.key);
    if (!group) return renderFlatListItem({ item });
    return (
      <ProjectFolder
        group={group}
        onNewThread={() => props.onNewThreadInProject(group.project)}
        onToggleExpanded={() =>
          setExpandedProjects((current) => {
            const next = new Set(current);
            if (next.has(group.scopeKey)) next.delete(group.scopeKey);
            else next.add(group.scopeKey);
            return next;
          })
        }
      >
        {renderFlatListItem({ item })}
      </ProjectFolder>
    );
  };
  const filterCustomized = options.selectedEnvironmentId !== null || selectedProjectKeys.length > 0;
  const filterIcon = filterCustomized
    ? "line.3.horizontal.decrease.circle.fill"
    : "line.3.horizontal.decrease.circle";
  const filterMenu = buildHomeListFilterMenu({
    environments,
    projects: projectFilterOptions,
    selectedEnvironmentId: options.selectedEnvironmentId,
    selectedProjectKey,
    selectedProjectKeys,
    onEnvironmentChange: setSelectedEnvironmentId,
    onProjectChange: setSelectedProjectKey,
    listOrganization: classic,
    projectSortOrder: preferences?.sidebarProjectSortOrder ?? options.projectSortOrder,
    threadSortOrder: preferences?.sidebarThreadSortOrder ?? "updated_at",
    onProjectSortOrderChange: (value) => savePreferences({ sidebarProjectSortOrder: value }),
    onThreadSortOrderChange: (value) => savePreferences({ sidebarThreadSortOrder: value }),
  });
  const nativeHeaderItems = createSidebarHeaderItems({
    filterIcon,
    filterMenu,
    onOpenSettings: props.onOpenSettings,
  });
  const listEmpty = (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 py-4 text-center text-sm text-drawer-foreground-muted"
          : "px-2 py-4 text-sm text-drawer-foreground-muted"
      }
    >
      {catalogState.isLoadingConnections
        ? translator.message("mobile.ui.loadingThreads")
        : Platform.OS === "android" && !catalogState.hasConnections
          ? translator.message("mobile.home.noEnvironments")
          : props.searchQuery.trim().length > 0
            ? threadSearch.isPending
              ? translator.message("mobile.navigation.searchingMessages")
              : translator.message("mobile.navigation.noMatchingThreads")
            : selectedProjectScope !== null
              ? `No threads in ${selectedProjectScope.title}`
              : translator.message("mobile.navigation.noThreadsYet")}
    </Text>
  );

  if (props.nativeChrome) {
    return (
      <>
        <NativeStackScreenOptions
          optionsVersion={[nativeHeaderItems, props.width]}
          options={{
            ...getConnectionAwareBrandHeaderOptions({
              headerWidth: props.width,
              trailingItemCount: nativeHeaderItems.length,
              onOpenEnvironments: props.onOpenEnvironmentSettings,
              fallbackTitleStyle: { fontSize: 18, fontWeight: "800" },
            }),
            headerSearchBarOptions: {
              ref: searchBarRef,
              autoCapitalize: "none",
              hideNavigationBar: false,
              hideWhenScrolling: false,
              obscureBackground: false,
              placeholder: translator.message("mobile.archive.searchShort"),
              placement: "stacked",
              onCancelButtonPress: () => {
                props.onSearchQueryChange("");
              },
              onChangeText: (event) => {
                props.onSearchQueryChange(event.nativeEvent.text);
              },
            },
            unstable_headerRightItems: () => nativeHeaderItems,
          }}
        />
        <View className="flex-1">
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              <AnimatedLegendList
                renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
                itemLayoutAnimation={THREAD_SIDEBAR_ROW_LAYOUT}
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={sidebarItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                automaticallyAdjustsScrollIndicatorInsets={NATIVE_LIQUID_GLASS_SUPPORTED}
                contentInsetAdjustmentBehavior={
                  NATIVE_LIQUID_GLASS_SUPPORTED ? "automatic" : "never"
                }
                contentContainerStyle={[
                  styles.threadListContent,
                  Platform.OS === "android" ? { paddingHorizontal: 0 } : null,
                  {
                    paddingBottom: Math.max(insets.bottom, 16) + 16,
                    paddingTop: 6,
                  },
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListHeaderComponent={
                  <>
                    {classic ? <ProjectOrderMenu scopes={projectScopes} /> : null}
                    {selection.toolbar(
                      threadListV2Items.flatMap((row) =>
                        row.type === "v2-thread" && !grouped?.groups.get(row.key)?.collapsed
                          ? [row.item.thread]
                          : [],
                      ),
                    )}
                  </>
                }
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
          <ThreadUndoNotice visible={props.visible} />
        </View>
      </>
    );
  }

  return (
    <View
      testID="thread-navigation-sidebar"
      className={
        Platform.OS === "android" ? "flex-1 bg-header" : "flex-1 border-r border-border bg-drawer"
      }
      // Android fills its pane, which animates its width while a hinge resizes the split.
      style={Platform.OS === "android" ? undefined : { width: props.width }}
    >
      <View
        className="flex-1"
        style={
          Platform.OS === "android"
            ? {
                marginTop: stickyHeaderHeight,
                marginHorizontal: 4,
                paddingBottom: insets.bottom,
                backgroundColor: drawerColor,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                overflow: "hidden",
              }
            : { paddingBottom: insets.bottom }
        }
      >
        {Platform.OS === "android" && listItems.length === 0 ? (
          <View className="flex-1 items-center justify-center">{listEmpty}</View>
        ) : (
          <SwipeableScrollGateProvider enabled={swipeEnabled}>
            <GestureDetector gesture={sidebarScrollGesture}>
              {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- Only the non-native workspace layout (Android and the fallback) renders this sidebar, which has no native header to register with. */}
              <AnimatedLegendList
                itemLayoutAnimation={THREAD_SIDEBAR_ROW_LAYOUT}
                data={listItems}
                drawDistance={500}
                estimatedItemSize={64}
                extraData={listExtraData}
                getItemType={(item) => item.type}
                itemsAreEqual={sidebarItemsAreEqual}
                keyExtractor={(item) => item.key}
                renderItem={renderListItem}
                contentContainerStyle={[
                  styles.threadListContent,
                  Platform.OS === "android" ? { paddingHorizontal: 0 } : null,
                  {
                    paddingBottom:
                      Platform.OS === "android"
                        ? floatingTabsEnabled
                          ? FLOATING_TABS.bottom + FLOATING_TABS.edge + fabSize
                          : Math.max(insets.bottom, 16) + fabClearance - insets.bottom
                        : 16 + insets.bottom,
                    paddingTop: Platform.OS === "android" ? 6 : topListInset,
                  },
                ]}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                {...scrollGateHandlers}
                recycleItems
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                style={styles.threadList}
                ListHeaderComponent={
                  <>
                    {classic ? <ProjectOrderMenu scopes={projectScopes} /> : null}
                    {selection.toolbar(
                      threadListV2Items.flatMap((row) =>
                        row.type === "v2-thread" && !grouped?.groups.get(row.key)?.collapsed
                          ? [row.item.thread]
                          : [],
                      ),
                    )}
                  </>
                }
                ListEmptyComponent={listEmpty}
              />
            </GestureDetector>
          </SwipeableScrollGateProvider>
        )}
      </View>

      {Platform.OS === "android" ? (
        <ThreadListToolbar
          sidebar
          onLayout={handleStickyHeaderLayout}
          searchQuery={props.searchQuery}
          onSearchQueryChange={props.onSearchQueryChange}
          filterActions={listMenuActions}
          filterCustomized={filterCustomized}
          onFilterAction={handleListMenuAction}
          onOpenEnvironments={props.onOpenEnvironmentSettings}
          onRequestVisibility={props.onRequestVisibility}
        />
      ) : (
        <View
          className="absolute inset-x-0 top-0 z-[4] bg-drawer"
          collapsable={false}
          onLayout={handleStickyHeaderLayout}
          pointerEvents="auto"
          style={{ paddingTop: insets.top }}
        >
          <View className="h-[50px] flex-row items-end gap-0.5 pr-2 pl-5">
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironmentSettings}
              size="pageTitle"
              brand={
                <View className="h-11 flex-1 justify-center">
                  <CompactBrandTitle allowFontScaling={false} />
                </View>
              }
            />
            <View className="flex-row items-center gap-2.5">
              <Menu actions={listMenuActions} onPressAction={handleListMenuAction}>
                <SidebarFilterButton
                  accessibilityLabel={translator.message("mobile.ui.filterThreads")}
                  icon={filterIcon}
                />
              </Menu>
              <SidebarHeaderActions onOpenSettings={props.onOpenSettings} />
            </View>
          </View>

          <View className="mx-4 mt-[9px] h-[38px] flex-row items-center gap-1.5 rounded-xl bg-sidebar-search pr-2.5 pl-[11px]">
            <SymbolView
              name="magnifyingglass"
              size={15}
              tintColorClassName="accent-drawer-foreground-muted"
              type="monochrome"
            />
            <TextInput
              ref={searchInputRef}
              accessibilityLabel={translator.message("mobile.navigation.searchThreads")}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={props.onSearchQueryChange}
              placeholder={translator.message("mobile.archive.searchShort")}
              placeholderTextColorClassName="accent-placeholder"
              selectionColorClassName={undefined}
              cursorColorClassName={undefined}
              selectionHandleColorClassName={undefined}
              returnKeyType="search"
              className="h-[34px] flex-1 px-0 py-0 font-sans text-base text-drawer-foreground"
              value={props.searchQuery}
            />
          </View>
        </View>
      )}
      <ThreadUndoNotice visible={props.visible} />
    </View>
  );
}

const styles = StyleSheet.create({
  threadList: {
    flex: 1,
  },
  threadListContent: {
    paddingHorizontal: 8,
  },
});
