import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  McpServerDefinition,
  McpDiscoverImportSourcesResult,
  McpImportSourcesInput,
  ServerSettings,
  ServerSettingsPatch,
  type McpServerDefinition as McpServerDefinitionType,
} from "./index.ts";

const decodeMcpServer = Schema.decodeUnknownSync(McpServerDefinition);
const decodeMcpDiscoverImportSourcesResult = Schema.decodeUnknownSync(
  McpDiscoverImportSourcesResult,
);
const decodeMcpImportSourcesInput = Schema.decodeUnknownSync(McpImportSourcesInput);
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
    ).toMatchObject({ scope: "global", replace: false, deduplicate: true });
  });
});
