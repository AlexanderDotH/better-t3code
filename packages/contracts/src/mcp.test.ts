import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  McpImportCursorJsonInput,
  McpServerDefinition,
  McpDiscoverImportSourcesResult,
  McpImportSourcesInput,
  McpMutationResult,
  McpRuntimeActionInput,
  McpRuntimeContextChange,
  McpRuntimeContextChangesInput,
  McpRuntimeContextSnapshot,
  McpRuntimeServerDetailsResult,
  McpRuntimeSnapshot,
  McpSetProviderEnabledInput,
  McpSetProviderEnabledResult,
  McpUpdateInput,
  ServerSettings,
  ServerSettingsPatch,
  WS_METHODS,
  type McpServerDefinition as McpServerDefinitionType,
} from "./index.ts";

const decodeMcpServer = Schema.decodeUnknownSync(McpServerDefinition);
const decodeMcpDiscoverImportSourcesResult = Schema.decodeUnknownSync(
  McpDiscoverImportSourcesResult,
);
const decodeMcpImportSourcesInput = Schema.decodeUnknownSync(McpImportSourcesInput);
const decodeMcpImportCursorJsonInput = Schema.decodeUnknownSync(McpImportCursorJsonInput);
const decodeMcpMutationResult = Schema.decodeUnknownSync(McpMutationResult);
const decodeMcpRuntimeActionInput = Schema.decodeUnknownSync(McpRuntimeActionInput);
const decodeMcpRuntimeContextChange = Schema.decodeUnknownSync(McpRuntimeContextChange);
const decodeMcpRuntimeContextChangesInput = Schema.decodeUnknownSync(McpRuntimeContextChangesInput);
const decodeMcpRuntimeContextSnapshot = Schema.decodeUnknownSync(McpRuntimeContextSnapshot);
const decodeMcpRuntimeServerDetailsResult = Schema.decodeUnknownSync(McpRuntimeServerDetailsResult);
const decodeMcpRuntimeSnapshot = Schema.decodeUnknownSync(McpRuntimeSnapshot);
const decodeMcpSetProviderEnabledInput = Schema.decodeUnknownSync(McpSetProviderEnabledInput);
const decodeMcpSetProviderEnabledResult = Schema.decodeUnknownSync(McpSetProviderEnabledResult);
const decodeMcpUpdateInput = Schema.decodeUnknownSync(McpUpdateInput);
const encodeMcpServer = Schema.encodeSync(McpServerDefinition);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("McpServerDefinition", () => {
  it("decodes and encodes stdio definitions with sensitive env values", () => {
    const decoded = decodeMcpServer({
      id: "github",
      name: "GitHub",
      enabled: true,
      scope: "global",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: {
          value: "secret",
          sensitive: true,
        },
      },
    });

    expect(decoded.transport).toBe("stdio");
    if (decoded.transport !== "stdio") {
      throw new Error("Expected stdio MCP server.");
    }
    expect(decoded.env.GITHUB_TOKEN).toEqual({
      value: "secret",
      sensitive: true,
    });
    expect(encodeMcpServer(decoded as McpServerDefinitionType)).toMatchObject({
      id: "github",
      transport: "stdio",
      command: "npx",
    });
  });

  it("decodes SSE and Streamable HTTP definitions", () => {
    expect(
      decodeMcpServer({
        id: "docs_sse",
        name: "Docs SSE",
        transport: "sse",
        url: "https://example.com/sse",
        headers: {
          Authorization: { value: "Bearer token", sensitive: true },
        },
      }).transport,
    ).toBe("sse");

    expect(
      decodeMcpServer({
        id: "docs_http",
        name: "Docs HTTP",
        transport: "http",
        url: "https://example.com/mcp",
      }).transport,
    ).toBe("http");
  });

  it("defaults legacy definitions to all provider instances", () => {
    const decoded = decodeMcpServer({
      id: "legacy",
      name: "Legacy",
      transport: "stdio",
      command: "node",
    });

    expect(decoded.providerRouting).toEqual({ mode: "all" });
  });

  it("decodes an explicit provider-instance allowlist", () => {
    const decoded = decodeMcpServer({
      id: "work_only",
      name: "Work only",
      transport: "stdio",
      command: "node",
      providerRouting: {
        mode: "selected",
        instanceIds: ["claude_work", "codex_work"],
      },
    });

    expect(decoded.providerRouting).toEqual({
      mode: "selected",
      instanceIds: ["claude_work", "codex_work"],
    });
  });

  it("rejects invalid names, missing transport fields, bad URLs, and invalid env/header names", () => {
    expect(() =>
      decodeMcpServer({
        id: "bad name",
        name: "Bad",
        transport: "stdio",
        command: "node",
      }),
    ).toThrow();
    expect(() =>
      decodeMcpServer({
        id: "missing_command",
        name: "Missing command",
        transport: "stdio",
      }),
    ).toThrow();
    expect(() =>
      decodeMcpServer({
        id: "bad_url",
        name: "Bad URL",
        transport: "http",
        url: "ftp://example.com/mcp",
      }),
    ).toThrow();
    expect(() =>
      decodeMcpServer({
        id: "bad_env",
        name: "Bad env",
        transport: "stdio",
        command: "node",
        env: { "BAD-NAME": { value: "x" } },
      }),
    ).toThrow();
    expect(() =>
      decodeMcpServer({
        id: "bad_header",
        name: "Bad header",
        transport: "sse",
        url: "https://example.com/sse",
        headers: { "Bad Header": { value: "x" } },
      }),
    ).toThrow();
  });
});

