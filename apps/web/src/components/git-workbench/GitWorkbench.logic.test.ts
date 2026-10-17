import { describe, expect, it } from "vite-plus/test";

import {
  buildChangeSelection,
  deriveGitPrimaryAction,
  deriveHistoryWindow,
  groupGitChanges,
  retainValidSelectionIds,
  validateRebasePlan,
  type GitPrimaryActionInput,
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
  const clean: GitPrimaryActionInput = {
    ahead: 0,
    behind: 0,
    conflicts: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };

  it("prioritizes conflicts and ongoing operations over dirty work and delivery", () => {
    const input = {
      ...clean,
      ahead: 2,
      behind: 3,
      staged: 2,
      operation: { kind: "rebase" as const },
    };
    expect(deriveGitPrimaryAction({ ...input, conflicts: 1 })).toEqual({
      disabled: false,
      id: "resolve-conflicts",
      label: "Resolve conflicts",
    });
    expect(deriveGitPrimaryAction(input).id).toBe("review-operation");
    expect(deriveGitPrimaryAction({ ...clean, operationRunning: true }).id).toBe(
      "review-operation",
    );
  });

  it.each([
    { staged: 2, unstaged: 4, untracked: 1 },
    { staged: 0, unstaged: 4, untracked: 1 },
    { staged: 0, unstaged: 0, untracked: 1 },
  ])("prepares dirty work for review before remote work: %j", (changes) => {
    expect(deriveGitPrimaryAction({ ...clean, ...changes, ahead: 1, behind: 2 })).toEqual({
      disabled: false,
      id: "prepare-commit",
      label: "Prepare commit",
    });
  });

  it.each([
    { ahead: 0, behind: 2, id: "pull" },
    { ahead: 2, behind: 0, id: "push" },
    { ahead: 2, behind: 3, id: "guided-sync" },
  ])("chooses the clean branch action for $ahead ahead and $behind behind", (input) => {
    expect(deriveGitPrimaryAction({ ...clean, ...input })).toMatchObject({
      disabled: false,
      id: input.id,
    });
  });

  it("shows the pull request when synchronized and otherwise offers history", () => {
    expect(
      deriveGitPrimaryAction({ ...clean, pullRequest: { url: "https://example.com/pull/1" } }).id,
    ).toBe("view-pull-request");
    expect(deriveGitPrimaryAction(clean).id).toBe("view-history");
  });

  it("keeps inspection available read-only and blocks actual mutations", () => {
    expect(deriveGitPrimaryAction({ ...clean, ahead: 1, readOnly: true }).disabled).toBe(true);
    expect(deriveGitPrimaryAction({ ...clean, behind: 1, readOnly: true }).disabled).toBe(true);
    expect(deriveGitPrimaryAction({ ...clean, staged: 1, readOnly: true })).toMatchObject({
      disabled: false,
      id: "prepare-commit",
    });
    expect(deriveGitPrimaryAction({ ...clean, conflicts: 1, readOnly: true }).disabled).toBe(false);
  });

  it("keeps remote and branch availability guards on the common recommendation", () => {
    expect(deriveGitPrimaryAction({ ...clean, ahead: 1, pushAvailable: false })).toMatchObject({
      id: "push",
      disabled: true,
    });
    expect(deriveGitPrimaryAction({ ...clean, behind: 1, pullAvailable: false })).toMatchObject({
      id: "pull",
      disabled: true,
    });
    expect(deriveGitPrimaryAction({ ...clean, ahead: 1, pushAvailable: true }).disabled).toBe(
      false,
    );
  });

  it("does not suggest mutations while repository status is unavailable", () => {
    expect(deriveGitPrimaryAction({ ...clean, ahead: 2, staged: 3, blocked: true })).toEqual({
      disabled: true,
      id: "unavailable",
      label: "Git status unavailable",
    });
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
