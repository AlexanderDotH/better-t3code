import { describe, expect, it } from "vite-plus/test";
import type { GitChangesDiffResult, GitHistoryListResult } from "@t3tools/contracts";
import {
  buildChangeSelectionInput,
  deriveConflictState,
  historyPageInput,
  isValidQueuedWorkflowPlan,
  resolveChangeSelection,
  toggleChangeSelection,
} from "./git-workbench-model";

const diff: GitChangesDiffResult = {
  path: "app.ts",
  source: "unstaged",
  stateToken: "state",
  patchId: "patch",
  binary: false,
  truncated: false,
  hunks: [
    {
      id: "h1",
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { id: "l1", type: "deletion", oldLine: 1, content: "old", selectable: true },
        { id: "l2", type: "addition", newLine: 1, content: "new", selectable: true },
        { id: "l3", type: "context", newLine: 2, content: "context", selectable: false },
      ],
    },
  ],
};

describe("mobile Git selections", () => {
  it("clears stale partial selections without broadening them to the entire file", () => {
    const state = {
      targetKey: "app.ts",
      patchKey: "patch1",
      selection: { kind: "lines" as const, ids: ["l1"] },
    };
    expect(resolveChangeSelection(state, "app.ts", "patch1")).toBe(state.selection);
    expect(resolveChangeSelection(state, "app.ts", "patch2")).toEqual({ kind: "lines", ids: [] });
    expect(resolveChangeSelection(state, "other.ts", "patch2")).toEqual({ kind: "file" });
  });
  it("sends opaque hunk and line identifiers and exact patch preconditions", () => {
    const hunk = toggleChangeSelection({ kind: "file" }, "hunks", "h1");
    expect(buildChangeSelectionInput("/repo", diff, "stage", hunk, "state")).toMatchObject({
      selection: { kind: "hunks", ids: ["h1"] },
      expectedStateToken: "state",
      expectedPatchId: "patch",
    });
    const lines = toggleChangeSelection(toggleChangeSelection(hunk, "lines", "l1"), "lines", "l2");
    expect(buildChangeSelectionInput("/repo", diff, "discard", lines, "state")?.selection).toEqual({
      kind: "lines",
      ids: ["l1", "l2"],
    });
    expect(toggleChangeSelection(lines, "lines", "l2")).toEqual({ kind: "lines", ids: ["l1"] });
  });
  it("rejects stale, empty, nonselectable and truncated partial selections", () => {
    expect(
      buildChangeSelectionInput("/repo", diff, "stage", { kind: "lines", ids: [] }, "state"),
    ).toBeNull();
    expect(
      buildChangeSelectionInput("/repo", diff, "stage", { kind: "lines", ids: ["l3"] }, "state"),
    ).toBeNull();
    expect(
      buildChangeSelectionInput("/repo", diff, "stage", { kind: "file" }, "new-state"),
    ).toBeNull();
    expect(
      buildChangeSelectionInput(
        "/repo",
        { ...diff, truncated: true },
        "stage",
        { kind: "hunks", ids: ["h1"] },
        "state",
      ),
    ).toBeNull();
    expect(
      buildChangeSelectionInput(
        "/repo",
        { ...diff, truncated: true },
        "stage",
        { kind: "file" },
        "state",
      ),
    ).toBeNull();
    expect(
      buildChangeSelectionInput(
        "/repo",
        diff,
        "discard",
        { kind: "lines", ids: ["l1"] },
        "state",
        true,
      ),
    ).toBeNull();
    expect(
      buildChangeSelectionInput(
        "/repo",
        { ...diff, oldPath: "old.ts" },
        "stage",
        { kind: "hunks", ids: ["h1"] },
        "state",
      ),
    ).toBeNull();
    expect(
      buildChangeSelectionInput("/repo", diff, "discard", { kind: "file" }, "state", true),
    ).toMatchObject({ confirmedUntrackedDeletion: true });
  });
});

describe("conflict resolution state", () => {
  it("requires complete current content without conflict markers before marking resolved", () => {
    expect(deriveConflictState(null, false).canResolve).toBe(false);
    expect(
      deriveConflictState("<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n", false),
    ).toEqual({ hasMarkers: true, canResolve: false });
    expect(deriveConflictState("resolved\n", true).canResolve).toBe(false);
    expect(deriveConflictState("", false)).toEqual({ hasMarkers: false, canResolve: true });
    expect(deriveConflictState("const text = '<<<<<<<';\n", false).canResolve).toBe(true);
  });
});

describe("history paging", () => {
  it("pins later pages to the first snapshot and resets pagination with filters", () => {
    const page: GitHistoryListResult = {
      items: [],
      snapshotOid: "a".repeat(40),
      nextCursor: 25,
      truncated: false,
    };
    expect(historyPageInput("/repo", { refName: " main ", path: " src/app.ts " }, page)).toEqual({
      cwd: "/repo",
      refName: "main",
      path: "src/app.ts",
      limit: 25,
      cursor: 25,
      snapshotOid: "a".repeat(40),
    });
    expect(historyPageInput("/repo", { refName: "", path: "" }, null)).toEqual({
      cwd: "/repo",
      limit: 25,
      cursor: 0,
    });
    expect(
      historyPageInput("/repo", { refName: "main", path: "" }, { ...page, nextCursor: null }),
    ).toBeNull();
  });
});

describe("queued workflow edits", () => {
  it("rejects incomplete plans before replacing a saved workflow", () => {
    expect(
      isValidQueuedWorkflowPlan({
        kind: "delivery",
        stage: { mode: "paths", paths: [] },
        push: false,
        createPullRequest: false,
      }),
    ).toBe(false);
    expect(
      isValidQueuedWorkflowPlan({
        kind: "delivery",
        stage: { mode: "all" },
        push: false,
        createPullRequest: true,
      }),
    ).toBe(false);
    expect(
      isValidQueuedWorkflowPlan({
        kind: "delivery",
        stage: { mode: "paths", paths: ["src/app.ts"] },
        push: true,
        createPullRequest: true,
      }),
    ).toBe(true);
    expect(
      isValidQueuedWorkflowPlan({
        kind: "advanced_operation",
        action: { kind: "guided_rebase", ontoRef: " " },
      }),
    ).toBe(false);
    expect(
      isValidQueuedWorkflowPlan({
        kind: "advanced_operation",
        action: { kind: "reset", mode: "hard", targetOid: "a".repeat(41) },
      }),
    ).toBe(false);
  });
});
