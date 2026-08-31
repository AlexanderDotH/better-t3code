import {
  ArchiveIcon,
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CloudIcon,
  ContainerIcon,
  FolderPlusIcon,
  Globe2Icon,
  LoaderIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  PrStatusTooltipContent,
  resolveThreadPr,
  terminalStatusFromRunningIds,
  ThreadWorktreeIndicator,
  useLinkedThreadPullRequest,
} from "./ThreadStatusIndicators";
import { ProjectFavicon } from "./ProjectFavicon";
import { useAtomValue } from "@effect/atom-react";
import { autoAnimate } from "@formkit/auto-animate";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  type ContextMenuItem,
  ProjectId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ResolvedKeybindingsConfig,
  type SidebarProjectGroupingMode,
  ThreadId,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { resolveProjectThreadSections } from "@t3tools/client-runtime/project-thread-preview";
import {
  resolveThreadSidebarLifecycle,
  type ChangeRequestSettleSource,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import {
  type SidebarProjectSortOrder,
  type SidebarThreadPreviewCount,
  type SidebarThreadSortOrder,
} from "@t3tools/contracts/settings";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useDesktopLocalBootstraps } from "../connection/useDesktopLocalBootstraps";
import { isElectron } from "../env";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { releaseProjectDraftUploads } from "../lib/composerDraftUploads";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isMacPlatform } from "../lib/utils";
import {
  readThreadShell,
  useProject,
  useProjects,
  useServerConfigs,
  useThreadShells,
  useThreadShellsForProjectRefs,
} from "../state/entities";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useThreadDiscoveredPorts } from "../portDiscoveryState";
import { openDiscoveredPort } from "./preview/openDiscoveredPort";
import { useAtomCommand } from "../state/use-atom-command";
import { previewEnvironment } from "../state/preview";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  useUiStateStore,
} from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { useShortcutModifierState } from "../shortcutModifierState";
import { ensureLocalApi, readLocalApi } from "../localApi";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useDesktopUpdateState } from "../state/desktopUpdate";

import { useThreadActions } from "../hooks/useThreadActions";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironment, useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { Kbd } from "./ui/kbd";
import {
  getDesktopUpdateActionError,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { showDesktopUpdateDownloadedToast } from "./desktopUpdate.toast";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { openCommandPalette } from "../commandPaletteBus";
import {
  archiveSelectedThreadEntries,
  buildMultiSelectThreadContextMenuItems,
  getSidebarThreadIdsToPrewarm,
  isThreadStatusAlwaysVisibleInProjectPreview,
  resolveLegacySidebarProjectThreadIds,
  resolveAdjacentThreadId,
  isContextMenuPointerDown,
  isSidebarNestedLinkClick,
  isTrailingDoubleClick,
  resolveProjectHeaderClickAction,
  resolveProjectStatusIndicator,
  resolveSidebarProjectSettingsTarget,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  orderItemsByPreferredIds,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  useThreadJumpHintVisibility,
  ThreadStatusPill,
} from "./Sidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { CommandDialogTrigger } from "./ui/command";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useBetterT3DeviceFeature } from "~/hooks/useBetterT3Feature";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { primaryServerKeybindingsAtom } from "../state/server";
import {
  derivePhysicalProjectKey,
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import type { SidebarThreadSummary } from "../types";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { partitionSidebarProjectsByActivity } from "../sidebarProjectActivity";
import { SidebarOlderProjectsSection } from "./sidebar/SidebarOlderProjectsSection";
import { resolveLegacySidebarProjectThreadDisclosure } from "./sidebar/legacySidebarProjectThreadDisclosure";
import { useLegacySidebarVirtualThreadRows } from "./sidebar/LegacySidebarVirtualThreadRows";
import {
  LegacySidebarDraftRows,
  useProjectHasDraftContent,
} from "./sidebar/LegacySidebarDraftRows";
import { ProjectThreadPreviewCountControl } from "./ProjectThreadPreviewCountControl";
import { useProjectThreadPreviewCount } from "../projectThreadPreviewSync";
import { useNowMinute } from "../hooks/useNowMinute";
const SIDEBAR_SORT_ORDERS = [
  "updated_at",
  "created_at",
  "manual",
] as const satisfies readonly SidebarProjectSortOrder[];
const SIDEBAR_THREAD_SORT_ORDERS = [
  "updated_at",
  "created_at",
] as const satisfies readonly SidebarThreadSortOrder[];
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
const MAX_SIDEBAR_ACTIVITY_TIMEOUT_MS = 2_147_483_647;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();

function localizedThreadStatusLabel(
  status: ThreadStatusPill,
  translator: InterfaceTranslator,
): string {
  const messageId = {
    Working: "sidebar.status.working",
    Monitoring: "sidebar.status.monitoring",
    Connecting: "sidebar.status.connecting",
    Completed: "sidebar.status.completed",
    Failed: "sidebar.status.failed",
    "Pending Approval": "sidebar.status.pendingApproval",
    "Awaiting Input": "sidebar.status.awaitingInput",
    "Plan Ready": "sidebar.status.planReady",
  } as const;
  return translator.message(messageId[status.label]);
}

function LocalizedThreadStatusLabel(props: {
  readonly status: ThreadStatusPill;
  readonly translator: InterfaceTranslator;
  readonly compact?: boolean;
}) {
  const label = localizedThreadStatusLabel(props.status, props.translator);
  if (props.compact) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-label={label}
              className={`inline-flex size-3.5 shrink-0 items-center justify-center ${props.status.colorClass}`}
            />
          }
        >
          <span
            className={`size-[9px] rounded-full ${props.status.dotClass} ${
              props.status.pulse ? "animate-status-pulse" : ""
            }`}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className={`inline-flex items-center gap-1 text-[10px] ${props.status.colorClass}`}
          />
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${props.status.dotClass} ${
            props.status.pulse ? "animate-status-pulse" : ""
          }`}
        />
        <span className="hidden md:inline">{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
const SIDEBAR_ICON_ACTION_BUTTON_CLASS =
  "inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-icon-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring";

function SidebarThreadDetailPrewarmer({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  useEnvironmentThread(threadRef.environmentId, threadRef.threadId);
  return null;
}

function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.title;
  }

  return member.environmentLabel
    ? `${member.environmentLabel} — ${member.workspaceRoot}`
    : member.workspaceRoot;
}

function projectExpansionPreferenceKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

function projectGroupingModeMessageId(mode: SidebarProjectGroupingMode) {
  switch (mode) {
    case "repository":
      return "sidebar.project.grouping.repository" as const;
    case "repository_path":
      return "sidebar.project.grouping.repositoryPath" as const;
    case "separate":
      return "sidebar.project.grouping.separate" as const;
  }
}

function projectGroupingDescriptionMessageId(mode: SidebarProjectGroupingMode) {
  switch (mode) {
    case "repository":
      return "sidebar.project.grouping.repositoryDescription" as const;
    case "repository_path":
      return "sidebar.project.grouping.repositoryPathDescription" as const;
    case "separate":
      return "sidebar.project.grouping.separateDescription" as const;
  }
}

function sidebarSortMessageId(order: SidebarProjectSortOrder | SidebarThreadSortOrder) {
  switch (order) {
    case "updated_at":
      return "sidebar.sort.lastUserMessage" as const;
    case "created_at":
      return "sidebar.sort.createdAt" as const;
    case "manual":
      return "sidebar.sort.manual" as const;
  }
}

function buildThreadJumpLabelMap(input: {
  keybindings: ResolvedKeybindingsConfig;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.threadJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<string, string>();
  for (const [threadKey, command] of input.threadJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

type SidebarChangeRequestHandler = (
  threadKey: string,
  changeRequest: ChangeRequestSettleSource | null,
) => void;

interface SidebarThreadRowProps {
  thread: SidebarThreadSummary;
  projectCwd: string | null;
  orderedProjectThreadKeys: readonly string[];
  isActive: boolean;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  startThreadRename: (threadKey: string, title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (
    event: React.MouseEvent<HTMLElement>,
    prUrl: string,
    threadRef?: ScopedThreadRef,
  ) => boolean;
  onChangeRequest: SidebarChangeRequestHandler;
  slotRef?: React.RefCallback<HTMLElement>;
  translator: InterfaceTranslator;
}

export const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    orderedProjectThreadKeys,
    isActive,
    openPullRequestsInRightPanel,
    jumpLabel,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    startThreadRename,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    onChangeRequest,
    slotRef,
    thread,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const isMobile = useIsMobile();
  const discoveredPorts = useThreadDiscoveredPorts({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const environment = useEnvironment(thread.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteThread =
    primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = environment?.label ?? null;
  // A desktop-local secondary backend (e.g. the WSL backend) shows up as a
  // bearer environment whose connection id is prefixed "local:". It runs on the
  // user's own machine, so the cloud icon is misleading — label it "Local" and
  // suppress the cloud icon (the project header already shows a container icon
  // for desktop-local projects, see sidebarProjectGrouping).
  const isDesktopLocalThread =
    environment !== null && isDesktopLocalConnectionTarget(environment.entry.target);
  const threadEnvironmentLabel = isRemoteThread
    ? (remoteEnvLabel ?? (isDesktopLocalThread ? "Local" : "Remote"))
    : null;
  // For grouped projects, the thread may belong to a different environment
  // than the representative project.  Look up the thread's own project cwd
  // so git status (and thus PR detection) queries the correct path.
  const threadProject = useProject(
    useMemo(
      () => scopeProjectRef(thread.environmentId, thread.projectId),
      [thread.environmentId, thread.projectId],
    ),
  );
  const threadProjectCwd = threadProject?.workspaceRoot ?? null;
  const gitCwd = thread.worktreePath ?? threadProjectCwd ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    thread.linkedPullRequest == null && thread.branch != null && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const isHighlighted = isActive || isSelected;
  const handleOpenDiscoveredPort = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const port = discoveredPorts[0];
      if (!port) return;
      event.preventDefault();
      event.stopPropagation();
      navigateToThread(threadRef);
      void (async () => {
        const result = await openDiscoveredPort({ threadRef, port, openPreview });
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: props.translator.message("sidebar.classic.previewOpenFailed"),
            description:
              error instanceof Error
                ? error.message
                : props.translator.message("sidebar.classic.previewOpenFailedDescription"),
          }),
        );
      })();
    },
    [discoveredPorts, navigateToThread, openPreview, threadRef],
  );
  const isThreadRunning =
    thread.session?.status === "running" && thread.session.activeTurnId != null;
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
  );
  const pr =
    thread.linkedPullRequest == null
      ? resolveThreadPr({ threadBranch: thread.branch, gitStatus: gitStatus.data })
      : (linkedPullRequestStatus?.pr ?? null);
  const prState = pr?.state ?? null;
  const prUpdatedAt = pr?.updatedAt ?? null;
  useEffect(() => {
    onChangeRequest(
      threadKey,
      prState === null ? null : { state: prState, updatedAt: prUpdatedAt },
    );
  }, [onChangeRequest, prState, prUpdatedAt, threadKey]);
  const prStatus = prStatusIndicator(
    pr,
    linkedPullRequestStatus?.sourceControlProvider ?? gitStatus.data?.sourceControlProvider,
    props.translator.message,
  );
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds, props.translator.message);
  const isConfirmingArchive = confirmingArchiveThreadKey === threadKey && !isThreadRunning;
  const threadMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : !isThreadRunning
      ? "pointer-events-none transition-opacity duration-150 max-sm:pr-6 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0"
      : "pointer-events-none";
  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveThreadKey((current) => (current === threadKey ? null : current));
  }, [setConfirmingArchiveThreadKey, threadKey]);
  const handleMouseLeave = useCallback(() => {
    clearConfirmingArchive();
  }, [clearConfirmingArchive]);
  const handleBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLLIElement>) => {
      const currentTarget = event.currentTarget;
      requestAnimationFrame(() => {
        if (currentTarget.contains(document.activeElement)) {
          return;
        }
        clearConfirmingArchive();
      });
    },
    [clearConfirmingArchive],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      handleThreadClick(event, threadRef, orderedProjectThreadKeys);
    },
    [handleThreadClick, orderedProjectThreadKeys, threadRef],
  );
  const handleRowDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Already renaming this row: a double-click on the row chrome (outside the
      // input) must not restart and discard the in-progress edit.
      if (renamingThreadKey === threadKey) return;
      // On mobile the first tap navigates and closes the sidebar sheet, so the
      // inline rename can't be shown. Renaming there stays on the context menu.
      if (isMobile) return;
      // cmd/ctrl/shift double-clicks are multi-select intent, not rename.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // Ignore double-clicks bubbling from nested controls (PR status, port,
      // archive buttons) — only the row body should enter inline rename.
      if ((event.target as HTMLElement).closest("button, a")) return;
      event.preventDefault();
      startThreadRename(threadKey, thread.title);
    },
    [isMobile, renamingThreadKey, startThreadRename, threadKey, thread.title],
  );
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToThread(threadRef);
    },
    [navigateToThread, threadRef],
  );
  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const hasSelection = useThreadSelectionStore.getState().hasSelection();
      if (hasSelection && isSelected) {
        void (async () => {
          const result = await settlePromise(() =>
            handleMultiSelectContextMenu({
              x: event.clientX,
              y: event.clientY,
            }),
          );
          if (result._tag === "Failure") {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: props.translator.message("sidebar.classic.threadActionFailed"),
                description:
                  error instanceof Error
                    ? error.message
                    : props.translator.message("sidebar.error.unexpected"),
              }),
            );
          }
        })();
        return;
      }

      if (hasSelection) {
        clearSelection();
      }
      void (async () => {
        const result = await settlePromise(() =>
          handleThreadContextMenu(threadRef, {
            x: event.clientX,
            y: event.clientY,
          }),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: props.translator.message("sidebar.classic.threadActionFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : props.translator.message("sidebar.error.unexpected"),
            }),
          );
        }
      })();
    },
    [clearSelection, handleMultiSelectContextMenu, handleThreadContextMenu, isSelected, threadRef],
  );
  const handlePrClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!prStatus) return;
      const openedInRightPanel = openPrLink(
        event,
        prStatus.url,
        openPullRequestsInRightPanel ? threadRef : undefined,
      );
      if (openedInRightPanel && openPullRequestsInRightPanel && !isActive) {
        navigateToThread(threadRef);
      }
    },
    [isActive, navigateToThread, openPrLink, openPullRequestsInRightPanel, prStatus, threadRef],
  );
  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );
  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );
  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );
  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);
  // Keep clicks/double-clicks inside the rename input from bubbling to the row.
  // Without stopping `dblclick`, double-clicking to select a word would re-fire
  // the row's rename handler and reset the in-progress edit back to the title.
  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);
  const handleConfirmArchiveRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) {
        confirmArchiveButtonRefs.current.set(threadKey, element);
      } else {
        confirmArchiveButtonRefs.current.delete(threadKey);
      }
    },
    [confirmArchiveButtonRefs, threadKey],
  );
  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const handleConfirmArchiveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmingArchive();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, clearConfirmingArchive, threadRef],
  );
  const handleStartArchiveConfirmation = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setConfirmingArchiveThreadKey(threadKey);
      requestAnimationFrame(() => {
        confirmArchiveButtonRefs.current.get(threadKey)?.focus();
      });
    },
    [confirmArchiveButtonRefs, setConfirmingArchiveThreadKey, threadKey],
  );
  const handleArchiveImmediateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, threadRef],
  );
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem
      ref={slotRef}
      className="w-full"
      data-thread-item
      data-virtual-thread-slot
      onMouseLeave={handleMouseLeave}
      onBlurCapture={handleBlurCapture}
    >
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${thread.id}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
        })} relative isolate`}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={prStatus.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={handlePrClick}
                  >
                    <ChangeRequestStatusIcon className="size-3" />
                  </a>
                }
              />
              <TooltipPopup side="top">
                <PrStatusTooltipContent status={prStatus} />
              </TooltipPopup>
            </Tooltip>
          )}
          {threadStatus && (
            <LocalizedThreadStatusLabel status={threadStatus} translator={props.translator} />
          )}
          {renamingThreadKey === threadKey ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-0.5 text-sm outline-none"
              value={renamingTitle}
              onChange={handleRenameInputChange}
              onKeyDown={handleRenameInputKeyDown}
              onBlur={handleRenameInputBlur}
              onClick={handleRenameInputClick}
              onDoubleClick={handleRenameInputClick}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    data-testid={`thread-title-${thread.id}`}
                  >
                    {thread.title}
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
                {thread.title}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {discoveredPorts.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.translator.message("sidebar.classic.openLocalhost", {
                      port: discoveredPorts[0]?.port ?? "",
                    })}
                    className="inline-flex cursor-pointer items-center justify-center text-emerald-600 outline-hidden focus-visible:ring-1 focus-visible:ring-ring dark:text-emerald-400"
                    onClick={handleOpenDiscoveredPort}
                  />
                }
              >
                <Globe2Icon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {props.translator.message("sidebar.classic.openLocalhost", {
                  port: discoveredPorts[0]?.port ?? "",
                })}
                {discoveredPorts.length > 1 ? ` (+${discoveredPorts.length - 1})` : ""}
              </TooltipPopup>
            </Tooltip>
          )}
          <ThreadWorktreeIndicator thread={thread} />
          {terminalStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="img"
                    aria-label={terminalStatus.label}
                    className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                  />
                }
              >
                <TerminalIcon
                  className={`size-3 ${terminalStatus.pulse ? "animate-status-pulse" : ""}`}
                />
              </TooltipTrigger>
              <TooltipPopup side="top">{terminalStatus.label}</TooltipPopup>
            </Tooltip>
          )}
          <div
            className={`flex min-w-12 justify-end ${
              isRemoteThread ? "max-sm:min-w-24" : "max-sm:min-w-20"
            }`}
          >
            {isConfirmingArchive ? (
              <button
                ref={handleConfirmArchiveRef}
                type="button"
                data-thread-selection-safe
                data-testid={`thread-archive-confirm-${thread.id}`}
                aria-label={props.translator.message("sidebar.classic.confirmArchive", {
                  title: thread.title,
                })}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-md bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleConfirmArchiveClick}
              >
                {props.translator.message("sidebar.classic.confirm")}
              </button>
            ) : !isThreadRunning ? (
              appSettingsConfirmThreadArchive ? (
                <div className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`thread-archive-${thread.id}`}
                    aria-label={props.translator.message("sidebar.classic.archiveThread", {
                      title: thread.title,
                    })}
                    className={SIDEBAR_ICON_ACTION_BUTTON_CLASS}
                    onPointerDown={stopPropagationOnPointerDown}
                    onClick={handleStartArchiveConfirmation}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="pointer-events-none absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-archive-${thread.id}`}
                          aria-label={props.translator.message("sidebar.classic.archiveThread", {
                            title: thread.title,
                          })}
                          className={SIDEBAR_ICON_ACTION_BUTTON_CLASS}
                          onPointerDown={stopPropagationOnPointerDown}
                          onClick={handleArchiveImmediateClick}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      </div>
                    }
                  />
                  <TooltipPopup side="top">
                    {props.translator.message("sidebar.classic.archive")}
                  </TooltipPopup>
                </Tooltip>
              )
            ) : null}
            <span className={threadMetaClassName}>
              <span className="inline-flex items-center gap-1">
                {isRemoteThread && !isDesktopLocalThread && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={
                            threadEnvironmentLabel ??
                            props.translator.message("sidebar.classic.remote")
                          }
                          className="inline-flex items-center justify-center"
                        />
                      }
                    >
                      <CloudIcon className="size-3 text-muted-foreground/40" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
                  </Tooltip>
                )}
                {jumpLabel ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={jumpLabel}
                          className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
                        />
                      }
                    >
                      {jumpLabel}
                    </TooltipTrigger>
                    <TooltipPopup side="top">{jumpLabel}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <span
                    className={`text-[10px] tabular-nums ${
                      isHighlighted ? "text-foreground" : "text-secondary-label"
                    }`}
                  >
                    {formatRelativeTimeLabel(
                      thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                    )}
                  </span>
                )}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

