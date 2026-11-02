import { assert, expect, it } from "@effect/vitest";
import {
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import {
  resolveProviderMcpServers,
  toAcpMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
} from "@t3tools/provider-core/server/mcpConfiguration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { codexManagedMcpConfiguration } from "./CodexMcpConfiguration.ts";
import { nativeProviderTestLayer } from "./testUtils/nativeProviderV2.ts";

const decodeServer = Schema.decodeSync(McpServerDefinition);
const servers = [
  decodeServer({
    id: "t3-code",
    name: "Private tool",
    enabled: true,
    scope: "global",
    providerRouting: { mode: "all" },
    transport: "stdio",
    command: "test-mcp",
    args: ["--stdio"],
    cwd: "/workspace/tools",
    env: { TOKEN: { value: "private-token", sensitive: true } },
  }),
  decodeServer({
    id: "docs",
    name: "Docs",
    enabled: true,
    scope: "global",
    providerRouting: { mode: "all" },
    transport: "http",
    url: "https://mcp.example.test",
    headers: { Authorization: { value: "Bearer private-token", sensitive: true } },
  }),
];

it("projects resolved servers without replacing T3's authenticated internal endpoint", () => {
  expect(codexManagedMcpConfiguration(servers)).toMatchObject({
    "mcp_servers.t3-managed:t3-code": {
      command: "test-mcp",
      env: { TOKEN: "private-token" },
      cwd: "/workspace/tools",
    },
    "mcp_servers.docs": {
      url: "https://mcp.example.test",
      http_headers: { Authorization: "Bearer private-token" },
    },
  });
  expect(toClaudeMcpServers(servers)["t3-managed:t3-code"]).toMatchObject({
    type: "stdio",
    env: { TOKEN: "private-token" },
  });
  expect(toOpenCodeMcpServers(servers).docs).toMatchObject({
    type: "remote",
    headers: { Authorization: "Bearer private-token" },
  });
  expect(toAcpMcpServers(servers)[0]).toMatchObject({
    name: "t3-managed:t3-code",
    _meta: { cwd: "/workspace/tools" },
  });
});

it.layer(nativeProviderTestLayer)("Provider managed MCP resolution", (it) => {
  it.effect(
    "forwards environment-local thread identity and withholds external servers from isolated turns",
    () =>
      Effect.gen(function* () {
        const host = yield* ProviderHost;
        const requests: Array<Parameters<NonNullable<typeof host.resolveMcpServers>>[0]> = [];
        const configured = {
          ...host,
          resolveMcpServers: (input: Parameters<NonNullable<typeof host.resolveMcpServers>>[0]) =>
            Effect.sync(() => {
              requests.push(input);
              return servers;
            }),
        };
        const input = {
          cwd: "/worktree",
          threadId: ThreadId.make("thread-worktree"),
          instanceId: ProviderInstanceId.make("codex-work"),
          driver: ProviderDriverKind.make("codex"),
        };
        assert.deepEqual(yield* resolveProviderMcpServers(configured, input), servers);
        assert.deepEqual(requests, [
          { cwd: input.cwd, threadId: input.threadId, providerInstanceId: input.instanceId },
        ]);
        assert.deepEqual(
          yield* resolveProviderMcpServers(configured, {
            ...input,
            runtimePolicy: { interactionMode: "chat" },
          }),
          [],
        );
        assert.deepEqual(
          yield* resolveProviderMcpServers(configured, {
            ...input,
            runtimePolicy: { interactionMode: "default", commandExecutionPolicy: "deny" },
          }),
          [],
        );
        assert.equal(requests.length, 1);
      }),
  );
});
