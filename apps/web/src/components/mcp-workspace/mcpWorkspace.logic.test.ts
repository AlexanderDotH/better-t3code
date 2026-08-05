import type { McpRuntimeServer, McpRuntimeSnapshot, McpServerDefinition } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMcpWorkspaceSummary } from "./mcpWorkspace.logic";

const definitions = [
  {
    id: "global_docs",
    name: "Global docs",
    enabled: true,
    providerRouting: { mode: "all" },
    scope: "global",
    transport: "http",
    url: "https://example.com/mcp",
    headers: {},
  },
  {
    id: "project_tools",
    name: "Project tools",
    enabled: true,
    providerRouting: { mode: "selected", instanceIds: ["codex_work"] },
    scope: "project",
    projectCwd: "/repo",
    transport: "stdio",
    command: "project-mcp",
    args: [],
    env: {},
  },
  {
    id: "personal_only",
    name: "Personal only",
    enabled: true,
    providerRouting: { mode: "selected", instanceIds: ["codex_personal"] },
    scope: "global",
    transport: "stdio",
    command: "personal-mcp",
    args: [],
    env: {},
  },
] as unknown as readonly McpServerDefinition[];

function runtimeServer(
  providerKey: string,
  state: McpRuntimeServer["state"],
  input: Partial<McpRuntimeServer> = {},
): McpRuntimeServer {
  return {
    providerKey,
    name: providerKey,
    source: "t3-managed",
    state,
    configDrift: "none",
    availableActions: [],
    reportsTools: true,
    ...input,
  } as McpRuntimeServer;
}

function runtimeSnapshot(servers: readonly McpRuntimeServer[]): McpRuntimeSnapshot {
  return {
    providerInstanceId: "codex_work",
    threadId: "thread-1",
    runtimeSessionId: "runtime-1",
    revision: 1,
    observedAt: "2026-08-03T12:00:00.000Z",
    servers,
  } as unknown as McpRuntimeSnapshot;
}

describe("deriveMcpWorkspaceSummary", () => {
  it("counts only definitions applicable to the selected provider and project", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "/repo",
      providerInstanceId: "codex_work",
      runtimeSnapshot: null,
      workspaceSupported: true,
    });

    expect(summary.configuredCount).toBe(2);
    expect(summary.state).toBe("disconnected");
    expect(summary.statusLabel).toBe("2 configured · next session");
    expect(summary.toolCount).toBeNull();
  });

  it("normalizes project path separators and trailing slashes", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "\\repo\\",
      providerInstanceId: "codex_work",
      runtimeSnapshot: null,
      workspaceSupported: true,
    });

    expect(summary.configuredCount).toBe(2);
  });

  it("excludes the locked T3 system server and exposes textual attention counts", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "/repo",
      providerInstanceId: "codex_work",
      runtimeSnapshot: runtimeSnapshot([
        runtimeServer("global_docs", "connected", { toolCount: 4 }),
        runtimeServer("project_tools", "auth-required", { toolCount: 2 }),
        runtimeServer("t3-code", "connected", {
          source: "t3-built-in",
          toolCount: 100,
        }),
      ]),
      workspaceSupported: true,
    });

    expect(summary.connectedCount).toBe(1);
    expect(summary.expectedCount).toBe(2);
    expect(summary.attentionCount).toBe(1);
    expect(summary.toolCount).toBe(6);
    expect(summary.statusLabel).toBe("1 of 2 connected · 1 needs attention");
  });

  it("does not shrink expected health when a configured runtime row is temporarily absent", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "/repo",
      providerInstanceId: "codex_work",
      runtimeSnapshot: runtimeSnapshot([
        runtimeServer("global_docs", "connected", { toolCount: 4 }),
      ]),
      workspaceSupported: true,
    });

    expect(summary.connectedCount).toBe(1);
    expect(summary.expectedCount).toBe(2);
    expect(summary.statusLabel).toBe("1 of 2 connected");
  });

  it("keeps configuration visible but reports upgrade-required on old servers", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "/repo",
      providerInstanceId: "codex_work",
      runtimeSnapshot: null,
      workspaceSupported: false,
    });

    expect(summary.configuredCount).toBe(2);
    expect(summary.state).toBe("upgrade-required");
    expect(summary.statusLabel).toBe("2 configured · upgrade required");
  });

  it("reports configuration-only when no provider account is selected", () => {
    const summary = deriveMcpWorkspaceSummary({
      configuredServers: definitions,
      projectCwd: "/repo",
      providerInstanceId: null,
      runtimeSnapshot: null,
      workspaceSupported: true,
    });

    expect(summary.configuredCount).toBe(1);
    expect(summary.state).toBe("configuration-only");
    expect(summary.statusLabel).toBe("1 configured · configuration only");
    expect(summary.freshnessLabel).toBe("Select a provider account for live status");
  });
});
