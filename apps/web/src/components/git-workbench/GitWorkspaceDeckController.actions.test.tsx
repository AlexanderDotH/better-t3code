import { EnvironmentId, type GitWorkbenchSnapshot } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import * as Cause from "effect/Cause";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useGitWorkspaceDeckActions } from "./GitWorkspaceDeckController.actions";
import { mapChanges, mapSnapshot } from "./GitWorkspaceDeckController.mapping";

const io = vi.hoisted(() => ({
  apply: vi.fn(),
  refresh: vi.fn(),
  query: vi.fn(),
  other: vi.fn(),
}));
vi.mock("~/state/gitWorkbench", () => ({
  gitWorkbenchEnvironment: {
    applyChangeSelection: "apply",
    refresh: "refresh",
    runOperation: "other",
    restoreUndoSnapshot: "other",
    createUndoSnapshot: "other",
    upsertQueuedWorkflow: "other",
    cancelQueuedWorkflow: "other",
    changesDiff: (target: unknown) => target,
  },
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: { writeFile: "other" } }));
vi.mock("~/state/vcs", () => ({ vcsEnvironment: { refreshStatus: "other" } }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: "apply" | "refresh" | "other") => io[command],
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (load) => ({
  ...(await load<typeof import("@t3tools/client-runtime/state/runtime")>()),
  executeAtomQuery: (...args: unknown[]) => io.query(...args),
}));

function snapshot(paths = ["a", "b", "c"]): GitWorkbenchSnapshot {
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
    files: paths.map((path) => ({
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
      unstagedStats: { insertions: 1, deletions: 0, binary: false },
    })),
    totals: {
      staged: 0,
      unstaged: paths.length,
      untracked: 0,
      conflicted: 0,
      insertions: paths.length,
      deletions: 0,
    },
    operation: { kind: "none" },
    truncated: false,
    generatedAt: "2026-10-16T00:00:00Z",
    stateToken: "state-1",
  };
}

