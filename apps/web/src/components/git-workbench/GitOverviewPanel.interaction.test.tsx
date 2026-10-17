// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { GitOperationState, GitWorkbenchSnapshot } from "./GitWorkbench.types";
import { GitOverviewPanel } from "./GitOverviewPanel";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key, date: () => "12:00" }),
}));

const cleanSnapshot: GitWorkbenchSnapshot = {
  ahead: 0,
  behind: 0,
  branch: "feature",
  changeCount: 0,
  conflicts: 0,
  generatedAt: "2026-10-17T10:00:00.000Z",
  headOid: "a".repeat(40),
  lastCommit: null,
  repositoryState: "clean",
  staged: 0,
  stale: false,
  stateToken: "state-1",
  unstaged: 0,
  untracked: 0,
  upstream: "origin/feature",
  worktreeRoot: "/repo",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderOverview(
  snapshot: Partial<GitWorkbenchSnapshot> = {},
  readOnly = false,
  operation: GitOperationState | null = null,
  status: {
    blocked?: boolean;
    operationRunning?: boolean;
    pushAvailable?: boolean;
    pullAvailable?: boolean;
  } = {},
) {
  const onNavigate = vi.fn();
  const onRunOperation = vi.fn();
  act(() =>
    root.render(
      <GitOverviewPanel
        insights={null}
        onCancelQueue={vi.fn()}
        onNavigate={onNavigate}
        onRestoreUndo={vi.fn()}
        onRunOperation={onRunOperation}
        operation={operation}
        queue={null}
        readOnly={readOnly}
        snapshot={{ ...cleanSnapshot, ...snapshot }}
        undoSnapshots={[]}
        {...status}
      />,
    ),
  );
  const button = container.querySelector<HTMLButtonElement>(
    'section[aria-labelledby="repository-pulse-heading"] button',
  );
  if (!button) throw new Error("Expected the next action button");
  return { button, onNavigate, onRunOperation };
}

describe("Git overview next action", () => {
  it.each([
    { ahead: 0, behind: 2, kind: "pull" },
    { ahead: 2, behind: 0, kind: "push" },
  ])("runs $kind for a clean one-sided branch", ({ ahead, behind, kind }) => {
    const { button, onNavigate, onRunOperation } = renderOverview({ ahead, behind });
    act(() => button.click());
    expect(onRunOperation).toHaveBeenCalledExactlyOnceWith({ kind });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each([
    { ahead: 1, behind: 0, availability: { pushAvailable: false } },
    { ahead: 0, behind: 1, availability: { pullAvailable: false } },
  ])(
    "blocks delivery without an available remote or upstream: %j",
    ({ ahead, behind, availability }) => {
      const { button, onRunOperation } = renderOverview(
        { ahead, behind },
        false,
        null,
        availability,
      );
      expect(button.disabled).toBe(true);
      act(() => button.click());
      expect(onRunOperation).not.toHaveBeenCalled();
    },
  );

  it("opens guided sync for divergence without issuing a pull", () => {
    const { button, onNavigate, onRunOperation } = renderOverview({ ahead: 2, behind: 3 });
    act(() => button.click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });

  it("opens Changes to prepare staged and unstaged work without committing", () => {
    const { button, onNavigate, onRunOperation } = renderOverview({
      ahead: 1,
      behind: 2,
      changeCount: 2,
      staged: 1,
      unstaged: 1,
    });
    act(() => button.click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("changes");
    expect(onRunOperation).not.toHaveBeenCalled();
  });

  it("offers operation inspection ahead of dirty work", () => {
    const { button, onNavigate, onRunOperation } = renderOverview({ staged: 1 }, false, {
      canAbort: true,
      canContinue: true,
      canSkip: false,
      conflicts: [],
      detail: "Rebase in progress",
      kind: "rebase",
      startedAt: "2026-10-17T10:00:00.000Z",
    });
    act(() => button.click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });

  it("prioritizes a running command while the repository operation marker is clear", () => {
    const { button, onNavigate, onRunOperation } = renderOverview({ staged: 1 }, false, null, {
      operationRunning: true,
    });
    act(() => button.click());
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });

  it("blocks the next action while the snapshot is refreshing", () => {
    const { button, onNavigate, onRunOperation } = renderOverview({ staged: 1 }, false, null, {
      blocked: true,
    });
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onRunOperation).not.toHaveBeenCalled();
  });

  it("allows read-only inspection while disabling pulls", () => {
    const inspection = renderOverview({ staged: 1 }, true);
    act(() => inspection.button.click());
    expect(inspection.onNavigate).toHaveBeenCalledExactlyOnceWith("changes");
    const mutation = renderOverview({ behind: 1 }, true);
    expect(mutation.button.disabled).toBe(true);
    act(() => mutation.button.click());
    expect(mutation.onRunOperation).not.toHaveBeenCalled();
  });

  it.each([{ stale: true }, { repositoryState: "unavailable" as const }])(
    "blocks stale and unavailable repository actions: %j",
    (snapshot) => {
      const { button, onNavigate, onRunOperation } = renderOverview({ ahead: 1, ...snapshot });
      expect(button.disabled).toBe(true);
      act(() => button.click());
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onRunOperation).not.toHaveBeenCalled();
    },
  );
});
