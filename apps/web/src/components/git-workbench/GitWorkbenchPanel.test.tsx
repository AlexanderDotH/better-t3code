import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import type { GitWorkbenchPanelProps } from "./GitWorkbench.types";

const baseProps = (): GitWorkbenchPanelProps => ({
  activeTab: "overview",
  branches: [{ current: true, name: "main", oid: "a".repeat(40), remote: false }],
  changes: [],
  currentFile: null,
  history: { commits: [], hasMore: false, loading: false, snapshotOid: "a".repeat(40) },
  insights: {
    activity: [{ count: 3, date: "2026-08-01" }],
    codeMix: [{ color: "#3178c6", files: 40, label: "TypeScript", percent: 80 }],
    contributors: [{ commits: 23, identity: "author-1", name: "Alex" }],
    coverage: { sampledCommits: 23, sampledFiles: 50, truncated: false },
  },
  loading: false,
  onApplySelection: vi.fn(),
  onCancelQueue: vi.fn(),
  onChangeTab: vi.fn(),
  onCreateBranch: vi.fn(),
  onLoadCommit: vi.fn(),
  onLoadMoreHistory: vi.fn(),
  onOpenCurrentFile: vi.fn(),
  onQueueWorkflow: vi.fn(),
  onRestoreUndo: vi.fn(),
  onRunOperation: vi.fn(),
  onSaveCurrentFile: vi.fn(),
  onSelectChange: vi.fn(),
  onSelectCommit: vi.fn(),
  onSwitchBranch: vi.fn(),
  onUpdateRebasePlan: vi.fn(),
  operation: null,
  queue: null,
  readOnly: false,
  selectedChangeId: null,
  selectedCommit: null,
  snapshot: {
    ahead: 1,
    behind: 0,
    branch: "main",
    changeCount: 3,
    conflicts: 0,
    generatedAt: "2026-08-02T08:30:00.000Z",
    headOid: "a".repeat(40),
    lastCommit: { authoredAt: "2026-08-02T07:00:00.000Z", oid: "a".repeat(40), subject: "Ship it" },
    repositoryState: "changed",
    staged: 2,
    stale: false,
    stateToken: "state-1",
    unstaged: 1,
    untracked: 0,
    upstream: "origin/main",
    worktreeRoot: "/repo",
  },
  undoSnapshots: [],
});

