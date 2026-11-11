import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  getThreadSortTimestamp,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import type {
  EnvironmentId,
  ScopedProjectRef,
  SidebarProjectGroupingMode,
  SidebarProjectSortOrder,
} from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import type { ThreadListV2ListItem } from "../threads/threadListV2";

export type HomeProjectSortOrder = Exclude<SidebarProjectSortOrder, "manual">;

export interface HomeProjectScope {
  readonly key: string;
  readonly title: string;
  readonly representative: EnvironmentProject;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly pinned: boolean;
  readonly archived: boolean;
}

function getProjectSortTimestamp(
  project: EnvironmentProject,
  sortOrder: HomeProjectSortOrder,
): number {
  return sortOrder === "created_at"
    ? (toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY)
    : (toSortableTimestamp(project.updatedAt) ??
        toSortableTimestamp(project.createdAt) ??
        Number.NEGATIVE_INFINITY);
}

export function buildHomeProjectScopes(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentId: EnvironmentId | null;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}): ReadonlyArray<HomeProjectScope> {
  const projects = input.projects.filter(
    (project) => input.environmentId === null || project.environmentId === input.environmentId,
  );
  return buildProjectGroups({
    projects,
    groupScratchProjects: true,
    settings: {
      sidebarProjectGroupingMode: input.projectGroupingMode,
      sidebarProjectGroupingOverrides: {},
    },
  }).map((group) => {
    return {
      key: group.key,
      title: group.label,
      representative: group.representative,
      projects: group.members.map((member) => member.project),
      projectRefs: group.memberProjectRefs,
      pinned: group.pinned,
      archived: group.archived,
    };
  });
}

export function findHomeProjectScope(
  scopes: ReadonlyArray<HomeProjectScope>,
  key: string | null,
): HomeProjectScope | null {
  if (key === null) {
    return null;
  }
  return (
    scopes.find((scope) => scope.key === key) ??
    scopes.find((scope) =>
      scope.projectRefs.some(
        (projectRef) => scopedProjectKey(projectRef.environmentId, projectRef.projectId) === key,
      ),
    ) ??
    null
  );
}

export function sortHomeProjectScopes(input: {
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly projectSortOrder: HomeProjectSortOrder;
}): ReadonlyArray<HomeProjectScope> {
  const scopeKeyByProjectRef = new Map(
    input.scopes.flatMap((scope) =>
      scope.projectRefs.map(
        (projectRef) =>
          [scopedProjectKey(projectRef.environmentId, projectRef.projectId), scope.key] as const,
      ),
    ),
  );
  const latestActivityByScope = new Map<string, number>();
  const recordActivity = (scopeKey: string | undefined, timestamp: number) => {
    if (!scopeKey || !Number.isFinite(timestamp)) return;
    latestActivityByScope.set(
      scopeKey,
      Math.max(latestActivityByScope.get(scopeKey) ?? Number.NEGATIVE_INFINITY, timestamp),
    );
  };

  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    recordActivity(
      scopeKeyByProjectRef.get(scopedProjectKey(thread.environmentId, thread.projectId)),
      getThreadSortTimestamp(thread, input.projectSortOrder),
    );
  }
  for (const pendingTask of input.pendingTasks) {
    recordActivity(
      scopeKeyByProjectRef.get(scopedProjectKey(pendingTask.environmentId, pendingTask.projectId)),
      Date.parse(pendingTask.createdAt),
    );
  }

  return Arr.sort(
    input.scopes,
    Order.mapInput(
      Order.Struct({
        timestamp: Order.flip(Order.Number),
        title: Order.String,
        key: Order.String,
      }),
      (scope: HomeProjectScope) => ({
        timestamp:
          latestActivityByScope.get(scope.key) ??
          Math.max(
            ...scope.projects.map((project) =>
              getProjectSortTimestamp(project, input.projectSortOrder),
            ),
          ),
        title: scope.title,
        key: scope.key,
      }),
    ),
  );
}

export interface GroupedThreadListGroup {
  readonly title: string;
  readonly scopeKey: string;
  readonly first: boolean;
  readonly last: boolean;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly hiddenCount: number;
  readonly project: EnvironmentProject;
}

type GroupedSortField = "createdAt" | "updatedAt";

/**
 * Rearranges the flat list into project groups for the Classic and Boring layouts. Settled rows
 * fold behind a toggle per project. Boring also starts each group with its favorites and keeps
 * snoozed rows below the groups.
 */
