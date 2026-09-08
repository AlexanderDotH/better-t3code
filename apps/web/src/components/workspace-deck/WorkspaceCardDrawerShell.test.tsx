import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { pseudoLocalizeInterfaceMessage } from "@t3tools/shared/interfaceLanguage";

const translatorFixture = vi.hoisted(() => ({ language: "en" as "en" | "de" }));

vi.mock("~/hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () =>
      createInterfaceTranslator({
        language: translatorFixture.language,
        locale: translatorFixture.language === "de" ? "de-DE" : "en-US",
      }),
  };
});

import { WorkspaceCardDrawerShell } from "./WorkspaceCardDrawerShell";

describe("WorkspaceCardDrawerShell", () => {
  afterEach(() => {
    translatorFixture.language = "en";
    vi.unstubAllGlobals();
  });

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

  it("uses a persisted resizable height when it is within the safe bounds", () => {
    const getItem = vi.fn(() => "432");
    vi.stubGlobal("window", {
      innerHeight: 620,
      localStorage: { getItem },
    });

    const html = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open
        availableHeight={620}
        activeTab="servers"
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

    expect(getItem).toHaveBeenCalledWith("t3code:mcp-workspace-drawer-height:v1");
    expect(html).toContain("--workspace-card-drawer-height:432px");
  });

  it("shrink-wraps content up to the safe maximum without storage or a resize handle", () => {
    const getItem = vi.fn(() => "432");
    vi.stubGlobal("window", {
      innerHeight: 620,
      localStorage: { getItem },
    });

    const compactHtml = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open
        sizingMode="content"
        availableHeight={620}
        activeTab="overview"
        ariaLabel="Git workbench"
        collapseLabel="Collapse Git workbench"
        tabs={[{ id: "overview", label: "Overview" }]}
        title="Git workbench"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Repository overview</div>
      </WorkspaceCardDrawerShell>,
    );
    const tallHtml = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open
        sizingMode="content"
        availableHeight={1_400}
        activeTab="overview"
        ariaLabel="Git workbench"
        collapseLabel="Collapse Git workbench"
        tabs={[]}
        title="Git workbench"
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Repository overview</div>
      </WorkspaceCardDrawerShell>,
    );

    expect(getItem).not.toHaveBeenCalled();
    expect(compactHtml).toContain('data-workspace-card-drawer-sizing="content"');
    expect(compactHtml).toContain("--workspace-card-drawer-max-height:460px");
    expect(compactHtml).not.toContain("--workspace-card-drawer-height");
    expect(compactHtml).not.toContain('role="separator"');
    expect(tallHtml).toContain("--workspace-card-drawer-max-height:1120px");
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

  it("localizes the tablist label while preserving a long dynamic title", () => {
    translatorFixture.language = "de";
    const title = Array.from({ length: 3 }, () =>
      pseudoLocalizeInterfaceMessage("betterT3.chat.workspaceCardDeck.label"),
    ).join(" ");
    const html = renderToStaticMarkup(
      <WorkspaceCardDrawerShell
        open
        sizingMode="content"
        availableHeight={620}
        activeTab="overview"
        ariaLabel={title}
        collapseLabel={title}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "details", label: "Details" },
        ]}
        title={title}
        onActiveTabChange={vi.fn()}
        onOpenChange={vi.fn()}
      >
        <div>Content</div>
      </WorkspaceCardDrawerShell>,
    );

    expect(html).toContain(`aria-label="Ansichten für ${title}"`);
    expect(html).toContain('class="min-w-0"');
    expect(html).toContain('class="workspace-card-drawer__tabs"');
  });
});
