import { describe, expect, it } from "vite-plus/test";

import {
  buildChangeSelection,
  deriveGitPrimaryAction,
  deriveHistoryWindow,
  groupGitChanges,
  retainValidSelectionIds,
  validateRebasePlan,
} from "./GitWorkbench.logic";
import type { GitWorkbenchChange, GitWorkbenchRebaseNode } from "./GitWorkbench.types";

const change = (
  overrides: Partial<GitWorkbenchChange> & Pick<GitWorkbenchChange, "id" | "path">,
): GitWorkbenchChange => ({
  additions: 0,
  binary: false,
  deletions: 0,
  kind: "modified",
  modeChanged: false,
  staged: false,
  submodule: false,
  unstaged: false,
  untracked: false,
  ...overrides,
});

describe("groupGitChanges", () => {
  it("puts conflicts first and represents a partially staged file in both index groups", () => {
    const groups = groupGitChanges([
      change({ id: "both", path: "src/both.ts", staged: true, unstaged: true }),
      change({ id: "new", path: "src/new.ts", untracked: true }),
      change({ id: "conflict", path: "src/conflict.ts", conflict: "both-modified" }),
    ]);

    expect(groups.map((group) => [group.id, group.changes.map((entry) => entry.id)])).toEqual([
      ["conflicts", ["conflict"]],
      ["staged", ["both"]],
      ["unstaged", ["both"]],
      ["untracked", ["new"]],
    ]);
  });
});

describe("deriveGitPrimaryAction", () => {
  it("prioritizes conflict resolution over delivery actions", () => {
    expect(
      deriveGitPrimaryAction({ ahead: 2, conflicts: 1, staged: 3, unstaged: 2, untracked: 0 }),
    ).toEqual({ id: "resolve-conflicts", label: "Resolve conflicts" });
  });

  it("commits the existing index without implying it will reset staged work", () => {
    expect(
      deriveGitPrimaryAction({ ahead: 0, conflicts: 0, staged: 2, unstaged: 4, untracked: 1 }),
    ).toEqual({ id: "commit-staged", label: "Commit 2 staged files" });
  });

  it("offers stage all when only worktree changes exist", () => {
    expect(
      deriveGitPrimaryAction({ ahead: 0, conflicts: 0, staged: 0, unstaged: 4, untracked: 1 }),
    ).toEqual({ id: "stage-all-and-commit", label: "Stage all & commit" });
  });
});

describe("deriveHistoryWindow", () => {
  it("bounds a fixed-row history list with overscan", () => {
    expect(
      deriveHistoryWindow({ itemCount: 1_000, rowHeight: 56, scrollTop: 560, viewportHeight: 168 }),
    ).toEqual({ end: 17, paddingBottom: 55_048, paddingTop: 336, start: 6 });
  });
});

describe("buildChangeSelection", () => {
  it("sends stable ids and concurrency tokens without sending patch text", () => {
    expect(
      buildChangeSelection({
        action: "stage",
        changeId: "src/app.ts",
        expectedPatchId: "patch-4",
        expectedStateToken: "state-9",
        hunkIds: ["h2"],
        lineIds: ["l4", "l5"],
        path: "src/app.ts",
        source: "worktree",
      }),
    ).toEqual({
      action: "stage",
      changeId: "src/app.ts",
      expectedPatchId: "patch-4",
      expectedStateToken: "state-9",
      hunkIds: ["h2"],
      lineIds: ["l4", "l5"],
      path: "src/app.ts",
      source: "worktree",
    });
  });

  it("represents a whole-file action with the change id and no browser patch payload", () => {
    expect(
      buildChangeSelection({
        action: "stage",
        changeId: "binary.dat",
        expectedStateToken: "state-10",
        hunkIds: [],
        lineIds: [],
        path: "binary.dat",
        source: "worktree",
      }),
    ).toEqual({
      action: "stage",
      changeId: "binary.dat",
      expectedStateToken: "state-10",
      hunkIds: [],
      lineIds: [],
      path: "binary.dat",
      source: "worktree",
    });
  });

  it("retains only selection ids that survived a refreshed patch", () => {
    expect([...retainValidSelectionIds(new Set(["h1", "h2", "gone"]), ["h2", "h1"])]).toEqual([
      "h1",
      "h2",
    ]);
  });
});

describe("validateRebasePlan", () => {
  it("rejects topology references before their labels", () => {
    const nodes: GitWorkbenchRebaseNode[] = [
      { id: "reset-feature", kind: "reset", label: "feature" },
      { id: "label-feature", kind: "label", label: "feature" },
    ];

    expect(validateRebasePlan(nodes)).toEqual({
      valid: false,
      reason: 'Reset references label "feature" before it is defined.',
    });
  });

  it("accepts a merge-preserving plan with defined labels", () => {
    const nodes: GitWorkbenchRebaseNode[] = [
      { id: "base", kind: "label", label: "onto" },
      { commitId: "a".repeat(40), id: "pick-a", kind: "pick", subject: "First" },
      { id: "feature", kind: "label", label: "feature" },
      { id: "reset", kind: "reset", label: "onto" },
      {
        commitId: "b".repeat(40),
        id: "merge",
        kind: "merge",
        labels: ["feature"],
        subject: "Merge feature",
      },
    ];

    expect(validateRebasePlan(nodes)).toEqual({ valid: true });
  });

  it("rejects duplicate topology labels", () => {
    const nodes: GitWorkbenchRebaseNode[] = [
      { id: "base-a", kind: "label", label: "feature" },
      { id: "base-b", kind: "label", label: "feature" },
    ];

    expect(validateRebasePlan(nodes)).toEqual({
      valid: false,
      reason: 'Label "feature" is defined more than once.',
    });
  });

  it("rejects moving a commit before an in-range dependency", () => {
    const parent = "a".repeat(40);
    const child = "b".repeat(40);
    const nodes: GitWorkbenchRebaseNode[] = [
      {
        commitId: child,
        dependencies: [parent],
        id: "child",
        kind: "pick",
        subject: "Child",
      },
      { commitId: parent, id: "parent", kind: "pick", subject: "Parent" },
    ];

    expect(validateRebasePlan(nodes)).toEqual({
      valid: false,
      reason: `Commit ${child.slice(0, 10)} appears before dependency ${parent.slice(0, 10)}.`,
    });
  });
});
