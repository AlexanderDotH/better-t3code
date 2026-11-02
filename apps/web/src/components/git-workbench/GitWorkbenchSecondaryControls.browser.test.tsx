import { useState } from "react";
import { act, render, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import { GitWorkbenchPanel } from "./GitWorkbenchPanel";
import type {
  GitOperationState,
  GitWorkbenchChange,
  GitWorkbenchPanelProps,
} from "./GitWorkbench.types";

const headOid = "a".repeat(40);
const targetOid = "b".repeat(40);
const operation: GitOperationState = {
  canAbort: true,
  canContinue: true,
  canSkip: true,
  conflicts: [],
  detail: "Resolve and stage the remaining files.",
  kind: "rebase",
  startedAt: "2026-08-02T10:00:00Z",
};

function change(path: string, conflicted = false): GitWorkbenchChange {
  return {
    additions: 1,
    binary: false,
    deletions: 1,
    ...(conflicted ? { conflict: "both-modified" as const } : {}),
    diff: {
      hunks: [
        {
          header: "@@ -1 +1 @@",
          id: path + "-hunk",
          lines: [
            {
              content: "old",
              id: path + "-old",
              kind: "deletion",
              newLine: null,
              oldLine: 1,
              selectable: true,
            },
            {
              content: "new",
              id: path + "-new",
              kind: "addition",
              newLine: 1,
              oldLine: null,
              selectable: true,
            },
          ],
        },
      ],
      patchId: path + "-patch",
      source: "worktree",
    },
    id: path + (conflicted ? "::conflict" : "::worktree"),
    kind: conflicted ? "conflicted" : "modified",
    modeChanged: false,
    path,
    staged: false,
    submodule: false,
    unstaged: true,
    untracked: false,
  };
}

function fixture(): GitWorkbenchPanelProps {
  return {
    activeTab: "changes",
    branches: [
      { current: true, name: "main", oid: headOid, remote: false },
      { current: false, name: "feature", oid: targetOid, remote: false },
      { current: false, name: "origin/main", oid: targetOid, remote: true },
    ],
    changes: [change("src/app.ts")],
    currentFile: null,
    history: { commits: [], hasMore: false, loading: false, snapshotOid: headOid },
    insights: null,
    loading: false,
    commitComposer: <footer>Commit footer</footer>,
    onApplySelection: vi.fn(),
    onCancelQueue: vi.fn(),
    onChangeTab: vi.fn(),
    onCloseCurrentFile: vi.fn(),
    onCreateBranch: vi.fn(),
    onEditQueue: vi.fn(),
    onLoadCommit: vi.fn(),
    onLoadMoreHistory: vi.fn(),
    onOpenCurrentFile: vi.fn(),
    onPrepareInteractiveRebase: vi.fn(),
    onQueueWorkflow: vi.fn(),
    onRestoreUndo: vi.fn(),
    onRetryQueue: vi.fn(),
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
      changeCount: 1,
      conflicts: 0,
      generatedAt: "2026-08-02T08:30:00Z",
      headOid,
      lastCommit: null,
      repositoryState: "changed",
      staged: 0,
      stale: false,
      stateToken: "state-1",
      unstaged: 1,
      untracked: 0,
      upstream: "origin/main",
      worktreeRoot: "/repo",
    },
    undoSnapshots: [],
  };
}

function Workbench({ model }: { readonly model: GitWorkbenchPanelProps }) {
  const [activeTab, setActiveTab] = useState(model.activeTab);
  const [selectedChangeId, setSelectedChangeId] = useState(model.selectedChangeId);
  const [editorPath, setEditorPath] = useState(model.editorPath ?? null);
  return (
    <GitWorkbenchPanel
      {...model}
      activeTab={activeTab}
      editorPath={editorPath}
      onChangeTab={(tab) => {
        model.onChangeTab(tab);
        setActiveTab(tab);
      }}
      onCloseCurrentFile={() => {
        model.onCloseCurrentFile?.();
        setEditorPath(null);
      }}
      onOpenCurrentFile={(path) => {
        model.onOpenCurrentFile(path);
        setEditorPath(path);
      }}
      onSelectChange={(id) => {
        model.onSelectChange(id);
        setSelectedChangeId(id);
        setEditorPath(null);
        setActiveTab("changes");
      }}
      selectedChangeId={selectedChangeId}
    />
  );
}

