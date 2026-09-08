import { describe, expect, it } from "vite-plus/test";

import { gitWorkbenchChangeRows } from "./git-workbench-changes";

describe("gitWorkbenchChangeRows", () => {
  it("keeps staged and working-tree sides distinct for partially staged files", () => {
    const snapshot = {
      files: [
        {
          path: "src/app.ts",
          kind: "modified",
          staged: true,
          unstaged: true,
          untracked: false,
          conflicted: false,
          indexStatus: "modified",
          worktreeStatus: "modified",
          binary: false,
          submodule: false,
          modeChanged: false,
          stagedStats: { insertions: 1, deletions: 0, binary: false },
          unstagedStats: { insertions: 2, deletions: 1, binary: false },
        },
      ],
    };

    expect(gitWorkbenchChangeRows(snapshot).map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "src/app.ts::staged", source: "staged" },
      { id: "src/app.ts::unstaged", source: "unstaged" },
    ]);
  });

  it("includes conflicts on the working-tree side", () => {
    const snapshot = {
      files: [
        {
          path: "src/conflict.ts",
          staged: false,
          unstaged: false,
          untracked: false,
          conflicted: true,
        },
      ],
    };

    expect(gitWorkbenchChangeRows(snapshot)).toHaveLength(1);
    expect(gitWorkbenchChangeRows(snapshot)[0]?.source).toBe("unstaged");
  });
});
