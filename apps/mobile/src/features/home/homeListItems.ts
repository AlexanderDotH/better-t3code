import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import type { HomeThreadGroup } from "./homeThreadList";

/** Threads shown per project before the "Show more" affordance appears. */
export const HOME_INITIAL_VISIBLE_THREADS = DEFAULT_PROJECT_THREAD_PREVIEW_COUNT;
/** Additional threads revealed per "Show more" tap. */
export const HOME_SHOW_MORE_STEP = 10;

export interface HomeGroupDisplayState {
  readonly collapsed: boolean;
  /** Threads revealed beyond the configured project preview count. */
  readonly additionalVisibleCount: number;
}

export const DEFAULT_GROUP_DISPLAY_STATE: HomeGroupDisplayState = {
  collapsed: false,
  additionalVisibleCount: 0,
};

export interface HomeHeaderListItem {
  readonly type: "header";
  readonly key: string;
  readonly group: HomeThreadGroup;
  readonly collapsed: boolean;
  readonly isFirst: boolean;
}

export interface HomeThreadListItem {
  readonly type: "thread";
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly isLast: boolean;
}

export interface HomePendingTaskListItem {
  readonly type: "pending-task";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  readonly isLast: boolean;
}

export interface HomeShowMoreListItem {
  readonly type: "show-more";
  readonly key: string;
  readonly groupKey: string;
  /** Threads still hidden. 0 means the group is fully expanded. */
  readonly hiddenCount: number;
  /** Whether more than the initial count is revealed, so "Show less" applies. */
  readonly canShowLess: boolean;
}

export interface HomeOlderProjectsListItem {
  readonly type: "older-projects";
  readonly key: "older-projects";
  readonly count: number;
  readonly expanded: boolean;
}

export type HomeListItem =
  | HomeHeaderListItem
  | HomeOlderProjectsListItem
  | HomePendingTaskListItem
  | HomeThreadListItem
  | HomeShowMoreListItem;

export interface HomeListLayout {
  readonly items: ReadonlyArray<HomeListItem>;
  readonly stickyHeaderIndices: ReadonlyArray<number>;
}

export type HomeGroupDisplayAction = "toggle-collapsed" | "show-more" | "show-less";

export function nextGroupDisplayState(
  current: HomeGroupDisplayState,
  action: HomeGroupDisplayAction,
): HomeGroupDisplayState {
  switch (action) {
    case "toggle-collapsed":
      return { ...current, collapsed: !current.collapsed };
    case "show-more":
      return {
        ...current,
        additionalVisibleCount: current.additionalVisibleCount + HOME_SHOW_MORE_STEP,
      };
    case "show-less":
      return { ...current, additionalVisibleCount: 0 };
  }
}

/**
 * Structural equality for list items. Item objects are rebuilt on every
 * collapse/show-more toggle; without this the lists would consider every
 * mounted row changed and re-render all of them (each carrying a swipeable +
 * a vcs-status subscription). Group/thread references are stable across
 * toggles.
 */
export function homeListItemsAreEqual(previous: HomeListItem, item: HomeListItem): boolean {
  switch (item.type) {
    case "header":
      return (
        previous.type === "header" &&
        previous.group === item.group &&
        previous.collapsed === item.collapsed &&
        previous.isFirst === item.isFirst
      );
    case "pending-task":
      return (
        previous.type === "pending-task" &&
        previous.pendingTask === item.pendingTask &&
        previous.isLast === item.isLast
      );
    case "thread":
      return (
        previous.type === "thread" &&
        previous.thread === item.thread &&
        previous.isLast === item.isLast
      );
    case "show-more":
      return (
        previous.type === "show-more" &&
        previous.groupKey === item.groupKey &&
        previous.hiddenCount === item.hiddenCount &&
        previous.canShowLess === item.canShowLess
      );
    case "older-projects":
      return (
        previous.type === "older-projects" &&
        previous.count === item.count &&
        previous.expanded === item.expanded
      );
  }
}

export function buildHomeListLayout(input: {
  readonly groups: ReadonlyArray<HomeThreadGroup>;
  readonly olderGroups?: ReadonlyArray<HomeThreadGroup>;
  readonly olderProjectsExpanded?: boolean;
  readonly projectThreadPreviewCount: ProjectThreadPreviewCount;
  readonly displayStates: ReadonlyMap<string, HomeGroupDisplayState>;
  /**
   * When searching, pagination is suspended so every match stays visible.
   */
  readonly showAllThreads?: boolean;
}): HomeListLayout {
  const items: HomeListItem[] = [];
  const stickyHeaderIndices: number[] = [];

  const appendGroups = (groups: ReadonlyArray<HomeThreadGroup>) => {
    for (const group of groups) {
      const display = input.displayStates.get(group.key) ?? DEFAULT_GROUP_DISPLAY_STATE;
      const collapsed = display.collapsed && input.showAllThreads !== true;

      stickyHeaderIndices.push(items.length);
      items.push({
        type: "header",
        key: `header:${group.key}`,
        group,
        collapsed,
        isFirst: items.length === 0,
      });

      if (collapsed) continue;

      const totalCount = group.threads.length;
      // Default to the group's recent-activity window (last few days, or a small
      // fallback for stale projects), capped at the configured preview size. Until the
      // user taps "Show more", older threads stay hidden to save vertical space;
      // revealed state is stored relative to this baseline so changing the
      // preference immediately rebases the group.
      const baselineCount = Math.min(
        group.recentThreads.length,
        input.projectThreadPreviewCount,
        totalCount,
      );
      const visibleCount = input.showAllThreads
        ? totalCount
        : Math.min(baselineCount + display.additionalVisibleCount, totalCount);
      const visibleThreads = group.threads.slice(0, visibleCount);
      const hiddenCount = totalCount - visibleCount;
      const hasShowMoreRow = !input.showAllThreads && totalCount > baselineCount;

      // Pending (unsent) tasks lead the group and are never paginated away.
      for (const [pendingIndex, pendingTask] of group.pendingTasks.entries()) {
        items.push({
          type: "pending-task",
          key: `pending-task:${pendingTask.message.messageId}`,
          pendingTask,
          isLast:
            pendingIndex === group.pendingTasks.length - 1 &&
            visibleThreads.length === 0 &&
            !hasShowMoreRow,
        });
      }

      for (const [threadIndex, thread] of visibleThreads.entries()) {
        items.push({
          type: "thread",
          key: `thread:${thread.environmentId}:${thread.id}`,
          thread,
          isLast: threadIndex === visibleThreads.length - 1 && !hasShowMoreRow,
        });
      }

      if (hasShowMoreRow) {
        items.push({
          type: "show-more",
          key: `show-more:${group.key}`,
          groupKey: group.key,
          hiddenCount,
          // Stale projects can start below the configured preview count, so
          // compare against the group's own baseline.
          canShowLess: visibleCount > baselineCount,
        });
      }
    }
  };

  appendGroups(input.groups);
  const olderGroups = input.olderGroups ?? [];
  if (olderGroups.length > 0) {
    items.push({
      type: "older-projects",
      key: "older-projects",
      count: olderGroups.length,
      expanded: input.olderProjectsExpanded === true,
    });
    if (input.olderProjectsExpanded === true) {
      appendGroups(olderGroups);
    }
  }

  return { items, stickyHeaderIndices };
}
