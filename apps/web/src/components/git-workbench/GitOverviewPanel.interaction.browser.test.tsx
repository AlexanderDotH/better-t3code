import { act, render as renderTest, type Screen } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import type { GitOperationState, GitWorkbenchSnapshot } from "./GitWorkbench.types";
import { GitOverviewPanel } from "./GitOverviewPanel";
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({
    message: (key: string) => key,
    date: () => "12:00",
  }),
}));
describe("Git overview next action", () => {
  it.each([
    {
      ahead: 0,
      behind: 2,
      kind: "pull",
    },
    {
      ahead: 2,
      behind: 0,
      kind: "push",
    },
  ])("runs $kind for a clean one-sided branch", async ({ ahead, behind, kind }) => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview({
      ahead,
      behind,
    });
    await act(async () => {
      await button.click();
    });
    expect(onRunOperation).toHaveBeenCalledExactlyOnceWith({
      kind,
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each([
    {
      ahead: 1,
      behind: 0,
      availability: {
        pushAvailable: false,
      },
    },
    {
      ahead: 0,
      behind: 1,
      availability: {
        pullAvailable: false,
      },
    },
  ])(
    "blocks delivery without an available remote or upstream: %j",
    async ({ ahead, behind, availability }) => {
      await using fixture = await setupFixture();
      const { renderOverview } = fixture;
      const { button, onRunOperation } = await renderOverview(
        {
          ahead,
          behind,
        },
        false,
        null,
        availability,
      );
      expect(button.disabled).toBe(true);
      await act(async () => {
        await button.click();
      });
      expect(onRunOperation).not.toHaveBeenCalled();
    },
  );
  it("opens guided sync for divergence without issuing a pull", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview({
      ahead: 2,
      behind: 3,
    });
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });
  it("opens Changes to prepare staged and unstaged work without committing", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview({
      ahead: 1,
      behind: 2,
      changeCount: 2,
      staged: 1,
      unstaged: 1,
    });
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("changes");
    expect(onRunOperation).not.toHaveBeenCalled();
  });
  it("offers operation inspection ahead of dirty work", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview(
      {
        staged: 1,
      },
      false,
      {
        canAbort: true,
        canContinue: true,
        canSkip: false,
        conflicts: [],
        detail: "Rebase in progress",
        kind: "rebase",
        startedAt: "2026-10-17T10:00:00.000Z",
      },
    );
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });
  it("prioritizes a running command while the repository operation marker is clear", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview(
      {
        staged: 1,
      },
      false,
      null,
      {
        operationRunning: true,
      },
    );
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("operations");
    expect(onRunOperation).not.toHaveBeenCalled();
  });
  it("blocks the next action while the snapshot is refreshing", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview(
      {
        staged: 1,
      },
      false,
      null,
      {
        blocked: true,
      },
    );
    expect(button.disabled).toBe(true);
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onRunOperation).not.toHaveBeenCalled();
  });
  it("allows read-only inspection while disabling pulls", async () => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const inspection = await renderOverview(
      {
        staged: 1,
      },
      true,
    );
    await act(async () => {
      await inspection.button.click();
    });
    expect(inspection.onNavigate).toHaveBeenCalledExactlyOnceWith("changes");
    const mutation = await renderOverview(
      {
        behind: 1,
      },
      true,
    );
    expect(mutation.button.disabled).toBe(true);
    await act(async () => {
      await mutation.button.click();
    });
    expect(mutation.onRunOperation).not.toHaveBeenCalled();
  });
  it.each([
    {
      stale: true,
    },
    {
      repositoryState: "unavailable" as const,
    },
  ])("blocks stale and unavailable repository actions: %j", async (snapshot) => {
    await using fixture = await setupFixture();
    const { renderOverview } = fixture;
    const { button, onNavigate, onRunOperation } = await renderOverview({
      ahead: 1,
      ...snapshot,
    });
    expect(button.disabled).toBe(true);
    await act(async () => {
      await button.click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onRunOperation).not.toHaveBeenCalled();
  });
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
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
  let screen: Screen;
  async function renderOverview(
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
    await act(async () => {
      await screen.rerender(
        <GitOverviewPanel
          insights={null}
          onCancelQueue={vi.fn()}
          onNavigate={onNavigate}
          onRestoreUndo={vi.fn()}
          onRunOperation={onRunOperation}
          operation={operation}
          queue={null}
          readOnly={readOnly}
          snapshot={{
            ...cleanSnapshot,
            ...snapshot,
          }}
          undoSnapshots={[]}
          {...status}
        />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      'section[aria-labelledby="repository-pulse-heading"] button',
    );
    if (!button) throw new Error("Expected the next action button");
    return {
      button,
      onNavigate,
      onRunOperation,
    };
  }
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });
  try {
    container = document.createElement("div");
    document.body.append(container);
    screen = fixtureResources.use(
      await renderTest(null, {
        container: container,
        /* The fixture exercises local state without router navigation.*/ router: false,
      }),
    );
    return {
      cleanSnapshot,
      get container() {
        return container;
      },
      set container(value: HTMLDivElement) {
        container = value;
      },
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      renderOverview,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
