import "../../index.css";
import "../mcp-workspace/McpWorkspaceCard.css";

import { McpRuntimeServerKey, type McpRuntimeServer } from "@t3tools/contracts";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { McpRuntimeServerList } from "../mcp-management/McpRuntimeServerList";
import { McpWorkspacePanel, type McpWorkspaceSection } from "../mcp-workspace/McpWorkspacePanel";
import type { McpConfiguredServerView, McpRuntimeServerView } from "./McpProviderWorkspace";
import { McpProviderWorkspace } from "./McpProviderWorkspace";
import { McpScopeFilterControls } from "./McpScopeFilterControls";

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

interface ProviderWorkspaceFixtureProps {
  readonly focusedServerKey?: string;
  readonly pendingRuntimeAction?: {
    readonly serverKey: string;
    readonly action: "authorize" | "reconnect" | "refresh";
  } | null;
  readonly readOnly?: boolean;
  readonly showProviderTabs?: boolean;
  readonly showRuntimeSelector?: boolean;
  readonly onLoadServerDetails?: (serverKey: string) => void;
  readonly onSelectProvider?: (providerId: string) => void;
  readonly onToggleProviderServer?: (serverId: string, enabled: boolean) => void;
}

function ProviderWorkspaceFixture(props: ProviderWorkspaceFixtureProps) {
  return (
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
      focusedServerKey={props.focusedServerKey ?? "notion"}
      pendingProviderServerIds={new Set()}
      {...(props.pendingRuntimeAction === undefined
        ? {}
        : { pendingRuntimeAction: props.pendingRuntimeAction })}
      {...(props.readOnly === undefined ? {} : { readOnly: props.readOnly })}
      {...(props.showProviderTabs === undefined
        ? {}
        : { showProviderTabs: props.showProviderTabs })}
      {...(props.showRuntimeSelector === undefined
        ? {}
        : { showRuntimeSelector: props.showRuntimeSelector })}
      onSelectProvider={props.onSelectProvider ?? (() => {})}
      onSelectContext={() => {}}
      onToggleProviderServer={props.onToggleProviderServer ?? (() => {})}
      onEditServer={() => {}}
      onDuplicateServer={() => {}}
      onDeleteServer={() => {}}
      onRuntimeAction={() => {}}
      onLoadServerDetails={props.onLoadServerDetails ?? (() => {})}
    />
  );
}

function Harness(props: ProviderWorkspaceFixtureProps) {
  return (
    <main className="min-h-dvh bg-background p-3 text-foreground sm:p-8">
      <div data-outside-accent className="mb-4 rounded-lg border border-border p-3 text-xs">
        Outside the provider panel
      </div>
      <ProviderWorkspaceFixture {...props} />
    </main>
  );
}

function runtimeListServer(index: number): McpRuntimeServer {
  const serverKey = index === 0 ? "notion" : `runtime-server-${index}`;
  return {
    providerKey: McpRuntimeServerKey.make(serverKey),
    source: "t3-managed",
    name: index === 0 ? "Notion" : `Runtime server ${index}`,
    transport: index % 2 === 0 ? "http" : "stdio",
    state: index === 0 ? "auth-required" : index % 4 === 0 ? "failed" : "connected",
    statusSource: "provider-query",
    observedAt: "2026-08-22T00:00:00.000Z",
    authState: index === 0 ? "required" : "authenticated",
    availableActions:
      index === 0 ? ["authorize", "reconnect", "refresh"] : ["reconnect", "refresh"],
    reportsTools: true,
    toolCount: index + 1,
    resourceCount: 0,
    templateCount: 0,
    configDrift: "none",
  } as McpRuntimeServer;
}

const exactRuntimeServers = Array.from({ length: 14 }, (_, index) => runtimeListServer(index));

function RuntimeListFixture() {
  return (
    <McpRuntimeServerList
      authorizationAvailable
      providerDisplayName="Claude · claude_work"
      servers={exactRuntimeServers}
      pendingAction={null}
      detailsByProviderKey={{}}
      detailsLoadingKeys={new Set()}
      detailsErrorByProviderKey={{}}
      actionErrorByProviderKey={{}}
      onToggleDetails={() => {}}
      onAction={() => {}}
      onOpenSettings={() => {}}
    />
  );
}