describe("ServerSettings.mcp", () => {
  it("defaults to no configured MCP servers", () => {
    expect(decodeServerSettings({}).mcp.servers).toEqual([]);
  });

  it("decodes MCP settings patches", () => {
    const patch = decodeServerSettingsPatch({
      mcp: {
        servers: [
          {
            id: "filesystem",
            name: "Filesystem",
            scope: "project",
            projectCwd: "/tmp/project",
            transport: "stdio",
            command: "node",
          },
        ],
      },
    });

    expect(patch.mcp?.servers?.[0]?.scope).toBe("project");
  });
});

describe("MCP import source contracts", () => {
  it("decodes discovered agent dotfolders and import selections", () => {
    const sources = decodeMcpDiscoverImportSourcesResult({
      sources: [
        {
          id: "codex:/home/alex/.codex",
          tool: "codex",
          label: "Codex .codex",
          path: "/home/alex/.codex",
          mcpServerCount: 2,
          skillCount: 1,
          mcpConfigPaths: ["/home/alex/.codex/config.toml"],
          skillPaths: ["/home/alex/.codex/skills/review/SKILL.md"],
        },
      ],
    });

    expect(sources.sources[0]?.tool).toBe("codex");
    expect(
      decodeMcpImportSourcesInput({
        sourceIds: ["codex:/home/alex/.codex"],
      }),
    ).toMatchObject({
      scope: "global",
      replace: false,
      deduplicate: true,
      providerRouting: { mode: "all" },
    });
    expect(decodeMcpImportCursorJsonInput({ json: "{}" }).providerRouting).toEqual({
      mode: "all",
    });
  });
});

describe("provider-specific MCP contracts", () => {
  it("decodes the focused provider enable mutation", () => {
    expect(
      decodeMcpSetProviderEnabledInput({
        serverId: "notion",
        providerInstanceId: "claude_work",
        enabled: false,
      }),
    ).toMatchObject({
      serverId: "notion",
      providerInstanceId: "claude_work",
      enabled: false,
    });
  });

  it("defaults missing mutation live-apply results for older servers", () => {
    expect(decodeMcpMutationResult({ servers: [] }).liveApplyResults).toEqual([]);
    expect(decodeMcpSetProviderEnabledResult({ servers: [] }).liveApplyResults).toEqual([]);
  });

  it("identifies the provider instance for multi-provider live apply results", () => {
    const decoded = decodeMcpMutationResult({
      servers: [],
      liveApplyResults: [
        {
          providerInstanceId: "claude_work",
          threadId: "thread-1",
          runtimeSessionId: "runtime-1",
          outcome: "applied",
        },
      ],
    });

    expect(decoded.liveApplyResults[0]?.providerInstanceId).toBe("claude_work");
  });

  it("preserves an omitted provider routing field on legacy update payloads", () => {
    const legacy = decodeMcpUpdateInput({
      server: {
        id: "notion",
        name: "Notion",
        transport: "http",
        url: "https://example.com/mcp",
      },
    });
    const explicit = decodeMcpUpdateInput({
      server: {
        id: "notion",
        name: "Notion",
        transport: "http",
        url: "https://example.com/mcp",
        providerRouting: { mode: "all" },
      },
    });

    expect(legacy.server.providerRouting).toBeUndefined();
    expect(explicit.server.providerRouting).toEqual({ mode: "all" });
  });
});

