import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { McpProviderWorkspace } from "./McpProviderWorkspace";

const providers = [
  {
    instanceId: "claude_personal",
    driver: "claudeAgent",
    displayName: "Claude",
    label: "Claude · claude_personal",
    tooltip: "Claude · Claude · claude_personal",
    accentColor: "#7c3aed",
    disabled: false,
    supportsUserMcp: true,
    statusLabel: "Ready",
    statusTone: "success",
  },
  {
    instanceId: "claude_work",
    driver: "claudeAgent",
    displayName: "Claude",
    label: "Claude · claude_work",
    tooltip: "Claude · Claude · claude_work",
    disabled: false,
    supportsUserMcp: true,
    statusLabel: "Ready",
    statusTone: "success",
  },
] as const;

function renderWorkspace(
  overrides: Partial<Parameters<typeof McpProviderWorkspace>[0]> = {},
): string {
  return renderToStaticMarkup(
    <McpProviderWorkspace
      providers={providers}
      selectedProviderId="claude_work"
      contexts={[]}
      selectedContextId={null}
      configuredServers={[]}
      runtimeServers={[]}
      runtimeSupported
      providerAssignmentsSupported
      isLoadingRuntime={false}
      pendingProviderServerIds={new Set()}
      pendingRuntimeAction={null}
      onSelectProvider={vi.fn()}
      onSelectContext={vi.fn()}
      onToggleProviderServer={vi.fn()}
      onEditServer={vi.fn()}
      onDuplicateServer={vi.fn()}
      onDeleteServer={vi.fn()}
      onRuntimeAction={vi.fn()}
      onLoadServerDetails={vi.fn()}
      {...overrides}
    />,
  );
}

