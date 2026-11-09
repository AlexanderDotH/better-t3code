import type { ScopedProjectRef } from "@t3tools/contracts";

import type { EnvironmentThreadShell } from "./models.ts";

/** Projects without work activity for longer than this fold into the Older projects shelf. */
export const PROJECT_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ProjectActivityGroup {
  readonly key: string;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  /** Member projects; their own timestamps count only while the group has no threads. */
  readonly projects: ReadonlyArray<{
    readonly createdAt?: string | null | undefined;
    readonly updatedAt?: string | null | undefined;
  }>;
}

export type ProjectActivityThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "projectId"
  | "archivedAt"
  | "runtime"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "settledOverride"
  | "unsettledAt"
  | "settledAt"
  | "latestUserMessageAt"
  | "updatedAt"
  | "createdAt"
>;

const ATTENTION_RUNTIME_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function threadRequiresAttention(thread: ProjectActivityThread): boolean {
  return (
    (thread.runtime !== null && ATTENTION_RUNTIME_STATUSES.has(thread.runtime.status)) ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan
  );
}

function firstActivityTimestamp(nowMs: number, ...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const timestampMs = Date.parse(value);
    if (Number.isFinite(timestampMs)) return Math.min(timestampMs, nowMs);
  }
  return null;
}

function projectMemberKey(ref: Pick<ScopedProjectRef, "environmentId" | "projectId">) {
  return `${ref.environmentId}:${ref.projectId}`;
}

/**
 * Splits project groups by work activity: a group is older once every unarchived thread is
 * settled, or once nothing happened for longer than {@link PROJECT_INACTIVITY_MS}. Threads that
 * need attention keep their group recent regardless of age.
 */
export function partitionProjectGroupsByActivity<
  Group extends ProjectActivityGroup,
  Thread extends ProjectActivityThread,
>(input: {
  readonly groups: ReadonlyArray<Group>;
  readonly threadsByGroupKey: ReadonlyMap<string, ReadonlyArray<Thread>>;
  readonly nowMs: number;
  readonly isThreadSettled?: (thread: Thread) => boolean;
}): {
  readonly recentGroups: ReadonlyArray<Group>;
  readonly olderGroups: ReadonlyArray<Group>;
  readonly nextTransitionAtMs: number | null;
} {
  if (!Number.isFinite(input.nowMs)) {
    return { recentGroups: input.groups, olderGroups: [], nextTransitionAtMs: null };
  }
  const isSettled = (thread: Thread) =>
    input.isThreadSettled?.(thread) ?? thread.settledOverride === "settled";
  const recentGroups: Group[] = [];
  const olderGroups: Group[] = [];
  let nextTransitionAtMs: number | null = null;

  for (const group of input.groups) {
    const activeThreads = (input.threadsByGroupKey.get(group.key) ?? []).filter(
      (thread) => thread.archivedAt === null,
    );
    if (activeThreads.some((thread) => threadRequiresAttention(thread) && !isSettled(thread))) {
      recentGroups.push(group);
      continue;
    }
    if (activeThreads.length > 0 && activeThreads.every(isSettled)) {
      olderGroups.push(group);
      continue;
    }
    const timestamps =
      activeThreads.length > 0
        ? activeThreads.map((thread) =>
            firstActivityTimestamp(
              input.nowMs,
              thread.unsettledAt,
              thread.settledAt,
              thread.latestUserMessageAt,
              thread.updatedAt,
              thread.createdAt,
            ),
          )
        : group.projects.map((project) =>
            firstActivityTimestamp(input.nowMs, project.updatedAt, project.createdAt),
          );
    let latestActivityAtMs = Number.NEGATIVE_INFINITY;
    for (const timestampMs of timestamps) {
      if (timestampMs !== null) latestActivityAtMs = Math.max(latestActivityAtMs, timestampMs);
    }
    if (!Number.isFinite(latestActivityAtMs)) {
      recentGroups.push(group);
      continue;
    }
    // Exactly the inactivity window is still recent; the next millisecond is older.
    const transitionAtMs = latestActivityAtMs + PROJECT_INACTIVITY_MS + 1;
    if (input.nowMs >= transitionAtMs) {
      olderGroups.push(group);
      continue;
    }
    recentGroups.push(group);
    if (nextTransitionAtMs === null || transitionAtMs < nextTransitionAtMs) {
      nextTransitionAtMs = transitionAtMs;
    }
  }

  return { recentGroups, olderGroups, nextTransitionAtMs };
}

/** Member keys (`environmentId:projectId`) of the groups that belong on the Older projects shelf. */
export function resolveOlderProjectMemberKeys<Thread extends ProjectActivityThread>(input: {
  readonly groups: ReadonlyArray<ProjectActivityGroup>;
  /** Every listed thread, so settled, snoozed and pinned work still counts as activity. */
  readonly threads: ReadonlyArray<Thread>;
  readonly nowMs: number;
  readonly isThreadSettled?: (thread: Thread) => boolean;
}): ReadonlyMap<string, string> {
  const groupKeyByMemberKey = new Map<string, string>();
  for (const group of input.groups) {
    for (const ref of group.projectRefs) groupKeyByMemberKey.set(projectMemberKey(ref), group.key);
  }
  const threadsByGroupKey = new Map<string, Thread[]>();
  for (const thread of input.threads) {
    const groupKey = groupKeyByMemberKey.get(projectMemberKey(thread));
    if (groupKey === undefined) continue;
    const threads = threadsByGroupKey.get(groupKey);
    if (threads) threads.push(thread);
    else threadsByGroupKey.set(groupKey, [thread]);
  }
  const { olderGroups } = partitionProjectGroupsByActivity({
    groups: input.groups,
    threadsByGroupKey,
    nowMs: input.nowMs,
    ...(input.isThreadSettled ? { isThreadSettled: input.isThreadSettled } : {}),
  });
  return new Map(
    olderGroups.flatMap((group) =>
      group.projectRefs.map((ref) => [projectMemberKey(ref), group.key] as const),
    ),
  );
}
