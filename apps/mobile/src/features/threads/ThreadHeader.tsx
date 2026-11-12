import { minuteTick } from "@t3tools/client-runtime/clock";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useMemo, useSyncExternalStore } from "react";
import { minuteTickToEpochMs } from "../../lib/clock";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import type { AppBarAction, AppBarMenuItem } from "../../components/ui/AppBar.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { requestTimelineControl } from "./timeline-controls";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useThreadHeaderPanels } from "./useThreadHeaderPanels";

const subscribeNever = () => () => undefined;

/** Ticks by the minute: each change rewrites the native header, so seconds stay in the chat. */
function useWorkingHeaderSubtitle(startedAt: string | null): string | null {
  const translator = useMobileInterfaceTranslator();
  const minute = useSyncExternalStore(
    startedAt === null ? subscribeNever : minuteTick.subscribe,
    minuteTick.getSnapshot,
    minuteTick.getSnapshot,
  );
  if (startedAt === null) return null;
  const elapsedMinutes = Math.floor((minuteTickToEpochMs(minute) - Date.parse(startedAt)) / 60_000);
  return Number.isFinite(elapsedMinutes) && elapsedMinutes >= 1
    ? `${translator.message("chat.timeline.workingFor")} ${formatDuration(elapsedMinutes * 60_000)}`
    : translator.message("chat.timeline.working");
}

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    /** When set, the subtitle shows the running turn instead of the project. */
    readonly workingStartedAt?: string | null;
    readonly workingTokenLabel?: string | null;
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
  },
) {
  const translator = useMobileInterfaceTranslator();
  const goBack = useWorkspaceBackNavigation("threads");
  const { layout, panes, toggleAuxiliaryPane, composerKeyboardActive } =
    useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const workingSubtitle = useWorkingHeaderSubtitle(props.workingStartedAt ?? null);
  const subtitle =
    workingSubtitle === null
      ? props.subtitle
      : [workingSubtitle, props.workingTokenLabel].filter(Boolean).join(" · ");
  const native = useThreadHeaderOptions({ ...props, subtitle });
  const panels = useThreadHeaderPanels(
    props.gitControls.threadId && !props.draft
      ? {
          environmentId: EnvironmentId.make(String(props.gitControls.environmentId)),
          threadId: ThreadId.make(String(props.gitControls.threadId)),
        }
      : null,
    props.title,
  );
  const timelineItems = props.gitControls.threadId
    ? (["find", "jump-list"] as const).map((action) => ({
        id: `timeline-${action}`,
        title: translator.message(
          action === "find" ? "mobile.timeline.find" : "mobile.timeline.jumpList",
        ),
        icon: action === "find" ? "magnifyingglass" : "list.bullet",
        onPress: () =>
          requestTimelineControl(
            scopedThreadKey(
              EnvironmentId.make(String(props.gitControls.environmentId)),
              ThreadId.make(String(props.gitControls.threadId)),
            ),
            action,
          ),
      }))
    : [];
  const actionItems: ReadonlyArray<Extract<AppBarMenuItem, { readonly onPress: () => void }>> = [
    ...panels.items,
    ...timelineItems,
  ];
  const androidHeaderActions = useMemo<ReadonlyArray<AppBarAction>>(() => {
    const actions: AppBarAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: translator.message("mobile.files.returnToChat"),
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible
          ? translator.message("mobile.ui.closeFiles")
          : translator.message("mobile.git.openFiles"),
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    if (props.hasWorkspaceRoot && props.gitControls.canOpenTerminal) {
      actions.push({
        accessibilityLabel: translator.message("mobile.git.openTerminal"),
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    if (props.gitControls.gitEnabled !== false)
      actions.push({
        accessibilityLabel: translator.message("mobile.thread.openGit"),
        icon: "point.topleft.down.curvedto.point.bottomright.up",
        onPress: props.onOpenGitInspector,
      });
    if (props.gitControls.gitEnabled !== false && onMergeBack) {
      actions.push({
        accessibilityLabel: translator.message("mobile.ui.mergeBackToSource"),
        icon: PullRequestGlyph.merged,
        onPress: onMergeBack,
      });
    }
    if (props.gitControls.knowledgeGraphControl) {
      actions.push({
        accessibilityLabel: props.gitControls.knowledgeGraphControl.accessibilityLabel,
        icon: "point.3.connected.trianglepath.dotted",
        onPress: props.gitControls.knowledgeGraphControl.onPress,
      });
    }
    return actions;
  }, [
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    onOpenTerminal,
    onMergeBack,
    props.onOpenGitInspector,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
    props.gitControls.canOpenTerminal,
    props.gitControls.gitEnabled,
    props.gitControls.knowledgeGraphControl,
    translator,
  ]);

  return (
    <>
      <AppBar
        title={props.title}
        subtitle={subtitle}
        sidebar={native.sidebar}
        options={{
          ...native.options,
          unstable_headerRightItems: () => [
            ...((
              native.options.unstable_headerRightItems as (() => ReadonlyArray<unknown>) | undefined
            )?.() ?? []),
            ...(actionItems.length
              ? [
                  {
                    type: "menu",
                    identifier: "thread-title-menu",
                    accessibilityLabel: props.title,
                    icon: { type: "sfSymbol", name: "ellipsis.circle" },
                    menu: {
                      title: props.title,
                      items: actionItems.map((item) => ({
                        type: "action",
                        label: item.title,
                        disabled: item.disabled,
                        icon: { type: "sfSymbol", name: item.icon },
                        onPress: item.onPress,
                      })),
                    },
                  },
                ]
              : []),
          ],
        }}
        optionsVersion={[native.optionsVersion, actionItems]}
        menus={
          actionItems.length
            ? [{ title: props.title, icon: "ellipsis.circle", items: actionItems }]
            : undefined
        }
        trailing={
          props.fileInspectorSupported && props.hasThreadCwd ? (
            <ScreenHeaderButton
              accessibilityLabel={
                props.inspectorMode !== null && panes.auxiliaryPaneVisible
                  ? translator.message("mobile.ui.hideInspector")
                  : translator.message("mobile.ui.showInspector")
              }
              icon="sidebar.right"
              selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
              onPress={props.onToggleInspector}
            />
          ) : null
        }
        onBack={layout.usesSplitView ? undefined : goBack}
        actions={androidHeaderActions}
        hideBottomBorder
        compact={composerKeyboardActive}
      />
      {native.fallback}
      {panels.editor}
      {panels.panel}
    </>
  );
}
