import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { renderToStaticMarkup } from "react-dom/server";
import { expectTypeOf, vi } from "vite-plus/test";

import {
  WorkspaceCardDrawerShell,
  type WorkspaceCardDrawerShellProps,
} from "../workspace-deck/WorkspaceCardDrawerShell";
import {
  findWorkspaceDeckCompactContent,
  findWorkspaceDeckCompactSurface,
  findWorkspaceDeckExpandedSurface,
} from "../workspace-deck/useWorkspaceCardDeckMeasurements";
import { GitWorkbenchDrawerShell } from "./GitWorkbenchDrawerShell";

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

describe("Git workbench content sizing behavior", () => {
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
      expect(html).toContain('data-workspace-card-expanded-surface="true"');
      expect(html).not.toContain('role="separator"');
      expect(html).not.toContain('aria-label="Resize Git workbench vertically"');
      expect(html).not.toContain("640px");
    },
  );

  it("selects the marked compact and expanded border boxes for shared measurement", () => {
    const compactContent = {} as HTMLElement;
    const compactSurface = {} as HTMLElement;
    const expandedSurface = {} as HTMLElement;
    const intrinsic = {
      querySelector: vi.fn((selector: string) => {
        if (selector === '[data-workspace-card-compact-content="true"]') return compactContent;
        if (selector === '[data-workspace-card-compact-surface="true"]') return compactSurface;
        if (selector === '[data-workspace-card-expanded-surface="true"]') return expandedSurface;
        return null;
      }),
    } as unknown as HTMLElement;

    expect(findWorkspaceDeckCompactContent(intrinsic)).toBe(compactContent);
    expect(findWorkspaceDeckCompactSurface(intrinsic, compactContent)).toBe(compactSurface);
    expect(findWorkspaceDeckExpandedSurface(intrinsic)).toBe(expandedSurface);
  });

  it("falls back to the intrinsic element when no expanded border box is marked", () => {
    const intrinsic = { querySelector: vi.fn(() => null) } as unknown as HTMLElement;
    expect(findWorkspaceDeckExpandedSurface(intrinsic)).toBe(intrinsic);
  });

  it("keeps MCP on the stored, vertically resizable drawer behavior", () => {
    const html = renderResizableMcpDrawer();

    expect(html).toContain('data-workspace-card-drawer-sizing="resizable"');
    expect(html).toContain("--workspace-card-drawer-height:384px");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize MCP workspace vertically"');
  });
});

// Node has no CSS layout engine. These assertions deliberately guard the two
// cascade rules that make the rendered behavioral contract above shrink-wrap
// and cap; view ownership and measurement selection are tested through APIs.
describe("Git workbench CSS repository policy", () => {
  it.effect("keeps content drawers shrink-wrapped with one capped overflow owner", () =>
    Effect.gen(function* () {
      const { gitWorkspaceDeckCssSource, workspaceCardDeckCssSource } = yield* readDrawerCss;

      expect(workspaceCardDeckCssSource).toMatch(
        /\.workspace-card-drawer\[data-workspace-card-drawer-sizing="content"\]\s*\{[^}]*height:\s*(?:auto|fit-content);[^}]*max-height:\s*var\(--workspace-card-drawer-max-height\);/,
      );
      expect(workspaceCardDeckCssSource).toMatch(
        /\.workspace-card-drawer\[data-workspace-card-drawer-sizing="content"\]\s+\.workspace-card-drawer__content\s*\{[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*hidden;/,
      );
      expect(gitWorkspaceDeckCssSource).not.toContain("var(--git-workbench-drawer-height)");
    }),
  );
});