function workbenchControls(screen: Screen) {
  const container = screen.container;
  async function renderWorkbench(model: GitWorkbenchPanelProps) {
    await screen.rerender(<Workbench model={{ ...model }} />);
  }

  function button(label: string, within: ParentNode = container): HTMLButtonElement {
    const found = [...within.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    );
    if (!found) throw new Error("Missing button: " + label);
    return found;
  }

  async function click(label: string, within: ParentNode = container) {
    await act(() => button(label, within).click());
  }

  async function tab(id: string) {
    const target = container.querySelector<HTMLButtonElement>("#git-workbench-tab-" + id);
    if (!target) throw new Error("Missing tab: " + id);
    await act(() => target.click());
  }

  function field<T extends HTMLInputElement | HTMLSelectElement>(
    label: string,
    tag: "input" | "select",
  ): T {
    const labelled = container.querySelector<T>(tag + '[aria-label="' + label + '"]');
    if (labelled) return labelled;
    const wrapped = [...container.querySelectorAll("label")].find((item) =>
      item.textContent?.trim().startsWith(label),
    );
    const found = wrapped?.querySelector<T>(tag);
    if (!found) throw new Error("Missing field: " + label);
    return found;
  }

  async function select(label: string, value: string) {
    const element = field<HTMLSelectElement>(label, "select");
    await act(() => {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function input(label: string, value: string) {
    const element = field<HTMLInputElement>(label, "input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter is unavailable.");
    await act(() => {
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function dialog() {
    const element = container.querySelector<HTMLElement>('[role="alertdialog"]');
    if (!element) throw new Error("Confirmation did not open.");
    return element;
  }

  async function chooseAdvanced(action: string) {
    await tab("operations");
    await select("Choose an advanced action", action);
  }

  return {
    render: renderWorkbench,
    button,
    click,
    tab,
    field,
    select,
    input,
    dialog,
    chooseAdvanced,
  };
}

describe("secondary Git controls", () => {
  it("keeps all five sections reachable and makes branch creation/switching the only branch actions", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    await workbench.render(model);
    expect(
      [...screen.container.querySelectorAll('[role="tab"]')].map((item) => item.textContent),
    ).toEqual(["Changes", "History", "Branches", "Repository", "Advanced"]);
    expect(screen.container.textContent).not.toContain("Top contributors");
    await workbench.tab("branches");
    expect(screen.container.textContent).toContain("origin/main");
    expect(screen.container.textContent).not.toContain("Rebase onto");
    expect(screen.container.textContent).not.toContain("Reset current branch");
    expect(screen.container.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(workbench.button("Create").disabled).toBe(true);
    await workbench.input("New branch name", "  feature/new  ");
    await workbench.click("Create");
    expect(model.onCreateBranch).toHaveBeenCalledWith("feature/new");
    expect(workbench.field<HTMLInputElement>("New branch name", "input").value).toBe("");
    await workbench.click("Switch");
    expect(model.onSwitchBranch).toHaveBeenCalledWith("feature");
    await workbench.tab("operations");
    expect(screen.container.textContent).toContain("Choose an advanced action");
    expect(screen.container.textContent).toContain("Run after active turn");
    expect(screen.container.textContent).toContain("Undo snapshots");
    expect(screen.container.querySelector("#reset-heading")).toBeNull();
    expect(screen.container.querySelector("#rebase-heading")).toBeNull();
    expect(model.onRunOperation).not.toHaveBeenCalled();
  });

  it("opens a soft reset only after an explicit action choice", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    await workbench.render(model);
    await workbench.chooseAdvanced("reset");
    expect(workbench.field<HTMLInputElement>("Target commit", "input").value).toBe(headOid);
    expect(model.onRunOperation).not.toHaveBeenCalled();
    await workbench.click("Reset soft");
    expect(model.onRunOperation).toHaveBeenCalledExactlyOnceWith({
      kind: "reset",
      mode: "soft",
      oid: headOid,
    });
    expect(screen.container.querySelector('[role="alertdialog"]')).toBeNull();
    await workbench.select("Choose an advanced action", "");
    expect(screen.container.querySelector("#reset-heading")).toBeNull();
  });

  it.each(["mixed", "hard"] as const)("retains the %s reset confirmation", async (mode) => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    await workbench.render(model);
    await workbench.chooseAdvanced("reset");
    await workbench.input("Target commit", " " + targetOid + " ");
    await workbench.select("Reset mode", mode);
    await workbench.click("Reset " + mode + "…");
    expect(model.onRunOperation).not.toHaveBeenCalled();
    expect(workbench.dialog().textContent).toContain("A local undo snapshot is created first");
    if (mode === "hard") {
      expect(workbench.button("Reset hard", workbench.dialog()).disabled).toBe(true);
      await workbench.input("Type RESET to confirm", "reset");
      expect(workbench.button("Reset hard", workbench.dialog()).disabled).toBe(true);
      await workbench.input("Type RESET to confirm", "RESET");
    }
    await workbench.click("Reset " + mode, workbench.dialog());
    expect(model.onRunOperation).toHaveBeenCalledExactlyOnceWith({
      kind: "reset",
      mode,
      oid: targetOid,
    });
  });

  it("requires a deliberate force-with-lease choice and blocks an open confirmation when state becomes stale", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.forcePushTarget = { expectedRemoteOid: headOid, remoteRef: "refs/heads/main" };
    await workbench.render(model);
    await workbench.tab("operations");
    expect(screen.container.textContent).not.toContain("Uses force-with-lease");
    await workbench.select("Choose an advanced action", "force-with-lease");
    expect(screen.container.textContent).toContain("Uses force-with-lease against refs/heads/main");
    expect(screen.container.textContent).toContain("cannot restore remote history");
    await workbench.click("Force with lease…");
    expect(workbench.button("Force with lease", workbench.dialog()).disabled).toBe(true);
    await workbench.input("Type FORCE to confirm", "FORCE");
    model.snapshot = { ...model.snapshot!, stale: true };
    await workbench.render(model);
    expect(workbench.button("Force with lease", workbench.dialog()).disabled).toBe(true);
    await workbench.click("Force with lease", workbench.dialog());
    expect(model.onRunOperation).not.toHaveBeenCalled();
    model.snapshot = { ...model.snapshot!, stale: false };
    await workbench.render(model);
    await workbench.click("Force with lease", workbench.dialog());
    expect(model.onRunOperation).toHaveBeenCalledExactlyOnceWith({
      kind: "force-with-lease",
      expectedRemoteOid: headOid,
      remoteRef: "refs/heads/main",
    });
  });

  it("offers local and remote rebase targets, and waits for the plan matching the selected target", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.rebasePreparedTarget = "origin/main";
    model.rebaseUpstreamRef = headOid;
    model.rebasePlan = [{ commitId: targetOid, id: "pick", kind: "pick", subject: "Feature" }];
    await workbench.render(model);
    await workbench.chooseAdvanced("rebase");
    const targets = [...workbench.field<HTMLSelectElement>("Rebase onto", "select").options].map(
      (item) => item.value,
    );
    expect(targets).toContain("feature");
    expect(targets).toContain("origin/main");
    expect(targets).not.toContain("main");
    expect(screen.container.textContent).toContain("Start rebase");
    await workbench.select("Rebase onto", "feature");
    expect(screen.container.textContent).not.toContain("Start rebase");
    await workbench.click("Prepare interactive rebase");
    expect(model.onPrepareInteractiveRebase).toHaveBeenCalledWith("feature");
    await workbench.render({ ...model, rebasePreparedTarget: "origin/main" });
    expect(screen.container.textContent).not.toContain("Start rebase");
    model.rebasePreparedTarget = "feature";
    model.rebaseUpstreamRef = targetOid;
    await workbench.render(model);
    await workbench.click("Start rebase");
    expect(model.onRunOperation).toHaveBeenCalledWith({
      kind: "start-interactive-rebase",
      nodes: model.rebasePlan,
      upstreamRef: targetOid,
    });
    await workbench.click("Rebase onto");
    expect(model.onRunOperation).toHaveBeenLastCalledWith({
      kind: "guided-rebase",
      branch: "feature",
    });
  });

  it("preserves merge topology and controlled reword messages in an explicitly opened plan", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.rebasePreparedTarget = "origin/main";
    model.rebaseUpstreamRef = headOid;
    model.rebasePlan = [
      { id: "base", kind: "label", label: "onto" },
      {
        commitId: targetOid,
        id: "reword",
        kind: "reword",
        message: "Original subject",
        subject: "Original subject",
      },
      { id: "feature", kind: "label", label: "feature" },
      { id: "reset", kind: "reset", label: "onto" },
      {
        commitId: "c".repeat(40),
        id: "merge",
        kind: "merge",
        labels: ["feature"],
        subject: "Merge feature",
      },
    ];
    await workbench.render(model);
    await workbench.chooseAdvanced("rebase");
    expect(screen.container.textContent).toContain("Labels, resets, and merges preserve topology");
    expect(screen.container.textContent).toContain("Merge feature");
    await workbench.input("New commit message for Original subject", "Clarify the feature");
    const nodes = vi.mocked(model.onUpdateRebasePlan).mock.calls.at(-1)![0];
    model.rebasePlan = nodes;
    await workbench.render(model);
    expect(
      workbench.field<HTMLInputElement>("New commit message for Original subject", "input").value,
    ).toBe("Clarify the feature");
    await workbench.click("Start rebase");
    expect(model.onRunOperation).toHaveBeenLastCalledWith({
      kind: "start-interactive-rebase",
      nodes,
      upstreamRef: headOid,
    });
  });

  it("keeps queue review, retry, replacement, cancellation, and confirmed undo available", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.queue = {
      id: "queue-1",
      label: "Commit and push",
      plan: { kind: "delivery", stage: { mode: "staged" }, push: true, createPullRequest: false },
      revision: 1,
      staleReasons: ["HEAD moved"],
      status: "needs-review",
    };
    model.undoSnapshots = [
      { id: "undo-1", createdAt: "2026-08-02T10:00:00Z", label: "Before rebase", refName: "main" },
    ];
    await workbench.render(model);
    await workbench.tab("operations");
    expect(screen.container.textContent).toContain("HEAD moved");
    await workbench.click("Review and edit");
    await workbench.select("Commit selection", "all");
    await workbench.click("Save workflow");
    expect(model.onEditQueue).toHaveBeenCalledWith("queue-1", {
      kind: "delivery",
      stage: { mode: "all" },
      push: true,
      createPullRequest: false,
    });
    await workbench.click("Retry validation");
    expect(model.onRetryQueue).toHaveBeenCalledWith("queue-1");
    await workbench.click("Replace workflow…");
    expect(model.onQueueWorkflow).not.toHaveBeenCalled();
    await workbench.click("Replace workflow", workbench.dialog());
    expect(model.onQueueWorkflow).toHaveBeenCalledWith({ kind: "stage-all-and-commit" });
    await workbench.click("Cancel workflow");
    expect(model.onCancelQueue).toHaveBeenCalledWith("queue-1");
    await workbench.click("Restore snapshot…");
    expect(workbench.dialog().textContent).toContain("Restoring cannot undo remote changes");
    expect(workbench.button("Restore snapshot", workbench.dialog()).disabled).toBe(true);
    await workbench.input("Type RESTORE to confirm", "RESTORE");
    await workbench.click("Restore snapshot", workbench.dialog());
    expect(model.onRestoreUndo).toHaveBeenCalledWith("undo-1");
  });

  it.each(["readOnly", "stale", "loading", "running"] as const)(
    "blocks mutations during %s while leaving tabs and conflict diffs navigable",
    async (restriction) => {
      await using screen = await render(null, { router: false });
      const workbench = workbenchControls(screen);
      const model = fixture();
      model.operation = { ...operation, conflicts: ["src/app.ts"] };
      model.changes = [change("src/app.ts", true)];
      if (restriction === "readOnly") model.readOnly = true;
      if (restriction === "stale") model.snapshot = { ...model.snapshot!, stale: true };
      if (restriction === "loading") model.loading = true;
      if (restriction === "running")
        model.operationProgress = { label: "Updating Git", status: "running" };
      await workbench.render(model);
      expect(workbench.button("Skip").disabled).toBe(true);
      expect(workbench.button("Abort…").disabled).toBe(true);
      await workbench.chooseAdvanced("reset");
      expect(workbench.button("Reset soft").disabled).toBe(true);
      await workbench.tab("branches");
      expect(workbench.button("Switch").disabled).toBe(true);
      expect(workbench.field<HTMLInputElement>("New branch name", "input").disabled).toBe(true);
      await workbench.tab("changes");
      const conflicts = workbench.field<HTMLSelectElement>("Conflicts", "select");
      expect(conflicts.disabled).toBe(false);
      await workbench.select("Conflicts", "src/app.ts");
      expect(model.onSelectChange).toHaveBeenCalledWith("src/app.ts::conflict");
      expect(model.onOpenCurrentFile).not.toHaveBeenCalled();
      expect(model.onRunOperation).not.toHaveBeenCalled();
    },
  );
});

