import type {
  McpLiveApplyOutcome,
  McpRuntimeAction,
  McpRuntimeActionResult,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  McpRuntimeServerKey,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export type ProviderMcpSupportMode = "unsupported" | "sessionConfig" | "nativeConfig";
export interface ProviderMcpRuntimeTarget {
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
}

export interface ProviderMcpRuntimeServerTarget extends ProviderMcpRuntimeTarget {
  readonly providerKey: McpRuntimeServerKey;
}

export interface ProviderMcpRuntimeActionInput extends ProviderMcpRuntimeServerTarget {
  readonly action: McpRuntimeAction;
}

export type ProviderMcpRuntimeApplyOutcome = Exclude<McpLiveApplyOutcome, "failed">;

/**
 * Optional provider-native MCP inspection boundary.
 *
 * Adapters resolve credentials and native configuration internally. Keeping
 * those values out of this interface prevents runtime status responses from
 * accidentally carrying secrets across the WebSocket boundary.
 */
export interface ProviderMcpRuntimeAdapter<TError> {
  readonly getSnapshot: (
    input: ProviderMcpRuntimeTarget,
  ) => Effect.Effect<ReadonlyArray<McpRuntimeServer>, TError>;
  readonly getServerDetails?: (
    input: ProviderMcpRuntimeServerTarget,
  ) => Effect.Effect<McpRuntimeServerDetailsResult, TError>;
  readonly runAction?: (
    input: ProviderMcpRuntimeActionInput,
  ) => Effect.Effect<McpRuntimeActionResult, TError>;
  /** Re-resolve T3-owned MCP settings inside the adapter's active session. */
  readonly applyConfiguration?: (
    input: ProviderMcpRuntimeTarget,
  ) => Effect.Effect<void | ProviderMcpRuntimeApplyOutcome, TError>;
}

export interface ProviderAdapterShape<TError> {
  readonly capabilities: { readonly mcp?: ProviderMcpSupportMode };
  readonly mcpRuntime?: ProviderMcpRuntimeAdapter<TError>;
}