function EmbeddedWorkspaceHarness({
  initialSection = "servers",
  selectedContextId = "thread-1:runtime-1",
}: {
  readonly initialSection?: McpWorkspaceSection;
  readonly selectedContextId?: string;
}) {
  const [activeSection, setActiveSection] = useState<McpWorkspaceSection>(initialSection);
  return (
    <main className="min-h-dvh bg-background p-3 text-foreground">
      <div
        className="mcp-workspace-card mx-auto h-[min(44rem,calc(100vh-1.5rem))] w-full max-w-[86rem] p-0"
        data-expanded="true"
      >
        <div className="flex h-full min-h-0">
          <McpWorkspacePanel
            activeSection={activeSection}
            contexts={[{ id: "thread-1:runtime-1", label: "Active · thread-1 · runtime-1" }]}
            providers={providers.map((provider) => ({
              id: provider.instanceId,
              label: provider.label,
              accentColor: provider.accentColor,
            }))}
            selectedContextId={selectedContextId}
            selectedProviderId="claude_work"
            servers={
              <ProviderWorkspaceFixture showProviderTabs={false} showRuntimeSelector={false} />
            }
            runtime={<RuntimeListFixture />}
            onActiveSectionChange={setActiveSection}
          />
        </div>
      </div>
    </main>
  );
}

function ScopeFilterHarness() {
  const [scope, setScope] = useState<"global" | "project">("global");
  const [projectKey, setProjectKey] = useState("better-t3code");
  return (
    <main className="min-h-dvh bg-background p-3 text-foreground sm:p-8">
      <McpScopeFilterControls
        scope={scope}
        projectKey={projectKey}
        projects={[
          { key: "better-t3code", name: "better-t3code" },
          { key: "website", name: "Website" },
        ]}
        onScopeChange={setScope}
        onProjectKeyChange={setProjectKey}
      />
    </main>
  );
}

function verticalScrollOwners(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].filter((element) => {
    const overflowY = getComputedStyle(element).overflowY;
    return (
      (overflowY === "auto" || overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 1
    );
  });
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
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    expect(getComputedStyle(panel).borderTopColor).not.toBe(
      getComputedStyle(document.querySelector<HTMLElement>("[data-outside-accent]")!)
        .borderTopColor,
    );

    const actionTrigger = page.getByRole("button", { name: "Actions for Notion" });
    await actionTrigger.click();
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    const menuRect = menu.element().getBoundingClientRect();
    expect(menuRect.left).toBeGreaterThanOrEqual(0);
    expect(menuRect.right).toBeLessThanOrEqual(width);
    expect(menuRect.top).toBeGreaterThanOrEqual(0);
    expect(menuRect.bottom).toBeLessThanOrEqual(height);
    await userEvent.keyboard("{Escape}");
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

describe("MCP row controls browser behavior", () => {
  it("keeps provider tabs, the action menu, switch, and disclosure keyboard accessible", async () => {
    await page.viewport(960, 1_100);
    const onSelectProvider = vi.fn();
    const onToggleProviderServer = vi.fn();
    render(
      <Harness
        onSelectProvider={onSelectProvider}
        onToggleProviderServer={onToggleProviderServer}
      />,
    );

    const providerTab = page.getByRole("tab", { name: /Claude · claude_personal/ });
    await expect.element(providerTab).toBeVisible();
    providerTab.element().focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectProvider).toHaveBeenCalledWith("claude_personal");

    const actionTrigger = page.getByRole("button", { name: "Actions for Notion" });
    actionTrigger.element().focus();
    await userEvent.keyboard("{Enter}");
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Refresh" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Reconnect" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    expect(
      document.activeElement === menu.element() || menu.element().contains(document.activeElement),
    ).toBe(true);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(actionTrigger.element()));

    const assignmentSwitch = page.getByRole("switch", {
      name: "Disable Notion for selected provider",
    });
    assignmentSwitch.element().focus();
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(onToggleProviderServer).toHaveBeenCalledWith("notion", false));

    const disclosure = page.getByRole("button", { name: "Hide Notion details" });
    const disclosureElement = disclosure.element();
    disclosureElement.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("button", { name: "Show Notion details" })).toBeVisible();
    expect(document.activeElement).toBe(disclosureElement);
  });

  it("keeps pending and read-only menus inspectable without blocking unrelated rows", async () => {
    const mountedPending = await render(
      <Harness pendingRuntimeAction={{ serverKey: "notion", action: "reconnect" }} />,
    );

    try {
      await expect.element(page.getByRole("status")).toHaveTextContent("Reconnecting Notion");
      const pendingMenuTrigger = page.getByRole("button", { name: "Actions for Notion" });
      expect((pendingMenuTrigger.element() as HTMLButtonElement).disabled).toBe(false);
      expect(
        (page.getByRole("button", { name: "Hide Notion details" }).element() as HTMLButtonElement)
          .disabled,
      ).toBe(false);

      const unrelatedMenuTrigger = page.getByRole("button", {
        name: "Actions for Workspace server 1",
        exact: true,
      });
      await unrelatedMenuTrigger.click();
      await expect.element(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
      expect(
        (page.getByRole("menuitem", { name: "Edit" }).element() as HTMLElement).ariaDisabled,
      ).not.toBe("true");
      await userEvent.keyboard("{Escape}");
    } finally {
      await mountedPending.unmount();
    }

    const mountedReadOnly = await render(<Harness readOnly />);
    try {
      const readOnlyTrigger = page.getByRole("button", { name: "Actions for Notion" });
      expect((readOnlyTrigger.element() as HTMLButtonElement).disabled).toBe(false);
      await readOnlyTrigger.click();
      await expect.element(page.getByRole("menuitem", { name: "Refresh" })).toBeVisible();
      expect(page.getByRole("menuitem", { name: "Refresh" }).element().ariaDisabled).toBe("true");
    } finally {
      await mountedReadOnly.unmount();
    }
  });

  it("uses the same primary-action-plus-menu keyboard contract in the Runtime renderer", async () => {
    await page.viewport(960, 900);
    render(
      <main className="min-h-dvh bg-background p-4 text-foreground">
        <RuntimeListFixture />
      </main>,
    );

    await expect.element(page.getByRole("button", { name: "Authorize" })).toBeVisible();
    const actionTrigger = page.getByRole("button", { name: "Actions for Notion" });
    actionTrigger.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Refresh" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Reconnect" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(actionTrigger.element()));
  });
});

