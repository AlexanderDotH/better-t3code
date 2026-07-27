import { describe, expect, it } from "vite-plus/test";
import {
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  exportCursorMcpServersJson,
  getMcpProviderStatuses,
  importCursorMcpServers,
  resolveActiveMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
} from "./McpConfigEngine.ts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";

describe("MCP config helpers", () => {
  it("resolves global servers for every session and project servers only for matching cwd", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      mcp: {
        servers: [
          {
            id: McpServerId.make("global_docs"),
            name: "Global Docs",
            enabled: true,
            scope: "global",
            transport: "http",
            url: "https://example.com/mcp",
            headers: {},
          },
          {
            id: McpServerId.make("project_docs"),
            name: "Project Docs",
            enabled: true,
            scope: "project",
            projectCwd: "/tmp/project",
            transport: "stdio",
            command: "node",
            args: [],
            env: {},
          },
          {
            id: McpServerId.make("disabled_docs"),
            name: "Disabled Docs",
            enabled: false,
            scope: "global",
            transport: "http",
            url: "https://example.com/disabled",
            headers: {},
          },
        ],
      },
    };

    expect(
      resolveActiveMcpServers(settings, { cwd: "/tmp/project" }).map((server) => server.id),
    ).toEqual(["global_docs", "project_docs"]);
    expect(
      resolveActiveMcpServers(settings, { cwd: "/tmp/other" }).map((server) => server.id),
    ).toEqual(["global_docs"]);
  });

  it("imports and exports Cursor mcpServers JSON", () => {
    const imported = importCursorMcpServers({
      json: JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "secret" },
          },
          docs: {
            type: "sse",
            url: "https://example.com/sse",
            headers: { Authorization: "Bearer token" },
          },
        },
      }),
      scope: "global",
    });

    expect(imported.map((server) => server.transport)).toEqual(["stdio", "sse"]);
    const exported = exportCursorMcpServersJson(imported, { includeDisabled: false });
    expect(JSON.parse(exported.json)).toEqual({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "secret" },
        },
        docs: {
          type: "sse",
          url: "https://example.com/sse",
          headers: { Authorization: "Bearer token" },
        },
      },
    });
  });

  it("maps active servers for Claude and OpenCode session config", () => {
    const servers: ServerSettings["mcp"]["servers"] = [
      {
        id: McpServerId.make("github"),
        name: "GitHub",
        enabled: true,
        scope: "global",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: { value: "secret", sensitive: true } },
      },
      {
        id: McpServerId.make("docs"),
        name: "Docs",
        enabled: true,
        scope: "global",
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: { value: "Bearer token", sensitive: true } },
      },
    ];

    expect(toClaudeMcpServers(servers)).toEqual({
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "secret" },
      },
      docs: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      },
    });
    expect(toOpenCodeMcpServers(servers)).toEqual({
      github: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github"],
        environment: { GITHUB_TOKEN: "secret" },
        enabled: true,
      },
      docs: {
        type: "remote",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
        enabled: true,
      },
    });
  });

  it("reports built-in providers as MCP-capable without failing future providers", () => {
    const providers = [
      provider("codex"),
      provider("cursor"),
      provider("claudeAgent"),
      provider("opencode"),
      provider("hyperagent"),
      provider("futureAgent"),
    ];

    expect(
      getMcpProviderStatuses({ providers, activeServerCount: 2 }).map((status) => ({
        provider: status.provider,
        capability: status.capability,
        state: status.state,
        activeServerCount: status.activeServerCount,
      })),
    ).toEqual([
      { provider: "codex", capability: "nativeConfig", state: "ready", activeServerCount: 2 },
      { provider: "cursor", capability: "sessionConfig", state: "ready", activeServerCount: 2 },
      {
        provider: "claudeAgent",
        capability: "sessionConfig",
        state: "ready",
        activeServerCount: 2,
      },
      {
        provider: "opencode",
        capability: "sessionConfig",
        state: "ready",
        activeServerCount: 2,
      },
      {
        provider: "hyperagent",
        capability: "sessionConfig",
        state: "ready",
        activeServerCount: 2,
      },
      {
        provider: "futureAgent",
        capability: "unsupported",
        state: "unsupported",
        activeServerCount: 0,
      },
    ]);
  });
});

function provider(driver: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: "1970-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}
