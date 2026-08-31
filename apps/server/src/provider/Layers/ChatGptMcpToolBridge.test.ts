import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  McpServerDefinition,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { buildNativeHarnessToolCatalog } from "../nativeHarness/NativeHarnessTools.ts";
import { makeChatGptMcpToolBridge, type ChatGptMcpClientFactory } from "./ChatGptMcpToolBridge.ts";

const decodeServer = Schema.decodeSync(McpServerDefinition);
const docsServer = decodeServer({
  id: "docs",
  name: "Docs",
  enabled: true,
  providerRouting: { mode: "all" },
  scope: "global",
  transport: "http",
  url: "https://mcp.example.test",
  headers: {},
});
const searchServer = decodeServer({
  id: "search",
  name: "Search",
  enabled: true,
  providerRouting: { mode: "all" },
  scope: "global",
  transport: "http",
  url: "https://search-mcp.example.test",
  headers: {},
});

describe("ChatGptMcpToolBridge", () => {
  it.effect("exposes internal T3 tools by name and namespaces configured MCP tools", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("chatgpt-mcp-thread");
        const instanceId = ProviderInstanceId.make("chatgpt_personal");
        McpProviderSession.setMcpProviderSession({
          environmentId: EnvironmentId.make("local"),
          threadId,
          providerSessionId: "provider-session",
          providerInstanceId: instanceId,
          endpoint: "http://127.0.0.1:43123/mcp",
          authorizationHeader: "Bearer internal-secret",
        });
        const closed: string[] = [];
        const calls: Array<{ readonly server: string; readonly name: string }> = [];
        const clientFactory: ChatGptMcpClientFactory = {
          connect: async (connection) => ({
            listTools: async () => ({
              tools:
                connection.kind === "internal"
                  ? [
                      {
                        name: "list_agents",
                        description: "List direct agents.",
                        inputSchema: { type: "object", additionalProperties: false },
                        annotations: { readOnlyHint: true },
                      },
                    ]
                  : [
                      {
                        name: "search",
                        description: "Search documentation.",
                        inputSchema: { type: "object", properties: { query: { type: "string" } } },
                      },
                    ],
            }),
            callTool: async ({ name }) => {
              calls.push({ server: connection.serverId, name });
              return { isError: false, structuredContent: { name } };
            },
            close: async () => {
              closed.push(connection.serverId);
            },
          }),
        };
        const bridge = yield* makeChatGptMcpToolBridge({
          instanceId,
          environment: {},
          clientFactory,
          resolveActiveServers: () => Effect.succeed([docsServer]),
        });

        const extension = yield* bridge.extensionForThread({ threadId, cwd: process.cwd() });
        expect(extension.declarations.map(({ name }) => name)).toEqual([
          "list_agents",
          "mcp__docs__search",
        ]);
        expect(extension.declarations[0]?.availability).toBe("read-only");
        expect(extension.declarations[0]?.requiresApproval).toBe(false);
        expect(extension.declarations[1]?.availability).toBe("default-only");
        expect(extension.declarations[1]?.requiresApproval).toBe(true);

        const result = yield* extension.execute({
          name: "mcp__docs__search",
          args: { query: "subscriptions" },
          cwd: process.cwd(),
          environment: {},
        });
        expect(result).toMatchObject({ ok: true, title: "Docs · search" });
        expect(calls).toEqual([{ server: "docs", name: "search" }]);

        yield* bridge.releaseThread(threadId);
        expect(closed.toSorted()).toEqual(["docs", "t3-code"]);
        McpProviderSession.clearMcpProviderSession(threadId);
      }),
    ),
  );

  it.effect("reconnects once when MCP closes while listing native provider tools", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("native-mcp-reconnect-thread");
        const closedAttempts: number[] = [];
        let connectionAttempt = 0;
        const bridge = yield* makeChatGptMcpToolBridge({
          instanceId: ProviderInstanceId.make("openrouter_personal"),
          environment: {},
          resolveActiveServers: () => Effect.succeed([docsServer]),
          clientFactory: {
            connect: async () => {
              connectionAttempt += 1;
              const attempt = connectionAttempt;
              return {
                listTools: async () => {
                  if (attempt === 1) throw new Error("MCP error -32000: Connection closed");
                  return {
                    tools: [
                      {
                        name: "search",
                        description: "Search documentation.",
                        inputSchema: { type: "object" },
                      },
                    ],
                  };
                },
                callTool: async () => ({ isError: false }),
                close: async () => {
                  closedAttempts.push(attempt);
                },
              };
            },
          },
        });

        const extension = yield* bridge.extensionForThread({ threadId, cwd: process.cwd() });

        expect(connectionAttempt).toBe(2);
        expect(closedAttempts).toEqual([1]);
        expect(extension.declarations.map(({ name }) => name)).toEqual(["mcp__docs__search"]);

        yield* bridge.releaseThread(threadId);
        expect(closedAttempts).toEqual([1, 2]);
      }),
    ),
  );

  it.effect("evicts a rejected MCP setup so the next native provider turn can reconnect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("native-mcp-retry-after-failure-thread");
        McpProviderSession.setMcpProviderSession({
          environmentId: EnvironmentId.make("local"),
          threadId,
          providerSessionId: "provider-session-retry",
          providerInstanceId: ProviderInstanceId.make("openrouter_personal"),
          endpoint: "http://127.0.0.1:43123/mcp",
          authorizationHeader: "Bearer internal-secret",
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
        );
        let connectionAttempt = 0;
        const bridge = yield* makeChatGptMcpToolBridge({
          instanceId: ProviderInstanceId.make("openrouter_personal"),
          environment: {},
          resolveActiveServers: () => Effect.succeed([]),
          clientFactory: {
            connect: async () => {
              connectionAttempt += 1;
              const attempt = connectionAttempt;
              return {
                listTools: async () => {
                  if (attempt <= 2) throw new Error("MCP error -32000: Connection closed");
                  return { tools: [] };
                },
                callTool: async () => ({ isError: false }),
                close: async () => undefined,
              };
            },
          },
        });

        const firstFailure = yield* Effect.flip(
          bridge.extensionForThread({ threadId, cwd: process.cwd() }),
        );
        expect(firstFailure.detail).toContain("Connection closed");
        expect(connectionAttempt).toBe(2);

        const extension = yield* bridge.extensionForThread({ threadId, cwd: process.cwd() });
        expect(connectionAttempt).toBe(3);
        expect(extension.declarations).toEqual([]);
      }),
    ),
  );

  it.effect("keeps healthy MCP tools when one configured server closes its connection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connectionAttempts: string[] = [];
        const bridge = yield* makeChatGptMcpToolBridge({
          instanceId: ProviderInstanceId.make("openrouter_personal"),
          environment: {},
          resolveActiveServers: () => Effect.succeed([docsServer, searchServer]),
          clientFactory: {
            connect: async (connection) => {
              connectionAttempts.push(connection.serverId);
              return {
                listTools: async () => {
                  if (connection.serverId === "docs") {
                    throw new Error("MCP error -32000: Connection closed");
                  }
                  return {
                    tools: [
                      {
                        name: "query",
                        description: "Search the web.",
                        inputSchema: { type: "object" },
                      },
                    ],
                  };
                },
                callTool: async () => ({ isError: false }),
                close: async () => undefined,
              };
            },
          },
        });

        const extension = yield* bridge.extensionForThread({
          threadId: ThreadId.make("native-mcp-partial-catalog-thread"),
          cwd: process.cwd(),
        });

        expect(connectionAttempts).toEqual(["docs", "docs", "search"]);
        expect(extension.declarations.map(({ name }) => name)).toEqual(["mcp__search__query"]);
      }),
    ),
  );

  it.effect("keeps all tools discoverable when the native catalog contains 538 definitions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: Array<{
          readonly name: string;
          readonly arguments?: Readonly<Record<string, unknown>>;
        }> = [];
        const bridge = yield* makeChatGptMcpToolBridge({
          instanceId: ProviderInstanceId.make("openrouter_personal"),
          environment: {},
          resolveActiveServers: () => Effect.succeed([docsServer]),
          clientFactory: {
            connect: async () => ({
              listTools: async () => ({
                tools: Array.from({ length: 533 }, (_, index) => ({
                  name: `external_${index}`,
                  description: `Run external tool ${index}.`,
                  inputSchema: { type: "object" },
                })),
              }),
              callTool: async (request) => {
                calls.push(request);
                return { isError: false, structuredContent: { name: request.name } };
              },
              close: async () => undefined,
            }),
          },
        });

        const extension = yield* bridge.extensionForThread({
          threadId: ThreadId.make("native-mcp-large-catalog-thread"),
          cwd: process.cwd(),
        });
        const catalog = yield* buildNativeHarnessToolCatalog({
          interactionMode: "default",
          sandboxMode: "danger-full-access",
          extensions: [extension],
        });

        expect(catalog).toHaveLength(90);
        expect(catalog.map(({ name }) => name)).toContain("mcp__t3_catalog__search");
        expect(catalog.map(({ name }) => name)).toContain("mcp__t3_catalog__call");

        const searchResult = yield* extension.execute({
          name: "mcp__t3_catalog__search",
          args: { query: "external_532" },
          cwd: process.cwd(),
          environment: {},
        });
        expect(searchResult).toMatchObject({
          ok: true,
          output: { tools: [{ name: "mcp__docs__external_532" }] },
        });

        const callResult = yield* extension.execute({
          name: "mcp__t3_catalog__call",
          args: { name: "mcp__docs__external_532", arguments: { value: "ok" } },
          cwd: process.cwd(),
          environment: {},
        });
        expect(callResult).toMatchObject({ ok: true, title: "Docs · external_532" });
        expect(calls).toEqual([{ name: "external_532", arguments: { value: "ok" } }]);
      }),
    ),
  );
});
