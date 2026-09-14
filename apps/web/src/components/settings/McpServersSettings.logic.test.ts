import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  type McpMutationResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveMcpProviderTabs,
  mcpInstallationTargets,
  isMcpServerEnabledForProvider,
  mcpMutationToastPresentation,
  runtimeStatePresentation,
} from "./McpServersSettings.logic";

describe("deriveMcpProviderTabs", () => {
  it("disambiguates duplicate account names without changing unique labels", () => {
    const tabs = deriveMcpProviderTabs([
      {
        instanceId: "claude_personal",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        installed: true,
        accentColor: "#7c3aed",
        status: "ready",
        auth: { email: "alex@example.test" },
      },
      {
        instanceId: "claude_work",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        installed: true,
      },
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
      },
    ]);

    expect(tabs.map((tab) => tab.label)).toEqual([
      "Claude · claude_personal",
      "Claude · claude_work",
      "Codex",
    ]);
    expect(tabs[0]).toMatchObject({
      accentColor: "#7c3aed",
      disabled: false,
      tooltip: "Claude · Claude · claude_personal",
      statusLabel: "Ready",
      statusTone: "success",
      account: "alex@example.test",
      supportsUserMcp: true,
    });
  });

  it("keeps enabled unavailable instances visible and omits disabled instances", () => {
    const tabs = deriveMcpProviderTabs([
      {
        instanceId: "future",
        driver: "futureDriver",
        enabled: true,
        installed: false,
        availability: "unavailable",
      },
      { instanceId: "codex", driver: "codex", enabled: false, installed: true },
    ]);

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      label: "futureDriver",
      disabled: true,
      statusLabel: "Unavailable",
      statusTone: "neutral",
    });
  });

  it("follows current Settings when provider snapshots lag behind toggles or deletions", () => {
    const providers = [
      { instanceId: "codex", driver: "codex", enabled: true, installed: true },
      { instanceId: "work", driver: "codex", enabled: false, installed: true },
      { instanceId: "deleted", driver: "codex", enabled: true, installed: true },
    ];
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, enabled: false },
      },
      providerInstances: {
        work: { driver: ProviderDriverKind.make("codex"), enabled: true, config: {} },
      },
    };
    expect(
      deriveMcpProviderTabs(providers, settings).map((provider) => provider.instanceId),
    ).toEqual(["work"]);
    expect(deriveMcpProviderTabs(providers, { ...settings, providerInstances: {} })).toEqual([]);
  });

  it("uses server-reported MCP capability instead of inferring support from driver names", () => {
    const tabs = deriveMcpProviderTabs([
      {
        instanceId: "grok",
        driver: "grok",
        enabled: true,
        installed: true,
        mcpCapability: "nativeConfig",
      },
      {
        instanceId: "fork",
        driver: "customFork",
        enabled: true,
        installed: true,
        mcpCapability: "unsupported",
      },
    ]);

    expect(tabs[0]?.supportsUserMcp).toBe(true);
    expect(tabs[1]?.supportsUserMcp).toBe(false);
  });
});

describe("isMcpServerEnabledForProvider", () => {
  it("treats legacy servers as enabled for every instance", () => {
    expect(isMcpServerEnabledForProvider({ enabled: true }, "claude_work")).toBe(true);
  });

  it("combines the global switch with selected instance routing", () => {
    expect(
      isMcpServerEnabledForProvider(
        {
          enabled: true,
          providerRouting: { mode: "selected", instanceIds: ["codex"] },
        },
        "claude_work",
      ),
    ).toBe(false);
    expect(
      isMcpServerEnabledForProvider(
        {
          enabled: false,
          providerRouting: { mode: "all" },
        },
        "codex",
      ),
    ).toBe(false);
  });
});

describe("runtimeStatePresentation", () => {
  it("distinguishes authentication from generic runtime failures", () => {
    expect(runtimeStatePresentation("auth-required")).toMatchObject({
      label: "Authorization required",
      tone: "warning",
    });
    expect(runtimeStatePresentation("failed")).toMatchObject({
      label: "Failed",
      tone: "danger",
    });
  });

  it("never presents unsupported or unknown telemetry as healthy", () => {
    expect(runtimeStatePresentation("unsupported").tone).toBe("neutral");
    expect(runtimeStatePresentation("unknown").tone).toBe("neutral");
  });
});

describe("mcpMutationToastPresentation", () => {
  it("distinguishes future-session persistence when no live runtime matched", () => {
    expect(
      mcpMutationToastPresentation(
        { servers: [], liveApplyResults: [] } as McpMutationResult,
        "MCP server updated",
      ),
    ).toEqual({
      type: "info",
      title: "MCP server updated — applies to the next session",
      description: "No matching live runtime required an update.",
    });
  });

  it("identifies provider-specific live and deferred outcomes", () => {
    const presentation = mcpMutationToastPresentation(
      {
        servers: [],
        liveApplyResults: [
          {
            providerInstanceId: "codex_work",
            threadId: "thread-1",
            runtimeSessionId: "runtime-1",
            outcome: "applied",
          },
          {
            providerInstanceId: "claude_personal",
            threadId: "thread-2",
            runtimeSessionId: "runtime-2",
            outcome: "pending-next-session",
          },
        ],
      } as unknown as McpMutationResult,
      "MCP servers imported",
    );

    expect(presentation.type).toBe("info");
    expect(presentation.title).toContain("some changes apply next session");
    expect(presentation.description).toContain("codex_work: updated now");
    expect(presentation.description).toContain("claude_personal: next session");
  });
});

it("offers only active, installed, compatible providers as installation targets", () => {
  const provider = { driver: "codex", enabled: true, installed: true };
  const targets = mcpInstallationTargets(
    deriveMcpProviderTabs([
      { ...provider, instanceId: "active" },
      { ...provider, instanceId: "disabled", enabled: false },
      { ...provider, instanceId: "disabled-status", status: "disabled" },
      { ...provider, instanceId: "missing", installed: false },
      { ...provider, instanceId: "unavailable", availability: "unavailable" },
      { ...provider, instanceId: "unsupported", mcpCapability: "unsupported" },
    ]),
  );
  expect(targets.map((target) => target.instanceId)).toEqual(["active"]);
});
