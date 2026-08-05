import type {
  EnvironmentId,
  McpRuntimeContextChangesInput,
  McpRuntimeServerDetailsInput,
  McpRuntimeSnapshotInput,
} from "@t3tools/contracts";

export interface McpProviderContextSelector extends McpRuntimeContextChangesInput {
  readonly environmentId: EnvironmentId;
}

export interface McpRuntimeSelector extends McpRuntimeSnapshotInput {
  readonly environmentId: EnvironmentId;
}

export interface McpRuntimeServerDetailsSelector extends McpRuntimeServerDetailsInput {
  readonly environmentId: EnvironmentId;
}

export function mcpProviderContextKey(selector: McpProviderContextSelector): string {
  return JSON.stringify([selector.environmentId, selector.providerInstanceId]);
}

export function mcpRuntimeSelectorKey(selector: McpRuntimeSelector): string {
  return JSON.stringify([
    selector.environmentId,
    selector.providerInstanceId,
    selector.threadId,
    selector.runtimeSessionId,
  ]);
}

export function mcpRuntimeServerDetailsKey(selector: McpRuntimeServerDetailsSelector): string {
  return JSON.stringify([mcpRuntimeSelectorKey(selector), selector.providerKey]);
}
