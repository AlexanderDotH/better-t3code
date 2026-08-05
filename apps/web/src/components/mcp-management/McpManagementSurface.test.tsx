import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { McpProviderWorkspace, McpServerEditorDialog, type McpProviderTab } from "./index";

const provider: McpProviderTab = {
  instanceId: "codex",
  driver: "codex",
  label: "Codex",
  displayName: "Codex",
  tooltip: "Codex · Codex · codex",
  disabled: false,
  supportsUserMcp: true,
  statusLabel: "Ready",
  statusTone: "success",
};

describe("MCP management public surface", () => {
  it("renders the shared provider/runtime groups outside the Settings route", () => {
    const html = renderToStaticMarkup(
      <McpProviderWorkspace
        providers={[provider]}
        selectedProviderId="codex"
        contexts={[]}
        selectedContextId={null}
        configuredServers={[]}
        runtimeServers={[]}
        runtimeSupported
        providerAssignmentsSupported
        isLoadingRuntime={false}
        pendingProviderServerIds={new Set()}
        onSelectProvider={vi.fn()}
        onSelectContext={vi.fn()}
        onToggleProviderServer={vi.fn()}
        onEditServer={vi.fn()}
        onDuplicateServer={vi.fn()}
        onDeleteServer={vi.fn()}
        onRuntimeAction={vi.fn()}
        onLoadServerDetails={vi.fn()}
      />,
    );

    expect(html).toContain("T3-managed servers");
    expect(html).toContain("Configured for new sessions");
  });

  it("exports the controlled editor for Settings and workspace-card controllers", () => {
    expect(typeof McpServerEditorDialog).toBe("function");
  });
});