interface SidebarProjectThreadListProps {
  projectKey: string;
  projectRefs: readonly ScopedProjectRef[];
  projectExpanded: boolean;
  hasOverflowingThreads: boolean;
  canToggleSettledThreads: boolean;
  settledThreadsVisible: boolean;
  canShowLess: boolean;
  hiddenThreadStatus: ThreadStatusPill | null;
  orderedProjectThreadKeys: readonly string[];
  renderedThreads: readonly SidebarThreadSummary[];
  threadPreviewCount: number;
  draftIndicatorsEnabled: boolean;
  showEmptyThreadState: boolean;
  shouldShowThreadPanel: boolean;
  projectCwd: string;
  activeRouteThreadKey: string | null;
  activeRouteDraftId: string | null;
  openPullRequestsInRightPanel: boolean;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  startThreadRename: (threadKey: string, title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null, enabled?: boolean) => void;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  navigateToDraft: (draftId: DraftId) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (
    event: React.MouseEvent<HTMLElement>,
    prUrl: string,
    threadRef?: ScopedThreadRef,
  ) => boolean;
  onChangeRequest: SidebarChangeRequestHandler;
  expandThreadListForProject: (projectKey: string) => void;
  showSettledThreadsForProject: (projectKey: string) => void;
  hideSettledThreadsForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  translator: InterfaceTranslator;
}

