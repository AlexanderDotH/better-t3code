// @effect-diagnostics globalFetch:off -- The MCP SDK requires a FetchLike callback for legacy SSE transports.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerDefinition, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { McpConfigEngineShape } from "../../mcp/McpConfigEngine.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NativeHarnessToolPolicyError,
  nativeHarnessToolDeclarations,
  type NativeHarnessToolDeclaration,
  type NativeHarnessToolExtension,
  type NativeHarnessToolResult,
} from "../nativeHarness/NativeHarnessTools.ts";

const MCP_OPERATION_TIMEOUT_MS = 60_000;
const MCP_CATALOG_DEFAULT_RESULT_LIMIT = 10;
const MCP_CATALOG_MAX_RESULT_LIMIT = 20;
const MCP_CATALOG_SEARCH_TOOL = "mcp__t3_catalog__search";
const MCP_CATALOG_CALL_TOOL = "mcp__t3_catalog__call";
const NATIVE_MCP_TOOL_DEFINITION_BUDGET =
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS -
  nativeHarnessToolDeclarations({
    interactionMode: "default",
    sandboxMode: "danger-full-access",
  }).length;

const McpCatalogSearchArgs = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  server: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MCP_CATALOG_MAX_RESULT_LIMIT })),
  ),
});
const McpCatalogCallArgs = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeMcpCatalogSearchArgs = Schema.decodeUnknownEffect(McpCatalogSearchArgs);
const decodeMcpCatalogCallArgs = Schema.decodeUnknownEffect(McpCatalogCallArgs);

const MCP_CATALOG_SEARCH_DECLARATION: NativeHarnessToolDeclaration = {
  name: MCP_CATALOG_SEARCH_TOOL,
  description:
    "Search the complete configured MCP tool catalog by capability or server before calling a tool that is not directly listed.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Capability, tool name, or descriptive keywords." },
      server: { type: "string", description: "Optional MCP server name or identifier." },
      limit: { type: "integer", minimum: 1, maximum: MCP_CATALOG_MAX_RESULT_LIMIT },
    },
  },
  availability: "read-only",
  requiresApproval: false,
};

const MCP_CATALOG_CALL_DECLARATION: NativeHarnessToolDeclaration = {
  name: MCP_CATALOG_CALL_TOOL,
  description:
    "Call a configured MCP tool returned by mcp__t3_catalog__search using its exact exposed name and arguments.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "Exact exposed MCP tool name returned by search." },
      arguments: {
        type: "object",
        additionalProperties: true,
        description: "Arguments matching the selected tool's input schema.",
      },
    },
    required: ["name"],
  },
  availability: "default-only",
  requiresApproval: true,
};

interface McpToolDescription {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: unknown | undefined;
  readonly annotations?: { readonly readOnlyHint?: boolean | undefined } | undefined;
}

interface NativeProviderMcpClient {
  readonly listTools: () => Promise<{ readonly tools: ReadonlyArray<McpToolDescription> }>;
  readonly callTool: (input: {
    readonly name: string;
    readonly arguments?: Readonly<Record<string, unknown>>;
  }) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

type McpConnection =
  | {
      readonly kind: "internal" | "http" | "sse";
      readonly serverId: string;
      readonly displayName: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "stdio";
      readonly serverId: string;
      readonly displayName: string;
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd?: string;
      readonly environment: Readonly<Record<string, string>>;
    };

export interface NativeProviderMcpClientFactory {
  readonly connect: (connection: McpConnection) => Promise<NativeProviderMcpClient>;
}

interface ConnectedTool {
  readonly exposedName: string;
  readonly nativeName: string;
  readonly serverId: string;
  readonly displayName: string;
  readonly client: NativeProviderMcpClient;
  readonly declaration: NativeHarnessToolDeclaration;
}

interface SessionTools {
  readonly extension: NativeHarnessToolExtension;
  readonly clients: ReadonlyArray<NativeProviderMcpClient>;
}

export interface NativeProviderMcpToolBridge {
  readonly extensionForThread: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
  }) => Effect.Effect<NativeHarnessToolExtension, NativeHarnessToolPolicyError>;
  readonly releaseThread: (threadId: ThreadId) => Effect.Effect<void>;
  readonly closeAll: Effect.Effect<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainValues(
  values: Readonly<Record<string, { readonly value: string }>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.value]));
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function connectionForConfiguredServer(
  server: McpServerDefinition,
  environment: NodeJS.ProcessEnv,
): McpConnection {
  if (server.transport === "stdio") {
    return {
      kind: "stdio",
      serverId: server.id,
      displayName: server.name,
      command: server.command,
      args: server.args,
      ...(server.cwd ? { cwd: server.cwd } : {}),
      environment: {
        ...definedEnvironment(environment),
        ...plainValues(server.env),
      },
    };
  }
  return {
    kind: server.transport,
    serverId: server.id,
    displayName: server.name,
    url: server.url,
    headers: plainValues(server.headers),
  };
}

