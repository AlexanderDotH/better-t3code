import { describe, expect, it } from "vite-plus/test";
import {
  ProjectId,
  ProviderInstanceId,
  type CatalogMcpConnection,
  type ExtensionCatalogEntry,
} from "@t3tools/contracts";
import { catalogMcpServer, catalogSourceUrl } from "./extensionStore.logic";

it("only opens valid HTTP source pages without embedded credentials", () => {
  expect(catalogSourceUrl("https://github.com/example/tool")).toBe(
    "https://github.com/example/tool",
  );
  expect(catalogSourceUrl("http://example.com")).toBe("http://example.com/");
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,test",
    "invalid",
    "https://user:secret@example.com",
  ]) {
    expect(catalogSourceUrl(url)).toBeNull();
  }
});

describe("MCP store setup", () => {
  const connection: CatalogMcpConnection = {
    label: "npm",
    transport: "stdio",
    command: "npx",
    url: "",
    headers: {},
    args: [
      { value: "-y" },
      { value: "@example/server@1.0.0" },
      { name: "--root", value: "{directory}" },
      { name: "--optional", value: "{optional}" },
    ],
    env: { TOKEN: "{token}" },
    inputs: [
      {
        key: "directory",
        label: "Directory",
        description: "",
        required: true,
        secret: false,
        defaultValue: "",
      },
      {
        key: "token",
        label: "Token",
        description: "",
        required: true,
        secret: true,
        defaultValue: "",
      },
      {
        key: "optional",
        label: "Optional",
        description: "",
        required: false,
        secret: false,
        defaultValue: "",
      },
    ],
  };
  const entry: ExtensionCatalogEntry = {
    id: "mcp-example",
    kind: "mcp",
    name: "Example",
    source: "example",
    sourceUrl: "https://example.com",
    description: "",
    connections: [connection],
  };
  it("preserves argument boundaries, secrets, and the selected project and provider", () => {
    const input = {
      entry,
      connection,
      values: { directory: "/a directory/with spaces", token: "secret" },
      scope: "project" as const,
      projectId: ProjectId.make("project-1"),
      projectCwd: "/workspace",
      providerRouting: {
        mode: "selected" as const,
        instanceIds: [ProviderInstanceId.make("codex")],
      },
    };
    expect(catalogMcpServer(input)).toMatchObject({
      scope: "project",
      projectCwd: "/workspace",
      providerRouting: input.providerRouting,
      args: ["-y", "@example/server@1.0.0", "--root", "/a directory/with spaces"],
      env: { TOKEN: { value: "secret", sensitive: true } },
    });
    expect(() => catalogMcpServer({ ...input, values: {} })).toThrow("Directory is required");
  });
});
