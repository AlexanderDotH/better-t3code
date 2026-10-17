import { McpRuntimeServerKey, type McpRuntimeServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aggregateMcpRuntimeStatus,
  mcpRuntimeServerNeedsAttention,
  mcpRuntimeStateLabel,
  orderMcpRuntimeServers,
} from "./mcpRuntimePresentation";

function runtimeServer(
  state: McpRuntimeServer["state"],
  overrides: Partial<McpRuntimeServer> = {},
): McpRuntimeServer {
  return {
    providerKey: McpRuntimeServerKey.make(`server-${state}`),
    source: "t3-managed",
    name: `Server ${state}`,
    state,
    statusSource: "provider-query",
    observedAt: "2026-08-02T00:00:00.000Z",
    authState: state === "auth-required" ? "required" : "none",
    availableActions: [],
    reportsTools: true,
    configDrift: "none",
    ...overrides,
  } as McpRuntimeServer;
}

describe("aggregateMcpRuntimeStatus", () => {
  it("is green only when every expected user server is connected", () => {
    const presentation = aggregateMcpRuntimeStatus([
      runtimeServer("connected"),
      runtimeServer("connected", { providerKey: McpRuntimeServerKey.make("server-two") }),
    ]);

    expect(presentation).toEqual({
      tone: "green",
      connectedCount: 2,
      expectedCount: 2,
      compactLabel: "MCP 2/2",
      label: "All 2 MCP servers connected",
    });
  });

  it("is red when every expected server has a terminal problem", () => {
    const presentation = aggregateMcpRuntimeStatus([
      runtimeServer("auth-required"),
      runtimeServer("failed", { providerKey: McpRuntimeServerKey.make("server-two") }),
    ]);

    expect(presentation.tone).toBe("red");
    expect(presentation.connectedCount).toBe(0);
    expect(presentation.expectedCount).toBe(2);
    expect(presentation.label).toBe("0 of 2 MCP servers connected");
  });

  it("is orange for partial availability, startup, stale state, or config drift", () => {
    expect(
      aggregateMcpRuntimeStatus([runtimeServer("connected"), runtimeServer("auth-required")]).tone,
    ).toBe("orange");
    expect(aggregateMcpRuntimeStatus([runtimeServer("starting")]).tone).toBe("orange");
    expect(aggregateMcpRuntimeStatus([runtimeServer("stale")]).tone).toBe("orange");
    expect(
      aggregateMcpRuntimeStatus([runtimeServer("connected", { configDrift: "pending-disable" })])
        .tone,
    ).toBe("orange");
  });

  it("is gray when there is no reliable user-server status", () => {
    expect(aggregateMcpRuntimeStatus([]).tone).toBe("gray");
    expect(aggregateMcpRuntimeStatus([runtimeServer("unknown")]).tone).toBe("gray");
    expect(aggregateMcpRuntimeStatus([runtimeServer("not-started")]).tone).toBe("gray");
    expect(aggregateMcpRuntimeStatus([runtimeServer("unsupported")]).tone).toBe("gray");
  });

  it("excludes disabled and built-in servers from the aggregate", () => {
    const presentation = aggregateMcpRuntimeStatus([
      runtimeServer("connected"),
      runtimeServer("failed", {
        providerKey: McpRuntimeServerKey.make("built-in"),
        source: "t3-built-in",
      }),
      runtimeServer("disabled", { providerKey: McpRuntimeServerKey.make("disabled") }),
    ]);

    expect(presentation.tone).toBe("green");
    expect(presentation.connectedCount).toBe(1);
    expect(presentation.expectedCount).toBe(1);
  });
});

describe("mcpRuntimeStateLabel", () => {
  it("describes authentication and setup failures explicitly", () => {
    expect(mcpRuntimeStateLabel("auth-required")).toBe("Authorization required");
    expect(mcpRuntimeStateLabel("setup-required")).toBe("Setup required");
    expect(mcpRuntimeStateLabel("failed")).toBe("Failed");
  });
});

describe("MCP diagnostics ordering", () => {
  it("shows failures before warnings and healthy servers within each source group", () => {
    const servers = [
      runtimeServer("connected", { name: "1password", source: "provider-native" }),
      runtimeServer("failed", { name: "notebooklm", source: "provider-native" }),
      runtimeServer("auth-required", { name: "atlassian", source: "provider-native" }),
      runtimeServer("stale", { name: "gitlab", source: "provider-native" }),
      runtimeServer("connected", {
        name: "codex_apps",
        source: "provider-native",
        configDrift: "pending-disable",
      }),
    ];

    expect(orderMcpRuntimeServers(servers).map((server) => server.name)).toEqual([
      "atlassian",
      "notebooklm",
      "codex_apps",
      "gitlab",
      "1password",
    ]);
    expect(servers[0]?.name).toBe("1password");
  });

  it("keeps configured, provider-managed, and built-in servers in separate groups", () => {
    const servers = [
      runtimeServer("failed", { name: "system", source: "t3-built-in" }),
      runtimeServer("failed", { name: "notebooklm", source: "provider-native" }),
      runtimeServer("connected", { name: "configured", source: "t3-managed" }),
    ];
    expect(orderMcpRuntimeServers(servers).map((server) => server.source)).toEqual([
      "t3-managed",
      "provider-native",
      "t3-built-in",
    ]);
  });

  it("highlights pending changes without treating disabled servers as failures", () => {
    expect(
      mcpRuntimeServerNeedsAttention(
        runtimeServer("connected", { configDrift: "pending-disable" }),
      ),
    ).toBe(true);
    expect(
      mcpRuntimeServerNeedsAttention(runtimeServer("disabled", { configDrift: "pending-enable" })),
    ).toBe(false);
    expect(mcpRuntimeServerNeedsAttention(runtimeServer("connected"))).toBe(false);
  });
});