const SidebarProjectThreadList = memo(function SidebarProjectThreadList(
  props: SidebarProjectThreadListProps,
) {
  const {
    projectKey,
    projectRefs,
    projectExpanded,
    hasOverflowingThreads,
    canToggleSettledThreads,
    settledThreadsVisible,
    canShowLess,
    hiddenThreadStatus,
    orderedProjectThreadKeys,
    renderedThreads,
    threadPreviewCount,
    draftIndicatorsEnabled,
    showEmptyThreadState,
    shouldShowThreadPanel,
    projectCwd,
    activeRouteThreadKey,
    activeRouteDraftId,
    openPullRequestsInRightPanel,
    threadJumpLabelByKey,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    startThreadRename,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    attachThreadListAutoAnimateRef,
    handleThreadClick,
    navigateToThread,
    navigateToDraft,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    onChangeRequest,
    expandThreadListForProject,
    showSettledThreadsForProject,
    hideSettledThreadsForProject,
    collapseThreadListForProject,
  } = props;
  const showMoreButtonRender = useMemo(() => <button type="button" />, []);
  const settledButtonRender = useMemo(() => <button type="button" />, []);
  const showLessButtonRender = useMemo(() => <button type="button" />, []);
  const renderedThreadKeys = useMemo(
    () =>
      renderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [renderedThreads],
  );
  const forcedThreadKeys = useMemo(
    () =>
      new Set(
        [activeRouteThreadKey, renamingThreadKey, confirmingArchiveThreadKey].filter(
          (key): key is string => key !== null,
        ),
      ),
    [activeRouteThreadKey, confirmingArchiveThreadKey, renamingThreadKey],
  );
  const virtualThreadRows = useLegacySidebarVirtualThreadRows({
    rowKeys: renderedThreadKeys,
    forcedKeys: forcedThreadKeys,
    previewRowCount: threadPreviewCount,
  });
  const threadListNodeRef = useRef<HTMLElement | null>(null);
  const attachVirtualThreadListRef = useCallback(
    (node: HTMLElement | null) => {
      threadListNodeRef.current = node;
      virtualThreadRows.containerRef(node);
    },
    [virtualThreadRows.containerRef],
  );
  useLayoutEffect(() => {
    attachThreadListAutoAnimateRef(
      threadListNodeRef.current,
      virtualThreadRows.shouldAnimateThreadList,
    );
  }, [attachThreadListAutoAnimateRef, virtualThreadRows.shouldAnimateThreadList]);

  return (
    <SidebarMenuSub
      ref={attachVirtualThreadListRef}
      className="mx-0.5 my-0 w-full translate-x-0 gap-0.5 overflow-hidden border-l-0 px-1 py-0 sm:mx-1 sm:px-1.5"
      data-logical-thread-count={renderedThreadKeys.length}
      data-virtual-thread-list={virtualThreadRows.isVirtualized || undefined}
    >
      {draftIndicatorsEnabled ? (
        <LegacySidebarDraftRows
          projectRefs={projectRefs}
          activeDraftId={activeRouteDraftId}
          visible={shouldShowThreadPanel}
          onNavigate={navigateToDraft}
        />
      ) : null}
      {shouldShowThreadPanel && showEmptyThreadState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div
            data-thread-selection-safe
            className="flex h-8 w-full translate-x-0 items-center px-2 text-left text-xs text-sidebar-muted-foreground/75"
          >
            <span>{props.translator.message("sidebar.classic.noThreads")}</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowThreadPanel &&
        renderedThreads.map((thread) => {
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          const slotRef = virtualThreadRows.getSlotRef(threadKey);
          if (!virtualThreadRows.isHydrated(threadKey)) {
            return (
              <SidebarMenuSubItem
                key={threadKey}
                ref={slotRef}
                aria-hidden
                className="h-7 w-full shrink-0"
                data-virtual-thread-placeholder
                data-virtual-thread-slot
              />
            );
          }
          return (
            <SidebarThreadRow
              key={threadKey}
              slotRef={slotRef}
              thread={thread}
              projectCwd={projectCwd}
              orderedProjectThreadKeys={orderedProjectThreadKeys}
              isActive={activeRouteThreadKey === threadKey}
              openPullRequestsInRightPanel={openPullRequestsInRightPanel}
              jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
              appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
              renamingThreadKey={renamingThreadKey}
              renamingTitle={renamingTitle}
              setRenamingTitle={setRenamingTitle}
              startThreadRename={startThreadRename}
              renamingInputRef={renamingInputRef}
              renamingCommittedRef={renamingCommittedRef}
              confirmingArchiveThreadKey={confirmingArchiveThreadKey}
              setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
              confirmArchiveButtonRefs={confirmArchiveButtonRefs}
              handleThreadClick={handleThreadClick}
              navigateToThread={navigateToThread}
              handleMultiSelectContextMenu={handleMultiSelectContextMenu}
              handleThreadContextMenu={handleThreadContextMenu}
              clearSelection={clearSelection}
              commitRename={commitRename}
              cancelRename={cancelRename}
              attemptArchiveThread={attemptArchiveThread}
              openPrLink={openPrLink}
              onChangeRequest={onChangeRequest}
              translator={props.translator}
            />
          );
        })}

      {projectExpanded && hasOverflowingThreads && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showMoreButtonRender}
            data-thread-selection-safe
            size="sm"
            className="h-8 w-full translate-x-0 justify-start px-2 text-left text-xs text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            onClick={() => {
              expandThreadListForProject(projectKey);
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
              {hiddenThreadStatus && (
                <LocalizedThreadStatusLabel
                  status={hiddenThreadStatus}
                  translator={props.translator}
                  compact
                />
              )}
              <span>{props.translator.message("sidebar.classic.showMore")}</span>
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && !hasOverflowingThreads && canToggleSettledThreads && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={settledButtonRender}
            data-thread-selection-safe
            size="sm"
            className="h-8 w-full translate-x-0 justify-start px-2 text-left text-xs text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            onClick={() => {
              if (settledThreadsVisible) {
                hideSettledThreadsForProject(projectKey);
              } else {
                showSettledThreadsForProject(projectKey);
              }
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <CircleCheckIcon className="size-3 shrink-0" aria-hidden />
              <span>
                {props.translator.message(
                  settledThreadsVisible
                    ? "sidebar.classic.hideSettled"
                    : "sidebar.classic.showSettled",
                )}
              </span>
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && canShowLess && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showLessButtonRender}
            data-thread-selection-safe
            size="sm"
            className="h-8 w-full translate-x-0 justify-start px-2 text-left text-xs text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
            onClick={() => {
              collapseThreadListForProject(projectKey);
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ChevronUpIcon className="size-3 shrink-0" aria-hidden />
              <span>{props.translator.message("sidebar.classic.showLess")}</span>
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
    </SidebarMenuSub>
  );
});

interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isThreadListExpanded: boolean;
  settledThreadsVisible: boolean;
  activeRouteThreadKey: string | null;
  activeRouteDraftId: string | null;
  openPullRequestsInRightPanel: boolean;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null, enabled?: boolean) => void;
  isProjectThreadSettled: (thread: SidebarThreadSummary) => boolean;
  onChangeRequest: SidebarChangeRequestHandler;
  expandThreadListForProject: (projectKey: string) => void;
  showSettledThreadsForProject: (projectKey: string) => void;
  hideSettledThreadsForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
}

