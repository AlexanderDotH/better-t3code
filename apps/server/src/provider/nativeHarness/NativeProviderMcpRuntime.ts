import {
  McpRuntimeServerKey,
  McpServerName,
  type IsoDateTime,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { ProviderAdapterValidationError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { NativeProviderSessionContext } from "./NativeProviderSessionContext.ts";
import type {
  NativeProviderMcpSessionConfig,
  NativeProviderToolHarness,
} from "./NativeProviderTypes.ts";

interface NativeProviderMcpRuntimeDependencies<HistoryItem, SessionState> {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly mcp: NativeProviderMcpSessionConfig | undefined;
  readonly releaseThread: NativeProviderToolHarness<never>["releaseThread"];
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<NativeProviderSessionContext<HistoryItem, SessionState>, ProviderAdapterError>;
  readonly nowIso: Effect.Effect<IsoDateTime>;
}

export function makeNativeProviderMcpRuntime<HistoryItem, SessionState>(
  dependencies: NativeProviderMcpRuntimeDependencies<HistoryItem, SessionState>,
): ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"] {
  const mcp = dependencies.mcp;
  if (!mcp) return undefined;

  const getSnapshot: NonNullable<
    ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]
  >["getSnapshot"] = Effect.fn("NativeProviderMcpRuntime.getSnapshot")(function* (input) {
    if (input.providerInstanceId !== dependencies.instanceId) {
      return yield* new ProviderAdapterValidationError({
        provider: dependencies.provider,
        operation: "mcpRuntime",
        issue: `MCP runtime target belongs to provider instance '${input.providerInstanceId}', not '${dependencies.instanceId}'.`,
      });
    }
    const context = yield* dependencies.requireSession(input.threadId);
    if (context.session.runtimeSessionId !== input.runtimeSessionId) {
      return yield* new ProviderAdapterValidationError({
        provider: dependencies.provider,
        operation: "mcpRuntime",
        issue: `MCP runtime session '${input.runtimeSessionId}' has been replaced.`,
      });
    }
    const observedAt = yield* dependencies.nowIso;
    const configured = mcp.resolveServers ? yield* mcp.resolveServers({ cwd: context.cwd }) : [];
    const internal =
      mcp.includeT3BuiltIn === false
        ? undefined
        : McpProviderSession.readMcpProviderSession(input.threadId);
    return [
      ...(internal
        ? [
            {
              providerKey: McpRuntimeServerKey.make("t3-code"),
              source: "t3-built-in" as const,
              providerInstanceId: dependencies.instanceId,
              threadId: context.threadId,
              runtimeSessionId: input.runtimeSessionId,
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
        providerKey: McpRuntimeServerKey.make(server.id),
        source: "t3-managed" as const,
        providerInstanceId: dependencies.instanceId,
        threadId: context.threadId,
        runtimeSessionId: input.runtimeSessionId,
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

  return {
    getSnapshot,
    applyConfiguration: (input) =>
      getSnapshot(input).pipe(
        Effect.andThen(dependencies.releaseThread?.(input.threadId) ?? Effect.void),
        Effect.as("applied" as const),
      ),
  };
}
