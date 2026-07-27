import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  exportCursorMcpServersJson,
  getMcpProviderStatuses,
  importCursorMcpServers,
  McpConfigEngine,
  McpConfigEngineLive,
  resolveActiveMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
} from "./McpConfigEngine.ts";

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
    const importedGithub = imported[0];
    const importedDocs = imported[1];
    expect(importedGithub?.transport).toBe("stdio");
    expect(importedDocs?.transport).toBe("sse");
    if (importedGithub?.transport !== "stdio" || importedDocs?.transport !== "sse") {
      throw new Error("Expected imported stdio and SSE MCP servers.");
    }
    expect(importedGithub.env.GITHUB_TOKEN).toEqual({
      value: "secret",
      sensitive: true,
    });
    expect(importedDocs.headers.Authorization).toEqual({
      value: "Bearer token",
      sensitive: true,
    });

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

effectIt.layer(NodeServices.layer)("McpConfigEngineLive", (it) => {
  it.effect("redacts client results while materializing active server secrets across CRUD", () =>
    Effect.gen(function* () {
      const engine = yield* McpConfigEngine;
      const created = yield* engine.create({
        id: McpServerId.make("github"),
        name: "GitHub",
        enabled: true,
        scope: "global",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_TOKEN: { value: "secret", sensitive: true },
          LOG_LEVEL: { value: "debug", sensitive: false },
        },
      });
      const createdServer = created.servers[0];
      expect(createdServer?.transport).toBe("stdio");
      if (createdServer?.transport !== "stdio") {
        throw new Error("Expected a stdio MCP server.");
      }
      expect(createdServer.env).toEqual({
        GITHUB_TOKEN: { value: "", sensitive: true, valueRedacted: true },
        LOG_LEVEL: { value: "debug", sensitive: false },
      });

      const active = yield* engine.resolveActiveServers({});
      expect(active[0]?.transport).toBe("stdio");
      if (active[0]?.transport !== "stdio") {
        throw new Error("Expected an active stdio MCP server.");
      }
      expect(active[0].env.GITHUB_TOKEN?.value).toBe("secret");

      yield* engine.setEnabled(McpServerId.make("github"), false);
      expect(yield* engine.resolveActiveServers({})).toEqual([]);

      const updated = yield* engine.update({
        id: McpServerId.make("github"),
        name: "GitHub Remote",
        enabled: true,
        scope: "global",
        transport: "http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: { value: "Bearer secret", sensitive: true },
        },
      });
      expect(updated.servers[0]?.name).toBe("GitHub Remote");

      const removed = yield* engine.delete(McpServerId.make("github"));
      expect(removed.servers).toEqual([]);
    }).pipe(
      Effect.provide(
        McpConfigEngineLive.pipe(Layer.provideMerge(ServerSettingsService.layerTest())),
      ),
    ),
  );
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
