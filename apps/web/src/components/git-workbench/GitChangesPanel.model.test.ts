import { describe, expect, it } from "vite-plus/test";

import { defaultGitReviewChange, gitReviewFiles } from "./GitChangesPanel.model";
import type { GitWorkbenchChange } from "./GitWorkbench.types";

function change(
  path: string,
  source: "index" | "worktree",
  overrides: Partial<GitWorkbenchChange> = {},
): GitWorkbenchChange {
  return {
    additions: 1,
    deletions: 0,
    binary: false,
    id: `${path}::${source}`,
    kind: "modified",
    modeChanged: false,
    path,
    staged: source === "index",
    submodule: false,
    unstaged: source === "worktree",
    untracked: false,
    ...overrides,
  };
}

describe("Git review file rows", () => {
  it("combines index and worktree entries without losing their independent patch sources", () => {
    const index = change("src/app.ts", "index");
    const worktree = change("src/app.ts", "worktree");
    const full = change("src/ready.ts", "index");
    const fresh = change("new.ts", "worktree", {
      kind: "untracked",
      untracked: true,
      unstaged: false,
    });
    const rows = gitReviewFiles([index, worktree, full, fresh]);

    expect(rows.map(({ path, staging }) => ({ path, staging }))).toEqual([
      { path: "src/app.ts", staging: "partial" },
      { path: "src/ready.ts", staging: "full" },
      { path: "new.ts", staging: "none" },
    ]);
    expect(rows[0]?.index).toBe(index);
    expect(rows[0]?.worktree).toBe(worktree);
    expect(defaultGitReviewChange(rows[0]!)).toBe(worktree);
    expect(defaultGitReviewChange(rows[1]!)).toBe(full);
  });

  it("keeps binary, deleted, renamed and conflict entries available through one path row", () => {
    const entries = [
      change("image.png", "worktree", { binary: true }),
      change("deleted.ts", "index", { kind: "deleted" }),
      change("renamed.ts", "worktree", { kind: "renamed", previousPath: "old.ts" }),
      change("conflict.ts", "worktree", {
        id: "conflict.ts::conflict",
        conflict: "both-modified",
        unstaged: false,
      }),
    ];
    const rows = gitReviewFiles(entries);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => defaultGitReviewChange(row))).toEqual(entries);
    expect(rows[3]?.conflict).toBe(entries[3]);
  });
});
