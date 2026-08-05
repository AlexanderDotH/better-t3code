import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { McpServerId, ProviderInstanceId, RuntimeSessionId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { claudeMcpRuntimeTools, normalizeClaudeMcpRuntimeServer } from "./ClaudeMcpRuntime.ts";

const metadata = {
  providerInstanceId: ProviderInstanceId.make("claude-work"),
  threadId: ThreadId.make("thread-claude-mcp"),
  runtimeSessionId: RuntimeSessionId.make("runtime-claude-mcp"),
  observedAt: "2026-08-02T12:00:00.000Z",
  managedServerIds: new Map([["notion", McpServerId.make("notion")]]),
  builtInProviderKeys: new Set(["t3-code"]),
} as const;

describe("Claude MCP runtime normalization", () => {
  it("normalizes connected managed servers without exposing native configuration", () => {
    const status = {
      name: "notion",
      status: "connected",
      serverInfo: {
        name: "Notion MCP",
        version: "1.2.3",
      },
      config: {
        type: "http",
        url: "https://mcp.notion.example",
        headers: {
          Authorization: "Bearer must-not-leak",
        },
      },
      tools: [
        {
          name: "search",
          description: "Search the workspace",
          annotations: {
            readOnly: true,
            destructive: false,
            openWorld: false,
          },
        },
      ],
    } satisfies McpServerStatus;

    expect(normalizeClaudeMcpRuntimeServer(status, metadata)).toEqual({
      serverId: McpServerId.make("notion"),
      providerKey: "notion",
      source: "t3-managed",
      providerInstanceId: ProviderInstanceId.make("claude-work"),
      threadId: ThreadId.make("thread-claude-mcp"),
      runtimeSessionId: RuntimeSessionId.make("runtime-claude-mcp"),
      name: "notion",
      transport: "http",
      state: "connected",
      statusSource: "provider-query",
      observedAt: "2026-08-02T12:00:00.000Z",
      authState: "authenticated",
      availableActions: ["refresh", "reconnect"],
      reportsTools: true,
      serverInfo: {
        name: "Notion MCP",
        version: "1.2.3",
      },
      toolCount: 1,
      configDrift: "none",
    });
  });

  it("reports authentication requirements without inventing an OAuth action", () => {
    const status = {
      name: "notion",
      status: "needs-auth",
      config: {
        type: "http",
        url: "https://mcp.notion.example",
      },
    } satisfies McpServerStatus;

    expect(normalizeClaudeMcpRuntimeServer(status, metadata)).toMatchObject({
      state: "auth-required",
      authState: "required",
      availableActions: ["refresh", "reconnect"],
      issue: {
        code: "needs-auth",
        message: "Authorization required",
      },
    });
  });

  it("redacts credentials from provider failures", () => {
    const status = {
      name: "native-server",
      status: "failed",
      error:
        "Authorization: Bearer super-secret token=another-secret https://x.test?access_token=url-secret",
      config: {
        type: "sse",
        url: "https://mcp.example/sse",
      },
    } satisfies McpServerStatus;

    const server = normalizeClaudeMcpRuntimeServer(status, metadata);
    expect(server.source).toBe("provider-native");
    expect(server.issue?.message).not.toContain("super-secret");
    expect(server.issue?.message).not.toContain("another-secret");
    expect(server.issue?.message).not.toContain("url-secret");
  });

  it("marks the internal T3 server separately", () => {
    const status = {
      name: "t3-code",
      status: "pending",
    } satisfies McpServerStatus;

    expect(normalizeClaudeMcpRuntimeServer(status, metadata)).toMatchObject({
      providerKey: "t3-code",
      source: "t3-built-in",
      state: "starting",
      authState: "unknown",
    });
  });

  it("maps every Claude connection state without collapsing disabled into failure", () => {
    const statuses = ["connected", "failed", "needs-auth", "pending", "disabled"] as const;
    const states = statuses.map(
      (status) => normalizeClaudeMcpRuntimeServer({ name: "notion", status }, metadata).state,
    );

    expect(states).toEqual(["connected", "failed", "auth-required", "starting", "disabled"]);
  });

  it("returns only safe lazy tool metadata", () => {
    const status = {
      name: "notion",
      status: "connected",
      tools: [
        {
          name: "search",
          description: "Search the workspace",
          annotations: {
            readOnly: true,
            destructive: false,
            openWorld: true,
          },
        },
      ],
    } satisfies McpServerStatus;

    expect(claudeMcpRuntimeTools(status)).toEqual([
      {
        name: "search",
        description: "Search the workspace",
        readOnly: true,
        destructive: false,
        openWorld: true,
      },
    ]);
  });
});