describe("GitWorkbenchPanel", () => {
  it("renders all five accessible tabs and truthful repository status", () => {
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...baseProps()} />);

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    for (const label of ["Overview", "Changes", "History", "Branches", "Operations"]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(markup).toContain("Changed");
    expect(markup).toContain("Updated");
    expect(markup).not.toContain("health score");
  });

  it("provides semantic alternatives for activity, contributors, and code mix", () => {
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...baseProps()} />);

    expect(markup).toContain('aria-label="Repository activity"');
    expect(markup).toContain("3 commits on 2026-08-01");
    expect(markup).toContain("Alex");
    expect(markup).toContain("23 commits");
    expect(markup).toContain("TypeScript");
    expect(markup).toContain("80%");
  });

  it("shows repository totals and pull-request state without inventing a health score", () => {
    const props = baseProps();
    props.snapshot = {
      ...props.snapshot!,
      additions: 12,
      deletions: 5,
      pullRequest: {
        number: 42,
        status: "open",
        title: "Git workbench",
        url: "https://example.test/pr/42",
      },
    };
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);

    expect(markup).toContain("+12");
    expect(markup).toContain("-5");
    expect(markup).toContain("PR #42");
    expect(markup).toContain("Git workbench");
    expect(markup).not.toContain("health score");
  });

  it("renders historical content as read-only and offers the current worktree explicitly", () => {
    const props = baseProps();
    props.activeTab = "history";
    props.selectedCommit = {
      author: "Alex",
      authoredAt: "2026-08-01T10:00:00.000Z",
      body: "Details",
      committedAt: "2026-08-01T10:01:00.000Z",
      committer: "Alex",
      files: [{ additions: 2, binary: false, deletions: 1, kind: "modified", path: "src/app.ts" }],
      oid: "b".repeat(40),
      parents: ["a".repeat(40)],
      subject: "Historical commit",
    };

    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);

    expect(markup).toContain("Historical files are read-only");
    expect(markup).toContain("Open current working tree version");
    expect(markup).toContain('aria-label="Filter history by branch"');
    expect(markup).toContain("main");
    expect(markup).not.toContain("Save historical file");
  });

  it("marks every mutation unavailable for read-only credentials", () => {
    const props = baseProps();
    props.activeTab = "branches";
    props.readOnly = true;

    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);

    expect(markup).toContain("Read-only access");
    expect(markup).toContain("disabled");
  });

  it("offers local and remote refs as rebase targets without switching a remote ref directly", () => {
    const props = baseProps();
    props.activeTab = "branches";
    props.branches = [
      ...props.branches,
      { current: false, name: "origin/main", oid: null, remote: true },
    ];

    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);

    expect(markup).toContain("origin/main");
    expect(markup).toContain("Rebase onto");
    expect(markup).toContain("Interactive…");
    expect(markup).not.toContain(">Switch</button>");
  });

  it("renders controlled commit-message editing for reword steps", () => {
    const props = baseProps();
    props.activeTab = "operations";
    props.rebasePlan = [
      {
        commitId: "b".repeat(40),
        id: "reword-1",
        kind: "reword",
        message: "Clarify workbench behavior",
        subject: "Original subject",
      },
    ];
    props.rebaseUpstreamRef = "a".repeat(40);

    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);

    expect(markup).toContain('aria-label="New commit message for Original subject"');
    expect(markup).toContain('value="Clarify workbench behavior"');
  });

  it("defers tab semantics to an embedding drawer when tabs are hidden", () => {
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...baseProps()} showTabs={false} />);

    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).toContain('aria-label="overview Git view"');
  });

  it("lets a short overview determine the workbench height", () => {
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...baseProps()} showTabs={false} />);
    const workbench = markup.match(/<section[^>]*data-git-workbench-layout="content"[^>]*>/)?.[0];
    const activeView = markup.match(/<div[^>]*data-git-workbench-view="overview"[^>]*>/)?.[0];

    expect(workbench).toContain("h-fit");
    expect(workbench).toContain("max-h-full");
    expect(workbench).toContain("overflow-hidden");
    expect(workbench).not.toContain("size-full");
    expect(activeView).toContain('data-git-workbench-scroll-region="document"');
    expect(activeView).toContain("overflow-auto");
  });

  it("keeps refresh status fixed above the active view and reserves space below it", () => {
    const props = baseProps();
    props.loading = true;
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);
    const activeView = markup.match(/<div[^>]*data-git-workbench-view="overview"[^>]*>/)?.[0];
    const overlay = markup.match(/<div[^>]*data-git-workbench-refresh-overlay="true"[^>]*>/)?.[0];

    expect(activeView).toContain('data-git-workbench-refresh-inset="true"');
    expect(activeView).toContain("mt-10");
    expect(overlay).toContain("pointer-events-none");
    expect(overlay).toContain("absolute");
    expect(overlay).toContain("top-3");
    expect(overlay).toContain("right-3");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Refreshing Git");
    expect(markup).toContain("motion-reduce:animate-none");
  });

  it("leaves Changes and History outer views unscrollable for their bounded inner regions", () => {
    for (const activeTab of ["changes", "history"] as const) {
      const props = baseProps();
      props.activeTab = activeTab;
      const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);
      const activeView = markup.match(
        new RegExp(`<div[^>]*data-git-workbench-view="${activeTab}"[^>]*>`),
      )?.[0];

      expect(activeView).toContain('data-git-workbench-scroll-region="nested"');
      expect(activeView).toContain("overflow-hidden");
      expect(activeView).not.toContain("overflow-auto");
    }
  });

  it("keeps loading and unavailable states naturally sized", () => {
    const loadingProps = baseProps();
    loadingProps.loading = true;
    loadingProps.snapshot = null;
    const loadingMarkup = renderToStaticMarkup(<GitWorkbenchPanel {...loadingProps} />);
    const unavailableProps = baseProps();
    unavailableProps.snapshot = null;
    const unavailableMarkup = renderToStaticMarkup(<GitWorkbenchPanel {...unavailableProps} />);

    const loading = loadingMarkup.match(/<div[^>]*data-git-workbench-state="loading"[^>]*>/)?.[0];
    const unavailable = unavailableMarkup.match(
      /<div[^>]*data-git-workbench-state="unavailable"[^>]*>/,
    )?.[0];
    expect(loading).toContain("min-h-48");
    expect(loading).toContain("w-full");
    expect(loading).not.toContain("size-full");
    expect(unavailable).toContain("min-h-48");
    expect(unavailable).toContain("w-full");
    expect(unavailable).not.toContain("size-full");
  });

  it("preserves the commit list as History's virtualized scroll owner", () => {
    const props = baseProps();
    props.activeTab = "history";
    const markup = renderToStaticMarkup(<GitWorkbenchPanel {...props} />);
    const history = markup.match(/<div[^>]*data-git-history-layout="content"[^>]*>/)?.[0];
    const commits = markup.match(/<div[^>]*data-git-history-scroll-region="commits"[^>]*>/)?.[0];
    const details = markup.match(/<main[^>]*data-git-history-scroll-region="details"[^>]*>/)?.[0];

    expect(history).toContain("h-fit");
    expect(history).toContain("max-h-full");
    expect(history).toContain("overflow-hidden");
    expect(history).not.toContain("size-full");
    expect(commits).toContain("min-h-0");
    expect(commits).toContain("flex-1");
    expect(commits).toContain("overflow-auto");
    expect(details).toContain("overflow-auto");
  });
});
