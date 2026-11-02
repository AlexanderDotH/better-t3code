import type { McpServerDefinition } from "@t3tools/contracts";
import type * as Schema from "effect/Schema";
import { managedMcpProviderKey } from "@t3tools/provider-core/server/mcpConfiguration";

export function codexManagedMcpConfiguration(servers: ReadonlyArray<McpServerDefinition>) {
  return Object.fromEntries(
    servers.map((server): [string, Schema.Json] => {
      const key = `mcp_servers.${managedMcpProviderKey(server.id)}`;
      if (server.transport === "stdio")
        return [
          key,
          {
            command: server.command,
            args: [...server.args],
            env: Object.fromEntries(
              Object.entries(server.env).map(([name, secret]) => [name, secret.value]),
            ),
            ...(server.cwd ? { cwd: server.cwd } : {}),
          },
        ];
      return [
        key,
        {
          url: server.url,
          http_headers: Object.fromEntries(
            Object.entries(server.headers).map(([name, secret]) => [name, secret.value]),
          ),
        },
      ];
    }),
  );
}
