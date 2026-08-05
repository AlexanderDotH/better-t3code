import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { GitChangesPanel } from "./GitChangesPanel";
import { GitConflictPanel } from "./GitConflictPanel";
import { GitCurrentFilePanel } from "./GitCurrentFilePanel";
import { GitOperationsPanel } from "./GitOperationsPanel";
import type { GitWorkbenchChange } from "./GitWorkbench.types";

const selectedChange: GitWorkbenchChange = {
  additions: 2,
  binary: false,
  deletions: 1,
  diff: {
    hunks: [
      {
        header: "@@ -1 +1 @@",
        id: "hunk-1",
        lines: [
          {
            content: "-old",
            id: "line-1",
            kind: "deletion",
            newLine: null,
            oldLine: 1,
            selectable: true,
          },
          {
            content: "+new",
            id: "line-2",
            kind: "addition",
            newLine: 1,
            oldLine: null,
            selectable: true,
          },
        ],
      },
    ],
    patchId: "patch-1",
    source: "worktree",
    stale: true,
  },
  id: "src/app.ts",
  kind: "modified",
  modeChanged: false,
  path: "src/app.ts",
  staged: false,
  submodule: false,
  unstaged: true,
  untracked: false,
};

describe("GitChangesPanel", () => {
  it("shows grouped changes, line controls, whole-file actions, and stale refresh", () => {
    const markup = renderToStaticMarkup(
      <GitChangesPanel
        changes={[selectedChange]}
        currentFile={null}
        onApplySelection={vi.fn()}
        onOpenCurrentFile={vi.fn()}
        onRefreshChange={vi.fn()}
        onSaveCurrentFile={vi.fn()}
        onSelectChange={vi.fn()}
        readOnly={false}
        selectedChangeId={selectedChange.id}
        stateToken="state-1"
      />,
    );

    expect(markup).toContain("Unstaged");
    expect(markup).toContain("Select hunk @@ -1 +1 @@");
    expect(markup).toContain("Select deletion line 1");
    expect(markup).toContain("The file changed after this diff loaded");
    expect(markup).toContain("Refresh diff");
    expect(markup).toContain("Stage file");
    expect(markup).toContain("Unified");
    expect(markup).toContain("Split");
  });
});

describe("GitConflictPanel", () => {
  it("labels base, ours, theirs, and the editable current result", () => {
    const markup = renderToStaticMarkup(
      <GitConflictPanel
        change={{
          ...selectedChange,
          conflict: "both-modified",
          conflictVersions: { base: "base", ours: "ours", theirs: "theirs" },
        }}
      />,
    );

    expect(markup).toContain("Base");
    expect(markup).toContain("Ours");
    expect(markup).toContain("Theirs");
    expect(markup).toContain("Current result");
  });
});

describe("GitCurrentFilePanel", () => {
  it("states that active-turn edits are buffered and keeps the expected revision at the boundary", () => {
    const markup = renderToStaticMarkup(
      <GitCurrentFilePanel
        file={{
          baseContent: "one",
          content: "two",
          loading: false,
          path: "src/app.ts",
          revision: "revision-2",
          saveState: "buffered",
        }}
        onSave={vi.fn()}
        readOnly={false}
      />,
    );

    expect(markup).toContain("buffered until the active agent turn settles");
    expect(markup).toContain("Current worktree file");
  });

  it("offers all three conflict choices without making the historical surface editable", () => {
    const markup = renderToStaticMarkup(
      <GitCurrentFilePanel
        file={{
          baseContent: "base",
          content: "mine",
          loading: false,
          path: "src/app.ts",
          revision: "revision-3",
          saveState: "conflict",
          serverContent: "agent",
        }}
        onSave={vi.fn()}
        readOnly={false}
      />,
    );

    expect(markup).toContain("Keep agent version");
    expect(markup).toContain("Keep my version");
    expect(markup).toContain("Save merged result");
  });
});

describe("GitOperationsPanel", () => {
  it("shows merge topology, queue semantics, force-with-lease, and local undo limits", () => {
    const markup = renderToStaticMarkup(
      <GitOperationsPanel
        forcePushTarget={{ expectedRemoteOid: "a".repeat(40), remoteRef: "refs/heads/main" }}
        onCancelQueue={vi.fn()}
        onQueueWorkflow={vi.fn()}
        onRestoreUndo={vi.fn()}
        onRunOperation={vi.fn()}
        onUpdateRebasePlan={vi.fn()}
        operation={null}
        queue={null}
        readOnly={false}
        rebasePlan={[
          { id: "base", kind: "label", label: "onto" },
          { commitId: "b".repeat(40), id: "pick", kind: "pick", subject: "Feature" },
          { id: "feature", kind: "label", label: "feature" },
          { id: "reset", kind: "reset", label: "onto" },
          {
            commitId: "c".repeat(40),
            id: "merge",
            kind: "merge",
            labels: ["feature"],
            subject: "Merge feature",
          },
        ]}
        undoSnapshots={[
          {
            createdAt: "2026-08-02T10:00:00.000Z",
            id: "undo-1",
            label: "Before rebase",
            refName: "main",
          },
        ]}
      />,
    );

    expect(markup).toContain("Labels, resets, and merges preserve topology");
    expect(markup).toContain("One durable workflow is kept per worktree");
    expect(markup).toContain("Uses force-with-lease");
    expect(markup).toContain("cannot restore remote history");
    expect(markup).toContain("Restore…");
  });

  it("lets a stale queued workflow be reviewed, retried, replaced, or cancelled", () => {
    const markup = renderToStaticMarkup(
      <GitOperationsPanel
        onCancelQueue={vi.fn()}
        onEditQueue={vi.fn()}
        onQueueWorkflow={vi.fn()}
        onRestoreUndo={vi.fn()}
        onRetryQueue={vi.fn()}
        onRunOperation={vi.fn()}
        onUpdateRebasePlan={vi.fn()}
        operation={null}
        queue={{
          id: "queue-1",
          label: "Commit and push",
          plan: {
            kind: "delivery",
            stage: { mode: "staged" },
            push: true,
            createPullRequest: false,
          },
          revision: 1,
          staleReasons: ["HEAD moved"],
          status: "needs-review",
        }}
        readOnly={false}
        rebasePlan={[]}
        undoSnapshots={[]}
      />,
    );

    expect(markup).toContain("Review &amp; edit");
    expect(markup).toContain("Retry validation");
    expect(markup).toContain("Replace workflow…");
    expect(markup).toContain("Cancel workflow");
  });
});
