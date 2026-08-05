import { ProviderDriverKind } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { McpWorkspaceCard } from "./McpWorkspaceCard";
import { McpWorkspacePanel } from "./McpWorkspacePanel";
import { McpWorkspacePeek } from "./McpWorkspacePeek";

const summary = {
  attentionCount: 1,
  configuredCount: 3,
  connectedCount: 2,
  expectedCount: 3,
  freshnessLabel: "Observed just now",
  state: "live" as const,
  statusLabel: "2 of 3 connected · 1 needs attention",
  toolCount: 12,
};

describe("McpWorkspaceCard", () => {
  it("renders truthful compact provider statistics without an inner scrollbar", () => {
    const html = renderToStaticMarkup(
      <McpWorkspaceCard
        providerDisplayName="Codex Work"
        providerDriver={ProviderDriverKind.make("codex")}
        summary={summary}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain('data-mcp-workspace-card="true"');
    expect(html).toContain('data-workspace-card-compact-surface="true"');
    expect(html).toContain("Codex Work");
    expect(html).toContain("2 / 3 connected");
    expect(html).toContain("1 needs attention");
    expect(html).toContain("12 known tools");
    expect(html).toContain('aria-label="Expand MCP workspace"');
    expect(html).not.toContain("overflow:auto");
  });

  it("keeps the expanded workbench inside the same card", () => {
    const html = renderToStaticMarkup(
      <McpWorkspaceCard
        expanded
        providerDisplayName="Codex Work"
        providerDriver={ProviderDriverKind.make("codex")}
        summary={summary}
        workbench={<div data-mcp-workbench>Full MCP management</div>}
        onExpand={vi.fn()}
      />,
    );

    const cardStart = html.indexOf("<article");
    const workbenchStart = html.indexOf("data-mcp-workbench");
    const cardEnd = html.indexOf("</article>", cardStart);
    expect(workbenchStart).toBeGreaterThan(cardStart);
    expect(workbenchStart).toBeLessThan(cardEnd);
  });

  it("does not imply observed connectivity for configuration-only states", () => {
    const html = renderToStaticMarkup(
      <McpWorkspaceCard
        providerDisplayName="Codex Work"
        providerDriver={ProviderDriverKind.make("codex")}
        summary={{
          ...summary,
          attentionCount: 0,
          connectedCount: 0,
          expectedCount: 3,
          freshnessLabel: "Runtime status requires a server upgrade",
          state: "upgrade-required",
          statusLabel: "3 configured · upgrade required",
          toolCount: null,
        }}
        onExpand={vi.fn()}
      />,
    );

    expect(html).toContain("3 configured · upgrade required");
    expect(html).not.toContain("0 / 3 connected");
  });
});

describe("McpWorkspacePeek", () => {
  it("makes the complete exposed edge an accessible activation target", () => {
    const html = renderToStaticMarkup(
      <McpWorkspacePeek
        blocked={false}
        position="next"
        providerDisplayName="Codex Work"
        summary={summary}
        requestActivation={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Open MCP workspace"');
    expect(html).toContain('data-workspace-card-peek="mcp"');
    expect(html).toContain("Codex Work");
    expect(html).toContain("1 needs attention");
  });
});

describe("McpWorkspacePanel", () => {
  it("offers Servers and Runtime as explicit management sections", () => {
    const html = renderToStaticMarkup(
      <McpWorkspacePanel
        activeSection="servers"
        servers={<div>Server configuration</div>}
        runtime={<div>Exact runtime session</div>}
        onActiveSectionChange={vi.fn()}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain("Servers");
    expect(html).toContain("Runtime");
    expect(html).toContain("Server configuration");
    expect(html).not.toContain("Exact runtime session");
  });
});
