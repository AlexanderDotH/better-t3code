import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import type { McpConfiguredServerView, McpRuntimeServerView } from "./McpProviderWorkspace";
import { McpProviderWorkspace } from "./McpProviderWorkspace";

const providers = [
  {
    instanceId: "claude_work",
    driver: "claudeAgent",
    displayName: "Claude",
    label: "Claude · claude_work",
    tooltip: "Claude · Claude · claude_work",
    account: "alex.work@example.test",
    accentColor: "#7c3aed",
    disabled: false,
    supportsUserMcp: true,
    statusLabel: "Ready",
    statusTone: "success",
  },
  {
    instanceId: "claude_personal",
    driver: "claudeAgent",
    displayName: "Claude",
    label: "Claude · claude_personal",
    tooltip: "Claude · Claude · claude_personal",
    account: "alex.personal@example.test",
    accentColor: "#0ea5e9",
    disabled: false,
    supportsUserMcp: true,
    statusLabel: "Warning",
    statusTone: "warning",
  },
  {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    label: "Codex",
    tooltip: "Codex · Codex · codex",
    disabled: false,
    supportsUserMcp: true,
    statusLabel: "Ready",
    statusTone: "success",
  },
] as const;

const configuredServers: ReadonlyArray<McpConfiguredServerView> = Array.from(
  { length: 18 },
  (_, index) => ({
    id: index === 0 ? "notion" : `server-${index}`,
    name: index === 0 ? "Notion" : `Workspace server ${index}`,
    enabledForProvider: true,
    globallyEnabled: true,
    globalScope: index % 2 === 0,
    scopeLabel: index % 2 === 0 ? "Global" : "/workspace/better-t3code",
    transport: index % 3 === 0 ? "HTTP" : "stdio",
    summary:
      index % 3 === 0 ? `https://mcp-${index}.example.test` : `npx @example/mcp-server-${index}`,
    secretCount: index % 4 === 0 ? 1 : 0,
  }),
);

const runtimeServers: ReadonlyArray<McpRuntimeServerView> = [
  {
    serverKey: "notion",
    definitionId: "notion",
    name: "Notion",
    source: "t3-managed",
    state: "auth-required",
    authLabel: "Authorization required",
    transport: "http",
    toolCount: 14,
    resourceCount: 2,
    templateCount: 1,
    version: "1.4.0",
    error: "Notion requires authorization again.",
    capabilities: { authorize: true, reconnect: true, refresh: true, reportsTools: true },
  },
  {
    serverKey: "native-search",
    name: "Provider Search",
    source: "provider-native",
    state: "connected",
    toolCount: 3,
    capabilities: { refresh: true, reportsTools: true },
  },
  {
    serverKey: "t3-code",
    name: "T3 Code System Server",
    source: "t3-built-in",
    state: "connected",
    toolCount: 8,
    capabilities: { reportsTools: true },
  },
];

function Harness(props: { readonly onLoadServerDetails?: (serverKey: string) => void }) {
  return (
    <main className="min-h-dvh bg-background p-3 text-foreground sm:p-8">
      <div data-outside-accent className="mb-4 rounded-lg border border-border p-3 text-xs">
        Outside the provider panel
      </div>
      <McpProviderWorkspace
        providers={providers}
        selectedProviderId="claude_work"
        contexts={[
          {
            id: "thread-1:runtime-1",
            runtimeSessionId: "runtime-1",
            threadId: "thread-1",
            label: "better-t3code · MCP polish",
            live: true,
          },
        ]}
        selectedContextId="thread-1:runtime-1"
        configuredServers={configuredServers}
        runtimeServers={runtimeServers}
        runtimeSupported
        providerAssignmentsSupported
        isLoadingRuntime={false}
        focusedServerKey="notion"
        pendingProviderServerIds={new Set()}
        onSelectProvider={() => {}}
        onSelectContext={() => {}}
        onToggleProviderServer={() => {}}
        onEditServer={() => {}}
        onDuplicateServer={() => {}}
        onDeleteServer={() => {}}
        onRuntimeAction={() => {}}
        onLoadServerDetails={props.onLoadServerDetails ?? (() => {})}
      />
    </main>
  );
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("MCP provider Settings browser behavior", () => {
  it.each([
    [1_400, 1_100],
    [960, 1_100],
    [430, 932],
  ])("keeps tabs and server rows inside a %ipx viewport", async (width, height) => {
    await page.viewport(width, height);
    render(<Harness />);

    await expect.element(page.getByRole("tab", { name: /Claude · claude_work/ })).toBeVisible();
    await expect
      .element(page.getByText("Authorization required", { exact: true }).first())
      .toBeVisible();
    await expect.element(page.getByText("Provider-managed servers")).toBeVisible();
    await expect.element(page.getByText("T3 Code System Server").first()).toBeVisible();

    const tabList = page.getByRole("tablist").element();
    const panel = tabList.parentElement;
    expect(panel).not.toBeNull();
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    expect(panelRect.left).toBeGreaterThanOrEqual(0);
    expect(panelRect.right).toBeLessThanOrEqual(width);
    expect(getComputedStyle(panel).borderTopColor).not.toBe(
      getComputedStyle(document.querySelector<HTMLElement>("[data-outside-accent]")!)
        .borderTopColor,
    );
  });

  it.each([false, true])("renders the provider panel in %s dark mode", async (dark) => {
    document.documentElement.classList.toggle("dark", dark);
    render(<Harness />);

    await expect.element(page.getByRole("tab", { name: /Claude · claude_personal/ })).toBeVisible();
    await expect.element(page.getByRole("tab", { name: /Codex/ })).toBeVisible();
    await expect.element(page.getByText("Notion requires authorization again.")).toBeVisible();
  });

  it("exposes duplicate-account details and accent color from keyboard focus", async () => {
    render(<Harness />);

    const tab = page.getByRole("tab", { name: /Claude · claude_work/ });
    await expect.element(tab).toBeVisible();
    tab.element().focus();

    await expect
      .element(page.getByText("Claude · Claude · claude_work", { exact: true }))
      .toBeVisible();
    expect(document.activeElement).toBe(tab.element());
    expect(tab.element().style.getPropertyValue("--mcp-provider-accent")).toBe("#7c3aed");
  });

  it("loads tool details only when the server disclosure opens", async () => {
    const onLoadServerDetails = vi.fn();
    render(<Harness onLoadServerDetails={onLoadServerDetails} />);

    await vi.waitFor(() => expect(onLoadServerDetails).toHaveBeenCalledTimes(1));
    onLoadServerDetails.mockClear();
    await page.getByRole("button", { name: "Hide Notion details" }).click();
    await page.getByRole("button", { name: "Show Notion details" }).click();
    await vi.waitFor(() => expect(onLoadServerDetails).toHaveBeenCalledTimes(1));
  });
});
