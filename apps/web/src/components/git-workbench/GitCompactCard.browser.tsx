import { createContext, useContext, useMemo, useState } from "react";
import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import "../../index.css";
import {
  WorkspaceCardDeck,
  type WorkspaceDeckCardDefinition,
} from "../workspace-deck/WorkspaceCardDeck";
import { GitCompactCard, type GitCompactStatus } from "./GitCompactCard";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";
import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import type {
  GitWorkbenchPanelProps,
  GitWorkbenchSnapshot,
  GitWorkbenchTabId,
} from "./GitWorkbench.types";

const crowdedStatus: GitCompactStatus = {
  additions: 7_358,
  ahead: 12,
  behind: 4,
  branch: "feature/a-very-long-branch-name-that-must-not-change-the-card-height",
  changeCount: 206,
  conflicts: 0,
  deletions: 791,
  kind: "changed",
  label: "Changes present",
  staged: 0,
  unstaged: 87,
  untracked: 119,
  updatedAtLabel: "Updated just now",
};

const workbenchSnapshot: GitWorkbenchSnapshot = {
  additions: 32,
  ahead: 2,
  behind: 0,
  branch: "feature/git-workbench-layout",
  changeCount: 4,
  conflicts: 0,
  deletions: 7,
  generatedAt: "2026-08-22T00:00:00.000Z",
  headOid: "0123456789abcdef0123456789abcdef01234567",
  lastCommit: {
    authoredAt: "2026-08-22T00:00:00.000Z",
    oid: "0123456789abcdef0123456789abcdef01234567",
    subject: "fix(web): keep the Git workbench content-sized",
  },
  repositoryState: "changed",
  staged: 1,
  stale: false,
  stateToken: "browser-layout-state",
  unstaged: 2,
  untracked: 1,
  upstream: "origin/feature/git-workbench-layout",
  worktreeRoot: "/workspace/better-t3code",
};

const crowdedBranches = Array.from({ length: 48 }, (_, index) => ({
  ahead: index % 4,
  behind: index % 3,
  current: index === 0,
  name: index === 0 ? "feature/git-workbench-layout" : `feature/browser-regression-${index}`,
  oid: `${String(index).padStart(2, "0")}23456789abcdef0123456789abcdef01234567`,
  remote: false,
  upstream: `origin/feature/browser-regression-${index}`,
}));

function gitPanelProps(
  activeTab: GitWorkbenchTabId,
  loading: boolean,
  onChangeTab: (tab: GitWorkbenchTabId) => void,
): GitWorkbenchPanelProps {
  return {
    activeTab,
    branches: crowdedBranches,
    changes: [],
    currentFile: null,
    history: {
      commits: [],
      hasMore: false,
      loading: false,
      snapshotOid: workbenchSnapshot.headOid,
    },
    insights: null,
    loading,
    onApplySelection: () => {},
    onCancelQueue: () => {},
    onChangeTab,
    onCreateBranch: () => {},
    onLoadCommit: () => {},
    onLoadMoreHistory: () => {},
    onOpenCurrentFile: () => {},
    onQueueWorkflow: () => {},
    onRestoreUndo: () => {},
    onRunOperation: () => {},
    onSaveCurrentFile: () => {},
    onSelectChange: () => {},
    onSelectCommit: () => {},
    onSwitchBranch: () => {},
    onUpdateRebasePlan: () => {},
    operation: null,
    queue: null,
    readOnly: false,
    selectedChangeId: null,
    selectedCommit: null,
    showTabs: false,
    snapshot: workbenchSnapshot,
    undoSnapshots: [],
  };
}

interface GitWorkbenchBrowserContextValue {
  readonly activeTab: GitWorkbenchTabId;
  readonly availableHeight: number;
  readonly loading: boolean;
  readonly setActiveTab: (tab: GitWorkbenchTabId) => void;
}

const GitWorkbenchBrowserContext = createContext<GitWorkbenchBrowserContextValue | null>(null);