export function buildGroupedThreadListItems(input: {
  readonly rows: ReadonlyArray<ThreadListV2ListItem>;
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly boring: boolean;
  readonly searching: boolean;
  readonly previewCount: number;
  readonly projectSortField: GroupedSortField;
  readonly threadSortField: GroupedSortField;
  readonly collapsedGroups: ReadonlyArray<string> | undefined;
  readonly openSettledGroups: ReadonlyArray<string> | undefined;
  readonly expandedGroups: ReadonlySet<string>;
  readonly selectedThreadKey: string | null;
}) {
  const rows = input.rows.filter((row) => row.type === "v2-thread" || row.type === "v2-pending");
  const isPinned = (row: ThreadListV2ListItem) => row.type === "v2-thread" && row.item.pinned;
  const isSnoozed = (row: ThreadListV2ListItem) => row.type === "v2-thread" && row.item.snoozed;
  const isSettled = (row: ThreadListV2ListItem) =>
    row.type === "v2-thread" && row.item.variant === "slim" && !row.item.snoozed;
  const isSelected = (row: ThreadListV2ListItem) =>
    row.type === "v2-thread" &&
    scopedThreadKey(row.item.thread.environmentId, row.item.thread.id) === input.selectedThreadKey;
  const below = input.boring ? rows.filter(isSnoozed) : [];
  const groupable = input.boring ? rows.filter((row) => !isSnoozed(row)) : rows;
  const groups = new Map<string, GroupedThreadListGroup>();
  const items: ThreadListV2ListItem[] = [];
  const included = new Set(below.map((row) => row.key));
  const scopes = [...input.scopes].sort(
    (first, second) =>
      Number(second.pinned) - Number(first.pinned) ||
      Date.parse(second.representative[input.projectSortField]) -
        Date.parse(first.representative[input.projectSortField]),
  );
  for (const scope of scopes) {
    const keys = new Set(
      scope.projectRefs.map((ref) => scopedProjectKey(ref.environmentId, ref.projectId)),
    );
    const scopeRows = groupable.filter((row) => {
      const target =
        row.type === "v2-thread"
          ? { environmentId: row.item.thread.environmentId, projectId: row.item.thread.projectId }
          : row.type === "v2-pending"
            ? row.pendingTask
            : null;
      return target !== null && keys.has(scopedProjectKey(target.environmentId, target.projectId));
    });
    // A search lists every match, so nothing it found may hide behind a toggle.
    const settledRows = input.searching ? [] : scopeRows.filter(isSettled);
    const unsettledRows = input.searching ? scopeRows : scopeRows.filter((r) => !isSettled(r));
    const favorites = input.boring ? unsettledRows.filter(isPinned) : [];
    const otherRows = input.boring ? unsettledRows.filter((r) => !isPinned(r)) : [...unsettledRows];
    otherRows.sort((first, second) =>
      first.type === "v2-thread" && second.type === "v2-thread"
        ? Date.parse(second.item.thread[input.threadSortField]) -
          Date.parse(first.item.thread[input.threadSortField])
        : first.type === second.type
          ? 0
          : first.type === "v2-pending"
            ? -1
            : 1,
    );
    const projectRows = [...favorites, ...otherRows];
    const collapsed = input.collapsedGroups?.includes(scope.key) === true;
    const expanded = input.expandedGroups.has(scope.key) || input.searching;
    const previewCount = Math.max(input.previewCount, favorites.length);
    const shown = projectRows.slice(
      0,
      collapsed ? 1 : expanded ? projectRows.length : previewCount,
    );
    const group = {
      title: scope.title,
      scopeKey: scope.key,
      collapsed,
      expanded,
      hiddenCount: Math.max(0, projectRows.length - previewCount),
      project: scope.representative,
    };
    for (const [index, row] of shown.entries()) {
      groups.set(row.key, { ...group, first: index === 0, last: index === shown.length - 1 });
      items.push(row);
    }
    for (const row of scopeRows) included.add(row.key);
    if (settledRows.length === 0) continue;
    const open = input.openSettledGroups?.includes(scope.key) === true;
    const toggle: ThreadListV2ListItem = {
      type: "v2-project-settled",
      key: `v2-project-settled:${scope.key}`,
      scopeKey: scope.key,
      count: settledRows.length,
      open,
    };
    // With nothing active, the toggle carries the project's header.
    groups.set(toggle.key, { ...group, first: shown.length === 0, last: false });
    items.push(toggle);
    if (collapsed) continue;
    for (const row of settledRows) {
      if (!open && !isSelected(row)) continue;
      groups.set(row.key, { ...group, first: false, last: false });
      items.push(row);
    }
  }
  items.push(...rows.filter((row) => !included.has(row.key)), ...below);
  return { items, groups };
}