function internalConnection(threadId: ThreadId): McpConnection | undefined {
  const session = McpProviderSession.readMcpProviderSession(threadId);
  if (!session) return undefined;
  return {
    kind: "internal",
    serverId: "t3-code",
    displayName: "T3 Code",
    url: session.endpoint,
    headers: { authorization: session.authorizationHeader },
  };
}

function withHeaders(
  input: RequestInit | undefined,
  headers: Readonly<Record<string, string>>,
): RequestInit {
  const merged = new Headers(input?.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return { ...input, headers: merged };
}

const defaultClientFactory: NativeProviderMcpClientFactory = {
  connect: async (connection) => {
    const client = new Client({ name: "t3-code-native-provider-harness", version: "0.0.0" });
    if (connection.kind === "stdio") {
      await client.connect(
        new StdioClientTransport({
          command: connection.command,
          args: [...connection.args],
          env: { ...connection.environment },
          ...(connection.cwd ? { cwd: connection.cwd } : {}),
          stderr: "pipe",
        }) as never,
      );
      return {
        listTools: () =>
          client.listTools() as Promise<{ tools: ReadonlyArray<McpToolDescription> }>,
        callTool: (request) =>
          client.callTool(request, undefined, { timeout: MCP_OPERATION_TIMEOUT_MS }),
        close: () => client.close(),
      };
    }
    const url = new URL(connection.url);
    if (connection.kind === "sse") {
      await client.connect(
        new SSEClientTransport(url, {
          requestInit: withHeaders(undefined, connection.headers),
          eventSourceInit: {
            fetch: (requestUrl, init) =>
              fetch(requestUrl, withHeaders(init, connection.headers)) as never,
          },
        }) as never,
      );
      return {
        listTools: () =>
          client.listTools() as Promise<{ tools: ReadonlyArray<McpToolDescription> }>,
        callTool: (request) =>
          client.callTool(request, undefined, { timeout: MCP_OPERATION_TIMEOUT_MS }),
        close: () => client.close(),
      };
    }
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: withHeaders(undefined, connection.headers),
      }) as never,
    );
    return {
      listTools: () => client.listTools() as Promise<{ tools: ReadonlyArray<McpToolDescription> }>,
      callTool: (request) =>
        client.callTool(request, undefined, { timeout: MCP_OPERATION_TIMEOUT_MS }),
      close: () => client.close(),
    };
  },
};

function stableSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeToolSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_") || "tool"
  );
}

function externalToolName(serverId: string, toolName: string): string {
  const full = `mcp__${safeToolSegment(serverId)}__${safeToolSegment(toolName)}`;
  return full.length <= 64 ? full : `${full.slice(0, 55)}_${stableSuffix(full)}`;
}

function inputSchema(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : { type: "object", additionalProperties: true };
}

function mcpExtensionCatalog(tools: ReadonlyArray<ConnectedTool>): {
  readonly declarations: ReadonlyArray<NativeHarnessToolDeclaration>;
  readonly usesGateway: boolean;
} {
  if (tools.length <= NATIVE_MCP_TOOL_DEFINITION_BUDGET) {
    return { declarations: tools.map((tool) => tool.declaration), usesGateway: false };
  }
  const directToolCount = Math.max(0, NATIVE_MCP_TOOL_DEFINITION_BUDGET - 2);
  return {
    declarations: [
      ...tools.slice(0, directToolCount).map((tool) => tool.declaration),
      MCP_CATALOG_SEARCH_DECLARATION,
      MCP_CATALOG_CALL_DECLARATION,
    ],
    usesGateway: true,
  };
}

function searchTerms(value: string | undefined): ReadonlyArray<string> {
  return (value ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function catalogToolMatches(
  tool: ConnectedTool,
  query: string | undefined,
  server: string | undefined,
): boolean {
  const searchable = [
    tool.exposedName,
    tool.nativeName,
    tool.serverId,
    tool.displayName,
    tool.declaration.description,
  ]
    .join(" ")
    .toLowerCase();
  const serverName = `${tool.serverId} ${tool.displayName}`.toLowerCase();
  return (
    searchTerms(query).every((term) => searchable.includes(term)) &&
    searchTerms(server).every((term) => serverName.includes(term))
  );
}

function mcpCatalogFailure(title: string, detail: string): NativeHarnessToolResult {
  return {
    ok: false,
    itemType: "mcp_tool_call",
    title,
    detail,
    output: { error: detail },
  };
}

function resultOutput(result: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(result)) return { result };
  const output: Record<string, unknown> = {};
  if ("structuredContent" in result) output.structuredContent = result.structuredContent;
  if ("content" in result) output.content = result.content;
  return Object.keys(output).length > 0 ? output : result;
}

function resultDetail(result: unknown, fallback: string): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return fallback;
  const text = result.content.find(
    (item): item is { readonly type: "text"; readonly text: string } =>
      isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  return text?.text.trim().slice(0, 500) || fallback;
}

async function closeClients(clients: ReadonlyArray<NativeProviderMcpClient>): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()));
}