describe("MCP runtime contracts", () => {
  const context = {
    providerInstanceId: "codex_work",
    driver: "codex",
    threadId: "thread-1",
    runtimeSessionId: "runtime-1",
    state: "active",
    updatedAt: "2026-08-02T12:00:00.000Z",
  } as const;

  const server = {
    serverId: "notion",
    providerKey: "notion",
    source: "t3-managed",
    providerInstanceId: "codex_work",
    threadId: "thread-1",
    runtimeSessionId: "runtime-1",
    name: "Notion",
    transport: "http",
    state: "auth-required",
    statusSource: "provider-query",
    observedAt: "2026-08-02T12:00:00.000Z",
    authState: "required",
    availableActions: ["authorize", "refresh"],
    reportsTools: true,
    toolCount: 12,
    issue: {
      code: "reauthenticationRequired",
      message: "Authorization required",
    },
    configDrift: "none",
  } as const;

  it("decodes a generation-fenced runtime snapshot", () => {
    const decoded = decodeMcpRuntimeSnapshot({
      context,
      revision: 4,
      observedAt: "2026-08-02T12:00:00.000Z",
      servers: [server],
    });

    expect(decoded.context.runtimeSessionId).toBe("runtime-1");
    expect(decoded.servers[0]?.state).toBe("auth-required");
    expect(decoded.servers[0]?.issue?.code).toBe("reauthenticationRequired");
  });

  it("decodes only safe lazy tool metadata", () => {
    const decoded = decodeMcpRuntimeServerDetailsResult({
      server,
      tools: [
        {
          name: "search",
          title: "Search workspace",
          description: "Searches authorized pages",
          readOnly: true,
          destructive: false,
          openWorld: false,
        },
      ],
      resources: [
        {
          uri: "notion://workspace/page-1",
          name: "Page one",
          mimeType: "text/markdown",
          size: 128,
        },
      ],
      templates: [
        {
          uriTemplate: "notion://workspace/{pageId}",
          name: "Workspace page",
        },
      ],
    });

    expect(decoded.tools).toEqual([
      {
        name: "search",
        title: "Search workspace",
        description: "Searches authorized pages",
        readOnly: true,
        destructive: false,
        openWorld: false,
      },
    ]);
    expect(decoded.resources[0]?.uri).toBe("notion://workspace/page-1");
    expect(decoded.templates[0]?.uriTemplate).toBe("notion://workspace/{pageId}");
  });

  it("defaults resource inventories for older runtime-detail responses", () => {
    const decoded = decodeMcpRuntimeServerDetailsResult({ server, tools: [] });

    expect(decoded.resources).toEqual([]);
    expect(decoded.templates).toEqual([]);
  });

  it("requires the runtime generation fence for actions", () => {
    expect(
      decodeMcpRuntimeActionInput({
        providerInstanceId: "codex_work",
        threadId: "thread-1",
        runtimeSessionId: "runtime-1",
        providerKey: "notion",
        action: "authorize",
      }).runtimeSessionId,
    ).toBe("runtime-1");

    expect(() =>
      decodeMcpRuntimeActionInput({
        providerInstanceId: "codex_work",
        threadId: "thread-1",
        providerKey: "notion",
        action: "authorize",
      }),
    ).toThrow();
  });

  it("decodes provider-scoped context snapshots and lifecycle changes", () => {
    expect(decodeMcpRuntimeContextChangesInput({ providerInstanceId: "codex_work" })).toEqual({
      providerInstanceId: "codex_work",
    });

    const snapshot = decodeMcpRuntimeContextSnapshot({
      providerInstanceId: "codex_work",
      revision: 3,
      observedAt: "2026-08-02T12:00:00.000Z",
      contexts: [context],
    });
    expect(snapshot.contexts[0]?.runtimeSessionId).toBe("runtime-1");

    const initial = decodeMcpRuntimeContextChange({ type: "snapshot", snapshot });
    const upserted = decodeMcpRuntimeContextChange({
      type: "context-upserted",
      revision: 4,
      observedAt: "2026-08-02T12:01:00.000Z",
      context: { ...context, state: "inactive", updatedAt: "2026-08-02T12:01:00.000Z" },
    });
    const removed = decodeMcpRuntimeContextChange({
      type: "context-removed",
      revision: 5,
      observedAt: "2026-08-02T12:02:00.000Z",
      threadId: "thread-1",
      runtimeSessionId: "runtime-1",
    });

    expect(initial.type).toBe("snapshot");
    expect(upserted.type).toBe("context-upserted");
    expect(removed.type).toBe("context-removed");
    expect(WS_METHODS.mcpRuntimeContextChanges).toBe("mcp.runtimeContextChanges");
  });
});
