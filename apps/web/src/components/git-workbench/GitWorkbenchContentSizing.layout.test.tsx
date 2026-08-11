import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { renderToStaticMarkup } from "react-dom/server";
import { expectTypeOf, vi } from "vite-plus/test";

import mcpWorkspaceControllerSource from "../mcp-workspace/McpWorkspaceController.tsx?raw";
import workspaceCardDrawerShellSource from "../workspace-deck/WorkspaceCardDrawerShell.tsx?raw";
import {
  WorkspaceCardDrawerShell,
  type WorkspaceCardDrawerShellProps,
} from "../workspace-deck/WorkspaceCardDrawerShell";
import gitBranchesPanelSource from "./GitBranchesPanel.tsx?raw";
import gitChangesPanelSource from "./GitChangesPanel.tsx?raw";
import gitHistoryPanelSource from "./GitHistoryPanel.tsx?raw";
import gitOperationsPanelSource from "./GitOperationsPanel.tsx?raw";
import gitOverviewPanelSource from "./GitOverviewPanel.tsx?raw";
import gitWorkspaceDeckLogicSource from "./gitWorkspaceDeck.logic.ts?raw";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";
import gitWorkbenchDrawerShellSource from "./GitWorkbenchDrawerShell.tsx?raw";
import gitWorkbenchPanelSource from "./GitWorkbenchPanel.tsx?raw";

const workspaceCardDeckCssPath = decodeURIComponent(
  new URL("../workspace-deck/WorkspaceCardDeck.css", import.meta.url).pathname,
);
const gitWorkspaceDeckCssPath = decodeURIComponent(
  new URL("./GitWorkspaceDeck.css", import.meta.url).pathname,
);
const readDrawerCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const workspaceCardDeckCssSource = yield* fileSystem.readFileString(workspaceCardDeckCssPath);
  const gitWorkspaceDeckCssSource = yield* fileSystem.readFileString(gitWorkspaceDeckCssPath);
  return { gitWorkspaceDeckCssSource, workspaceCardDeckCssSource };
}).pipe(Effect.provide(NodeServices.layer));

function renderGitDrawer(availableHeight: number): string {
  return renderToStaticMarkup(
    <GitWorkbenchDrawerShell
      open
      activeTab="overview"
      availableHeight={availableHeight}
      onActiveTabChange={vi.fn()}
      onOpenChange={vi.fn()}
    >
      <div>Repository overview</div>
    </GitWorkbenchDrawerShell>,
  );
}

function renderResizableMcpDrawer(): string {
  return renderToStaticMarkup(
    <WorkspaceCardDrawerShell
      open
      activeTab="servers"
      ariaLabel="MCP workspace"
      availableHeight={620}
      collapseLabel="Collapse MCP workspace"
      resizeLabel="Resize MCP workspace vertically"
      storageKey="t3code:mcp-workspace-drawer-height:v1"
      tabs={[]}
      title="MCP workspace"
      onActiveTabChange={vi.fn()}
      onOpenChange={vi.fn()}
    >
      <div>MCP servers</div>
    </WorkspaceCardDrawerShell>,
  );
}

