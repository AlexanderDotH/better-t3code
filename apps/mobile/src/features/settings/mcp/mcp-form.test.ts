import { McpServerDefinition, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_MANAGEMENT_SCOPE,
  managementScopeInput,
  mcpDraftFromServer,
  mcpServerFromDraft,
  validateMcpImportJson,
} from "./mcp-form";

const decodeServer = Schema.decodeUnknownSync(McpServerDefinition);

describe("mobile MCP forms", () => {
  it.each(["stdio", "sse", "http"] as const)(
    "round trips %s with scope, routing and redacted secrets",
    (transport) => {
      const secret = { value: "", sensitive: true, valueRedacted: true };
      const server = decodeServer({
        id: "docs",
        name: "Documentation",
        enabled: false,
        scope: "project",
        projectId: ProjectId.make("project-1"),
        projectCwd: "/host/project",
        providerRouting: { mode: "selected", instanceIds: [ProviderInstanceId.make("codex")] },
        transport,
        ...(transport === "stdio"
          ? {
              command: "npx",
              cwd: "/host/tools",
              args: ["-y", "two words", ""],
              env: { TOKEN: secret },
            }
          : { url: "https://example.com/mcp", headers: { Authorization: secret } }),
      });
      expect(mcpServerFromDraft(mcpDraftFromServer(server), [server.id], server.id)).toEqual(
        server,
      );
    },
  );

  it("preserves stored secrets until replaced and rejects renaming a redacted key", () => {
    const draft = mcpDraftFromServer(
      decodeServer({
        id: "docs",
        name: "Docs",
        transport: "stdio",
        command: "docs",
        env: { TOKEN: { value: "hidden", sensitive: true, valueRedacted: true } },
      }),
    );
    expect(draft.env[0]?.value).toBe("");
    const row = draft.env[0]!;
    expect(() =>
      mcpServerFromDraft({ ...draft, env: [{ ...row, name: "NEW_TOKEN" }] }, []),
    ).toThrow("mobile.mcp.secretReenter");
    expect(
      mcpServerFromDraft(
        { ...draft, env: [{ ...row, value: "replacement", valueRedacted: false }] },
        [],
      ),
    ).toMatchObject({
      env: { TOKEN: { value: "replacement", sensitive: true } },
    });
  });

  it("validates identifiers, project scope, routing, transport fields and duplicate secrets", () => {
    const draft = { ...mcpDraftFromServer(null), id: "docs", name: "Docs", command: "docs" };
    const cases = [
      { patch: { id: "1-invalid" }, error: "identifierInvalid" },
      { patch: { name: " " }, error: "nameRequired" },
      { patch: { command: " " }, error: "commandRequired" },
      { patch: { scope: "project" as const }, error: "projectRequired" },
      {
        patch: { providerRouting: { mode: "selected" as const, instanceIds: [] } },
        error: "providerRequired",
      },
      { patch: { transport: "http" as const, url: "file:///private" }, error: "urlInvalid" },
    ];
    for (const { patch, error } of cases) {
      expect(() => mcpServerFromDraft({ ...draft, ...patch }, [])).toThrow(`mobile.mcp.${error}`);
    }
    expect(() => mcpServerFromDraft(draft, ["docs"])).toThrow("identifierDuplicate");
    const entry = {
      rowId: "1",
      name: "Authorization",
      value: "",
      sensitive: false,
      valueRedacted: false,
    };
    expect(() =>
      mcpServerFromDraft(
        {
          ...draft,
          transport: "http",
          url: "https://example.com",
          headers: [entry, { ...entry, rowId: "2", name: "authorization" }],
        },
        [],
      ),
    ).toThrow("secretNameDuplicate");
    expect(
      managementScopeInput({
        ...EMPTY_MANAGEMENT_SCOPE,
        projectCwd: "/ignored",
        projectId: "ignored",
      }),
    ).toEqual({ scope: "global" });
  });

  it("accepts pasted or file JSON with a BOM, and rejects invalid envelopes", () => {
    const jsonFromFile = '\uFEFF{"mcpServers":{"docs":{"command":"docs"}}}';
    expect(JSON.parse(validateMcpImportJson(jsonFromFile))).toEqual({
      mcpServers: { docs: { command: "docs" } },
    });
    for (const json of ["null", "[]", "{}", '{"mcpServers":[]}', '{"mcpServers":null}']) {
      expect(() => validateMcpImportJson(json)).toThrow("mobile.mcp.invalidImport");
    }
    expect(() => validateMcpImportJson("{")).toThrow("mobile.mcp.invalidJson");
  });
});
