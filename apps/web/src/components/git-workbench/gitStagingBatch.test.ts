import type {
  GitApplyChangeSelectionInput,
  GitChangesDiffResult,
  GitWorkbenchFile,
  GitWorkbenchSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { setGitFilesStaged } from "./gitStagingBatch";

function file(path: string, overrides: Partial<GitWorkbenchFile> = {}): GitWorkbenchFile {
  return {
    path,
    kind: "modified",
    indexStatus: "unmodified",
    worktreeStatus: "modified",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    binary: false,
    submodule: false,
    modeChanged: false,
    stagedStats: { insertions: 0, deletions: 0, binary: false },
    unstagedStats: { insertions: 1, deletions: 1, binary: false },
    ...overrides,
  };
}

function snapshot(
  files: readonly GitWorkbenchFile[],
  stateToken = "state-1",
): GitWorkbenchSnapshot {
  return {
    isRepository: true,
    registeredCwd: "/repo",
    repositoryRoot: "/repo",
    worktreeRoot: "/repo",
    gitCommonDir: "/repo/.git",
    refName: "topic",
    upstreamRef: null,
    headOid: "a".repeat(40),
    unborn: false,
    detached: false,
    aheadCount: 0,
    behindCount: 0,
    files,
    totals: {
      staged: 0,
      unstaged: files.length,
      untracked: 0,
      conflicted: 0,
      insertions: 1,
      deletions: 1,
    },
    operation: { kind: "none" },
    truncated: false,
    generatedAt: "2026-10-16T00:00:00Z",
    stateToken,
  };
}

function diff(
  path: string,
  stateToken: string,
  source: "staged" | "unstaged",
): GitChangesDiffResult {
  return {
    path,
    stateToken,
    source,
    patchId: `patch:${stateToken}:${path}`,
    binary: false,
    truncated: false,
    hunks: [],
  };
}

describe("setGitFilesStaged", () => {
  it("refreshes and applies each unique file serially with its fresh source, patch, and snapshot", async () => {
    const events: string[] = [];
    const files = [file("src/a.ts"), file("src/b.ts", { binary: true })];
    let revision = 0;
    const applied: Omit<GitApplyChangeSelectionInput, "cwd">[] = [];
    const result = await setGitFilesStaged({
      paths: ["src/a.ts", "src/a.ts", "src/b.ts"],
      staged: true,
      expectedStateToken: "state-0",
      canContinue: () => true,
      refreshSnapshot: async () => {
        events.push(`refresh:${revision}`);
        return snapshot(files, `state-${revision}`);
      },
      readDiff: async (request) => {
        events.push(`diff:${request.path}`);
        return diff(request.path, request.expectedStateToken!, request.source);
      },
      applyFile: async (request) => {
        events.push(`apply:${request.path}`);
        applied.push(request);
        revision += 1;
        return { snapshot: snapshot(files, `state-${revision}`) };
      },
    });

    expect(events).toEqual([
      "refresh:0",
      "diff:src/a.ts",
      "apply:src/a.ts",
      "refresh:1",
      "diff:src/b.ts",
      "apply:src/b.ts",
    ]);
    expect(applied).toEqual([
      {
        action: "stage",
        path: "src/a.ts",
        source: "unstaged",
        selection: { kind: "file" },
        expectedStateToken: "state-0",
        expectedPatchId: "patch:state-0:src/a.ts",
      },
      {
        action: "stage",
        path: "src/b.ts",
        source: "unstaged",
        selection: { kind: "file" },
        expectedStateToken: "state-1",
        expectedPatchId: "patch:state-1:src/b.ts",
      },
    ]);
    expect(result).toEqual({
      status: "completed",
      completedPaths: ["src/a.ts", "src/b.ts"],
      skippedPaths: [],
    });
  });

  it("unstages the index while retaining the partially staged file's worktree changes", async () => {
    const current = snapshot([
      file("src/a.ts", { staged: true, unstaged: true, indexStatus: "modified" }),
    ]);
    const applyFile = vi.fn(async () => ({ snapshot: current }));
    const result = await setGitFilesStaged({
      paths: ["src/a.ts"],
      staged: false,
      expectedStateToken: current.stateToken,
      canContinue: () => true,
      refreshSnapshot: async () => current,
      readDiff: async (request) => diff(request.path, current.stateToken, request.source),
      applyFile,
    });

    expect(applyFile).toHaveBeenCalledWith({
      action: "unstage",
      expectedPatchId: "patch:state-1:src/a.ts",
      expectedStateToken: "state-1",
      path: "src/a.ts",
      selection: { kind: "file" },
      source: "staged",
    });
    expect(current.files[0]?.unstaged).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("retains earlier success and never attempts a third file after a stale response", async () => {
    const stale = { _tag: "GitWorkbenchStaleStateError", message: "Changed externally" };
    const current = snapshot([file("a"), file("b"), file("c")]);
    const refreshSnapshot = vi.fn(async () => current);
    const applyFile = vi.fn(async (request: Omit<GitApplyChangeSelectionInput, "cwd">) => {
      if (request.path === "b") throw stale;
      return { snapshot: current };
    });
    const result = await setGitFilesStaged({
      paths: ["a", "b", "c"],
      staged: true,
      expectedStateToken: current.stateToken,
      canContinue: () => true,
      refreshSnapshot,
      readDiff: async (request) => diff(request.path, current.stateToken, request.source),
      applyFile,
    });

    expect(result).toEqual({
      status: "stopped",
      reason: "error",
      path: "b",
      error: stale,
      completedPaths: ["a"],
      skippedPaths: [],
    });
    expect(refreshSnapshot).toHaveBeenCalledTimes(2);
    expect(applyFile.mock.calls.map(([request]) => request.path)).toEqual(["a", "b"]);
  });

  it("stops before the next patch when an external change follows a successful mutation", async () => {
    const files = [file("a"), file("b"), file("c")];
    const refreshSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot(files, "initial"))
      .mockResolvedValueOnce(snapshot(files, "external-change"));
    const readDiff = vi.fn(async (request: { path: string; source: "staged" | "unstaged" }) =>
      diff(request.path, "initial", request.source),
    );
    const applyFile = vi.fn(async () => ({ snapshot: snapshot(files, "after-first-apply") }));
    const result = await setGitFilesStaged({
      paths: ["a", "b", "c"],
      staged: true,
      expectedStateToken: "initial",
      canContinue: () => true,
      refreshSnapshot,
      readDiff,
      applyFile,
    });
    expect(result).toEqual({
      status: "stopped",
      reason: "stale",
      path: "b",
      completedPaths: ["a"],
      skippedPaths: [],
    });
    expect(readDiff).toHaveBeenCalledOnce();
    expect(applyFile).toHaveBeenCalledOnce();
    expect(refreshSnapshot).toHaveBeenCalledTimes(2);
  });

  it("rejects a patch from another snapshot or source before a mutation", async () => {
    const current = snapshot([file("a")]);
    for (const wrongDiff of [
      diff("a", "older", "unstaged"),
      diff("a", current.stateToken, "staged"),
    ]) {
      const applyFile = vi.fn(async () => ({ snapshot: current }));
      const result = await setGitFilesStaged({
        paths: ["a"],
        staged: true,
        expectedStateToken: current.stateToken,
        canContinue: () => true,
        refreshSnapshot: async () => current,
        readDiff: async () => wrongDiff,
        applyFile,
      });
      expect(result).toMatchObject({ status: "stopped", reason: "stale", completedPaths: [] });
      expect(applyFile).not.toHaveBeenCalled();
    }
  });

  it("stops after the snapshot refresh if its scope or permission became unavailable", async () => {
    let allowed = true;
    const readDiff = vi.fn();
    const applyFile = vi.fn();
    const result = await setGitFilesStaged({
      paths: ["a"],
      staged: true,
      expectedStateToken: "state-1",
      canContinue: () => allowed,
      refreshSnapshot: async () => {
        allowed = false;
        return snapshot([file("a")]);
      },
      readDiff,
      applyFile,
    });
    expect(result).toMatchObject({ status: "stopped", reason: "cancelled", completedPaths: [] });
    expect(readDiff).not.toHaveBeenCalled();
    expect(applyFile).not.toHaveBeenCalled();
  });

  it("skips already-correct or disappeared files and stops at newly conflicted paths", async () => {
    const current = snapshot([
      file("already", { staged: true, unstaged: false }),
      file("conflict", { conflicted: true }),
    ]);
    const readDiff = vi.fn();
    const applyFile = vi.fn();
    const result = await setGitFilesStaged({
      paths: ["already", "gone", "conflict", "later"],
      staged: true,
      expectedStateToken: current.stateToken,
      canContinue: () => true,
      refreshSnapshot: async () => current,
      readDiff,
      applyFile,
    });
    expect(result).toEqual({
      status: "stopped",
      reason: "conflicted",
      path: "conflict",
      completedPaths: [],
      skippedPaths: ["already", "gone"],
    });
    expect(readDiff).not.toHaveBeenCalled();
    expect(applyFile).not.toHaveBeenCalled();
  });
});
