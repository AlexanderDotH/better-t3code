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

function sidebarThreadRequiresAttention(thread: SidebarThreadSummary): boolean {
  return (
    (thread.runtime !== null &&
      ["preparing", "queued", "starting", "running", "waiting"].includes(thread.runtime.status)) ||
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
  readonly isThreadSettled?: (thread: SidebarThreadSummary) => boolean;
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
    const requiresAttention = activeThreads.some(
      (thread) => sidebarThreadRequiresAttention(thread) && !input.isThreadSettled?.(thread),
    );
    if (
      !requiresAttention &&
      activeThreads.length > 0 &&
      activeThreads.every(
        (thread) => input.isThreadSettled?.(thread) ?? thread.settledOverride === "settled",
      )
    ) {
      olderProjects.push(project);
      continue;
    }
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

/** Active rows of projects idle past the inactivity window, for the Older projects shelf. */
export function splitSidebarActiveThreadsByProjectActivity<
  T extends Pick<SidebarThreadSummary, "environmentId" | "projectId">,
>(input: {
  readonly projects: readonly SidebarProjectSnapshot[];
  /** Every listed thread, so settled and pinned work still counts as project activity. */
  readonly threads: readonly SidebarThreadSummary[];
  readonly activeThreads: readonly T[];
  readonly nowMs: number;
  readonly isThreadSettled?: (thread: SidebarThreadSummary) => boolean;
}): SidebarThreadActivityPartition<T> & { readonly olderProjectCount: number } {
  const projectKeyByMemberKey = new Map<string, string>();
  for (const project of input.projects) {
    for (const ref of project.memberProjectRefs) {
      projectKeyByMemberKey.set(`${ref.environmentId}:${ref.projectId}`, project.projectKey);
    }
  }
  const threadsByProjectKey = new Map<string, SidebarThreadSummary[]>();
  for (const thread of input.threads) {
    const projectKey = projectKeyByMemberKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (projectKey === undefined) continue;
    const list = threadsByProjectKey.get(projectKey);
    if (list) list.push(thread);
    else threadsByProjectKey.set(projectKey, [thread]);
  }
  const { olderProjects } = partitionSidebarProjectsByActivity({
    projects: input.projects,
    threadsByProjectKey,
    nowMs: input.nowMs,
    ...(input.isThreadSettled ? { isThreadSettled: input.isThreadSettled } : {}),
  });
  const partition = partitionSidebarThreadsByProjectActivity({
    threads: input.activeThreads,
    olderProjects,
  });
  const olderProjectKeys = new Set(
    partition.olderThreads.flatMap((thread) => {
      const projectKey = projectKeyByMemberKey.get(`${thread.environmentId}:${thread.projectId}`);
      return projectKey === undefined ? [] : [projectKey];
    }),
  );
  return { ...partition, olderProjectCount: olderProjectKeys.size };
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
