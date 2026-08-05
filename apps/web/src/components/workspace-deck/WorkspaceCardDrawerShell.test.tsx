import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { WorkspaceCardDrawerShell } from "./WorkspaceCardDrawerShell";

describe("WorkspaceCardDrawerShell", () => {
  it("renders a reusable vertically resizable drawer with caller-owned labels and tabs", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open
        availableHeight={620}
        activeTab="servers"
        ariaLabel="MCP workspace"
        collapseLabel="Collapse MCP workspace"
        resizeLabel="Resize MCP workspace vertically"
        storageKey="t3code:mcp-workspace-drawer-height:v1"
        tabs={[
          { id: "servers", label: "Servers" },
          { id: "runtime", label: "Runtime" },
        ]}
        title="MCP workspace"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Provider management</div>
      </WorkspaceCardDrawerShell>,
    );

    expect(html).toContain("--workspace-card-drawer-height:384px");
    expect(html).toContain('aria-label="Resize MCP workspace vertically"');
    expect(html).toContain('aria-label="Collapse MCP workspace"');
    expect(html).toContain("Servers");
    expect(html).toContain("Runtime");
    expect(html).toContain("Provider management");
  });

  it("does not mount content while collapsed", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open={false}
        activeTab="runtime"
        ariaLabel="MCP workspace"
        collapseLabel="Collapse MCP workspace"
        resizeLabel="Resize MCP workspace vertically"
        storageKey="t3code:mcp-workspace-drawer-height:v1"
        tabs={[]}
        title="MCP workspace"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Provider management</div>
      </WorkspaceCardDrawerShell>,
    );

    expect(html).toBe("");
  });
});
