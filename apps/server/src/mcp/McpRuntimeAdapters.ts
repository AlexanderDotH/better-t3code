import type { ProviderAdapterShape } from "@t3tools/provider-core/server/mcpRuntime";
import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
export type {
  ProviderMcpSupportMode,
  ProviderMcpRuntimeTarget,
  ProviderMcpRuntimeServerTarget,
  ProviderMcpRuntimeActionInput,
  ProviderMcpRuntimeApplyOutcome,
  ProviderMcpRuntimeAdapter,
  ProviderAdapterShape,
} from "@t3tools/provider-core/server/mcpRuntime";

export class McpRuntimeAdapters extends Context.Service<
  McpRuntimeAdapters,
  {
    readonly getByInstance: (
      providerInstanceId: ProviderInstanceId,
    ) => Effect.Effect<ProviderAdapterShape<Error>, Error>;
  }
>()("t3/mcp/McpRuntimeAdapters") {}
