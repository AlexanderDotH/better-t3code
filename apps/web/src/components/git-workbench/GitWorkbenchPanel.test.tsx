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
    expect(markup).toContain("Open current worktree version");
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
});