const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const translator = useInterfaceTranslator();
  const {
    project,
    isThreadListExpanded,
    settledThreadsVisible,
    activeRouteThreadKey,
    activeRouteDraftId,
    openPullRequestsInRightPanel,
    newThreadShortcutLabel,
    handleNewThread,
    archiveThread,
    deleteThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    isProjectThreadSettled,
    onChangeRequest,
    expandThreadListForProject,
    showSettledThreadsForProject,
    hideSettledThreadsForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
  } = props;
  const threadSortOrder = useClientSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const draftIndicatorsEnabled = useBetterT3DeviceFeature("chat.draftIndicators");
  const shiftClickShowLessEnabled = useBetterT3DeviceFeature("chat.shiftClickShowLess");
  const appSettingsConfirmThreadDelete = useClientSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const appSettingsConfirmThreadArchive = useClientSettings<boolean>(
    (settings) => settings.confirmThreadArchive,
  );
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const updateSettings = useUpdateClientSettings();
  const sidebarThreadPreviewCount = useClientSettings<SidebarThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: translator.message("sidebar.thread.idCopied"),
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translator.message("sidebar.thread.copyIdFailed"),
          description:
            error instanceof Error ? error.message : translator.message("sidebar.error.unexpected"),
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: translator.message("sidebar.thread.pathCopied"),
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translator.message("sidebar.thread.copyPathFailed"),
          description:
            error instanceof Error ? error.message : translator.message("sidebar.error.unexpected"),
        }),
      );
    },
  });
  const openPrLink = useOpenPrLink();
  const sidebarThreads = useThreadShellsForProjectRefs(project.memberProjectRefs);
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Keep a ref so callbacks can read the latest map without appearing in
  // dependency arrays (avoids invalidating every thread-row memo on each
  // thread-list change).
  const sidebarThreadByKeyRef = useRef(sidebarThreadByKey);
  sidebarThreadByKeyRef.current = sidebarThreadByKey;
  const projectThreads = sidebarThreads;
  const hasProjectDraftContent = useProjectHasDraftContent(project.memberProjectRefs);
  const projectPreferenceKeys = useMemo(() => projectExpansionPreferenceKeys(project), [project]);
  const projectExpanded = useUiStateStore((state) =>
    resolveProjectExpanded(state.projectExpandedById, projectPreferenceKeys),
  );
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threadLastVisitedAts = useMemo(
    () =>
      projectThreads.map(
        (thread) =>
          threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ] ?? null,
      ),
    [projectThreads, threadLastVisitedAtById],
  );
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const memberProjectByScopedKey = useMemo(
    () =>
      new Map(
        project.memberProjects.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          member,
        ]),
      ),
    [project.memberProjects],
  );
  const memberThreadCountByPhysicalKey = useMemo(() => {
    const counts = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const thread of projectThreads) {
      const member = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!member) {
        continue;
      }
      counts.set(member.physicalProjectKey, (counts.get(member.physicalProjectKey) ?? 0) + 1);
    }
    return counts;
  }, [memberProjectByScopedKey, project.memberProjects, projectThreads]);

  const { projectStatus, visibleProjectThreads, threadStatusByKey } = useMemo(() => {
    const lastVisitedAtByThreadKey = new Map(
      projectThreads.map((thread, index) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        threadLastVisitedAts[index] ?? null,
      ]),
    );
    const visibleProjectThreads = sortThreadsForSidebar(
      projectThreads.filter((thread) => thread.archivedAt === null),
      threadSortOrder,
    );
    const threadStatusByKey = new Map(
      visibleProjectThreads.map((thread) => {
        const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        const lastVisitedAt = lastVisitedAtByThreadKey.get(threadKey);
        return [
          threadKey,
          resolveThreadStatusPill({
            thread: {
              ...thread,
              ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
            },
          }),
        ] as const;
      }),
    );
    const projectStatus = resolveProjectStatusIndicator(
      visibleProjectThreads.map(
        (thread) =>
          threadStatusByKey.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))) ??
          null,
      ),
    );
    return {
      projectStatus,
      threadStatusByKey,
      visibleProjectThreads,
    };
  }, [projectThreads, threadLastVisitedAts, threadSortOrder]);
  const pinnedCollapsedThread = useMemo(() => {
    const activeThreadKey = activeRouteThreadKey ?? undefined;
    if (!activeThreadKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);

  const { sections, hiddenThreadStatus } = useMemo(() => {
    const sections = resolveProjectThreadSections({
      items: visibleProjectThreads,
      count: sidebarThreadPreviewCount,
      showAllNonSettled: false,
      showSettled: false,
      isSettled: isProjectThreadSettled,
      alwaysVisible: (thread) =>
        isThreadStatusAlwaysVisibleInProjectPreview(
          threadStatusByKey.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))) ??
            null,
        ),
      keepSettledVisible: (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeRouteThreadKey,
    });
    return {
      sections,
      hiddenThreadStatus: resolveProjectStatusIndicator(
        sections.hiddenNonSettledItems.map(
          (thread) =>
            threadStatusByKey.get(
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            ) ?? null,
        ),
      ),
    };
  }, [
    activeRouteThreadKey,
    isProjectThreadSettled,
    sidebarThreadPreviewCount,
    threadStatusByKey,
    visibleProjectThreads,
  ]);
  const { hasOverflowingThreads, canToggleSettledThreads, canShowLess, renderedThreads } =
    useMemo(() => {
      return resolveLegacySidebarProjectThreadDisclosure({
        sections,
        isThreadListExpanded,
        settledThreadsVisible,
        pinnedCollapsedThread,
      });
    }, [isThreadListExpanded, pinnedCollapsedThread, sections, settledThreadsVisible]);
  const orderedProjectThreadKeys = useMemo(
    () =>
      renderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [renderedThreads],
  );
  const showEmptyThreadState =
    projectExpanded && visibleProjectThreads.length === 0 && !hasProjectDraftContent;
  const shouldShowThreadPanel =
    projectExpanded || pinnedCollapsedThread !== null || activeRouteDraftId !== null;

  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        resolveProjectHeaderClickAction({
          button: event.button,
          detail: event.detail,
          projectExpanded,
          shiftKey: shiftClickShowLessEnabled && event.shiftKey,
        }) === "show-less"
      ) {
        collapseThreadListForProject(project.projectKey);
        return;
      }
      if (useThreadSelectionStore.getState().hasSelection()) {
        clearSelection();
      }
      setProjectExpanded(projectPreferenceKeys, !projectExpanded);
    },
    [
      clearSelection,
      collapseThreadListForProject,
      dragInProgressRef,
      projectExpanded,
      project.projectKey,
      projectPreferenceKeys,
      shiftClickShowLessEnabled,
      setProjectExpanded,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const navigateToDraft = useCallback(
    (draftId: DraftId) => {
      clearSelection();
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({ to: "/draft/$draftId", params: { draftId } });
    },
    [clearSelection, isMobile, router, setOpenMobile],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      setProjectExpanded(projectPreferenceKeys, !projectExpanded);
    },
    [dragInProgressRef, projectExpanded, projectPreferenceKeys, setProjectExpanded],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.title);
  }, []);

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember, options: { force?: boolean } = {}) => {
      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const result = await deleteProject({
        environmentId: member.environmentId,
        input: {
          projectId: member.id,
          ...(options.force === true ? { force: true } : {}),
        },
      });
      if (result._tag === "Failure") {
        return result;
      }
      const draftStore = useComposerDraftStore.getState();
      releaseProjectDraftUploads(
        memberProjectRef,
        sidebarThreads
          .filter(
            (thread) =>
              thread.environmentId === member.environmentId && thread.projectId === member.id,
          )
          .map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(memberProjectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(memberProjectRef);
      return result;
    },
    [deleteProject, sidebarThreads],
  );

  const handleRemoveProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const memberThreadCount = memberThreadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
      if (memberThreadCount > 0) {
        const warningToastId = toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: translator.message("sidebar.project.notEmpty"),
            description: translator.message("sidebar.project.notEmptyDescription"),
            actionVariant: "destructive",
            actionProps: {
              children: translator.message("sidebar.project.deleteAnyway"),
              onClick: () => {
                void (async () => {
                  toastManager.close(warningToastId);
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 180);
                  });

                  const latestProjectThreads = Array.from(
                    sidebarThreadByKeyRef.current.values(),
                  ).filter(
                    (thread) =>
                      thread.environmentId === memberProjectRef.environmentId &&
                      thread.projectId === memberProjectRef.projectId,
                  );
                  const confirmed = await api.dialogs.confirm(
                    latestProjectThreads.length > 0
                      ? [
                          translator.message("sidebar.project.removeWithThreadsConfirm", {
                            project: member.title,
                            count: latestProjectThreads.length,
                          }),
                          translator.message("sidebar.project.path", {
                            path: member.workspaceRoot,
                          }),
                          ...(member.environmentLabel
                            ? [
                                translator.message("sidebar.project.environment", {
                                  environment: member.environmentLabel,
                                }),
                              ]
                            : []),
                          translator.message("sidebar.thread.deleteManyHistoryWarning"),
                          translator.message("sidebar.project.removeEntryOnly"),
                          translator.message("sidebar.project.actionCannotUndo"),
                        ].join("\n")
                      : [
                          translator.message("sidebar.project.removeConfirm", {
                            project: member.title,
                          }),
                          translator.message("sidebar.project.path", {
                            path: member.workspaceRoot,
                          }),
                          ...(member.environmentLabel
                            ? [
                                translator.message("sidebar.project.environment", {
                                  environment: member.environmentLabel,
                                }),
                              ]
                            : []),
                          translator.message("sidebar.project.removeEntryOnly"),
                        ].join("\n"),
                    { variant: "destructive" },
                  );
                  if (!confirmed) {
                    return;
                  }

                  const result = await removeProject(member, { force: true });
                  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                    const error = squashAtomCommandFailure(result);
                    toastManager.add(
                      stackedThreadToast({
                        type: "error",
                        title: translator.message("sidebar.project.removeFailed", {
                          project: member.title,
                        }),
                        description:
                          error instanceof Error
                            ? error.message
                            : translator.message("sidebar.project.removeUnknownError"),
                      }),
                    );
                  }
                })().catch((error) => {
                  const message =
                    error instanceof Error
                      ? error.message
                      : translator.message("sidebar.project.removeUnknownError");
                  console.error("Failed to remove project", {
                    projectId: member.id,
                    environmentId: member.environmentId,
                    ...safeErrorLogAttributes(error),
                  });
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: translator.message("sidebar.project.removeFailed", {
                        project: member.title,
                      }),
                      description: message,
                    }),
                  );
                });
              },
            },
          }),
        );
        return;
      }

      const message = [
        translator.message("sidebar.project.removeConfirm", { project: member.title }),
        translator.message("sidebar.project.path", { path: member.workspaceRoot }),
        ...(member.environmentLabel
          ? [
              translator.message("sidebar.project.environment", {
                environment: member.environmentLabel,
              }),
            ]
          : []),
        translator.message("sidebar.project.removeEntryOnly"),
      ].join("\n");
      const confirmed = await api.dialogs.confirm(message, { variant: "destructive" });
      if (!confirmed) {
        return;
      }

      const result = await removeProject(member);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        const message =
          error instanceof Error
            ? error.message
            : translator.message("sidebar.project.removeUnknownError");
        console.error("Failed to remove project", {
          projectId: member.id,
          environmentId: member.environmentId,
          ...safeErrorLogAttributes(error),
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.project.removeFailed", {
              project: member.title,
            }),
            description: message,
          }),
        );
      }
    },
    [memberThreadCountByPhysicalKey, removeProject, translator],
  );

  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>();
        const makeLeaf = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          member: SidebarProjectGroupMember,
          options?: {
            destructive?: boolean;
            disabled?: boolean;
          },
        ): ContextMenuItem<string> => {
          const id = `${action}:${member.physicalProjectKey}`;
          actionHandlers.set(id, () => {
            switch (action) {
              case "rename":
                openProjectRenameDialog(member);
                return;
              case "grouping":
                openProjectGroupingDialog(member);
                return;
              case "copy-path":
                copyPathToClipboard(member.workspaceRoot, { path: member.workspaceRoot });
                return;
              case "delete":
                return handleRemoveProject(member);
            }
          });

          return {
            id,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            ...(options?.destructive ? { destructive: true } : {}),
            ...(options?.disabled ? { disabled: true } : {}),
          };
        };

        const buildTargetedItem = (
          action: "rename" | "grouping" | "copy-path" | "delete",
          label: string,
          options?: {
            destructive?: boolean;
            isDisabled?: (member: SidebarProjectGroupMember) => boolean;
          },
        ): ContextMenuItem<string> => {
          if (project.memberProjects.length === 1) {
            const singleMember = project.memberProjects[0]!;
            return {
              ...makeLeaf(action, singleMember, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(singleMember) ? { disabled: true } : {}),
              }),
              label,
              ...(action === "delete" ? { icon: "trash" } : {}),
            };
          }

          return {
            id: `${action}:submenu`,
            label,
            ...(action === "delete" ? { icon: "trash" } : {}),
            children: project.memberProjects.map((member) =>
              makeLeaf(action, member, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(member) ? { disabled: true } : {}),
              }),
            ),
          };
        };

        const clicked = await api.contextMenu.show(
          [
            buildTargetedItem("rename", translator.message("sidebar.project.menu.rename")),
            buildTargetedItem("grouping", translator.message("sidebar.project.menu.group")),
            buildTargetedItem("copy-path", translator.message("sidebar.project.menu.copyPath")),
            buildTargetedItem("delete", translator.message("sidebar.project.menu.remove"), {
              destructive: true,
            }),
          ],
          {
            x: event.clientX,
            y: event.clientY,
          },
        );

        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [
      copyPathToClipboard,
      handleRemoveProject,
      openProjectGroupingDialog,
      openProjectRenameDialog,
      project.groupedProjectCount,
      project.memberProjects,
      suppressProjectClickForContextMenuRef,
    ],
  );

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const handleThreadClick = useCallback(
    (
      event: React.MouseEvent,
      threadRef: ScopedThreadRef,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      if (isSidebarNestedLinkClick(event.target)) return;
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      // Ignore the trailing click of a plain double-click so it doesn't navigate
      // while a double-click is starting an inline rename. Placed after the
      // modifier branches so cmd/shift selection still processes every click.
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [
      clearSelection,
      isMobile,
      rangeSelectTo,
      router,
      setOpenMobile,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectedThreadEntries = threadKeys.flatMap((threadKey) => {
        const threadRef = parseScopedThreadKey(threadKey);
        const thread = threadRef ? readThreadShell(threadRef) : null;
        return threadRef && thread ? [{ threadKey, threadRef, thread }] : [];
      });
      const hasRunningThread = selectedThreadEntries.some(
        ({ thread }) => thread.session?.status === "running" && thread.session.activeTurnId != null,
      );

      const clicked = await api.contextMenu.show(
        buildMultiSelectThreadContextMenuItems({ count, hasRunningThread }).map((item) => ({
          ...item,
          label: translator.message(
            item.id === "mark-unread"
              ? "sidebar.thread.action.markUnreadCount"
              : item.id === "archive"
                ? "sidebar.thread.action.archiveCount"
                : "sidebar.thread.action.deleteCount",
            { count },
          ),
        })),
        position,
      );

      if (clicked === "mark-unread") {
        for (const { threadKey, thread } of selectedThreadEntries) {
          markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked === "archive") {
        if (appSettingsConfirmThreadArchive) {
          const confirmed = await api.dialogs.confirm(
            translator.message("sidebar.thread.archiveManyConfirm", { count }),
          );
          if (!confirmed) return;
        }

        const archiveOutcome = await archiveSelectedThreadEntries({
          entries: selectedThreadEntries,
          archive: ({ threadRef }, onArchived) => archiveThread(threadRef, { onArchived }),
        });
        for (const failure of archiveOutcome.followupFailures) {
          if (isAtomCommandInterrupted(failure)) continue;
          const error = squashAtomCommandFailure(failure);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.thread.archiveNavigationFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        }
        if (archiveOutcome.mutationFailure) {
          removeFromSelection(archiveOutcome.archivedThreadKeys);
          if (!isAtomCommandInterrupted(archiveOutcome.mutationFailure)) {
            const error = squashAtomCommandFailure(archiveOutcome.mutationFailure);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: translator.message("sidebar.thread.archiveManyFailed"),
                description:
                  error instanceof Error
                    ? error.message
                    : translator.message("sidebar.error.unexpected"),
              }),
            );
          }
          return;
        }
        removeFromSelection(threadKeys);
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            translator.message("sidebar.thread.deleteManyConfirm", { count }),
            translator.message("sidebar.thread.deleteManyHistoryWarning"),
          ].join("\n"),
          { variant: "destructive" },
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      for (const { threadRef } of selectedThreadEntries) {
        const result = await deleteThread(threadRef, {
          deletedThreadKeys,
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: translator.message("sidebar.thread.deleteManyFailed"),
                description:
                  error instanceof Error
                    ? error.message
                    : translator.message("sidebar.error.unexpected"),
              }),
            );
          }
          return;
        }
      }
      removeFromSelection(threadKeys);
    },
    [
      appSettingsConfirmThreadArchive,
      appSettingsConfirmThreadDelete,
      archiveThread,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
    ],
  );

  const createThreadForProjectMember = useCallback(
    (member: SidebarProjectGroupMember) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void (async () => {
        // No options: branch, worktree, and env mode come from the user's
        // configured defaults, never from the currently viewed thread.
        const result = await settlePromise(() =>
          handleNewThread(scopeProjectRef(member.environmentId, member.id)),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.thread.createFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        }
      })();
    },
    [handleNewThread, isMobile, setOpenMobile],
  );

  const handleCreateThreadClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (project.memberProjects.length === 1) {
        createThreadForProjectMember(project.memberProjects[0]!);
        return;
      }

      void (async () => {
        const api = readLocalApi();
        if (!api) {
          return;
        }
        const clickedResult = await settlePromise(() =>
          api.contextMenu.show(
            project.memberProjects.map((member) => ({
              id: member.physicalProjectKey,
              label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            })),
            {
              x: event.clientX,
              y: event.clientY,
            },
          ),
        );
        if (clickedResult._tag === "Failure") {
          const error = squashAtomCommandFailure(clickedResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.project.chooseEnvironmentFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
          return;
        }
        const clicked = clickedResult.value;
        if (!clicked) {
          return;
        }
        const targetMember = project.memberProjects.find(
          (member) => member.physicalProjectKey === clicked,
        );
        if (!targetMember) {
          return;
        }
        createThreadForProjectMember(targetMember);
      })();
    },
    [createThreadForProjectMember, project.groupedProjectCount, project.memberProjects],
  );

  const handleProjectSettingsClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isMobile) setOpenMobile(false);
      void router.navigate(resolveSidebarProjectSettingsTarget(project));
    },
    [isMobile, project, router, setOpenMobile],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await archiveThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.thread.archiveFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.error.unexpected"),
          }),
        );
      }
    },
    [archiveThread],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const startThreadRename = useCallback((threadKey: string, title: string) => {
    setRenamingThreadKey(threadKey);
    setRenamingTitle(title);
    renamingCommittedRef.current = false;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: translator.message("sidebar.thread.titleEmpty"),
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          title: trimmed,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.thread.renameFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.error.unexpected"),
          }),
        );
      }
      finishRename();
    },
    [updateThreadMetadata],
  );

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: translator.message("sidebar.project.titleEmpty"),
      });
      return;
    }

    if (trimmed === projectRenameTarget.title) {
      closeProjectRenameDialog();
      return;
    }

    const result = await updateProject({
      environmentId: projectRenameTarget.environmentId,
      input: {
        projectId: projectRenameTarget.id,
        title: trimmed,
      },
    });
    if (result._tag === "Success") {
      closeProjectRenameDialog();
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translator.message("sidebar.project.renameFailed"),
          description:
            error instanceof Error ? error.message : translator.message("sidebar.error.unexpected"),
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle, updateProject]);

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const threadProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadWorkspacePath =
        thread.worktreePath ?? threadProject?.workspaceRoot ?? project.workspaceRoot ?? null;
      const clicked = await api.contextMenu.show(
        [
          ...(thread.branch
            ? [
                {
                  id: "new-thread-on-branch",
                  label: translator.message("sidebar.thread.menu.newOnBranch", {
                    branch: thread.branch,
                  }),
                },
              ]
            : []),
          { id: "rename", label: translator.message("sidebar.thread.menu.rename") },
          { id: "mark-unread", label: translator.message("sidebar.thread.menu.markUnread") },
          { id: "copy-path", label: translator.message("sidebar.project.menu.copyPath") },
          { id: "copy-thread-id", label: translator.message("sidebar.thread.menu.id") },
          {
            id: "delete",
            label: translator.message("sidebar.thread.menu.delete"),
            destructive: true,
            icon: "trash",
          },
        ],
        position,
      );

      if (clicked === "new-thread-on-branch") {
        // Explicit branch carry-over: reuse the thread's worktree when it
        // has one, otherwise its branch on the local checkout.
        const result = await settlePromise(() =>
          handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            envMode: thread.worktreePath ? "worktree" : "local",
            startFromOrigin: false,
          }),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.thread.createFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        }
        return;
      }

      if (clicked === "rename") {
        startThreadRename(threadKey, thread.title);
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.thread.pathUnavailable"),
              description: translator.message("sidebar.thread.pathUnavailableDescription"),
            }),
          );
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            translator.message("sidebar.thread.deleteConfirm", { title: thread.title }),
            translator.message("sidebar.thread.deleteHistoryWarning"),
          ].join("\n"),
          { variant: "destructive" },
        );
        if (!confirmed) {
          return;
        }
      }
      const result = await deleteThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.thread.deleteFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.error.unexpected"),
          }),
        );
      }
    },
    [
      appSettingsConfirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      handleNewThread,
      markThreadUnread,
      memberProjectByScopedKey,
      project.workspaceRoot,
      startThreadRename,
    ],
  );

  const displayedProjectStatus = projectStatus;
  const displayedProjectStatusLabel = displayedProjectStatus
    ? localizedThreadStatusLabel(displayedProjectStatus, translator)
    : null;

  return (
    <>
      <div className="group/project-header relative">
        <SidebarMenuButton
          ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
          className={`pr-14 group-hover/project-header:bg-sidebar-row-hover group-hover/project-header:text-sidebar-foreground max-sm:pr-20 ${
            isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
          {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
          onPointerDownCapture={handleProjectButtonPointerDownCapture}
          onClick={handleProjectButtonClick}
          onKeyDown={handleProjectButtonKeyDown}
          onContextMenu={handleProjectButtonContextMenu}
        >
          {!projectExpanded && displayedProjectStatus ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={displayedProjectStatusLabel ?? displayedProjectStatus.label}
                    className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${displayedProjectStatus.colorClass}`}
                  />
                }
              >
                <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                  <span
                    className={`size-[9px] rounded-full ${displayedProjectStatus.dotClass} ${
                      displayedProjectStatus.pulse ? "animate-status-pulse" : ""
                    }`}
                  />
                </span>
                <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-icon-muted opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {displayedProjectStatusLabel ?? displayedProjectStatus.label}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <ChevronRightIcon
              className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                projectExpanded ? "rotate-90" : ""
              }`}
            />
          )}
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.workspaceRoot}
            faviconPath={project.faviconPath}
          />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium text-sidebar-foreground/90">
              {project.displayName}
            </span>
            {project.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-secondary-label text-[10px]">
                {translator.message("sidebar.project.groupedCount", {
                  count: project.groupedProjectCount,
                })}
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
        {/* Environment badge – visible by default, crossfades with the
            "new thread" button on hover using the same pointer-events +
            opacity pattern as the thread row archive/timestamp swap. */}
        {project.environmentPresence === "remote-only" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={
                    project.allRemoteMembersAreDesktopLocal
                      ? translator.message("sidebar.classic.localSandboxProject")
                      : translator.message("sidebar.classic.remoteProject")
                  }
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-icon-muted transition-opacity duration-150 max-sm:right-14 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100"
                />
              }
            >
              {project.allRemoteMembersAreDesktopLocal ? (
                <ContainerIcon className="size-3" />
              ) : (
                <CloudIcon className="size-3" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {project.allRemoteMembersAreDesktopLocal
                ? translator.message("sidebar.classic.localSandbox", {
                    environments: translator.list(project.remoteEnvironmentLabels),
                  })
                : translator.message("sidebar.classic.remoteEnvironment", {
                    environments: translator.list(project.remoteEnvironmentLabels),
                  })}
            </TooltipPopup>
          </Tooltip>
        )}
        <div className="pointer-events-none absolute top-[calc(50%+1px)] right-0.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={translator.message("sidebar.project.settingsFor", {
                    project: project.displayName,
                  })}
                  data-testid="project-settings-button"
                  className={SIDEBAR_ICON_ACTION_BUTTON_CLASS}
                  onClick={handleProjectSettingsClick}
                >
                  <SettingsIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">
              {translator.message("sidebar.navigation.settings")}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={translator.message("sidebar.classic.createThreadIn", {
                    project: project.displayName,
                  })}
                  data-testid="new-thread-button"
                  className={SIDEBAR_ICON_ACTION_BUTTON_CLASS}
                  onClick={handleCreateThreadClick}
                >
                  <SquarePenIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">
              {newThreadShortcutLabel
                ? translator.message("sidebar.thread.newWithShortcut", {
                    shortcut: newThreadShortcutLabel,
                  })
                : translator.message("sidebar.thread.new")}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      <SidebarProjectThreadList
        projectKey={project.projectKey}
        projectRefs={project.memberProjectRefs}
        projectExpanded={projectExpanded}
        hasOverflowingThreads={hasOverflowingThreads}
        canToggleSettledThreads={canToggleSettledThreads}
        settledThreadsVisible={settledThreadsVisible}
        canShowLess={canShowLess}
        hiddenThreadStatus={hiddenThreadStatus}
        orderedProjectThreadKeys={orderedProjectThreadKeys}
        renderedThreads={renderedThreads}
        threadPreviewCount={sidebarThreadPreviewCount}
        draftIndicatorsEnabled={draftIndicatorsEnabled}
        showEmptyThreadState={showEmptyThreadState}
        shouldShowThreadPanel={shouldShowThreadPanel}
        projectCwd={project.workspaceRoot}
        activeRouteThreadKey={activeRouteThreadKey}
        activeRouteDraftId={activeRouteDraftId}
        openPullRequestsInRightPanel={openPullRequestsInRightPanel}
        threadJumpLabelByKey={threadJumpLabelByKey}
        appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
        renamingThreadKey={renamingThreadKey}
        renamingTitle={renamingTitle}
        setRenamingTitle={setRenamingTitle}
        startThreadRename={startThreadRename}
        renamingInputRef={renamingInputRef}
        renamingCommittedRef={renamingCommittedRef}
        confirmingArchiveThreadKey={confirmingArchiveThreadKey}
        setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
        confirmArchiveButtonRefs={confirmArchiveButtonRefs}
        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
        handleThreadClick={handleThreadClick}
        navigateToThread={navigateToThread}
        navigateToDraft={navigateToDraft}
        handleMultiSelectContextMenu={handleMultiSelectContextMenu}
        handleThreadContextMenu={handleThreadContextMenu}
        clearSelection={clearSelection}
        commitRename={commitRename}
        cancelRename={cancelRename}
        attemptArchiveThread={attemptArchiveThread}
        openPrLink={openPrLink}
        onChangeRequest={onChangeRequest}
        expandThreadListForProject={expandThreadListForProject}
        showSettledThreadsForProject={showSettledThreadsForProject}
        hideSettledThreadsForProject={hideSettledThreadsForProject}
        collapseThreadListForProject={collapseThreadListForProject}
        translator={translator}
      />

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{translator.message("sidebar.project.renameTitle")}</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? translator.message("sidebar.project.renameDescriptionPath", {
                    path: projectRenameTarget.workspaceRoot,
                  })
                : translator.message("sidebar.project.renameDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {translator.message("sidebar.project.title")}
              </span>
              <Input
                aria-label={translator.message("sidebar.project.title")}
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
            {projectRenameTarget?.environmentLabel ? (
              <p className="text-xs text-muted-foreground">
                {translator.message("sidebar.project.environment", {
                  environment: projectRenameTarget.environmentLabel,
                })}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              {translator.message("common.cancel")}
            </Button>
            <Button onClick={() => void submitProjectRename()}>
              {translator.message("sidebar.project.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{translator.message("sidebar.project.groupingTitle")}</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? translator.message("sidebar.project.groupingDescriptionPath", {
                    path: projectGroupingTarget.workspaceRoot,
                  })
                : translator.message("sidebar.project.groupingDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                {translator.message("sidebar.project.groupingRule")}
              </span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={translator.message("sidebar.project.groupingRule")}
                >
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? translator.message("sidebar.project.useGlobalDefault", {
                          mode: translator.message(
                            projectGroupingModeMessageId(
                              projectGroupingSettings.sidebarProjectGroupingMode,
                            ),
                          ),
                        })
                      : translator.message(projectGroupingModeMessageId(projectGroupingSelection))}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    {translator.message("sidebar.project.grouping.globalDefault")}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {translator.message("sidebar.project.grouping.repository")}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {translator.message("sidebar.project.grouping.repositoryPath")}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {translator.message("sidebar.project.grouping.separate")}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? translator.message(
                    projectGroupingDescriptionMessageId(
                      projectGroupingSettings.sidebarProjectGroupingMode,
                    ),
                  )
                : translator.message(projectGroupingDescriptionMessageId(projectGroupingSelection))}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              {translator.message("common.cancel")}
            </Button>
            <Button onClick={saveProjectGroupingPreference}>
              {translator.message("sidebar.project.save")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

const SidebarProjectListRow = memo(function SidebarProjectListRow(props: SidebarProjectItemProps) {
  return (
    <SidebarMenuItem className="rounded-md">
      <SidebarProjectItem {...props} />
    </SidebarMenuItem>
  );
});

function LocalSecondaryStatus() {
  const translator = useInterfaceTranslator();
  const { environments } = useEnvironments();
  // The desktop reports which local secondary backends (e.g. the WSL backend)
  // exist; the hook polls because the bridge has no change event. A backend that
  // is still cold-booting has no httpBaseUrl yet and isn't in the catalog, so we
  // surface "Connecting" straight from the bootstrap list and clear it once the
  // matching environment reports a connected phase.
  const secondaries = useDesktopLocalBootstraps();

  // Connected desktop-local environments keyed by their backend URL so we can
  // match a bootstrap (which only knows the URL) to its connection phase.
  const localEnvByUrl = useMemo(() => {
    const map = new Map<string, { phase: string; error: string | null }>();
    for (const environment of environments) {
      if (
        isDesktopLocalConnectionTarget(environment.entry.target) &&
        environment.displayUrl !== null
      ) {
        map.set(environment.displayUrl, {
          phase: environment.connection.phase,
          error: environment.connection.error,
        });
      }
    }
    return map;
  }, [environments]);

  const connecting: string[] = [];
  const failed: Array<{ label: string; error: string | null }> = [];
  for (const bootstrap of secondaries) {
    const env =
      bootstrap.httpBaseUrl !== null ? localEnvByUrl.get(bootstrap.httpBaseUrl) : undefined;
    if (env?.phase === "connected") {
      continue;
    }
    if (env?.phase === "error") {
      failed.push({ label: bootstrap.label, error: env.error });
      continue;
    }
    connecting.push(bootstrap.label);
  }

  if (connecting.length === 0 && failed.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 pt-2 pb-0">
      {connecting.length > 0 ? (
        <Alert
          variant="default"
          className="rounded-2xl border-border/40 bg-accent/40 text-muted-foreground"
        >
          <LoaderIcon className="animate-spin" />
          <AlertTitle className="text-xs font-medium text-foreground">
            {translator.message("sidebar.classic.connecting", {
              environments: translator.list(connecting),
            })}
          </AlertTitle>
        </Alert>
      ) : null}
      {failed.length > 0 ? (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
          <TriangleAlertIcon />
          <AlertTitle>
            {translator.message("sidebar.classic.connectionFailed", {
              environments: translator.list(failed.map((entry) => entry.label)),
            })}
          </AlertTitle>
          <AlertDescription>
            {failed
              .map((entry) => entry.error)
              .filter(Boolean)
              .join("; ") || translator.message("sidebar.classic.backendNoResponse")}
          </AlertDescription>
        </Alert>
      ) : null}
    </SidebarGroup>
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  threadPreviewCount,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
  onThreadPreviewCountChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  threadPreviewCount: SidebarThreadPreviewCount;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  onThreadPreviewCountChange: (count: SidebarThreadPreviewCount) => void;
}) {
  const translator = useInterfaceTranslator();
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-icon-muted transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">{translator.message("sidebar.classic.options")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            {translator.message("sidebar.sort.projects")}
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {SIDEBAR_SORT_ORDERS.map((value) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {translator.message(sidebarSortMessageId(value))}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            {translator.message("sidebar.sort.threads")}
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {SIDEBAR_THREAD_SORT_ORDERS.map((value) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {translator.message(sidebarSortMessageId(value))}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 text-muted-foreground sm:text-xs font-medium">
            {translator.message("sidebar.classic.chatsPerProject")}
          </div>
          <div className="px-2 py-1">
            <ProjectThreadPreviewCountControl
              ariaLabel={translator.message("sidebar.classic.chatsPerProject")}
              count={threadPreviewCount}
              onChange={onThreadPreviewCountChange}
            />
          </div>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: string;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

interface SidebarProjectsContentProps {
  showArm64IntelBuildWarning: boolean;
  arm64IntelBuildWarningDescription: string | null;
  desktopUpdateButtonAction: "download" | "install" | "none";
  desktopUpdateButtonDisabled: boolean;
  desktopUpdateActionPending: boolean;
  handleDesktopUpdateButtonClick: () => void;
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  threadPreviewCount: SidebarThreadPreviewCount;
  onThreadPreviewCountChange: (count: SidebarThreadPreviewCount) => void;
  updateSettings: ReturnType<typeof useUpdateClientSettings>;
  openAddProject: () => void;
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  recentProjects: readonly SidebarProjectSnapshot[];
  olderProjects: readonly SidebarProjectSnapshot[];
  olderProjectsExpanded: boolean;
  setOlderProjectsExpanded: (expanded: boolean) => void;
  expandedThreadListsByProject: ReadonlySet<string>;
  settledThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeThreadKey: string | null;
  routeDraftId: string | null;
  openPullRequestsInRightPanel: boolean;
  newThreadShortcutLabel: string | null;
  commandPaletteShortcutLabel: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null, enabled?: boolean) => void;
  isProjectThreadSettled: (thread: SidebarThreadSummary) => boolean;
  onChangeRequest: SidebarChangeRequestHandler;
  expandThreadListForProject: (projectKey: string) => void;
  showSettledThreadsForProject: (projectKey: string) => void;
  hideSettledThreadsForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
  projectsLength: number;
}

interface SidebarProjectListProps {
  projects: readonly SidebarProjectSnapshot[];
  isManualProjectSorting: boolean;
  projectDnDSensors: ReturnType<typeof useSensors>;
  projectCollisionDetection: CollisionDetection;
  handleProjectDragStart: (event: DragStartEvent) => void;
  handleProjectDragEnd: (event: DragEndEvent) => void;
  handleProjectDragCancel: (event: DragCancelEvent) => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>;
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  expandedThreadListsByProject: ReadonlySet<string>;
  settledThreadListsByProject: ReadonlySet<string>;
  activeRouteProjectKey: string | null;
  routeThreadKey: string | null;
  routeDraftId: string | null;
  openPullRequestsInRightPanel: boolean;
  newThreadShortcutLabel: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null, enabled?: boolean) => void;
  isProjectThreadSettled: (thread: SidebarThreadSummary) => boolean;
  onChangeRequest: SidebarChangeRequestHandler;
  expandThreadListForProject: (projectKey: string) => void;
  showSettledThreadsForProject: (projectKey: string) => void;
  hideSettledThreadsForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  attachProjectListAutoAnimateRef: (node: HTMLElement | null) => void;
}

const SidebarProjectList = memo(function SidebarProjectList(props: SidebarProjectListProps) {
  const {
    projects,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    expandedThreadListsByProject,
    settledThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    routeDraftId,
    openPullRequestsInRightPanel,
    newThreadShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    isProjectThreadSettled,
    onChangeRequest,
    expandThreadListForProject,
    showSettledThreadsForProject,
    hideSettledThreadsForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
  } = props;

  if (projects.length === 0) {
    return null;
  }

  if (isManualProjectSorting) {
    return (
      <DndContext
        sensors={projectDnDSensors}
        collisionDetection={projectCollisionDetection}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragStart={handleProjectDragStart}
        onDragEnd={handleProjectDragEnd}
        onDragCancel={handleProjectDragCancel}
      >
        <SidebarMenu>
          <SortableContext
            items={projects.map((project) => project.projectKey)}
            strategy={verticalListSortingStrategy}
          >
            {projects.map((project) => (
              <SortableProjectItem key={project.projectKey} projectId={project.projectKey}>
                {(dragHandleProps) => (
                  <SidebarProjectItem
                    project={project}
                    isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
                    settledThreadsVisible={settledThreadListsByProject.has(project.projectKey)}
                    activeRouteThreadKey={
                      activeRouteProjectKey === project.projectKey ? routeThreadKey : null
                    }
                    activeRouteDraftId={
                      activeRouteProjectKey === project.projectKey ? routeDraftId : null
                    }
                    openPullRequestsInRightPanel={openPullRequestsInRightPanel}
                    newThreadShortcutLabel={newThreadShortcutLabel}
                    handleNewThread={handleNewThread}
                    archiveThread={archiveThread}
                    deleteThread={deleteThread}
                    threadJumpLabelByKey={threadJumpLabelByKey}
                    attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
                    isProjectThreadSettled={isProjectThreadSettled}
                    onChangeRequest={onChangeRequest}
                    expandThreadListForProject={expandThreadListForProject}
                    showSettledThreadsForProject={showSettledThreadsForProject}
                    hideSettledThreadsForProject={hideSettledThreadsForProject}
                    collapseThreadListForProject={collapseThreadListForProject}
                    dragInProgressRef={dragInProgressRef}
                    suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
                    suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
                    isManualProjectSorting={isManualProjectSorting}
                    dragHandleProps={dragHandleProps}
                  />
                )}
              </SortableProjectItem>
            ))}
          </SortableContext>
        </SidebarMenu>
      </DndContext>
    );
  }

  return (
    <SidebarMenu ref={attachProjectListAutoAnimateRef}>
      {projects.map((project) => (
        <SidebarProjectListRow
          key={project.projectKey}
          project={project}
          isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
          settledThreadsVisible={settledThreadListsByProject.has(project.projectKey)}
          activeRouteThreadKey={
            activeRouteProjectKey === project.projectKey ? routeThreadKey : null
          }
          activeRouteDraftId={activeRouteProjectKey === project.projectKey ? routeDraftId : null}
          openPullRequestsInRightPanel={openPullRequestsInRightPanel}
          newThreadShortcutLabel={newThreadShortcutLabel}
          handleNewThread={handleNewThread}
          archiveThread={archiveThread}
          deleteThread={deleteThread}
          threadJumpLabelByKey={threadJumpLabelByKey}
          attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
          isProjectThreadSettled={isProjectThreadSettled}
          onChangeRequest={onChangeRequest}
          expandThreadListForProject={expandThreadListForProject}
          showSettledThreadsForProject={showSettledThreadsForProject}
          hideSettledThreadsForProject={hideSettledThreadsForProject}
          collapseThreadListForProject={collapseThreadListForProject}
          dragInProgressRef={dragInProgressRef}
          suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
          suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
          isManualProjectSorting={isManualProjectSorting}
          dragHandleProps={null}
        />
      ))}
    </SidebarMenu>
  );
});

const SidebarProjectsContent = memo(function SidebarProjectsContent(
  props: SidebarProjectsContentProps,
) {
  const translator = useInterfaceTranslator();
  const {
    showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    desktopUpdateActionPending,
    handleDesktopUpdateButtonClick,
    projectSortOrder,
    threadSortOrder,
    threadPreviewCount,
    onThreadPreviewCountChange,
    updateSettings,
    openAddProject,
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    recentProjects,
    olderProjects,
    olderProjectsExpanded,
    setOlderProjectsExpanded,
    expandedThreadListsByProject,
    settledThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    routeDraftId,
    openPullRequestsInRightPanel,
    newThreadShortcutLabel,
    commandPaletteShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    isProjectThreadSettled,
    onChangeRequest,
    expandThreadListForProject,
    showSettledThreadsForProject,
    hideSettledThreadsForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
    projectsLength,
  } = props;

  const handleProjectSortOrderChange = useCallback(
    (sortOrder: SidebarProjectSortOrder) => {
      updateSettings({ sidebarProjectSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleThreadSortOrderChange = useCallback(
    (sortOrder: SidebarThreadSortOrder) => {
      updateSettings({ sidebarThreadSortOrder: sortOrder });
    },
    [updateSettings],
  );
  const handleThreadPreviewCountChange = useCallback(
    (count: SidebarThreadPreviewCount) => {
      onThreadPreviewCountChange(count);
    },
    [onThreadPreviewCountChange],
  );
  const sharedProjectListProps: Omit<SidebarProjectListProps, "projects"> = {
    isManualProjectSorting,
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    handleNewThread,
    archiveThread,
    deleteThread,
    expandedThreadListsByProject,
    settledThreadListsByProject,
    activeRouteProjectKey,
    routeThreadKey,
    routeDraftId,
    openPullRequestsInRightPanel,
    newThreadShortcutLabel,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    isProjectThreadSettled,
    onChangeRequest,
    expandThreadListForProject,
    showSettledThreadsForProject,
    hideSettledThreadsForProject,
    collapseThreadListForProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    attachProjectListAutoAnimateRef,
  };

  return (
    <SidebarContent
      className="gap-0"
      fixedHeader={
        // Lifted above the stage backdrop, whose fade bleeds below the
        // header and would otherwise paint across the search row's outline.
        <SidebarGroup className="relative z-[1] px-2 pt-2 pb-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <CommandDialogTrigger
                render={
                  <SidebarMenuButton
                    className="focus-visible:ring-0"
                    data-testid="command-palette-trigger"
                  />
                }
              >
                <SearchIcon />
                <span className="flex-1 truncate">
                  {translator.message("sidebar.classic.search")}
                </span>
                {commandPaletteShortcutLabel ? (
                  <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-[10px]">
                    {commandPaletteShortcutLabel}
                  </Kbd>
                ) : null}
              </CommandDialogTrigger>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      }
    >
      {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
        <SidebarGroup className="px-2 pt-2 pb-0">
          <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
            <TriangleAlertIcon />
            <AlertTitle>{translator.message("sidebar.update.intelOnAppleSilicon")}</AlertTitle>
            <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
            {desktopUpdateButtonAction !== "none" ? (
              <AlertAction>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={desktopUpdateButtonDisabled || desktopUpdateActionPending}
                  onClick={handleDesktopUpdateButtonClick}
                >
                  {desktopUpdateButtonAction === "download"
                    ? translator.message("sidebar.update.downloadArmBuild")
                    : translator.message("sidebar.update.installArmBuild")}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </SidebarGroup>
      ) : null}
      <LocalSecondaryStatus />
      <SidebarGroup className="px-2 py-2">
        <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
          <span className="text-xs font-medium text-sidebar-muted-foreground/80">
            {translator.message("sidebar.classic.projects")}
          </span>
          <div className="flex items-center gap-1">
            <ProjectSortMenu
              projectSortOrder={projectSortOrder}
              threadSortOrder={threadSortOrder}
              threadPreviewCount={threadPreviewCount}
              onProjectSortOrderChange={handleProjectSortOrderChange}
              onThreadSortOrderChange={handleThreadSortOrderChange}
              onThreadPreviewCountChange={handleThreadPreviewCountChange}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={translator.message("sidebar.classic.addProject")}
                    data-testid="sidebar-add-project-trigger"
                    className="size-6 [--control-icon-color:currentColor] text-icon-muted"
                    onClick={openAddProject}
                  />
                }
              >
                <FolderPlusIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="right">
                {translator.message("sidebar.classic.addProject")}
              </TooltipPopup>
            </Tooltip>
          </div>
        </div>

        <SidebarProjectList projects={recentProjects} {...sharedProjectListProps} />
        <SidebarOlderProjectsSection
          count={olderProjects.length}
          open={olderProjectsExpanded}
          onOpenChange={setOlderProjectsExpanded}
        >
          <SidebarProjectList projects={olderProjects} {...sharedProjectListProps} />
        </SidebarOlderProjectsSection>

        {projectsLength === 0 && (
          <div className="px-2 pt-4 text-center text-secondary-label text-xs">
            {translator.message("sidebar.project.noProjects")}
          </div>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
});

export default function LegacySidebar() {
  const translator = useInterfaceTranslator();
  const projects = useProjects();
  const sidebarThreads = useThreadShells();
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const sidebarOlderProjectsExpanded = useUiStateStore(
    (store) => store.sidebarOlderProjectsExpanded,
  );
  const setSidebarOlderProjectsExpanded = useUiStateStore(
    (store) => store.setSidebarOlderProjectsExpanded,
  );
  const [sidebarActivityNowMs, setSidebarActivityNowMs] = useState(() => Date.now());
  const [dismissedOlderProjectAutoRevealKey, setDismissedOlderProjectAutoRevealKey] = useState<
    string | null
  >(null);
  const navigate = useNavigate();
  const sidebarThreadSortOrder = useClientSettings((s) => s.sidebarThreadSortOrder);
  const sidebarAutoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
  const sidebarAutoSettleOnMerge = useClientSettings((s) => s.sidebarAutoSettleOnMerge);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { count: sidebarThreadPreviewCount, setCount: setSidebarThreadPreviewCount } =
    useProjectThreadPreviewCount();
  const updateSettings = useUpdateClientSettings();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread, deleteThread } = useThreadActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [settledThreadListsByProject, setSettledThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [changeRequestByKey, setChangeRequestByKey] = useState<
    ReadonlyMap<string, ChangeRequestSettleSource>
  >(() => new Map());
  const handleChangeRequest = useCallback(
    (threadKey: string, changeRequest: ChangeRequestSettleSource | null) => {
      setChangeRequestByKey((current) => {
        const previous = current.get(threadKey) ?? null;
        if (
          previous?.state === changeRequest?.state &&
          (previous?.updatedAt ?? null) === (changeRequest?.updatedAt ?? null)
        ) {
          return current;
        }
        const next = new Map(current);
        if (changeRequest === null) {
          next.delete(threadKey);
        } else {
          next.set(threadKey, changeRequest);
        }
        return next;
      });
    },
    [],
  );
  const serverConfigs = useServerConfigs();
  const nowMinute = useNowMinute();
  const isProjectThreadSettled = useCallback(
    (thread: SidebarThreadSummary) => {
      const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
      const now = `${nowMinute}:00.000Z`;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const changeRequest = changeRequestByKey.get(threadKey) ?? null;
      return (
        resolveThreadSidebarLifecycle(thread, {
          now,
          autoSettleAfterDays: sidebarAutoSettleAfterDays,
          autoSettleOnMerge: sidebarAutoSettleOnMerge,
          changeRequest,
          supportsSettlement: capabilities?.threadSettlement === true,
          supportsSnooze: capabilities?.threadSnooze === true,
        }) === "settled"
      );
    },
    [
      changeRequestByKey,
      nowMinute,
      serverConfigs,
      sidebarAutoSettleAfterDays,
      sidebarAutoSettleOnMerge,
    ],
  );
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const desktopUpdateState = useDesktopUpdateState();
  const [desktopUpdateActionPending, setDesktopUpdateActionPending] = useState(false);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const desktopLocalEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter((environment) => isDesktopLocalConnectionTarget(environment.entry.target))
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    return buildPhysicalToLogicalProjectKeyMap({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
    });
  }, [orderedProjects, projectGroupingSettings, primaryEnvironmentId]);
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      isDesktopLocalEnvironment: (environmentId) => desktopLocalEnvironmentIds.has(environmentId),
    });
  }, [
    environmentLabelById,
    desktopLocalEnvironmentIds,
    orderedProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  const activeRouteProjectKey = useMemo(() => {
    if (routeDraftThread) {
      const draftProjectRef = scopeProjectRef(
        routeDraftThread.environmentId,
        routeDraftThread.projectId,
      );
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(scopedProjectKey(draftProjectRef)) ??
        scopedProjectKey(draftProjectRef);
      return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
    }
    if (!routeThreadKey) {
      return null;
    }
    const activeThread = sidebarThreadByKey.get(routeThreadKey);
    if (!activeThread) return null;
    const physicalKey =
      projectPhysicalKeyByScopedRef.get(
        scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
      ) ?? scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId));
    return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
  }, [
    routeDraftThread,
    routeThreadKey,
    sidebarThreadByKey,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
  ]);

  // Group threads by logical project key so all threads from grouped projects
  // are displayed together.
  const threadsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarThreadSummary[]>();
    for (const thread of sidebarThreads) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(thread);
      } else {
        next.set(logicalKey, [thread]);
      }
    }
    return next;
  }, [sidebarThreads, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeTerminalOpen,
      modelPickerOpen: isModelPickerOpen(),
    }),
    [routeTerminalOpen],
  );
  const newThreadShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", newThreadShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", newThreadShortcutLabelOptions);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, navigate, setOpenMobile, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.projectKey === active.id);
      const overProject = sidebarProjects.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      reorderProjects(orderedProjects.map(getProjectOrderKey), activeMemberKeys, overMemberKeys);
    },
    [orderedProjects, sidebarProjectSortOrder, reorderProjects, sidebarProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListControllersRef = useRef(
    new WeakMap<HTMLElement, ReturnType<typeof autoAnimate>>(),
  );
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null, enabled = true) => {
    if (!node) return;
    const existingController = animatedThreadListControllersRef.current.get(node);
    if (existingController) {
      if (enabled) existingController.enable();
      else existingController.disable();
      return;
    }
    const controller = autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListControllersRef.current.set(node, controller);
    if (!enabled) controller.disable();
  }, []);

  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.map((thread) => {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      return {
        ...thread,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectByKey,
    sidebarProjects,
    visibleThreads,
  ]);
  const { recentProjects, olderProjects, nextTransitionAtMs } = useMemo(
    () =>
      partitionSidebarProjectsByActivity({
        projects: sortedProjects,
        threadsByProjectKey,
        nowMs: sidebarActivityNowMs,
      }),
    [sidebarActivityNowMs, sortedProjects, threadsByProjectKey],
  );
  const activeRouteProjectIsOlder =
    activeRouteProjectKey !== null &&
    olderProjects.some((project) => project.projectKey === activeRouteProjectKey);
  const olderProjectsExpanded =
    sidebarOlderProjectsExpanded ||
    (activeRouteProjectIsOlder && activeRouteProjectKey !== dismissedOlderProjectAutoRevealKey);
  const sidebarProjectsEligibleForDetailWork = useMemo(
    () => (olderProjectsExpanded ? [...recentProjects, ...olderProjects] : recentProjects),
    [olderProjects, olderProjectsExpanded, recentProjects],
  );

  useEffect(() => {
    const refreshActivityClock = () => {
      setSidebarActivityNowMs(Date.now());
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshActivityClock();
      }
    };
    const timeoutId =
      nextTransitionAtMs === null
        ? null
        : window.setTimeout(
            refreshActivityClock,
            Math.max(0, Math.min(MAX_SIDEBAR_ACTIVITY_TIMEOUT_MS, nextTransitionAtMs - Date.now())),
          );

    window.addEventListener("focus", refreshActivityClock);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", refreshActivityClock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [nextTransitionAtMs, sidebarActivityNowMs]);

  const handleOlderProjectsExpandedChange = useCallback(
    (expanded: boolean) => {
      setDismissedOlderProjectAutoRevealKey(
        !expanded && activeRouteProjectIsOlder ? activeRouteProjectKey : null,
      );
      setSidebarOlderProjectsExpanded(expanded);
    },
    [activeRouteProjectIsOlder, activeRouteProjectKey, setSidebarOlderProjectsExpanded],
  );

  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const deferredProjectExpandedById = useDeferredValue(projectExpandedById);
  const deferredExpandedThreadListsByProject = useDeferredValue(expandedThreadListsByProject);
  const deferredSettledThreadListsByProject = useDeferredValue(settledThreadListsByProject);
  const visibleSidebarThreadKeys = useMemo(
    () =>
      sidebarProjectsEligibleForDetailWork.flatMap((project) => {
        const projectExpanded = resolveProjectExpanded(
          deferredProjectExpandedById,
          projectExpansionPreferenceKeys(project),
        );
        const rawProjectThreads = threadsByProjectKey.get(project.projectKey) ?? [];
        const activeThreadKey =
          activeRouteProjectKey === project.projectKey ? (routeThreadKey ?? undefined) : undefined;
        const pinnedCollapsedThread =
          !projectExpanded && activeThreadKey
            ? (rawProjectThreads.find(
                (thread) =>
                  thread.archivedAt === null &&
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                    activeThreadKey,
              ) ?? null)
            : null;
        const pinnedCollapsedThreadKey = pinnedCollapsedThread
          ? scopedThreadKey(
              scopeThreadRef(pinnedCollapsedThread.environmentId, pinnedCollapsedThread.id),
            )
          : null;
        return resolveLegacySidebarProjectThreadIds({
          projectExpanded,
          pinnedCollapsedThreadId: pinnedCollapsedThreadKey,
          resolveExpandedThreadIds: () => {
            const projectThreads = sortThreadsForSidebar(
              rawProjectThreads.filter((thread) => thread.archivedAt === null),
              sidebarThreadSortOrder,
            );
            const isThreadListExpanded = deferredExpandedThreadListsByProject.has(
              project.projectKey,
            );
            const settledThreadsVisible = deferredSettledThreadListsByProject.has(
              project.projectKey,
            );
            const sections = resolveProjectThreadSections({
              items: projectThreads,
              count: sidebarThreadPreviewCount,
              showAllNonSettled: false,
              showSettled: false,
              isSettled: isProjectThreadSettled,
              alwaysVisible: (thread) => {
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                return isThreadStatusAlwaysVisibleInProjectPreview(
                  resolveThreadStatusPill({
                    thread: {
                      ...thread,
                      lastVisitedAt: threadLastVisitedAtById[threadKey],
                    },
                  }),
                );
              },
              keepSettledVisible: (thread) =>
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
            });
            const disclosure = resolveLegacySidebarProjectThreadDisclosure({
              sections,
              isThreadListExpanded,
              settledThreadsVisible,
            });
            return disclosure.renderedThreads.map((thread) =>
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            );
          },
        });
      }),
    [
      activeRouteProjectKey,
      sidebarThreadSortOrder,
      sidebarThreadPreviewCount,
      deferredExpandedThreadListsByProject,
      deferredSettledThreadListsByProject,
      isProjectThreadSettled,
      deferredProjectExpandedById,
      routeThreadKey,
      sidebarProjectsEligibleForDetailWork,
      threadLastVisitedAtById,
      threadsByProjectKey,
    ],
  );
  const threadJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadKey] of visibleSidebarThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadKeys]);
  const threadJumpThreadKeys = useMemo(
    () => [...threadJumpCommandByKey.keys()],
    [threadJumpCommandByKey],
  );
  const sidebarShortcutContext = {
    terminalFocus: terminalFocused,
    terminalOpen: routeTerminalOpen,
    modelPickerOpen: isModelPickerOpen(),
  };
  const threadJumpLabelByKey = useMemo(
    () =>
      buildThreadJumpLabelMap({
        keybindings,
        platform,
        terminalOpen: sidebarShortcutContext.terminalOpen,
        threadJumpCommandByKey,
      }),
    [keybindings, platform, sidebarShortcutContext.terminalOpen, threadJumpCommandByKey],
  );
  const shouldShowThreadJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform,
      context: sidebarShortcutContext,
    },
  );
  const visibleThreadJumpLabelByKey = showThreadJumpHints
    ? threadJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;
  const orderedSidebarThreadKeys = visibleSidebarThreadKeys;
  const prewarmedSidebarThreadKeys = useMemo(
    () => getSidebarThreadIdsToPrewarm(visibleSidebarThreadKeys),
    [visibleSidebarThreadKeys],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () =>
      prewarmedSidebarThreadKeys.flatMap((threadKey) => {
        const ref = parseScopedThreadKey(threadKey);
        return ref ? [ref] : [];
      }),
    [prewarmedSidebarThreadKeys],
  );

  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowThreadJumpHintsNow);
  }, [shouldShowThreadJumpHintsNow, updateThreadJumpHintsVisibility]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcutContext = getCurrentSidebarShortcutContext();

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadKey = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadKeys,
          currentThreadId: routeThreadKey,
          direction: traversalDirection,
        });
        if (!targetThreadKey) {
          return;
        }
        const targetThread = sidebarThreadByKey.get(targetThreadKey);
        if (!targetThread) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadKey = threadJumpThreadKeys[jumpIndex];
      if (!targetThreadKey) {
        return;
      }
      const targetThread = sidebarThreadByKey.get(targetThreadKey);
      if (!targetThread) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
    };

    window.addEventListener("keydown", onWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    getCurrentSidebarShortcutContext,
    keybindings,
    navigateToThread,
    orderedSidebarThreadKeys,
    platform,
    routeThreadKey,
    sidebarThreadByKey,
    threadJumpThreadKeys,
  ]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!useThreadSelectionStore.getState().hasSelection()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection]);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? translator.message(
          desktopUpdateButtonAction === "download"
            ? "sidebar.update.armDownloadDescription"
            : desktopUpdateButtonAction === "install"
              ? "sidebar.update.armInstallDescription"
              : "sidebar.update.armNextDescription",
        )
      : null;
  const commandPaletteShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "commandPalette.toggle",
    newThreadShortcutLabelOptions,
  );
  const handleDesktopUpdateButtonClick = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (
      desktopUpdateButtonDisabled ||
      desktopUpdateButtonAction === "none" ||
      desktopUpdateActionPending
    ) {
      return;
    }

    setDesktopUpdateActionPending(true);

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            showDesktopUpdateDownloadedToast(bridge, result.state, translator);
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.downloadFailed"),
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.downloadStartFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        })
        .finally(() => setDesktopUpdateActionPending(false));
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          translator.message("sidebar.update.installConfirm", {
            version:
              (desktopUpdateState.downloadedVersion ?? desktopUpdateState.availableVersion)
                ? ` ${desktopUpdateState.downloadedVersion ?? desktopUpdateState.availableVersion}`
                : "",
          }),
        );
      } catch (error) {
        setDesktopUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.update.confirmFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.update.confirmationFailed"),
          }),
        );
        return;
      }
      if (!confirmed) {
        setDesktopUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.installFailed"),
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.installFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        })
        .finally(() => setDesktopUpdateActionPending(false));
    }
  }, [
    desktopUpdateActionPending,
    desktopUpdateButtonAction,
    desktopUpdateButtonDisabled,
    desktopUpdateState,
    translator,
  ]);

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const showSettledThreadsForProject = useCallback((projectKey: string) => {
    setSettledThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const hideSettledThreadsForProject = useCallback((projectKey: string) => {
    setSettledThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
    setSettledThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      {prewarmedSidebarThreadRefs.map((threadRef) => (
        <SidebarThreadDetailPrewarmer key={scopedThreadKey(threadRef)} threadRef={threadRef} />
      ))}
      <SidebarChromeHeader isElectron={isElectron} />

      <SidebarProjectsContent
        showArm64IntelBuildWarning={showArm64IntelBuildWarning}
        arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
        desktopUpdateButtonAction={desktopUpdateButtonAction}
        desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
        desktopUpdateActionPending={desktopUpdateActionPending}
        handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
        projectSortOrder={sidebarProjectSortOrder}
        threadSortOrder={sidebarThreadSortOrder}
        threadPreviewCount={sidebarThreadPreviewCount}
        onThreadPreviewCountChange={setSidebarThreadPreviewCount}
        updateSettings={updateSettings}
        openAddProject={openAddProjectCommandPalette}
        isManualProjectSorting={isManualProjectSorting}
        projectDnDSensors={projectDnDSensors}
        projectCollisionDetection={projectCollisionDetection}
        handleProjectDragStart={handleProjectDragStart}
        handleProjectDragEnd={handleProjectDragEnd}
        handleProjectDragCancel={handleProjectDragCancel}
        handleNewThread={handleNewThread}
        archiveThread={archiveThread}
        deleteThread={deleteThread}
        recentProjects={recentProjects}
        olderProjects={olderProjects}
        olderProjectsExpanded={olderProjectsExpanded}
        setOlderProjectsExpanded={handleOlderProjectsExpandedChange}
        expandedThreadListsByProject={expandedThreadListsByProject}
        settledThreadListsByProject={settledThreadListsByProject}
        activeRouteProjectKey={activeRouteProjectKey}
        routeThreadKey={routeThreadKey}
        routeDraftId={routeDraftId}
        openPullRequestsInRightPanel={routeThreadRef !== null}
        newThreadShortcutLabel={newThreadShortcutLabel}
        commandPaletteShortcutLabel={commandPaletteShortcutLabel}
        threadJumpLabelByKey={visibleThreadJumpLabelByKey}
        attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
        isProjectThreadSettled={isProjectThreadSettled}
        onChangeRequest={handleChangeRequest}
        expandThreadListForProject={expandThreadListForProject}
        showSettledThreadsForProject={showSettledThreadsForProject}
        hideSettledThreadsForProject={hideSettledThreadsForProject}
        collapseThreadListForProject={collapseThreadListForProject}
        dragInProgressRef={dragInProgressRef}
        suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
        suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
        attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
        projectsLength={sidebarProjects.length}
      />
      <SidebarChromeFooter />
    </>
  );
}
