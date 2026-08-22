import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildHomeListLayout,
  DEFAULT_GROUP_DISPLAY_STATE,
  HOME_INITIAL_VISIBLE_THREADS,
  HOME_SHOW_MORE_STEP,
  nextGroupDisplayState,
  resolveGroupedProjectSettledThreadKeys,
  type HomeGroupDisplayState,
  type HomeListItem,
} from "./homeListItems";
import type { HomeThreadGroup } from "./homeThreadList";

const environmentId = EnvironmentId.make("environment-1");

function makeProject(id: string, title: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title,
    workspaceRoot: `/workspaces/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    checkpointsEnabled: true,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function makeThread(id: string, projectId: ProjectId): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: `Thread ${id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function withSessionStatus(
  thread: EnvironmentThreadShell,
  status: "running" | "starting",
): EnvironmentThreadShell {
  return {
    ...thread,
    session: {
      threadId: thread.id,
      status,
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId: null,
      runtimeMode: "full-access",
      activeTurnId: null,
      abortState: null,
      lastError: null,
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  };
}

function makeGroup(key: string, threadCount: number): HomeThreadGroup {
  const project = makeProject(key, key);
  const threads = Array.from({ length: threadCount }, (_, index) =>
    makeThread(`${key}-thread-${index}`, project.id),
  );
  return {
    key,
    title: key,
    representative: project,
    projects: [project],
    pendingTasks: [],
    threads,
    // All threads inside the recency window, so the baseline stays at the
    // initial page size and the pagination expectations below hold.
    recentThreads: threads,
    newThreadTarget: project,
  };
}

function makePendingTask(projectId: ProjectId): PendingNewTask {
  const creation = {
    projectId,
    workspaceMode: "local" as const,
    branch: null,
    worktreePath: null,
  };
  return {
    creation,
    message: {
      environmentId,
      threadId: ThreadId.make("pending-thread"),
      messageId: MessageId.make("pending-message"),
      commandId: CommandId.make("pending-command"),
      text: "Pending task",
      attachments: [],
      creation,
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    title: "Pending task",
  };
}

function itemTypes(items: ReadonlyArray<HomeListItem>): string[] {
  return items.map((item) => item.type);
}

function visibleThreadIds(items: ReadonlyArray<HomeListItem>): string[] {
  return items.flatMap((item) => (item.type === "thread" ? [item.thread.id] : []));
}

function settledThreadKeys(
  group: HomeThreadGroup,
  settledIndexes: ReadonlyArray<number>,
): ReadonlySet<string> {
  return new Set(
    settledIndexes.flatMap((index) => {
      const thread = group.threads[index];
      return thread ? [`${thread.environmentId}:${thread.id}`] : [];
    }),
  );
}

function displayStates(
  entries: Record<string, HomeGroupDisplayState>,
): ReadonlyMap<string, HomeGroupDisplayState> {
  return new Map(Object.entries(entries));
}

describe("buildHomeListLayout", () => {
  it("uses three threads as the default project preview count", () => {
    expect(HOME_INITIAL_VISIBLE_THREADS).toBe(3);

    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 8)],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });

    expect(layout.items.filter((item) => item.type === "thread")).toHaveLength(3);
  });

  it("renders a header plus all threads for a small group without a show-more row", () => {
    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 3)],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });

    expect(itemTypes(layout.items)).toEqual(["header", "thread", "thread", "thread"]);
    expect(layout.stickyHeaderIndices).toEqual([0]);
    expect(layout.items.at(-1)).toMatchObject({ type: "thread", isLast: true });
  });

  it("limits large groups to the initial visible count with a show-more row", () => {
    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 133)],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });

    const threadItems = layout.items.filter((item) => item.type === "thread");
    expect(threadItems).toHaveLength(HOME_INITIAL_VISIBLE_THREADS);
    expect(layout.items.at(-1)).toMatchObject({
      type: "show-more",
      groupKey: "alpha",
      hiddenCount: 133 - HOME_INITIAL_VISIBLE_THREADS,
      canShowLess: false,
    });
    // The show-more row takes over the last slot, so no thread is marked last.
    expect(threadItems.every((item) => item.type === "thread" && !item.isLast)).toBe(true);
  });

  it("keeps an active thread visible outside the recent-activity window", () => {
    const group = makeGroup("alpha", 7);
    const threads = group.threads.map((thread, index) =>
      index === 6 ? withSessionStatus(thread, "running") : thread,
    );

    const layout = buildHomeListLayout({
      groups: [{ ...group, threads, recentThreads: threads.slice(0, 3) }],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-1",
      "alpha-thread-2",
      "alpha-thread-6",
    ]);
    expect(layout.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 3,
      canShowLess: false,
    });
  });

  it("preserves source order while hiding only inactive threads beyond the quota", () => {
    const group = makeGroup("alpha", 7);
    const threads = group.threads.map((thread, index) => {
      if (index === 3) return withSessionStatus(thread, "starting");
      if (index === 5) return withSessionStatus(thread, "running");
      return thread;
    });

    const layout = buildHomeListLayout({
      groups: [{ ...group, threads }],
      projectThreadPreviewCount: 2,
      displayStates: displayStates({}),
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-1",
      "alpha-thread-3",
      "alpha-thread-5",
    ]);
    expect(layout.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 3,
      canShowLess: false,
    });
  });

  it("omits show-more when every thread beyond the quota is active", () => {
    const group = makeGroup("alpha", 5);
    const threads = group.threads.map((thread, index) =>
      index < 2 ? thread : withSessionStatus(thread, index === 2 ? "starting" : "running"),
    );

    const layout = buildHomeListLayout({
      groups: [{ ...group, threads }],
      projectThreadPreviewCount: 2,
      displayStates: displayStates({}),
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-1",
      "alpha-thread-2",
      "alpha-thread-3",
      "alpha-thread-4",
    ]);
    expect(layout.items.some((item) => item.type === "show-more")).toBe(false);
    expect(layout.items.at(-1)).toMatchObject({ type: "thread", isLast: true });
  });

  it("retains show-less for manual expansion after active extras exhaust hidden threads", () => {
    const group = makeGroup("alpha", 4);
    const threads = group.threads.map((thread, index) =>
      index === 3 ? withSessionStatus(thread, "running") : thread,
    );

    const collapsedToQuota = buildHomeListLayout({
      groups: [{ ...group, threads }],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
    });
    expect(collapsedToQuota.items.some((item) => item.type === "show-more")).toBe(false);

    const manuallyExpanded = buildHomeListLayout({
      groups: [{ ...group, threads }],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
      }),
    });
    expect(manuallyExpanded.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 0,
      canShowLess: true,
    });
  });

  it("reveals more threads per show-more step and offers show-less when exhausted", () => {
    const group = makeGroup("alpha", 20);

    const expandedOnce = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
      }),
    });
    expect(expandedOnce.items.filter((item) => item.type === "thread")).toHaveLength(
      HOME_INITIAL_VISIBLE_THREADS + HOME_SHOW_MORE_STEP,
    );
    expect(expandedOnce.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 7,
      canShowLess: true,
    });

    const fullyExpanded = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(
          nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
          "show-more",
        ),
      }),
    });
    expect(fullyExpanded.items.filter((item) => item.type === "thread")).toHaveLength(20);
    expect(fullyExpanded.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 0,
      canShowLess: true,
    });

    const reset = nextGroupDisplayState(
      nextGroupDisplayState(
        nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
        "show-more",
      ),
      "show-less",
    );
    expect(reset.additionalVisibleCount).toBe(0);
  });

  it("finishes non-settled pagination before offering the settled section", () => {
    const group = makeGroup("alpha", 6);
    const settledKeys = settledThreadKeys(group, [1, 3]);

    const collapsed = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 2,
      displayStates: displayStates({}),
      settledThreadKeys: settledKeys,
    });
    expect(visibleThreadIds(collapsed.items)).toEqual(["alpha-thread-0", "alpha-thread-2"]);
    expect(collapsed.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 2,
      canToggleSettled: false,
      settledVisible: false,
    });

    const expanded = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 2,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
      }),
      settledThreadKeys: settledKeys,
    });
    expect(visibleThreadIds(expanded.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-2",
      "alpha-thread-4",
      "alpha-thread-5",
    ]);
    expect(expanded.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 0,
      canShowLess: true,
      canToggleSettled: true,
      settledVisible: false,
    });
  });

  it("offers settled chats directly when every non-settled chat fits", () => {
    const group = makeGroup("alpha", 4);

    const layout = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
      settledThreadKeys: settledThreadKeys(group, [1, 3]),
    });

    expect(visibleThreadIds(layout.items)).toEqual(["alpha-thread-0", "alpha-thread-2"]);
    expect(layout.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 0,
      canShowLess: false,
      canToggleSettled: true,
      settledVisible: false,
    });
  });

  it("appends settled chats and resets them together with show-less", () => {
    const group = makeGroup("alpha", 4);
    const settledKeys = settledThreadKeys(group, [1, 3]);
    const settledState = nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-settled");

    const shown = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({ alpha: settledState }),
      settledThreadKeys: settledKeys,
    });
    expect(visibleThreadIds(shown.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-2",
      "alpha-thread-1",
      "alpha-thread-3",
    ]);
    expect(shown.items.at(-1)).toMatchObject({
      type: "show-more",
      canShowLess: true,
      canToggleSettled: true,
      settledVisible: true,
    });

    const hidden = nextGroupDisplayState(settledState, "hide-settled");
    expect(hidden.settledVisible).toBe(false);

    const reset = nextGroupDisplayState(settledState, "show-less");
    expect(reset).toMatchObject({ additionalVisibleCount: 0, settledVisible: false });
  });

  it("keeps a selected settled chat visible without opening the settled section", () => {
    const group = makeGroup("alpha", 4);
    const selected = group.threads[3]!;

    const layout = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
      settledThreadKeys: settledThreadKeys(group, [1, 3]),
      selectedThreadKey: `${selected.environmentId}:${selected.id}`,
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-2",
      "alpha-thread-3",
    ]);
  });

  it("does not offer to reveal settled chats when the selected chat is the only settled one", () => {
    const group = makeGroup("alpha", 3);
    const selected = group.threads[2]!;

    const layout = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
      settledThreadKeys: settledThreadKeys(group, [2]),
      selectedThreadKey: `${selected.environmentId}:${selected.id}`,
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-1",
      "alpha-thread-2",
    ]);
    expect(layout.items.some((item) => item.type === "show-more")).toBe(false);
  });

  it("shows matching settled chats without controls while searching", () => {
    const group = makeGroup("alpha", 4);

    const layout = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 1,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "toggle-collapsed"),
      }),
      settledThreadKeys: settledThreadKeys(group, [1, 3]),
      showAllThreads: true,
    });

    expect(visibleThreadIds(layout.items)).toEqual([
      "alpha-thread-0",
      "alpha-thread-2",
      "alpha-thread-1",
      "alpha-thread-3",
    ]);
    expect(layout.items.some((item) => item.type === "show-more")).toBe(false);
  });

  it("rebases the expanded amount when the configured preview count changes", () => {
    const group = makeGroup("alpha", 20);
    const displayState = nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more");

    const withThree = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({ alpha: displayState }),
    });
    const withFive = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: 5,
      displayStates: displayStates({ alpha: displayState }),
    });

    expect(withThree.items.filter((item) => item.type === "thread")).toHaveLength(13);
    expect(withFive.items.filter((item) => item.type === "thread")).toHaveLength(15);
  });

  it("honors custom and maximum project preview counts", () => {
    const group = makeGroup("alpha", 20);

    for (const count of [5, 15]) {
      const layout = buildHomeListLayout({
        groups: [group],
        projectThreadPreviewCount: count,
        displayStates: displayStates({}),
      });
      expect(layout.items.filter((item) => item.type === "thread")).toHaveLength(count);
    }
  });

  it("offers show-less after expanding a stale group whose baseline is below the page size", () => {
    // Stale project: 10 threads total but only 3 within the recency window.
    const project = makeProject("stale", "stale");
    const threads = Array.from({ length: 10 }, (_, index) =>
      makeThread(`stale-thread-${index}`, project.id),
    );
    const group: HomeThreadGroup = {
      key: "stale",
      title: "stale",
      representative: project,
      projects: [project],
      pendingTasks: [],
      threads,
      recentThreads: threads.slice(0, 3),
      newThreadTarget: project,
    };

    const collapsedToRecent = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });
    expect(collapsedToRecent.items.filter((item) => item.type === "thread")).toHaveLength(3);
    expect(collapsedToRecent.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 7,
      canShowLess: false,
    });

    const expanded = buildHomeListLayout({
      groups: [group],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({
        stale: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "show-more"),
      }),
    });
    expect(expanded.items.filter((item) => item.type === "thread")).toHaveLength(10);
    expect(expanded.items.at(-1)).toMatchObject({
      type: "show-more",
      hiddenCount: 0,
      canShowLess: true,
    });
  });

  it("hides threads and the show-more row for collapsed groups", () => {
    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 12), makeGroup("beta", 2)],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "toggle-collapsed"),
      }),
    });

    expect(itemTypes(layout.items)).toEqual(["header", "header", "thread", "thread"]);
    expect(layout.items[0]).toMatchObject({ type: "header", collapsed: true, isFirst: true });
    expect(layout.items[1]).toMatchObject({ type: "header", collapsed: false, isFirst: false });
    expect(layout.stickyHeaderIndices).toEqual([0, 1]);
  });

  it("suspends collapse and pagination while searching", () => {
    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 12)],
      projectThreadPreviewCount: 1,
      displayStates: displayStates({
        alpha: nextGroupDisplayState(DEFAULT_GROUP_DISPLAY_STATE, "toggle-collapsed"),
      }),
      showAllThreads: true,
    });

    expect(layout.items.filter((item) => item.type === "thread")).toHaveLength(12);
    expect(layout.items.some((item) => item.type === "show-more")).toBe(false);
  });

  it("keeps pending unsent tasks outside the configured thread count", () => {
    const group = makeGroup("alpha", 8);
    const layout = buildHomeListLayout({
      groups: [{ ...group, pendingTasks: [makePendingTask(group.representative.id)] }],
      projectThreadPreviewCount: 3,
      displayStates: displayStates({}),
    });

    expect(layout.items.filter((item) => item.type === "pending-task")).toHaveLength(1);
    expect(layout.items.filter((item) => item.type === "thread")).toHaveLength(3);
  });

  it("keeps sticky indices aligned across multiple expanded groups", () => {
    const layout = buildHomeListLayout({
      groups: [makeGroup("alpha", 8), makeGroup("beta", 1)],
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });

    // header + 3 threads + show-more = 5 items, so beta's header is index 5.
    expect(layout.stickyHeaderIndices).toEqual([0, 5]);
    expect(layout.items[5]).toMatchObject({ type: "header", isFirst: false });
  });

  it("keeps older project groups behind one expandable shelf", () => {
    const recent = makeGroup("recent", 1);
    const older = makeGroup("older", 1);
    const collapsed = buildHomeListLayout({
      groups: [recent],
      olderGroups: [older],
      olderProjectsExpanded: false,
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });

    expect(itemTypes(collapsed.items)).toEqual(["header", "thread", "older-projects"]);
    expect(collapsed.items.at(-1)).toMatchObject({
      type: "older-projects",
      count: 1,
      expanded: false,
    });

    const expanded = buildHomeListLayout({
      groups: [recent],
      olderGroups: [older],
      olderProjectsExpanded: true,
      projectThreadPreviewCount: HOME_INITIAL_VISIBLE_THREADS,
      displayStates: displayStates({}),
    });
    expect(itemTypes(expanded.items)).toEqual([
      "header",
      "thread",
      "older-projects",
      "header",
      "thread",
    ]);
    expect(expanded.stickyHeaderIndices).toEqual([0, 3]);
  });
});

