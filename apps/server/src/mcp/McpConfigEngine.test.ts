import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { ServerSettingsService } from "../serverSettings.ts";
import { McpConfigurationReconciler } from "./McpConfigurationReconciler.ts";
import {
  exportCursorMcpServersJson,
  getMcpProviderStatuses,
  importCursorMcpServers,
  managedMcpProviderKey,
  McpConfigEngine,
  McpConfigEngineLive,
  resolveActiveMcpServers,
  toAcpMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
} from "./McpConfigEngine.ts";

describe("MCP config helpers", () => {
  it("combines master enablement, project scope, and provider-instance routing", () => {
    const codexWork = ProviderInstanceId.make("codex_work");
    const claudeWork = ProviderInstanceId.make("claude_work");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      mcp: {
        servers: [
          {
            id: McpServerId.make("global_docs"),
            name: "Global Docs",
            enabled: true,
            providerRouting: { mode: "all" },
            scope: "global",
            transport: "http",
            url: "https://example.com/mcp",
            headers: {},
          },
          {
            id: McpServerId.make("project_docs"),
            name: "Project Docs",
            enabled: true,
            providerRouting: { mode: "selected", instanceIds: [claudeWork] },
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
            providerRouting: { mode: "all" },
            scope: "global",
            transport: "http",
            url: "https://example.com/disabled",
            headers: {},
          },
        ],
      },
    };

    expect(
      resolveActiveMcpServers(settings, {
        cwd: "/tmp/project",
        providerInstanceId: claudeWork,
      }).map((server) => server.id),
    ).toEqual(["global_docs", "project_docs"]);
    expect(
      resolveActiveMcpServers(settings, {
        cwd: "/tmp/project",
        providerInstanceId: codexWork,
      }).map((server) => server.id),
    ).toEqual(["global_docs"]);
    expect(
      resolveActiveMcpServers(settings, {
        cwd: "/tmp/other",
        providerInstanceId: claudeWork,
      }).map((server) => server.id),
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
      providerRouting: {
        mode: "selected",
        instanceIds: [ProviderInstanceId.make("claude_work")],
      },
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
    expect(imported.every((server) => server.providerRouting.mode === "selected")).toBe(true);

    const exported = exportCursorMcpServersJson(imported, {
      includeDisabled: false,
      providerInstanceId: ProviderInstanceId.make("claude_work"),
    });
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
    expect(
      exportCursorMcpServersJson(imported, {
        includeDisabled: false,
        providerInstanceId: ProviderInstanceId.make("codex_work"),
      }).servers,
    ).toEqual([]);
  });

  it("maps active servers for Claude and OpenCode session config", () => {
    const servers: ServerSettings["mcp"]["servers"] = [
      {
        id: McpServerId.make("github"),
        name: "GitHub",
        enabled: true,
        providerRouting: { mode: "all" },
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
        providerRouting: { mode: "all" },
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

  it("uses stable provider keys when display names collide and protects the built-in key", () => {
    const servers: ServerSettings["mcp"]["servers"] = [
      {
        id: McpServerId.make("docs_one"),
        name: "Docs",
        enabled: true,
        providerRouting: { mode: "all" },
        scope: "global",
        transport: "http",
        url: "https://one.example.com/mcp",
        headers: {},
      },
      {
        id: McpServerId.make("docs_two"),
        name: "Docs",
        enabled: true,
        providerRouting: { mode: "all" },
        scope: "global",
        transport: "http",
        url: "https://two.example.com/mcp",
        headers: {},
      },
      {
        id: McpServerId.make("t3-code"),
        name: "User T3 Code",
        enabled: true,
        providerRouting: { mode: "all" },
        scope: "global",
        transport: "http",
        url: "https://user.example.com/mcp",
        headers: {},
      },
    ];

    expect(toAcpMcpServers(servers).map((server) => server.name)).toEqual([
      "docs_one",
      "docs_two",
      "t3-managed:t3-code",
    ]);
    expect(managedMcpProviderKey(McpServerId.make("t3-code"))).toBe("t3-managed:t3-code");
    expect(Object.keys(toClaudeMcpServers(servers))).toEqual([
      "docs_one",
      "docs_two",
      "t3-managed:t3-code",
    ]);
    expect(Object.keys(toOpenCodeMcpServers(servers))).toEqual([
      "docs_one",
      "docs_two",
      "t3-managed:t3-code",
    ]);
  });

  it("reports native provider MCP capabilities without failing unknown providers", () => {
    const providers = [
      provider("codex"),
      provider("cursor"),
      provider("claudeAgent"),
      provider("opencode"),
      provider("grok"),
      provider("gemini"),
      provider("futureAgent"),
    ];
    const capabilities = new Map(
      providers.map((candidate) => [
        candidate.instanceId,
        candidate.driver === "codex"
          ? ("nativeConfig" as const)
          : candidate.driver === "cursor" ||
              candidate.driver === "claudeAgent" ||
              candidate.driver === "opencode"
            ? ("sessionConfig" as const)
            : ("unsupported" as const),
      ]),
    );

    expect(
      getMcpProviderStatuses({ providers, activeServerCount: 2, capabilities }).map((status) => ({
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
        provider: "grok",
        capability: "unsupported",
        state: "unsupported",
        activeServerCount: 0,
      },
      {
        provider: "gemini",
        capability: "unsupported",
        state: "unsupported",
        activeServerCount: 0,
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
  it.effect("routes every catalog mutation through one reconciler and returns live outcomes", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const liveResult = {
        providerInstanceId: ProviderInstanceId.make("codex"),
        threadId: ThreadId.make("thread-live-apply"),
        runtimeSessionId: RuntimeSessionId.make("runtime-live-apply"),
        outcome: "applied" as const,
      };
      const reconcilerLayer = Layer.succeed(
        McpConfigurationReconciler,
        McpConfigurationReconciler.of({
          reconcileCurrent: Ref.update(calls, (count) => count + 1).pipe(Effect.as([liveResult])),
          providerCapability: () => Effect.succeed("nativeConfig"),
        }),
      );
      const engine = yield* McpConfigEngine.pipe(
        Effect.provide(
          McpConfigEngineLive.pipe(
            Layer.provideMerge(ServerSettingsService.layerTest()),
            Layer.provideMerge(reconcilerLayer),
          ),
        ),
      );
      const id = McpServerId.make("managed");
      const definition = {
        id,
        name: "Managed",
        enabled: true,
        providerRouting: { mode: "all" as const },
        scope: "global" as const,
        transport: "http" as const,
        url: "https://managed.example.com/mcp",
        headers: {},
      };

      const created = yield* engine.create(definition);
      yield* engine.update({ ...definition, name: "Managed Updated" });
      yield* engine.setEnabled(id, false);
      yield* engine.setProviderEnabled({
        serverId: id,
        providerInstanceId: ProviderInstanceId.make("codex"),
        enabled: false,
      });
      yield* engine.importCursorJson({
        json: JSON.stringify({
          mcpServers: {
            imported: { url: "https://imported.example.com/mcp" },
          },
        }),
        providerRouting: { mode: "all" },
        scope: "global",
        replace: false,
      });
      yield* engine.delete(id);

      expect(created.liveApplyResults).toEqual([liveResult]);
      expect(yield* Ref.get(calls)).toBe(6);
    }),
  );

  it.effect("preserves concurrent catalog mutations and legacy provider routing", () =>
    Effect.gen(function* () {
      const engine = yield* McpConfigEngine;
      const alphaId = McpServerId.make("alpha");
      const betaId = McpServerId.make("beta");
      const workProvider = ProviderInstanceId.make("codex_work");

      yield* Effect.all(
        [
          engine.create({
            id: alphaId,
            name: "Alpha",
            enabled: true,
            providerRouting: { mode: "all" },
            scope: "global",
            transport: "http",
            url: "https://alpha.example.com/mcp",
            headers: {},
          }),
          engine.create({
            id: betaId,
            name: "Beta",
            enabled: true,
            providerRouting: { mode: "selected", instanceIds: [workProvider] },
            scope: "global",
            transport: "http",
            url: "https://beta.example.com/mcp",
            headers: {},
          }),
        ],
        { concurrency: "unbounded" },
      );

      yield* Effect.all(
        [
          engine.setEnabled(alphaId, false),
          engine.update({
            id: betaId,
            name: "Beta Updated",
            enabled: true,
            scope: "global",
            transport: "http",
            url: "https://beta.example.com/v2/mcp",
            headers: {},
          }),
        ],
        { concurrency: "unbounded" },
      );

      const updated = yield* engine.list;
      expect(updated.servers).toEqual([
        expect.objectContaining({ id: alphaId, enabled: false }),
        expect.objectContaining({
          id: betaId,
          name: "Beta Updated",
          providerRouting: { mode: "selected", instanceIds: [workProvider] },
        }),
      ]);

      const resetRouting = yield* engine.update({
        id: betaId,
        name: "Beta Updated",
        enabled: true,
        providerRouting: { mode: "all" },
        scope: "global",
        transport: "http",
        url: "https://beta.example.com/v2/mcp",
        headers: {},
      });
      expect(resetRouting.servers[1]?.providerRouting).toEqual({ mode: "all" });
    }).pipe(
      Effect.provide(
        McpConfigEngineLive.pipe(
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(
            Layer.succeed(
              McpConfigurationReconciler,
              McpConfigurationReconciler.of({
                reconcileCurrent: Effect.succeed([]),
                providerCapability: () => Effect.succeed("nativeConfig"),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("redacts client results while materializing active server secrets across CRUD", () =>
    Effect.gen(function* () {
      const engine = yield* McpConfigEngine;
      const created = yield* engine.create({
        id: McpServerId.make("github"),
        name: "GitHub",
        enabled: true,
        providerRouting: { mode: "all" },
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

      const disabledForClaude = yield* engine.setProviderEnabled({
        serverId: McpServerId.make("github"),
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        enabled: false,
      });
      const configuredProviderIds = Object.keys(DEFAULT_SERVER_SETTINGS.providers);
      expect(disabledForClaude.servers[0]?.providerRouting).toEqual({
        mode: "selected",
        instanceIds: configuredProviderIds.filter((instanceId) => instanceId !== "claudeAgent"),
      });
      expect(
        yield* engine.resolveActiveServers({
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        }),
      ).toEqual([]);
      expect(
        (yield* engine.resolveActiveServers({
          providerInstanceId: ProviderInstanceId.make("codex"),
        })).map((server) => server.id),
      ).toEqual(["github"]);
      expect(
        (yield* engine.providerStatus([provider("codex"), provider("claudeAgent")])).providers.map(
          (status) => [status.instanceId, status.activeServerCount],
        ),
      ).toEqual([
        ["codex", 1],
        ["claudeAgent", 0],
      ]);

      const reenabledForClaude = yield* engine.setProviderEnabled({
        serverId: McpServerId.make("github"),
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        enabled: true,
      });
      expect(reenabledForClaude.servers[0]?.providerRouting).toEqual({
        mode: "selected",
        instanceIds: [
          ...configuredProviderIds.filter((instanceId) => instanceId !== "claudeAgent"),
          "claudeAgent",
        ],
      });

      yield* engine.setEnabled(McpServerId.make("github"), false);
      expect(yield* engine.resolveActiveServers({})).toEqual([]);
      const providerToggleWithMasterDisabled = yield* engine.setProviderEnabled({
        serverId: McpServerId.make("github"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        enabled: true,
      });
      expect(providerToggleWithMasterDisabled.servers[0]?.enabled).toBe(false);

      const updated = yield* engine.update({
        id: McpServerId.make("github"),
        name: "GitHub Remote",
        enabled: true,
        providerRouting: {
          mode: "selected",
          instanceIds: [ProviderInstanceId.make("retired_provider")],
        },
        scope: "global",
        transport: "http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: { value: "Bearer secret", sensitive: true },
        },
      });
      expect(updated.servers[0]?.name).toBe("GitHub Remote");

      const preservedRetiredProvider = yield* engine.setProviderEnabled({
        serverId: McpServerId.make("github"),
        providerInstanceId: ProviderInstanceId.make("cursor"),
        enabled: true,
      });
      expect(preservedRetiredProvider.servers[0]?.providerRouting).toEqual({
        mode: "selected",
        instanceIds: ["retired_provider", "cursor"],
      });

      const removed = yield* engine.delete(McpServerId.make("github"));
      expect(removed.servers).toEqual([]);
    }).pipe(
      Effect.provide(
        McpConfigEngineLive.pipe(
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(
            Layer.succeed(
              McpConfigurationReconciler,
              McpConfigurationReconciler.of({
                reconcileCurrent: Effect.succeed([]),
                providerCapability: () => Effect.succeed("nativeConfig"),
              }),
            ),
          ),
        ),
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
