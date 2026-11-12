import type { ArchivedSnapshotEntry } from "@t3tools/client-runtime/state/threads";
import {
  scopeProject,
  scopeThreadShell,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentId } from "@t3tools/contracts";
import { foldSearchQuery, rankSearchItems, scoreThreadSearch } from "@t3tools/shared/paletteSearch";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { scopedProjectKey } from "../../lib/scopedEntities";
import type { ProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { buildHomeProjectScopes, findHomeProjectScope } from "../home/homeThreadList";

export type ArchivedThreadSortOrder = "newest" | "oldest";

export interface ArchivedThreadGroup {
  readonly key: string;
  readonly project: EnvironmentProject;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

function archiveTimestamp(thread: EnvironmentThreadShell): number {
  const timestamp = Date.parse(thread.archivedAt ?? thread.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesQuery(value: string | null, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query) ?? false;
}

export function buildArchivedProjectScopes(input: {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly environmentId: EnvironmentId | null;
  readonly projectGroupingSettings?: ProjectGroupingSettings;
}) {
  return buildHomeProjectScopes({
    projects: input.snapshots.flatMap((entry) =>
      entry.snapshot.projects.map((project) => scopeProject(entry.environmentId, project)),
    ),
    environmentId: input.environmentId,
    projectGroupingMode: input.projectGroupingSettings?.sidebarProjectGroupingMode ?? "repository",
    projectGroupingOverrides: input.projectGroupingSettings?.sidebarProjectGroupingOverrides,
  });
}

export function buildArchivedThreadGroups(input: {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly environmentLabels: Readonly<Record<string, string>>;
  readonly environmentId: EnvironmentId | null;
  readonly projectKey?: string | null;
  readonly projectGroupingSettings?: ProjectGroupingSettings;
  readonly searchQuery: string;
  readonly sortOrder: ArchivedThreadSortOrder;
}): ReadonlyArray<ArchivedThreadGroup> {
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const foldedQuery = foldSearchQuery(input.searchQuery);
  const allScopes = buildArchivedProjectScopes(input);
  const selectedScope = findHomeProjectScope(allScopes, input.projectKey ?? null);
  const scopes = selectedScope ? [selectedScope] : allScopes;
  const projectsByKey = new Map<string, EnvironmentProject>();
  const threadsByProject = new Map<string, EnvironmentThreadShell[]>();
  for (const entry of input.snapshots) {
    if (input.environmentId !== null && input.environmentId !== entry.environmentId) continue;
    for (const raw of entry.snapshot.projects) {
      const project = scopeProject(entry.environmentId, raw);
      projectsByKey.set(scopedProjectKey(project.environmentId, project.id), project);
    }
    for (const raw of entry.snapshot.threads) {
      if (raw.archivedAt === null) continue;
      const thread = scopeThreadShell(entry.environmentId, raw);
      const key = scopedProjectKey(thread.environmentId, thread.projectId);
      const threads = threadsByProject.get(key) ?? [];
      threads.push(thread);
      threadsByProject.set(key, threads);
    }
  }
  const timestampOrder = input.sortOrder === "newest" ? Order.flip(Order.Number) : Order.Number;
  const groups = scopes.flatMap((scope): ArchivedThreadGroup[] => {
    const matchingThreads = scope.projectRefs.flatMap((ref) => {
      const key = scopedProjectKey(ref.environmentId, ref.projectId);
      const project = projectsByKey.get(key);
      if (!project) return [];
      const threads = threadsByProject.get(key) ?? [];
      const groupMatches =
        !query ||
        matchesQuery(scope.title, query) ||
        matchesQuery(project.workspaceRoot, query) ||
        matchesQuery(input.environmentLabels[project.environmentId] ?? null, query);
      return groupMatches
        ? threads
        : rankSearchItems(threads, (thread, options) =>
            scoreThreadSearch(foldedQuery, threadSearchSubject(thread, null), 0, {
              ...options,
              picks: false,
            }),
          ).map(({ item }) => item);
    });
    if (matchingThreads.length === 0) return [];
    return [
      {
        key: scope.key,
        project:
          scope.representative.title === scope.title
            ? scope.representative
            : { ...scope.representative, title: scope.title },
        projects: scope.projects,
        threads: Arr.sort(
          matchingThreads,
          Order.mapInput(
            Order.Struct({ timestamp: timestampOrder, title: Order.String, id: Order.String }),
            (thread: EnvironmentThreadShell) => ({
              timestamp: archiveTimestamp(thread),
              title: thread.title,
              id: `${thread.environmentId}:${thread.id}`,
            }),
          ),
        ),
      },
    ];
  });
  return Arr.sort(
    groups,
    Order.mapInput(
      Order.Struct({ timestamp: timestampOrder, title: Order.String, key: Order.String }),
      (group: ArchivedThreadGroup) => ({
        timestamp: group.threads[0] ? archiveTimestamp(group.threads[0]) : 0,
        title: group.project.title,
        key: group.key,
      }),
    ),
  );
}