function GitWorkbenchBrowserBody() {
  const context = useContext(GitWorkbenchBrowserContext);
  if (!context) throw new Error("GitWorkbenchBrowserBody requires its browser harness context.");
  return (
    <GitWorkbenchDrawerShell
      activeTab={context.activeTab}
      availableHeight={context.availableHeight}
      open
      repositoryLabel="better-t3code"
      onActiveTabChange={context.setActiveTab}
      onOpenChange={() => {}}
    >
      <GitWorkbenchPanel
        {...gitPanelProps(context.activeTab, context.loading, context.setActiveTab)}
      />
    </GitWorkbenchDrawerShell>
  );
}

const GIT_WORKBENCH_BROWSER_CARDS: readonly WorkspaceDeckCardDefinition<"git">[] = [
  {
    id: "git",
    label: "Git",
    renderBody: () => <GitWorkbenchBrowserBody />,
    renderPeek: () => null,
  },
];

function GitWorkbenchBrowserHarness({
  availableHeight,
  initialTab = "overview",
  loading = false,
}: {
  readonly availableHeight: number;
  readonly initialTab?: GitWorkbenchTabId;
  readonly loading?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<GitWorkbenchTabId>(initialTab);
  const contextValue = useMemo(
    () => ({ activeTab, availableHeight, loading, setActiveTab }),
    [activeTab, availableHeight, loading],
  );
  return (
    <main
      className="mx-auto w-[calc(100vw-2rem)] max-w-[86rem] bg-background text-foreground"
      data-git-browser-fixture="true"
    >
      <GitWorkbenchBrowserContext.Provider value={contextValue}>
        <WorkspaceCardDeck
          activeCard="git"
          cards={GIT_WORKBENCH_BROWSER_CARDS}
          compactHeightReferenceCard="git"
          expandedCard="git"
          resetKey="git-browser-layout"
          selectionMode="immediate"
          onRequestCard={() => {}}
        />
      </GitWorkbenchBrowserContext.Provider>
    </main>
  );
}

function verticalScrollOwners(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].filter((element) => {
    const overflowY = getComputedStyle(element).overflowY;
    return (
      (overflowY === "auto" || overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 1
    );
  });
}

function activeGitView(): HTMLElement {
  const view = document.querySelector<HTMLElement>("[data-git-workbench-view]");
  if (!view) throw new Error("The active Git workbench view was not rendered.");
  return view;
}

function dispatchPull(
  target: HTMLElement,
  input: { readonly endX: number; readonly endY: number; readonly pointerId: number },
) {
  const common = {
    bubbles: true,
    button: 0,
    clientX: 100,
    isPrimary: true,
    pointerId: input.pointerId,
    pointerType: "mouse",
  } as const;
  target.dispatchEvent(new PointerEvent("pointerdown", { ...common, clientY: 100 }));
  target.dispatchEvent(
    new PointerEvent("pointermove", {
      ...common,
      clientX: input.endX,
      clientY: input.endY,
    }),
  );
  target.dispatchEvent(
    new PointerEvent("pointerup", {
      ...common,
      clientX: input.endX,
      clientY: input.endY,
    }),
  );
}

describe("GitCompactCard browser layout", () => {
  it("fits the important repository facts inside the Chat-sized card without scrolling", async () => {
    await page.viewport(840, 620);
    document.documentElement.classList.add("dark");
    const mounted = await render(
      <div
        data-compact-card-fixture="true"
        style={{ height: 140, margin: "48px auto", width: "min(760px, calc(100vw - 40px))" }}
      >
        <GitCompactCard
          status={crowdedStatus}
          lastCommit={{
            ageLabel: "12 minutes ago",
            summary:
              "feat: preserve a deliberately long commit subject without growing the compact panel",
          }}
          quickAction={{ label: "Stage all & commit", onSelect: vi.fn() }}
          onExpand={vi.fn()}
        />
      </div>,
    );

    try {
      await vi.waitFor(() => {
        const card = document.querySelector<HTMLElement>(".git-compact-card")!;
        const content = document.querySelector<HTMLElement>(".git-compact-card__content")!;
        expect(Math.abs(card.getBoundingClientRect().height - 140)).toBeLessThanOrEqual(1);
        expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight);
        expect(getComputedStyle(content).overflowY).toBe("hidden");
      });

      const cardRect = document
        .querySelector<HTMLElement>(".git-compact-card")!
        .getBoundingClientRect();
      for (const selector of [
        ".git-compact-card__header",
        ".git-compact-card__summary",
        ".git-compact-card__footer",
        ".git-compact-card__header-action",
        ".git-compact-card__quick-action",
      ]) {
        const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(cardRect.top);
        expect(rect.bottom).toBeLessThanOrEqual(cardRect.bottom);
      }

      const cardText = document.querySelector<HTMLElement>(".git-compact-card")!.textContent;
      expect(cardText).toContain("206 changes");
      expect(cardText).toContain("87 unstaged");
      expect(cardText).toContain("119 untracked");
      expect(cardText).not.toContain("Recent activity");
      expect(cardText).not.toContain("Top contributors");
      expect(cardText).not.toContain("Code mix");

      const fixture = document.querySelector<HTMLElement>("[data-compact-card-fixture]")!;
      fixture.style.width = "360px";
      await vi.waitFor(() => {
        const summary = document.querySelector<HTMLElement>(".git-compact-card__summary")!;
        expect(summary.scrollWidth).toBeLessThanOrEqual(summary.clientWidth);
        expect(
          document.querySelector<HTMLElement>(".git-compact-card__content")!.scrollHeight,
        ).toBeLessThanOrEqual(
          document.querySelector<HTMLElement>(".git-compact-card__content")!.clientHeight,
        );
      });
    } finally {
      document.documentElement.classList.remove("dark");
      await mounted.unmount();
    }
  });

  it("opens only after an upward, vertically dominant pull", async () => {
    const onExpand = vi.fn();
    const mounted = await render(
      <div style={{ height: 192, width: 720 }}>
        <GitCompactCard status={crowdedStatus} onExpand={onExpand} />
      </div>,
    );

    try {
      const handle = document.querySelector<HTMLElement>("[data-git-compact-pull-handle]")!;
      dispatchPull(handle, { endX: 100, endY: 65, pointerId: 1 });
      dispatchPull(handle, { endX: 140, endY: 64, pointerId: 2 });
      expect(onExpand).not.toHaveBeenCalled();

      dispatchPull(handle, { endX: 104, endY: 60, pointerId: 3 });
      await vi.waitFor(() => expect(onExpand).toHaveBeenCalledTimes(1));
    } finally {
      await mounted.unmount();
    }
  });

  it("keeps the pull and keyboard expansion actions inert while blocked", async () => {
    const onExpand = vi.fn();
    const mounted = await render(
      <div style={{ height: 140, width: 720 }}>
        <GitCompactCard expansionBlocked status={crowdedStatus} onExpand={onExpand} />
      </div>,
    );

    try {
      const handle = document.querySelector<HTMLElement>("[data-git-compact-pull-handle]")!;
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand Git workbench"]',
      )!;
      expect(handle.getAttribute("aria-hidden")).toBe("true");
      expect(handle.tabIndex).toBe(-1);
      expect(button.disabled).toBe(true);

      dispatchPull(handle, { endX: 100, endY: 50, pointerId: 4 });
      button.click();
      expect(onExpand).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });
});

