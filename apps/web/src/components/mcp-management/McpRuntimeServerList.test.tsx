import { McpRuntimeServerKey, type McpRuntimeServer } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { McpRuntimeInventoryDetails, McpRuntimeServerList } from "./McpRuntimeServerList";

function server(overrides: Partial<McpRuntimeServer> = {}): McpRuntimeServer {
  return {
    providerKey: McpRuntimeServerKey.make("notion"),
    source: "t3-managed",
    name: "Notion",
    transport: "http",
    state: "auth-required",
    statusSource: "provider-query",
    observedAt: "2026-08-02T00:00:00.000Z",
    authState: "required",
    availableActions: ["authorize", "reconnect", "refresh"],
    reportsTools: true,
    toolCount: 12,
    resourceCount: 2,
    templateCount: 1,
    configDrift: "none",
    ...overrides,
  } as McpRuntimeServer;
}

describe("McpRuntimeServerList", () => {
  it("shows explicit auth state, safe inventory counts, supported actions, and system ownership", () => {
    const html = renderToStaticMarkup(
      <McpRuntimeServerList
        authorizationAvailable
        providerDisplayName="Codex Personal"
        servers={[
          server(),
          server({
            providerKey: McpRuntimeServerKey.make("t3-code"),
            source: "t3-built-in",
            name: "t3-code",
            state: "connected",
            authState: "authenticated",
            availableActions: [],
          }),
        ]}
        pendingAction={null}
        detailsByProviderKey={{}}
        detailsLoadingKeys={new Set()}
        detailsErrorByProviderKey={{}}
        actionErrorByProviderKey={{}}
        onToggleDetails={() => {}}
        onAction={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(html).toContain("Codex Personal");
    expect(html).toContain("Authorization required");
    expect(html).toContain("12 tools");
    expect(html).toContain(">Authorize<");
    expect(html).toContain('aria-label="Actions for Notion"');
    expect(html).toContain("T3 Code System Server");
    expect(html).toContain("T3-managed servers");
    expect(html).toContain("T3 Code system server");
    expect(html).toContain("Manage MCP servers");
  });

  it("directs remote authorization to the environment host", () => {
    const html = renderToStaticMarkup(
      <McpRuntimeServerList
        authorizationAvailable={false}
        providerDisplayName="Remote Codex"
        servers={[server()]}
        pendingAction={null}
        detailsByProviderKey={{}}
        detailsLoadingKeys={new Set()}
        detailsErrorByProviderKey={{}}
        actionErrorByProviderKey={{}}
        onToggleDetails={() => {}}
        onAction={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(html).toContain(">Authorize<");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Authorize/s);
    expect(html).toContain("Complete authorization on the environment host");
  });

  it("disables runtime mutations for read-only users", () => {
    const html = renderToStaticMarkup(
      <McpRuntimeServerList
        authorizationAvailable
        readOnly
        providerDisplayName="Codex Personal"
        servers={[server()]}
        pendingAction={null}
        detailsByProviderKey={{}}
        detailsLoadingKeys={new Set()}
        detailsErrorByProviderKey={{}}
        actionErrorByProviderKey={{}}
        onToggleDetails={() => {}}
        onAction={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(html).toContain("Runtime actions require operate access");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("only disables mutations on the exact pending server row", () => {
    const html = renderToStaticMarkup(
      <McpRuntimeServerList
        authorizationAvailable
        providerDisplayName="Codex Personal"
        servers={[
          server(),
          server({
            providerKey: McpRuntimeServerKey.make("slack"),
            name: "Slack",
          }),
        ]}
        pendingAction={{ serverKey: "notion", action: "authorize" }}
        detailsByProviderKey={{}}
        detailsLoadingKeys={new Set()}
        detailsErrorByProviderKey={{}}
        actionErrorByProviderKey={{}}
        onToggleDetails={() => {}}
        onAction={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(html).toContain("Authorizing Notion");
    expect(html).not.toContain("Authorizing Slack");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("renders lazy tools, resources, and resource templates", () => {
    const html = renderToStaticMarkup(
      <McpRuntimeInventoryDetails
        serverName="Notion"
        reportsTools
        details={{
          tools: [{ name: "search", title: "Search pages", readOnly: true }],
          resources: [
            {
              uri: "notion://workspace/readme",
              name: "readme",
              title: "Workspace README",
              mimeType: "text/markdown",
            },
          ],
          templates: [
            {
              uriTemplate: "notion://database/{databaseId}",
              name: "database",
              title: "Database template",
            },
          ],
        }}
      />,
    );

    expect(html).toContain('aria-label="Notion tools"');
    expect(html).toContain("Search pages");
    expect(html).toContain('aria-label="Notion resources"');
    expect(html).toContain("notion://workspace/readme");
    expect(html).toContain('aria-label="Notion resource templates"');
    expect(html).toContain("notion://database/{databaseId}");
  });
});
