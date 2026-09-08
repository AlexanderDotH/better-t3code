import type {
  McpConfigError,
  McpCursorJsonResult,
  McpDiscoverImportSourcesResult,
  McpExportCursorJsonInput,
  McpImportCursorJsonInput,
  McpImportSourcesInput,
  McpListResult,
  McpMutationResult,
  McpProviderCapability,
  McpProviderStatusResult,
  McpServerDefinition,
  McpServerId,
  McpServerUpdateDefinition,
  McpSetProviderEnabledInput,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ResolveActiveMcpServersInput {
  readonly cwd?: string | null | undefined;
  readonly projectId?: string | null | undefined;
  readonly projectCwd?: string | null | undefined;
  readonly providerInstanceId?: ProviderInstanceId | null | undefined;
}

export interface McpConfigEngineShape {
  readonly list: Effect.Effect<McpListResult, McpConfigError>;
  readonly create: (
    server: McpServerDefinition,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly update: (
    server: McpServerUpdateDefinition,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly delete: (id: McpServerId) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly setEnabled: (
    id: McpServerId,
    enabled: boolean,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly setProviderEnabled: (
    input: McpSetProviderEnabledInput,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly importCursorJson: (
    input: McpImportCursorJsonInput,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly discoverImportSources: Effect.Effect<McpDiscoverImportSourcesResult, McpConfigError>;
  readonly importSources: (
    input: McpImportSourcesInput,
  ) => Effect.Effect<McpMutationResult, McpConfigError>;
  readonly exportCursorJson: (
    input: McpExportCursorJsonInput,
  ) => Effect.Effect<McpCursorJsonResult, McpConfigError>;
  readonly providerStatus: (
    providers: ReadonlyArray<ServerProvider>,
    input?: ResolveActiveMcpServersInput,
    providerCapability?: (
      providerInstanceId: ProviderInstanceId,
    ) => Effect.Effect<McpProviderCapability>,
  ) => Effect.Effect<McpProviderStatusResult, McpConfigError>;
  readonly resolveActiveServers: (
    input: ResolveActiveMcpServersInput,
  ) => Effect.Effect<ReadonlyArray<McpServerDefinition>, McpConfigError>;
}

export class McpConfigEngine extends Context.Service<McpConfigEngine, McpConfigEngineShape>()(
  "t3/mcp/McpConfigService/McpConfigEngine",
) {}