describe("Git workbench expanded browser layout", () => {
  it("shrinks a short Overview after a taller document view without retaining empty space", async () => {
    await page.viewport(1_400, 1_100);
    const mounted = await render(
      <GitWorkbenchBrowserHarness availableHeight={1_000} initialTab="branches" />,
    );

    try {
      await expect.element(page.getByRole("tab", { name: "Branches" })).toBeVisible();
      await vi.waitFor(() => {
        const view = activeGitView();
        expect(view.dataset.gitWorkbenchView).toBe("branches");
        expect(view.dataset.gitWorkbenchScrollRegion).toBe("document");
        expect(view.scrollHeight).toBeGreaterThan(view.clientHeight + 1);
      });
      const tallDrawerHeight = document
        .querySelector<HTMLElement>("[data-workspace-card-expanded-surface]")!
        .getBoundingClientRect().height;

      await page.getByRole("tab", { name: "Overview" }).click();

      await vi.waitFor(() => {
        const view = activeGitView();
        const overview = view.firstElementChild as HTMLElement | null;
        const drawer = document.querySelector<HTMLElement>(
          "[data-workspace-card-expanded-surface]",
        );
        const viewport = document.querySelector<HTMLElement>(".workspace-card-deck__viewport");
        expect(view.dataset.gitWorkbenchView).toBe("overview");
        expect(overview).not.toBeNull();
        expect(drawer).not.toBeNull();
        expect(viewport).not.toBeNull();
        if (!overview || !drawer || !viewport) return;

        const drawerHeight = drawer.getBoundingClientRect().height;
        expect(drawerHeight).toBeLessThan(tallDrawerHeight - 24);
        expect(Math.max(0, view.clientHeight - overview.scrollHeight)).toBeLessThanOrEqual(2);
        expect(
          Math.abs(viewport.getBoundingClientRect().height - drawerHeight),
        ).toBeLessThanOrEqual(1);
      });
    } finally {
      await mounted.unmount();
    }
  });

  it.each([
    [1_400, 1_100],
    [960, 1_000],
    [430, 932],
  ])("caps a tall document to one vertical scroll owner at %ipx", async (width, height) => {
    await page.viewport(width, height);
    const mounted = await render(
      <GitWorkbenchBrowserHarness availableHeight={520} initialTab="branches" />,
    );

    try {
      await expect.element(page.getByRole("tab", { name: "Branches" })).toBeVisible();
      await vi.waitFor(() => {
        const drawer = document.querySelector<HTMLElement>("[data-git-workbench-drawer]");
        const view = activeGitView();
        expect(drawer).not.toBeNull();
        if (!drawer) return;
        expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth + 1);
        expect(view.dataset.gitWorkbenchScrollRegion).toBe("document");
        expect(view.scrollHeight).toBeGreaterThan(view.clientHeight + 1);
        expect(verticalScrollOwners(drawer)).toEqual([view]);
      });
    } finally {
      await mounted.unmount();
    }
  });

  it.each([
    [1_400, 1_100],
    [960, 1_000],
    [430, 932],
  ])("pins the refresh overlay above scrolling Git content at %ipx", async (width, height) => {
    await page.viewport(width, height);
    const mounted = await render(
      <GitWorkbenchBrowserHarness availableHeight={520} initialTab="branches" loading />,
    );

    try {
      await expect.element(page.getByText("Refreshing Git", { exact: true })).toBeVisible();
      const overlay = document.querySelector<HTMLElement>(
        '[data-git-workbench-refresh-overlay="true"]',
      );
      const frame = document.querySelector<HTMLElement>('[data-git-workbench-view-frame="true"]');
      const view = activeGitView();
      expect(overlay).not.toBeNull();
      expect(frame).not.toBeNull();
      if (!overlay || !frame) return;

      await vi.waitFor(() => expect(view.scrollHeight).toBeGreaterThan(view.clientHeight + 1));
      const overlayBefore = overlay.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const content = view.firstElementChild as HTMLElement | null;
      expect(overlay.getAttribute("role")).toBe("status");
      expect(getComputedStyle(overlay).pointerEvents).toBe("none");
      expect(overlayBefore.top).toBeGreaterThanOrEqual(frameRect.top);
      expect(overlayBefore.top - frameRect.top).toBeLessThanOrEqual(20);
      expect(frameRect.right - overlayBefore.right).toBeGreaterThanOrEqual(0);
      expect(frameRect.right - overlayBefore.right).toBeLessThanOrEqual(20);
      expect(content).not.toBeNull();
      if (content) {
        expect(content.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          overlayBefore.bottom - 1,
        );
      }

      view.scrollTop = Math.max(1, Math.floor((view.scrollHeight - view.clientHeight) / 2));
      view.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(view.scrollTop).toBeGreaterThan(0));

      const overlayAfter = overlay.getBoundingClientRect();
      expect(Math.abs(overlayAfter.top - overlayBefore.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(overlayAfter.right - overlayBefore.right)).toBeLessThanOrEqual(1);
    } finally {
      await mounted.unmount();
    }
  });
});
