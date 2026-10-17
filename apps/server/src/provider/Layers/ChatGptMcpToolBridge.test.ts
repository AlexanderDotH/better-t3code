import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  DeepPlanRunId,
  McpServerDefinition,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { buildNativeHarnessToolCatalog } from "../nativeHarness/NativeHarnessTools.ts";
import {
  makeNativeProviderMcpToolBridge,
  type ChatGptMcpClientFactory,
} from "./ChatGptMcpToolBridge.ts";

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
  it.effect(
    "keeps bound planning tools and inherits composer approvals for other MCP actions",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const threadId = ThreadId.make("native-deep-plan");
          const instanceId = ProviderInstanceId.make("openai");
          const config = {
            capabilities: new Set(["workspace"]),
            environmentId: EnvironmentId.make("local"),
            threadId,
            providerSessionId: "native-deep-plan-session",
            providerInstanceId: instanceId,
            endpoint: "http://127.0.0.1:43123/mcp",
            authorizationHeader: "Bearer test",
          };
          McpProviderSession.setMcpProviderSession(config);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
          );
          let connections = 0;
          const bridge = yield* makeNativeProviderMcpToolBridge({
            instanceId,
            environment: {},
            resolveActiveServers: () => Effect.succeed([docsServer]),
            clientFactory: {
              connect: async () => {
                connections += 1;
                return {
                  listTools: async () => ({
                    tools: [
                      { name: "deep_plan_publish", inputSchema: { type: "object" } },
                      { name: "deep_plan_adjust_procedure", inputSchema: { type: "object" } },
                      { name: "ordinary_write", inputSchema: { type: "object" } },
                      { name: "workspace_edit", inputSchema: { type: "object" } },
                    ],
                  }),
                  callTool: async () => ({ isError: false }),
                  close: async () => {},
                };
              },
            },
          });
          const initial = yield* bridge.extensionForThread({ threadId, cwd: "/workspace" });
          const initialCatalog = yield* buildNativeHarnessToolCatalog({
            interactionMode: "plan",
            sandboxMode: "read-only",
            extensions: [initial],
          });
          expect(initialCatalog.map((tool) => tool.name)).not.toContain("deep_plan_publish");

          McpProviderSession.setMcpProviderSession({
            ...config,
            capabilities: new Set(["workspace", "deep-plan"]),
            deepPlan: {
              runId: DeepPlanRunId.make("run-1"),
              runThreadId: threadId,
              phase: "planning",
              approvedPlanVersion: null,
              modelSelection: { instanceId, model: "gpt-5.6" },
            },
          });
          const bound = yield* bridge.extensionForThread({ threadId, cwd: "/workspace" });
          const boundCatalog = yield* buildNativeHarnessToolCatalog({
            interactionMode: "plan",
            sandboxMode: "read-only",
            extensions: [bound],
          });
          expect(boundCatalog.map((tool) => tool.name)).toContain("deep_plan_publish");
          expect(boundCatalog.map((tool) => tool.name)).toContain("ordinary_write");
          expect(boundCatalog.map((tool) => tool.name)).toContain("mcp__docs__ordinary_write");
          expect(boundCatalog.map((tool) => tool.name)).not.toContain("workspace_edit");
          expect(
            bound.declarations.find((tool) => tool.name === "ordinary_write")?.requiresApproval,
          ).toBe(true);
          expect(boundCatalog.map((tool) => tool.name)).toContain("mcp__docs__deep_plan_publish");
          expect(
            bound.declarations.find((tool) => tool.name === "deep_plan_publish")?.requiresApproval,
          ).toBe(false);
          expect(connections).toBe(4);
          McpProviderSession.setMcpProviderSession({
            ...config,
            capabilities: new Set(["workspace", "deep-plan"]),
            deepPlan: {
              runId: DeepPlanRunId.make("run-1"),
              runThreadId: threadId,
              phase: "execution",
              approvedPlanVersion: 1,
              readOnly: true,
              modelSelection: { instanceId, model: "gpt-5.6" },
            },
          });
          const review = yield* bridge.extensionForThread({ threadId, cwd: "/workspace" });
          const reviewCatalog = yield* buildNativeHarnessToolCatalog({
            interactionMode: "plan",
            sandboxMode: "read-only",
            extensions: [review],
          });
          expect(reviewCatalog.map((tool) => tool.name)).toContain("deep_plan_adjust_procedure");
          expect(reviewCatalog.map((tool) => tool.name)).toContain("ordinary_write");
          expect(reviewCatalog.map((tool) => tool.name)).not.toContain("workspace_edit");
          expect(reviewCatalog.map((tool) => tool.name)).toContain(
            "mcp__docs__deep_plan_adjust_procedure",
          );
          expect(connections).toBe(6);
        }),
      ),
  );

  it.effect("exposes internal T3 tools by name and namespaces configured MCP tools", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threadId = ThreadId.make("chatgpt-mcp-thread");
        const instanceId = ProviderInstanceId.make("chatgpt_personal");
        McpProviderSession.setMcpProviderSession({
          capabilities: new Set(["preview", "workspace", "workspace-write", "coordination"]),
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
        const bridge = yield* makeNativeProviderMcpToolBridge({
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
        const bridge = yield* makeNativeProviderMcpToolBridge({
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
          capabilities: new Set(["preview", "workspace", "workspace-write", "coordination"]),
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
        const bridge = yield* makeNativeProviderMcpToolBridge({
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
        const bridge = yield* makeNativeProviderMcpToolBridge({
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
        const bridge = yield* makeNativeProviderMcpToolBridge({
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