describe("Git workbench content sizing", () => {
  it("makes persisted resize settings unrepresentable for content-sized drawers", () => {
    type ContentDrawerProps = Extract<
      WorkspaceCardDrawerShellProps<"overview">,
      { readonly sizingMode: "content" }
    >;

    expectTypeOf<ContentDrawerProps["storageKey"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ContentDrawerProps["resizeLabel"]>().toEqualTypeOf<undefined>();
  });

  it.each([
    { availableHeight: 620, safeMaximum: 460 },
    { availableHeight: 1_400, safeMaximum: 1_120 },
  ])(
    "caps natural content at $safeMaximum px when $availableHeight px is available",
    ({ availableHeight, safeMaximum }) => {
      const html = renderGitDrawer(availableHeight);

      expect(html).toContain('data-workspace-card-drawer-sizing="content"');
      expect(html).toContain(`--workspace-card-drawer-max-height:${safeMaximum}px`);
      expect(html).not.toContain('role="separator"');
      expect(html).not.toContain('aria-label="Resize Git workbench vertically"');
      expect(html).not.toContain("640px");
    },
  );

  it.effect("shrink-wraps short Git content and delegates capped overflow to the active view", () =>
    Effect.gen(function* () {
      const { gitWorkspaceDeckCssSource, workspaceCardDeckCssSource } = yield* readDrawerCss;

      expect(workspaceCardDeckCssSource).toMatch(
        /\.workspace-card-drawer\[data-workspace-card-drawer-sizing="content"\]\s*\{[^}]*height:\s*(?:auto|fit-content);[^}]*max-height:\s*var\(--workspace-card-drawer-max-height\);/,
      );
      expect(workspaceCardDeckCssSource).toMatch(
        /\.workspace-card-drawer__content\s*\{[^}]*min-height:\s*0;/,
      );
      expect(workspaceCardDeckCssSource).toMatch(
        /\.workspace-card-drawer\[data-workspace-card-drawer-sizing="content"\]\s+\.workspace-card-drawer__content\s*\{[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*hidden;/,
      );
      expect(gitWorkspaceDeckCssSource).not.toContain("var(--git-workbench-drawer-height)");
      expect(workspaceCardDrawerShellSource).not.toContain("--git-workbench-drawer-height");
      expect(gitWorkbenchDrawerShellSource).not.toContain("DRAWER_DEFAULT_MAX_HEIGHT");
      expect(gitWorkbenchDrawerShellSource).not.toContain("DRAWER_HEIGHT_STORAGE_KEY");
      expect(gitWorkspaceDeckLogicSource).not.toContain("resolveGitDrawerHeight");
      expect(gitWorkspaceDeckLogicSource).not.toContain("nextGitDrawerHeightFromPointer");
      expect(gitWorkspaceDeckLogicSource).not.toContain("parsePersistedGitDrawerHeight");
    }),
  );

  it("keeps Overview, Branches, and Operations at their natural document height", () => {
    expect(gitOverviewPanelSource).toContain(
      'className="grid min-h-0 gap-4 p-4 @3xl/git-panel:grid-cols-',
    );
    expect(gitBranchesPanelSource).toContain('className="grid gap-4 p-4 @3xl/git-panel:grid-cols-');
    expect(gitOperationsPanelSource).toContain(
      'className="grid gap-4 p-4 @3xl/git-panel:grid-cols-',
    );
    expect(gitOverviewPanelSource).not.toMatch(/<div className="[^"]*size-full/);
    expect(gitBranchesPanelSource).not.toMatch(/<div className="[^"]*size-full/);
    expect(gitOperationsPanelSource).not.toMatch(/<div className="[^"]*size-full/);
  });

  it("removes fill-height roots while retaining a capped Overview scroll owner", () => {
    expect(gitWorkbenchPanelSource).toContain("data-git-workbench-view={props.activeTab}");
    expect(gitWorkbenchPanelSource).not.toContain(
      'className="@container/git-panel flex size-full min-h-0 flex-col bg-background"',
    );
    expect(gitWorkbenchPanelSource).not.toContain(
      'className="grid size-full min-h-48 place-content-center',
    );
    expect(gitWorkbenchPanelSource).toMatch(/className="relative min-h-0 flex-auto overflow-auto"/);
  });

  it("reports content height changes from the drawer border box", () => {
    expect(workspaceCardDrawerShellSource).toContain(
      "const nextHeight = drawer.getBoundingClientRect().height",
    );
    expect(workspaceCardDrawerShellSource).toContain("new ResizeObserver(reportHeight)");
    expect(workspaceCardDrawerShellSource).toContain(
      'observer.observe(drawer, { box: "border-box" })',
    );
    expect(workspaceCardDrawerShellSource).toContain("notifyHeightChange(nextHeight)");
  });

  it("preserves History virtualization and Changes scrolling within the capped view", () => {
    expect(gitHistoryPanelSource).not.toContain(
      'className="grid size-full min-h-0 @container/git-history',
    );
    expect(gitHistoryPanelSource).toContain('className="min-h-0 flex-1 overflow-auto"');
    expect(gitHistoryPanelSource).toContain("onScroll={onScroll}");
    expect(gitHistoryPanelSource).toContain("props.onLoadMore()");

    expect(gitChangesPanelSource).not.toContain(
      'className="grid size-full min-h-0 @container/git-changes',
    );
    expect(gitChangesPanelSource).not.toContain('className="flex size-full min-h-0 flex-col"');
    expect(gitChangesPanelSource).toContain('"min-h-0 overflow-auto border-r"');
    expect(gitChangesPanelSource).toContain(
      'className="max-h-[45%] min-h-32 overflow-auto border-b',
    );
  });

  it("leaves MCP on the stored, vertically resizable drawer path", () => {
    const html = renderResizableMcpDrawer();

    expect(mcpWorkspaceControllerSource).toContain('resizeLabel="Resize MCP workspace vertically"');
    expect(mcpWorkspaceControllerSource).toContain("storageKey={MCP_DRAWER_STORAGE_KEY}");
    expect(mcpWorkspaceControllerSource).not.toContain('sizingMode="content"');
    expect(html).toContain("--workspace-card-drawer-height:384px");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize MCP workspace vertically"');
  });
});