describe("resolveGroupedProjectSettledThreadKeys", () => {
  it("uses capability and lifecycle precedence before hiding a settled chat", () => {
    const group = makeGroup("alpha", 4);
    const explicitlySettled = {
      ...group.threads[0]!,
      settledOverride: "settled" as const,
      settledAt: "2026-06-02T00:00:00.000Z",
    };
    const pinnedSettled = {
      ...group.threads[1]!,
      settledOverride: "settled" as const,
      settledAt: "2026-06-02T00:00:00.000Z",
      pinnedAt: "2026-06-02T00:00:00.000Z",
    };
    const runningSettled = withSessionStatus(
      {
        ...group.threads[2]!,
        settledOverride: "settled" as const,
        settledAt: "2026-06-02T00:00:00.000Z",
      },
      "running",
    );
    const snoozedSettled = {
      ...group.threads[3]!,
      settledOverride: "settled" as const,
      settledAt: "2026-06-02T00:00:00.000Z",
      snoozedAt: "2026-06-02T00:00:00.000Z",
      snoozedUntil: "2026-06-04T00:00:00.000Z",
    };

    const supported = resolveGroupedProjectSettledThreadKeys({
      threads: [explicitlySettled, pinnedSettled, runningSettled, snoozedSettled],
      settlementEnvironmentIds: new Set([environmentId]),
      snoozeEnvironmentIds: new Set([environmentId]),
      changeRequestStateByKey: new Map(),
      now: "2026-06-03T00:00:00.000Z",
      autoSettleAfterDays: 3,
    });
    expect([...supported]).toEqual([`${environmentId}:${explicitlySettled.id}`]);

    const unsupported = resolveGroupedProjectSettledThreadKeys({
      threads: [explicitlySettled],
      settlementEnvironmentIds: new Set(),
      snoozeEnvironmentIds: new Set(),
      changeRequestStateByKey: new Map(),
      now: "2026-06-03T00:00:00.000Z",
      autoSettleAfterDays: 3,
    });
    expect(unsupported.size).toBe(0);
  });
});
