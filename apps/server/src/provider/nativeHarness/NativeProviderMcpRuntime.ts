import {
  McpRuntimeServerKey,
  McpServerName,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type RuntimeSessionId,
  type ThreadId,
} from "@t3tools/contracts";
import { ProviderAdapterProtocolError } from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type {
  ProviderMcpRuntimeAdapter,
  ProviderMcpRuntimeTarget,
} from "../../mcp/McpRuntimeAdapters.ts";
import { readMcpProviderSession } from "../../mcp/McpProviderSession.ts";
import type { NativeProviderMcpSessionConfig } from "./NativeProviderTypes.ts";

export interface NativeProviderMcpRuntimeSession {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly cwd: string;
  readonly isRunning: () => boolean;
}

export function makeNativeProviderMcpRuntime(input: {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly host: ProviderHost["Service"];
  readonly configuration: NativeProviderMcpSessionConfig;
  readonly findSession: (threadId: ThreadId) => NativeProviderMcpRuntimeSession | undefined;
  readonly releaseThread: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
}) {
  const pending = new Map<ThreadId, RuntimeSessionId>();
  const requireSession = Effect.fn("NativeProviderMcpRuntime.requireSession")(function* (
    target: ProviderMcpRuntimeTarget,
  ) {
    const session = input.findSession(target.threadId);
    if (
      target.providerInstanceId !== input.instanceId ||
      !session ||
      session.runtimeSessionId !== target.runtimeSessionId
    )
      return yield* new ProviderAdapterProtocolError({
        driver: input.driver,
        detail: "The MCP runtime session has been replaced.",
      });
    return session;
  });
  const getSnapshot: ProviderMcpRuntimeAdapter<ProviderAdapterProtocolError>["getSnapshot"] =
    Effect.fn("NativeProviderMcpRuntime.getSnapshot")(function* (target) {
      const session = yield* requireSession(target);
      const observedAt = DateTime.formatIso(yield* DateTime.now);
      const configured = input.host.resolveMcpServers
        ? yield* input.host
            .resolveMcpServers({
              cwd: session.cwd,
              threadId: target.threadId,
              providerInstanceId: input.instanceId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterProtocolError({
                    driver: input.driver,
                    detail: "Could not resolve configured MCP servers",
                    cause,
                  }),
              ),
            )
        : input.configuration.resolveServers
          ? yield* input.configuration.resolveServers({ cwd: session.cwd }).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterProtocolError({
                    driver: input.driver,
                    detail: "Could not resolve configured MCP servers",
                    cause,
                  }),
              ),
            )
          : [];
      yield* requireSession(target);
      const internal =
        input.configuration.includeT3BuiltIn === false
          ? undefined
          : readMcpProviderSession(target.threadId);
      return [
        ...(internal
          ? [
              {
                providerKey: McpRuntimeServerKey.make("t3-code"),
                source: "t3-built-in" as const,
                providerInstanceId: input.instanceId,
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                name: McpServerName.make("T3 Code"),
                transport: "http" as const,
                state: "unknown" as const,
                statusSource: "configuration" as const,
                observedAt,
                authState: "authenticated" as const,
                availableActions: [] as const,
                reportsTools: false,
                configDrift: "none" as const,
              },
            ]
          : []),
        ...configured.map((server) => ({
          serverId: server.id,
          providerKey: McpRuntimeServerKey.make(
            server.id === "t3-code" ? "t3-managed:t3-code" : server.id,
          ),
          source: "t3-managed" as const,
          providerInstanceId: input.instanceId,
          threadId: target.threadId,
          runtimeSessionId: target.runtimeSessionId,
          name: McpServerName.make(server.name),
          transport: server.transport,
          state: "unknown" as const,
          statusSource: "configuration" as const,
          observedAt,
          authState: "unknown" as const,
          availableActions: ["refresh"] as const,
          reportsTools: false,
          configDrift: "none" as const,
        })),
      ];
    });
  const adapter: ProviderMcpRuntimeAdapter<ProviderAdapterProtocolError> = {
    getSnapshot,
    applyConfiguration: Effect.fn("NativeProviderMcpRuntime.applyConfiguration")(
      function* (target) {
        const session = yield* requireSession(target);
        if (session.isRunning()) {
          pending.set(target.threadId, target.runtimeSessionId);
          return "pending-next-session" as const;
        }
        yield* input.releaseThread?.(target.threadId) ?? Effect.void;
        return "applied" as const;
      },
    ),
  };
  return {
    adapter,
    settle: Effect.fn("NativeProviderMcpRuntime.settleConfiguration")(function* (
      threadId: ThreadId,
    ) {
      const runtimeSessionId = pending.get(threadId);
      if (runtimeSessionId === undefined) return false;
      pending.delete(threadId);
      if (input.findSession(threadId)?.runtimeSessionId !== runtimeSessionId) return false;
      yield* input.releaseThread?.(threadId) ?? Effect.void;
      return true;
    }),
  };
}