describe("embedded MCP workspace browser layout", () => {
  it.each([
    [1_400, 1_100],
    [960, 1_000],
    [430, 932],
  ])(
    "keeps one fixed selector layer and one vertical scroll owner at %ipx",
    async (width, height) => {
      await page.viewport(width, height);
      render(<EmbeddedWorkspaceHarness />);

      await expect.element(page.getByRole("tab", { name: "Claude · claude_work" })).toBeVisible();
      await expect.element(page.getByRole("combobox", { name: "Runtime session" })).toBeVisible();
      const panel = document.querySelector<HTMLElement>("[data-mcp-workspace-panel]");
      const selectors = document.querySelector<HTMLElement>("[data-mcp-workspace-selectors]");
      const content = document.querySelector<HTMLElement>(".mcp-workspace-panel__content");
      const viewTabs = document.querySelector<HTMLElement>(
        '[role="tablist"][aria-label="MCP workspace views"]',
      );
      expect(panel).not.toBeNull();
      expect(selectors).not.toBeNull();
      expect(content).not.toBeNull();
      expect(viewTabs).not.toBeNull();
      if (!panel || !selectors || !content || !viewTabs) return;

      expect(document.querySelectorAll('[data-mcp-runtime-session-selector="true"]')).toHaveLength(
        1,
      );
      expect(
        document.querySelectorAll('[role="tablist"][aria-label="MCP provider accounts"]'),
      ).toHaveLength(0);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      await vi.waitFor(() => {
        expect(content.scrollHeight).toBeGreaterThan(content.clientHeight + 1);
        expect(verticalScrollOwners(panel)).toEqual([content]);
      });

      const selectorsTop = selectors.getBoundingClientRect().top;
      const tabsTop = viewTabs.getBoundingClientRect().top;
      content.scrollTop = Math.floor((content.scrollHeight - content.clientHeight) / 2);
      content.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(content.scrollTop).toBeGreaterThan(0));
      expect(Math.abs(selectors.getBoundingClientRect().top - selectorsTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(viewTabs.getBoundingClientRect().top - tabsTop)).toBeLessThanOrEqual(1);

      content.scrollTop = 0;
      const runtimeTab = page.getByRole("tab", { name: "Runtime" });
      runtimeTab.element().focus();
      await userEvent.keyboard("{Enter}");
      await expect.element(page.getByRole("list", { name: "MCP server status" })).toBeVisible();
      await vi.waitFor(() => {
        expect(content.scrollHeight).toBeGreaterThan(content.clientHeight + 1);
        expect(verticalScrollOwners(panel)).toEqual([content]);
      });
      expect(runtimeTab.element().getAttribute("aria-selected")).toBe("true");
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    },
  );

  it("preserves an explicitly selected ended session in the single outer selector", async () => {
    render(<EmbeddedWorkspaceHarness selectedContextId="ended-runtime" />);

    const selector = page.getByRole("combobox", { name: "Runtime session" });
    await expect.element(selector).toHaveTextContent("Ended or unavailable session");
    expect(document.querySelectorAll('[data-mcp-runtime-session-selector="true"]')).toHaveLength(1);
  });

  it("shows the Project selector only after keyboard-selecting Project scope", async () => {
    await page.viewport(430, 932);
    render(<ScopeFilterHarness />);

    const scope = page.getByRole("combobox", { name: "Scope" });
    await expect.element(scope).toBeVisible();
    expect(document.querySelector('[role="combobox"][aria-label="Project"]')).toBeNull();
    scope.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("option", { name: "Project" })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect.element(page.getByRole("combobox", { name: "Project" })).toBeVisible();

    const controls = document.querySelector<HTMLElement>("[data-mcp-scope-controls]");
    expect(controls).not.toBeNull();
    if (controls) expect(controls.scrollWidth).toBeLessThanOrEqual(controls.clientWidth + 1);
  });
});
