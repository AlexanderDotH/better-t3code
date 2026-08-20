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
