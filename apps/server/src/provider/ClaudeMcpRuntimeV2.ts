import type { McpServerDefinition, ProviderInstanceId } from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ProviderAdapterProtocolError } from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import { managedMcpProviderKey } from "@t3tools/provider-core/server/mcpConfiguration";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type {
  ProviderMcpRuntimeAdapter,
  ProviderMcpRuntimeTarget,
} from "../mcp/McpRuntimeAdapters.ts";
import type { McpRuntimeRegistry } from "../mcp/McpRuntimeRegistry.ts";
import type { ClaudeAgentSdkQuerySession } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { claudeMcpRuntimeTools, normalizeClaudeMcpRuntimeServer } from "./ClaudeMcpRuntime.ts";

export interface ClaudeMcpRuntimeBinding {
  readonly owner: symbol;
  readonly target: ProviderMcpRuntimeTarget;
  readonly query: ClaudeAgentSdkQuerySession;
  readonly cwd: string;
  readonly model: string;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  readonly configuredServers: ReadonlyArray<McpServerDefinition>;
  readonly builtInExpected: boolean;
  readonly isRunning: Effect.Effect<boolean>;
  readonly resolveServers: Effect.Effect<
    {
      readonly servers: NonNullable<Options["mcpServers"]>;
      readonly definitions: ReadonlyArray<McpServerDefinition>;
    },
    ProviderAdapterProtocolError
  >;
  readonly createdAt: DateTime.Utc;
}
const driver = ProviderDriverKind.make("claudeAgent");
const key = (target: ProviderMcpRuntimeTarget) =>
  `${target.runtimeSessionId}\u0000${target.threadId}`;

