import { describe, expect, it } from "vite-plus/test";

import {
  appendGitWorkbenchHistoryPage,
  beginGitWorkbenchHistory,
  type GitWorkbenchHistoryPage,
} from "./history.ts";

interface Commit {
  readonly oid: string;
}

const page = (
  queryKey: string,
  snapshotOid: string,
  commits: ReadonlyArray<Commit>,
  nextCursor: string | null,
): GitWorkbenchHistoryPage<Commit> => ({
  queryKey,
  snapshotOid,
  commits,
  nextCursor,
});

describe("Git workbench history pagination", () => {
  it("appends cursor pages anchored to the first repository snapshot", () => {
    const initial = appendGitWorkbenchHistoryPage(
      beginGitWorkbenchHistory<Commit>("main:src"),
      page("main:src", "head-a", [{ oid: "a" }], "cursor-2"),
      (commit) => commit.oid,
    );
    const next = appendGitWorkbenchHistoryPage(
      initial,
      page("main:src", "head-a", [{ oid: "b" }], null),
      (commit) => commit.oid,
    );

    expect(next).toEqual({
      queryKey: "main:src",
      snapshotOid: "head-a",
      commits: [{ oid: "a" }, { oid: "b" }],
      nextCursor: null,
    });
  });

  it("ignores a late page after the active ref or path changes", () => {
    const current = beginGitWorkbenchHistory<Commit>("release:src");

    expect(
      appendGitWorkbenchHistoryPage(
        current,
        page("main:src", "head-a", [{ oid: "stale" }], null),
        (commit) => commit.oid,
      ),
    ).toBe(current);
  });

  it("rejects pages from a moved snapshot and deduplicates overlapping commits", () => {
    const initial = appendGitWorkbenchHistoryPage(
      beginGitWorkbenchHistory<Commit>("main:src"),
      page("main:src", "head-a", [{ oid: "a" }, { oid: "b" }], "cursor-2"),
      (commit) => commit.oid,
    );
    const moved = appendGitWorkbenchHistoryPage(
      initial,
      page("main:src", "head-b", [{ oid: "new-head" }], null),
      (commit) => commit.oid,
    );
    const overlap = appendGitWorkbenchHistoryPage(
      initial,
      page("main:src", "head-a", [{ oid: "b" }, { oid: "c" }], null),
      (commit) => commit.oid,
    );

    expect(moved).toBe(initial);
    expect(overlap.commits).toEqual([{ oid: "a" }, { oid: "b" }, { oid: "c" }]);
  });
});