type ActionInput = Parameters<typeof useGitWorkspaceDeckActions>[0];
let actions: ReturnType<typeof useGitWorkspaceDeckActions>;
let renderer: ReactTestRenderer;
function Host({ input }: { input: ActionInput }) {
  const nextActions = useGitWorkspaceDeckActions(input);
  useEffect(() => {
    actions = nextActions;
  }, [nextActions]);
  return null;
}
function input(contractSnapshot = snapshot()): ActionInput {
  return {
    activeTurn: false,
    changes: mapChanges(contractSnapshot, {}),
    contractSnapshot,
    currentFile: null,
    cwd: "/repo",
    environmentId: EnvironmentId.make("env-a"),
    queuedWorkflow: null,
    refreshChangesDiff: vi.fn(),
    refreshFile: vi.fn(),
    refreshWorkbenchQuery: vi.fn(),
    setCurrentFile: vi.fn(),
    setDiffs: vi.fn(),
    snapshot: mapSnapshot(contractSnapshot, null),
    threadId: null,
    translate: createInterfaceTranslator({ language: "en", locale: "en-US" }).message,
    turnId: null,
  };
}
function selection(action: "stage" | "unstage" | "discard" = "stage") {
  return {
    action,
    changeId: "a::worktree",
    expectedPatchId: "patch-a",
    expectedStateToken: "state-1",
    hunkIds: [],
    lineIds: [],
    path: "a",
    source: "worktree" as const,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.apply.mockReset().mockResolvedValue({ _tag: "Success", value: { snapshot: snapshot() } });
  io.refresh.mockReset().mockResolvedValue({ _tag: "Success", value: snapshot() });
  io.other.mockReset();
  io.query.mockReset().mockImplementation(async (_registry, target) => ({
    _tag: "Success",
    value: {
      path: target.input.path,
      source: target.input.source,
      stateToken: target.input.expectedStateToken,
      patchId: `patch-${target.input.path}`,
      binary: false,
      truncated: false,
      hunks: [],
    },
  }));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("Git workspace staging actions", () => {
  it("uses scoped fresh queries and surfaces a stale stop after retaining the first mutation", async () => {
    io.apply
      .mockResolvedValueOnce({ _tag: "Success", value: { snapshot: snapshot() } })
      .mockResolvedValueOnce({
        _tag: "Failure",
        cause: Cause.fail({ _tag: "GitWorkbenchStaleStateError", message: "Changed externally" }),
      });
    const props = input();
    await act(async () => {
      renderer = create(<Host input={props} />);
    });
    await act(async () => actions.setFilesStaged(["a", "b", "c"], true));

    expect(io.refresh).toHaveBeenCalledTimes(2);
    expect(io.query).toHaveBeenCalledTimes(2);
    expect(io.query.mock.calls[0]?.[1]).toEqual({
      environmentId: EnvironmentId.make("env-a"),
      input: { cwd: "/repo", path: "a", source: "unstaged", expectedStateToken: "state-1" },
    });
    expect(io.query.mock.calls[0]?.[2]).toMatchObject({ refresh: true });
    expect(io.apply.mock.calls.map(([request]) => request.input.path)).toEqual(["a", "b"]);
    expect(io.apply.mock.calls[0]?.[0]).toEqual({
      environmentId: EnvironmentId.make("env-a"),
      input: {
        action: "stage",
        cwd: "/repo",
        expectedPatchId: "patch-a",
        expectedStateToken: "state-1",
        path: "a",
        selection: { kind: "file" },
        source: "unstaged",
      },
    });
    expect(actions.stagingPending).toBe(false);
    expect(actions.stagingError).toContain("Stopped at b. 1 files updated.");
    expect(actions.stagingError).toContain("repository changed");
    expect(props.setDiffs).toHaveBeenLastCalledWith({});
  });

  it("locks duplicate staging requests while a fresh snapshot is in flight", async () => {
    let release: (value: { _tag: "Success"; value: GitWorkbenchSnapshot }) => void = () => {};
    io.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      renderer = create(<Host input={input()} />);
    });
    await act(async () => {
      actions.setFilesStaged(["a"], true);
      actions.setFilesStaged(["a"], true);
      actions.applyChangeSelection(selection());
    });
    expect(io.refresh).toHaveBeenCalledOnce();
    expect(actions.stagingPending).toBe(true);
    expect(io.apply).not.toHaveBeenCalled();
    await act(async () => release({ _tag: "Success", value: snapshot() }));
    expect(io.apply).toHaveBeenCalledOnce();
    expect(actions.stagingPending).toBe(false);
  });

  it("stops an old-scope batch before its patch read and permits staging in the new scope", async () => {
    let release: (value: { _tag: "Success"; value: GitWorkbenchSnapshot }) => void = () => {};
    io.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = input();
    await act(async () => {
      renderer = create(<Host input={first} />);
    });
    await act(async () => actions.setFilesStaged(["a"], true));
    const second = { ...input(), environmentId: EnvironmentId.make("env-b") };
    await act(async () => renderer.update(<Host input={second} />));
    await act(async () => release({ _tag: "Success", value: snapshot() }));
    expect(io.query).not.toHaveBeenCalled();
    expect(io.apply).not.toHaveBeenCalled();
    expect(actions.stagingPending).toBe(false);
    await act(async () => actions.setFilesStaged(["a"], true));
    expect(io.apply).toHaveBeenCalledOnce();
    expect(io.apply.mock.calls[0]?.[0].environmentId).toBe(EnvironmentId.make("env-b"));
  });

  it.each([
    { activeTurn: true },
    { readOnly: true },
    { snapshot: { ...mapSnapshot(snapshot(), null), stale: true } },
  ])("blocks single and bulk index mutations for $activeTurn $readOnly", async (blocked) => {
    await act(async () => {
      renderer = create(<Host input={{ ...input(), ...blocked }} />);
    });
    await act(async () => actions.applyChangeSelection(selection()));
    await act(async () => actions.setFilesStaged(["a"], true));
    expect(io.apply).not.toHaveBeenCalled();
    expect(io.refresh).not.toHaveBeenCalled();
    expect(actions.stagingError).toBeTruthy();
  });

  it("allows explicit conflict staging during an operation while blocking bulk and discard", async () => {
    const base = snapshot(["a"]);
    const conflict: GitWorkbenchSnapshot = {
      ...base,
      operation: { kind: "merge" },
      files: base.files.map((file) => ({ ...file, conflicted: true, kind: "conflicted" })),
    };
    await act(async () => {
      renderer = create(<Host input={input(conflict)} />);
    });
    await act(async () =>
      actions.applyChangeSelection({ ...selection(), changeId: "a::conflict" }),
    );
    expect(io.apply).toHaveBeenCalledOnce();
    await act(async () => actions.setFilesStaged(["a"], true));
    await act(async () =>
      actions.applyChangeSelection({ ...selection("discard"), changeId: "a::conflict" }),
    );
    expect(io.apply).toHaveBeenCalledOnce();
    expect(io.refresh).not.toHaveBeenCalled();
  });
});