export function makeClaudeMcpRuntimeV2(
  instanceId: ProviderInstanceId,
  registry:
    | (Pick<McpRuntimeRegistry["Service"], "registerSession" | "endSession"> &
        Partial<Pick<McpRuntimeRegistry["Service"], "refresh">>)
    | undefined,
) {
  const contexts = new Map<string, ClaudeMcpRuntimeBinding>();
  const error = (detail: string, cause?: unknown) =>
    new ProviderAdapterProtocolError({ driver, detail, cause });
  const requireContext = Effect.fn("ClaudeMcpRuntimeV2.requireContext")(function* (
    target: ProviderMcpRuntimeTarget,
  ) {
    const context = contexts.get(key(target));
    if (target.providerInstanceId !== instanceId || !context)
      return yield* error("The Claude MCP runtime session has been replaced.");
    return context;
  });
  const assertCurrent = (context: ClaudeMcpRuntimeBinding) =>
    Effect.suspend(() =>
      contexts.get(key(context.target)) === context
        ? Effect.void
        : error("The Claude MCP runtime session has been replaced."),
    );
  const statuses = Effect.fn("ClaudeMcpRuntimeV2.readStatuses")(function* (
    context: ClaudeMcpRuntimeBinding,
  ) {
    if (!context.query.mcpServerStatus)
      return yield* error("This Claude SDK runtime does not expose MCP status.");
    const result = yield* context.query.mcpServerStatus.pipe(
      Effect.mapError((cause) => error("Could not read Claude MCP status.", cause)),
    );
    yield* assertCurrent(context);
    return result;
  });
  const metadata = (context: ClaudeMcpRuntimeBinding, observedAt: string) => ({
    providerInstanceId: instanceId,
    threadId: context.target.threadId,
    runtimeSessionId: context.target.runtimeSessionId,
    observedAt,
    managedServerIds: new Map(
      context.configuredServers.map((server) => [managedMcpProviderKey(server.id), server.id]),
    ),
    builtInProviderKeys: context.builtInExpected ? new Set(["t3-code"]) : new Set<string>(),
  });
  const adapter: ProviderMcpRuntimeAdapter<ProviderAdapterProtocolError> = {
    getSnapshot: Effect.fn("ClaudeMcpRuntimeV2.getSnapshot")(function* (target) {
      const context = yield* requireContext(target);
      const observedAt = DateTime.formatIso(yield* DateTime.now);
      return (yield* statuses(context)).map((status) =>
        normalizeClaudeMcpRuntimeServer(status, metadata(context, observedAt)),
      );
    }),
    getServerDetails: Effect.fn("ClaudeMcpRuntimeV2.getServerDetails")(function* (target) {
      const context = yield* requireContext(target);
      const status = (yield* statuses(context)).find((entry) => entry.name === target.providerKey);
      if (!status) return yield* error("Claude did not report this MCP server.");
      return {
        server: normalizeClaudeMcpRuntimeServer(
          status,
          metadata(context, DateTime.formatIso(yield* DateTime.now)),
        ),
        tools: claudeMcpRuntimeTools(status),
        resources: [],
        templates: [],
      };
    }),
    runAction: Effect.fn("ClaudeMcpRuntimeV2.runAction")(function* (target) {
      const context = yield* requireContext(target);
      if (target.action !== "reconnect" || !context.query.reconnectMcpServer)
        return {
          accepted: false,
          action: target.action,
          providerKey: target.providerKey,
          message: "This Claude runtime does not expose that MCP action.",
        };
      const running = yield* context.isRunning;
      yield* assertCurrent(context);
      if (running)
        return {
          accepted: false,
          action: target.action,
          providerKey: target.providerKey,
          message: "Wait for current work to finish before reconnecting an MCP server.",
        };
      yield* context.query
        .reconnectMcpServer(target.providerKey)
        .pipe(Effect.mapError((cause) => error("Could not reconnect Claude MCP server.", cause)));
      yield* assertCurrent(context);
      return { accepted: true, action: target.action, providerKey: target.providerKey };
    }),
    applyConfiguration: Effect.fn("ClaudeMcpRuntimeV2.applyConfiguration")(function* (target) {
      const context = yield* requireContext(target);
      const running = yield* context.isRunning;
      yield* assertCurrent(context);
      if (!context.query.setMcpServers || running) return "pending-next-session" as const;
      const desired = yield* context.resolveServers;
      yield* assertCurrent(context);
      const outcome = yield* context.query
        .setMcpServers(desired.servers)
        .pipe(
          Effect.mapError((cause) => error("Could not apply Claude MCP configuration.", cause)),
        );
      yield* assertCurrent(context);
      contexts.set(key(target), {
        ...context,
        configuredServers: [
          ...new Map(
            [...context.configuredServers, ...desired.definitions].map((server) => [
              server.id,
              server,
            ]),
          ).values(),
        ],
      });
      return outcome;
    }),
  };
  return {
    adapter,
    bind: Effect.fn("ClaudeMcpRuntimeV2.bind")(function* (binding: ClaudeMcpRuntimeBinding) {
      contexts.set(key(binding.target), binding);
      if (registry)
        yield* registry.registerSession({
          provider: driver,
          providerInstanceId: instanceId,
          threadId: binding.target.threadId,
          runtimeSessionId: binding.target.runtimeSessionId,
          cwd: binding.cwd,
          model: binding.model,
          runtimeMode: binding.runtimePolicy.runtimeMode,
          status: "ready",
          createdAt: DateTime.formatIso(binding.createdAt),
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
    }),
    releaseQuery: Effect.fn("ClaudeMcpRuntimeV2.releaseQuery")(function* (
      query: ClaudeAgentSdkQuerySession,
    ) {
      for (const [entryKey, context] of contexts)
        if (context.query === query) {
          contexts.delete(entryKey);
          if (registry) yield* registry.endSession(context.target);
        }
    }),
    release: Effect.fn("ClaudeMcpRuntimeV2.release")(function* (owner: symbol) {
      for (const [entryKey, context] of contexts)
        if (context.owner === owner) {
          contexts.delete(entryKey);
          if (registry) yield* registry.endSession(context.target);
        }
    }),
  };
}