describe("McpProviderWorkspace", () => {
  it("renders disambiguated provider tabs with a scoped accent", () => {
    const html = renderWorkspace();

    expect(html).toContain("Claude · claude_personal");
    expect(html).toContain("Claude · claude_work");
    expect(html).toContain("--mcp-provider-accent:#7c3aed");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
  });

  it("lets an embedded controller provide the single provider-tab surface", () => {
    const html = renderWorkspace({
      embedded: true,
      showProviderTabs: false,
      showRuntimeSelector: false,
    });

    expect(html).not.toContain('aria-label="MCP provider accounts"');
    expect(html).not.toContain('aria-label="Runtime session"');
    expect(html).toContain('data-mcp-provider-workspace="embedded"');
    expect(html).toContain("border-y border-border/60 bg-transparent");
    expect(html).not.toContain("rounded-xl border border-[var(--mcp-provider-accent");
    expect(html).toContain("T3-managed servers");
  });

  it("describes configured servers honestly when no live session exists", () => {
    const html = renderWorkspace({
      configuredServers: [
        {
          id: "notion",
          name: "Notion",
          enabledForProvider: true,
          globallyEnabled: true,
          globalScope: true,
          scopeLabel: "Global",
          transport: "http",
          summary: "https://mcp.notion.com/mcp",
          secretCount: 0,
        },
      ],
    });

    expect(html).toContain("Configured for new sessions");
    expect(html).toContain("Notion");
    expect(html).not.toContain(">Connected<");
  });

  it("separates managed, provider-native, and locked T3 system servers", () => {
    const html = renderWorkspace({
      contexts: [
        {
          id: "runtime-1",
          runtimeSessionId: "runtime-1",
          threadId: "thread-1",
          label: "Website · MCP polish",
          live: true,
        },
      ],
      selectedContextId: "runtime-1",
      runtimeServers: [
        {
          serverKey: "native-notion",
          name: "Notion native",
          source: "provider-native",
          state: "auth-required",
          toolCount: 5,
          capabilities: { authorize: true, reconnect: true, refresh: true },
        },
        {
          serverKey: "t3-code",
          name: "t3-code",
          source: "t3-built-in",
          state: "connected",
          capabilities: {},
        },
      ],
    });

    expect(html).toContain("Provider-managed servers");
    expect(html).toContain("T3 Code System Server");
    expect(html).toContain("Authorization required");
    expect(html).toContain("5 tools");
    expect(html).toContain(">Authorize<");
    expect(html).toContain('aria-label="Actions for Notion native"');
  });

  it("uses one shared primary action and a visibly labeled provider switch", () => {
    const html = renderWorkspace({
      contexts: [
        {
          id: "runtime-1",
          runtimeSessionId: "runtime-1",
          threadId: "thread-1",
          label: "Website · MCP polish",
          live: true,
        },
      ],
      selectedContextId: "runtime-1",
      configuredServers: [
        {
          id: "notion",
          name: "Notion",
          enabledForProvider: true,
          globallyEnabled: true,
          globalScope: true,
          scopeLabel: "Global",
          transport: "http",
          summary: "https://mcp.notion.com/mcp",
          secretCount: 0,
        },
      ],
      runtimeServers: [
        {
          serverKey: "notion-runtime",
          definitionId: "notion",
          name: "Notion",
          source: "t3-managed",
          state: "failed",
          capabilities: { reconnect: true, refresh: true },
        },
      ],
    });

    expect(html).toContain(">Reconnect<");
    expect(html).toContain(">Enabled<");
    expect(html).toContain('aria-label="Actions for Notion"');
  });

  it("only marks the exact pending runtime row as busy", () => {
    const html = renderWorkspace({
      pendingRuntimeAction: { serverKey: "native-notion", action: "reconnect" },
      runtimeServers: [
        {
          serverKey: "native-notion",
          name: "Notion native",
          source: "provider-native",
          state: "failed",
          capabilities: { reconnect: true, refresh: true },
        },
        {
          serverKey: "native-slack",
          name: "Slack native",
          source: "provider-native",
          state: "failed",
          capabilities: { reconnect: true, refresh: true },
        },
      ],
    });

    expect(html).toContain("Reconnecting Notion native");
    expect(html).not.toContain("Reconnecting Slack native");
    expect(html).toContain(">Reconnect<");
  });

  it("uses the canonical configured denominator for provider-tab health", () => {
    const html = renderWorkspace({
      runtimeSummary: {
        mode: "live",
        configuredCount: 2,
        connectedCount: 1,
        expectedCount: 2,
        attentionCount: 1,
        knownToolCount: null,
        observedAt: "2026-08-03T12:00:00.000Z",
        statusLabel: "1 need attention",
      },
    });

    expect(html).toContain("1/2");
  });

  it("shows disclosed tools, resources, and resource templates", () => {
    const html = renderWorkspace({
      contexts: [
        {
          id: "runtime-1",
          runtimeSessionId: "runtime-1",
          threadId: "thread-1",
          label: "Website · MCP polish",
          live: true,
        },
      ],
      selectedContextId: "runtime-1",
      focusedServerKey: "native-notion",
      runtimeServers: [
        {
          serverKey: "native-notion",
          name: "Notion native",
          source: "provider-native",
          state: "connected",
          tools: [{ name: "search", title: "Search pages" }],
          resources: [{ uri: "notion://readme", name: "readme", title: "Workspace README" }],
          templates: [
            {
              uriTemplate: "notion://database/{id}",
              name: "database",
              title: "Database template",
            },
          ],
          capabilities: { reportsTools: true },
        },
      ],
    });

    expect(html).toContain("Search pages");
    expect(html).toContain('aria-label="MCP resources"');
    expect(html).toContain("notion://readme");
    expect(html).toContain('aria-label="MCP resource templates"');
    expect(html).toContain("notion://database/{id}");
  });

  it("shows mixed-version fallback instead of pretending runtime health", () => {
    const html = renderWorkspace({ runtimeSupported: false });

    expect(html).toContain("This server version does not report MCP runtime status");
    expect(html).not.toContain(">Connected<");
  });

  it("keeps user MCP assignments locked for unsupported providers", () => {
    const html = renderWorkspace({
      providers: [
        {
          instanceId: "grok",
          driver: "grok",
          displayName: "Grok",
          label: "Grok",
          tooltip: "Grok · Grok · grok",
          disabled: false,
          supportsUserMcp: false,
          statusLabel: "Ready",
          statusTone: "success",
        },
      ],
      selectedProviderId: "grok",
      configuredServers: [
        {
          id: "notion",
          name: "Notion",
          enabledForProvider: false,
          globallyEnabled: true,
          globalScope: true,
          scopeLabel: "Global",
          transport: "http",
          summary: "https://mcp.notion.com/mcp",
          secretCount: 0,
        },
      ],
    });

    expect(html).toContain("does not support user-configured MCP servers");
    expect(html).toContain("disabled");
  });

  it("keeps status inspectable while explaining read-only mutation controls", () => {
    const html = renderWorkspace({
      readOnly: true,
      configuredServers: [
        {
          id: "notion",
          name: "Notion",
          enabledForProvider: true,
          globallyEnabled: true,
          globalScope: true,
          scopeLabel: "Global",
          transport: "http",
          summary: "https://mcp.notion.com/mcp",
          secretCount: 0,
        },
      ],
    });

    expect(html).toContain("read-only access");
    expect(html).toContain("Notion");
    expect(html).toContain('aria-label="Actions for Notion"');
    expect(html).toMatch(
      /<span[^>]*data-disabled=""[^>]*aria-label="Disable Notion for selected provider"/,
    );
  });
});