describe("operation recovery in Changes", () => {
  it("returns from Edit to the selected conflict Diff without opening another editor or moving the commit footer", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.readOnly = true;
    model.editorPath = "src/one.ts";
    model.operation = { ...operation, conflicts: ["src/one.ts", "src/two.ts"] };
    model.changes = [change("src/one.ts", true), change("src/two.ts", true)];
    await workbench.render(model);
    expect(screen.container.textContent).toContain("Loading current");
    await workbench.select("Conflicts", "src/two.ts");
    expect(model.onCloseCurrentFile).not.toHaveBeenCalled();
    expect(model.onSelectChange).toHaveBeenCalledWith("src/two.ts::conflict");
    expect(model.onOpenCurrentFile).not.toHaveBeenCalled();
    expect(
      screen.container.querySelector('[data-git-changes-scroll-region="details"]')?.textContent,
    ).toContain("src/two.ts");
    expect(screen.container.textContent).not.toContain("Loading current");
    expect(
      screen.container.querySelector("footer")?.closest("[data-git-changes-scroll-region]"),
    ).toBeNull();
    expect(screen.container.querySelector("footer")?.textContent).toBe("Commit footer");
  });

  it.each(["operation", "changes", "snapshot"] as const)(
    "keeps Continue disabled for unresolved %s evidence until the refreshed state is clear",
    async (source) => {
      await using screen = await render(null, { router: false });
      const workbench = workbenchControls(screen);
      const model = fixture();
      model.operation = { ...operation, conflicts: source === "operation" ? ["src/app.ts"] : [] };
      model.changes = [change("src/app.ts", source === "changes")];
      model.snapshot = { ...model.snapshot!, conflicts: source === "snapshot" ? 1 : 0 };
      await workbench.render(model);
      expect(workbench.button("Continue").disabled).toBe(true);
      await workbench.click("Continue");
      expect(model.onRunOperation).not.toHaveBeenCalled();
      model.operation = { ...operation, conflicts: [] };
      model.changes = [change("src/app.ts")];
      model.snapshot = { ...model.snapshot!, conflicts: 0, stateToken: "state-2" };
      await workbench.render(model);
      expect(workbench.button("Continue").disabled).toBe(false);
      await workbench.click("Continue");
      expect(model.onRunOperation).toHaveBeenCalledExactlyOnceWith({ kind: "continue" });
    },
  );

  it("keeps Skip available when supported and reconfirms Abort against the latest mutation restrictions", async () => {
    await using screen = await render(null, { router: false });
    const workbench = workbenchControls(screen);
    const model = fixture();
    model.operation = { ...operation };
    await workbench.render(model);
    await workbench.click("Skip");
    expect(model.onRunOperation).toHaveBeenLastCalledWith({ kind: "skip" });
    vi.mocked(model.onRunOperation).mockClear();
    await workbench.click("Abort…");
    expect(model.onRunOperation).not.toHaveBeenCalled();
    model.loading = true;
    await workbench.render(model);
    expect(workbench.button("Abort operation", workbench.dialog()).disabled).toBe(true);
    await workbench.click("Abort operation", workbench.dialog());
    expect(model.onRunOperation).not.toHaveBeenCalled();
    model.loading = false;
    await workbench.render(model);
    await workbench.click("Abort operation", workbench.dialog());
    expect(model.onRunOperation).toHaveBeenCalledExactlyOnceWith({ kind: "abort" });
  });
});
