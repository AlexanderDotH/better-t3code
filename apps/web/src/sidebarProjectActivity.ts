import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";
import type { SidebarThreadSummary } from "./types";

export const SIDEBAR_PROJECT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1_000;

export interface SidebarProjectActivityPartition {
  readonly recentProjects: SidebarProjectSnapshot[];
  readonly olderProjects: SidebarProjectSnapshot[];
  readonly nextTransitionAtMs: number | null;
}

export interface SidebarThreadActivityPartition<T> {
  readonly recentThreads: T[];
  readonly olderThreads: T[];
}

export function sidebarThreadRequiresAttention(thread: SidebarThreadSummary): boolean {
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.latestTurn?.state === "running" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan
  );
}

function parseActivityTimestamp(nowMs: number, ...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const timestampMs = Date.parse(value);
    if (Number.isFinite(timestampMs)) {
      return Math.min(timestampMs, nowMs);
    }
  }
  return null;
}

export function partitionSidebarProjectsByActivity(input: {
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly threadsByProjectKey: ReadonlyMap<string, readonly SidebarThreadSummary[]>;
  readonly nowMs: number;
}): SidebarProjectActivityPartition {
  const recentProjects: SidebarProjectSnapshot[] = [];
  const olderProjects: SidebarProjectSnapshot[] = [];
  let nextTransitionAtMs: number | null = null;

  if (!Number.isFinite(input.nowMs)) {
    return {
      recentProjects: [...input.projects],
      olderProjects,
      nextTransitionAtMs,
    };
  }

  for (const project of input.projects) {
    const activeThreads = (input.threadsByProjectKey.get(project.projectKey) ?? []).filter(
      (thread) => thread.archivedAt === null,
    );
    const requiresAttention = activeThreads.some(sidebarThreadRequiresAttention);
    let latestActivityAtMs = Number.NEGATIVE_INFINITY;

    const activityTimestamps =
      activeThreads.length > 0
        ? activeThreads.map((thread) =>
            parseActivityTimestamp(
              input.nowMs,
              thread.unsettledAt,
              thread.settledAt,
              thread.latestUserMessageAt,
              thread.updatedAt,
              thread.createdAt,
            ),
          )
        : project.memberProjects.map((member) =>
            parseActivityTimestamp(input.nowMs, member.updatedAt, member.createdAt),
          );

    for (const timestampMs of activityTimestamps) {
      if (timestampMs !== null) {
        latestActivityAtMs = Math.max(latestActivityAtMs, timestampMs);
      }
    }

    if (requiresAttention || !Number.isFinite(latestActivityAtMs)) {
      recentProjects.push(project);
      continue;
    }

    // Exactly seven days remains recent. The first millisecond beyond the
    // boundary is when the project moves into the older section.
    const transitionAtMs = latestActivityAtMs + SIDEBAR_PROJECT_INACTIVITY_MS + 1;
    if (input.nowMs >= transitionAtMs) {
      olderProjects.push(project);
      continue;
    }

    recentProjects.push(project);
    if (nextTransitionAtMs === null || transitionAtMs < nextTransitionAtMs) {
      nextTransitionAtMs = transitionAtMs;
    }
  }

  return { recentProjects, olderProjects, nextTransitionAtMs };
}

export function partitionSidebarThreadsByProjectActivity<
  T extends Pick<SidebarThreadSummary, "environmentId" | "projectId">,
>(input: {
  readonly threads: readonly T[];
  readonly olderProjects: readonly SidebarProjectSnapshot[];
}): SidebarThreadActivityPartition<T> {
  const olderMemberKeys = new Set(
    input.olderProjects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
      ),
    ),
  );
  const recentThreads: T[] = [];
  const olderThreads: T[] = [];
  for (const thread of input.threads) {
    const target = olderMemberKeys.has(`${thread.environmentId}:${thread.projectId}`)
      ? olderThreads
      : recentThreads;
    target.push(thread);
  }
  return { recentThreads, olderThreads };
}

export function resolveSidebarOlderProjectsExpanded(input: {
  readonly persistedExpanded: boolean;
  readonly activeRouteProjectKey: string | null;
  readonly dismissedAutoRevealProjectKey: string | null;
  readonly olderProjectKeys: ReadonlySet<string>;
}): boolean {
  if (input.persistedExpanded) return true;
  return (
    input.activeRouteProjectKey !== null &&
    input.olderProjectKeys.has(input.activeRouteProjectKey) &&
    input.activeRouteProjectKey !== input.dismissedAutoRevealProjectKey
  );
}