function isConnectionClosed(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.toLowerCase().includes("connection closed");
}

async function connectAndListTools(
  factory: NativeProviderMcpClientFactory,
  connection: McpConnection,
): Promise<{
  readonly client: NativeProviderMcpClient;
  readonly listed: { readonly tools: ReadonlyArray<McpToolDescription> };
}> {
  const connectOnce = async () => {
    const client = await factory.connect(connection);
    try {
      return { client, listed: await client.listTools() };
    } catch (cause) {
      await closeClients([client]);
      throw cause;
    }
  };

  try {
    return await connectOnce();
  } catch (cause) {
    if (!isConnectionClosed(cause)) throw cause;
    return connectOnce();
  }
}

export const makeNativeProviderMcpToolBridge = Effect.fn("makeNativeProviderMcpToolBridge")(
  function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly environment: NodeJS.ProcessEnv;
    readonly resolveActiveServers: McpConfigEngineShape["resolveActiveServers"];
    readonly clientFactory?: NativeProviderMcpClientFactory;
  }) {
    const factory = input.clientFactory ?? defaultClientFactory;
    const sessions = new Map<ThreadId, Promise<SessionTools>>();
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const buildSession = async (threadId: ThreadId, cwd: string): Promise<SessionTools> => {
      const configured = await runPromise(
        input.resolveActiveServers({ cwd, providerInstanceId: input.instanceId }),
      );
      const connections = [
        ...(internalConnection(threadId) ? [internalConnection(threadId)!] : []),
        ...configured.map((server) => connectionForConfiguredServer(server, input.environment)),
      ];
      const clients: NativeProviderMcpClient[] = [];
      try {
        const connectedTools: ConnectedTool[] = [];
        const seen = new Set<string>([MCP_CATALOG_SEARCH_TOOL, MCP_CATALOG_CALL_TOOL]);
        for (const connection of connections) {
          let prepared: Awaited<ReturnType<typeof connectAndListTools>>;
          try {
            prepared = await connectAndListTools(factory, connection);
          } catch (cause) {
            if (connection.kind === "internal") throw cause;
            await runPromise(
              Effect.logWarning(
                "Configured MCP server is unavailable; omitting its tools from this native provider session.",
              ).pipe(
                Effect.annotateLogs({
                  mcpServerId: connection.serverId,
                  mcpTransport: connection.kind,
                  failureTag: cause instanceof Error ? cause.name : "UnknownFailure",
                }),
              ),
            );
            continue;
          }
          const { client, listed } = prepared;
          clients.push(client);
          for (const tool of listed.tools) {
            const exposedName =
              connection.kind === "internal"
                ? tool.name
                : externalToolName(connection.serverId, tool.name);
            if (seen.has(exposedName)) {
              throw new Error(`MCP tool name collision for '${exposedName}'.`);
            }
            seen.add(exposedName);
            connectedTools.push({
              exposedName,
              nativeName: tool.name,
              serverId: connection.serverId,
              displayName: connection.displayName,
              client,
              declaration: {
                name: exposedName,
                description:
                  tool.description?.trim() ||
                  `Run ${tool.name} on the configured MCP server ${connection.displayName}.`,
                inputSchema: inputSchema(tool.inputSchema),
                availability:
                  tool.annotations?.readOnlyHint === true ? "read-only" : "default-only",
                requiresApproval: tool.annotations?.readOnlyHint !== true,
              },
            });
          }
        }
        const byName = new Map(connectedTools.map((tool) => [tool.exposedName, tool]));
        const catalog = mcpExtensionCatalog(connectedTools);
        const executeConnectedTool = (
          tool: ConnectedTool,
          args: Readonly<Record<string, unknown>>,
        ) =>
          Effect.promise(() =>
            tool.client.callTool({ name: tool.nativeName, arguments: args }),
          ).pipe(
            Effect.map((result) => {
              const ok = !(isRecord(result) && result.isError === true);
              const title = `${tool.displayName} · ${tool.nativeName}`;
              return {
                ok,
                itemType: "mcp_tool_call",
                title,
                detail: resultDetail(result, ok ? "MCP tool completed." : "MCP tool failed."),
                output: resultOutput(result),
              } satisfies NativeHarnessToolResult;
            }),
            Effect.catchCause((cause) =>
              Effect.succeed({
                ok: false,
                itemType: "mcp_tool_call" as const,
                title: `${tool.displayName} · ${tool.nativeName}`,
                detail: String(cause),
                output: { error: String(cause) },
              }),
            ),
          );
        const executeCatalogSearch = (args: Readonly<Record<string, unknown>>) =>
          decodeMcpCatalogSearchArgs(args).pipe(
            Effect.map((decoded) => {
              const matches = connectedTools.filter((tool) =>
                catalogToolMatches(tool, decoded.query, decoded.server),
              );
              const limit = decoded.limit ?? MCP_CATALOG_DEFAULT_RESULT_LIMIT;
              const tools = matches.slice(0, limit).map((tool) => ({
                name: tool.exposedName,
                server: tool.displayName,
                description: tool.declaration.description,
                inputSchema: tool.declaration.inputSchema,
                requiresApproval: tool.declaration.requiresApproval ?? true,
              }));
              return {
                ok: true,
                itemType: "mcp_tool_call" as const,
                title: "MCP tool catalog",
                detail: `Found ${matches.length} matching MCP tools; returned ${tools.length}.`,
                output: { total: matches.length, returned: tools.length, tools },
              } satisfies NativeHarnessToolResult;
            }),
            Effect.orElseSucceed(() =>
              mcpCatalogFailure("MCP tool catalog", "Invalid MCP tool catalog search arguments."),
            ),
          );
        const executeCatalogCall = (args: Readonly<Record<string, unknown>>) =>
          decodeMcpCatalogCallArgs(args).pipe(
            Effect.flatMap((decoded) => {
              const tool = byName.get(decoded.name);
              if (!tool) {
                return Effect.succeed(
                  mcpCatalogFailure(
                    "MCP tool catalog · call",
                    `Unknown MCP tool '${decoded.name}'. Search the catalog before calling it.`,
                  ),
                );
              }
              return executeConnectedTool(tool, decoded.arguments ?? {});
            }),
            Effect.orElseSucceed(() =>
              mcpCatalogFailure("MCP tool catalog · call", "Invalid MCP tool call arguments."),
            ),
          );
        return {
          clients,
          extension: {
            declarations: catalog.declarations,
            execute: (execution) => {
              if (catalog.usesGateway && execution.name === MCP_CATALOG_SEARCH_TOOL) {
                return executeCatalogSearch(execution.args);
              }
              if (catalog.usesGateway && execution.name === MCP_CATALOG_CALL_TOOL) {
                return executeCatalogCall(execution.args);
              }
              const tool = byName.get(execution.name);
              if (!tool) return Effect.sync((): undefined => undefined);
              return executeConnectedTool(tool, execution.args);
            },
          },
        };
      } catch (cause) {
        await closeClients(clients);
        throw cause;
      }
    };

    const getSession = (threadId: ThreadId, cwd: string) => {
      const existing = sessions.get(threadId);
      if (existing) return existing;
      const created = buildSession(threadId, cwd);
      sessions.set(threadId, created);
      void created.catch(() => {
        if (sessions.get(threadId) === created) sessions.delete(threadId);
      });
      return created;
    };

    const releaseThread = (threadId: ThreadId) =>
      Effect.promise(async () => {
        const session = sessions.get(threadId);
        sessions.delete(threadId);
        if (!session) return;
        try {
          await closeClients((await session).clients);
        } catch {
          // A failed setup closes the clients it created before rejecting.
        }
      });

    const closeAll = Effect.promise(async () => {
      const pending = [...sessions.values()];
      sessions.clear();
      await Promise.all(
        pending.map(async (session) => {
          try {
            await closeClients((await session).clients);
          } catch {
            // A failed setup closes the clients it created before rejecting.
          }
        }),
      );
    });
    yield* Effect.addFinalizer(() => closeAll);

    return {
      extensionForThread: ({ threadId, cwd }) =>
        Effect.tryPromise({
          try: async () => (await getSession(threadId, cwd)).extension,
          catch: (cause) =>
            new NativeHarnessToolPolicyError({
              detail: `Could not prepare native provider MCP tools: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        }),
      releaseThread,
      closeAll,
    } satisfies NativeProviderMcpToolBridge;
  },
);

// Compatibility aliases for the original ChatGPT subscription integration.
export type ChatGptMcpClientFactory = NativeProviderMcpClientFactory;
export type ChatGptMcpToolBridge = NativeProviderMcpToolBridge;
export const makeChatGptMcpToolBridge = makeNativeProviderMcpToolBridge;
