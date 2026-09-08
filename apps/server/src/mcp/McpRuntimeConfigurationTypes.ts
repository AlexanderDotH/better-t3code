import type { McpServerDefinition, ProviderInstanceId } from "@t3tools/contracts";

export interface McpRuntimeConfigurationReconcileInput {
  readonly generation: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly previousServers: ReadonlyArray<McpServerDefinition>;
  readonly desiredServers: ReadonlyArray<McpServerDefinition>;
}
