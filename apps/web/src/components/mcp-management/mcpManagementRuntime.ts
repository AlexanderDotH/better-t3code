import type {
  EnvironmentId,
  McpRuntimeContext,
  McpRuntimeSnapshot,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { agentSettingsEnvironment } from "../../state/agentSettings";
import { useEnvironmentQuery } from "../../state/query";
import { mcpRuntimeContextId } from "./mcpManagementView";

const EMPTY_CONTEXTS: ReadonlyArray<McpRuntimeContext> = Object.freeze([]);

export interface McpManagementRuntimeInput {
  readonly enabled: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId: ProviderInstanceId | null | undefined;
  readonly workspaceVersion: number | undefined;
  readonly selectedContextId: string | null;
  readonly preferredThreadId?: string;
  readonly preferredRuntimeSessionId?: string;
  readonly requirePreferredExact?: boolean;
}

export interface McpManagementRuntimeState {
  readonly supported: boolean;
  readonly contexts: ReadonlyArray<McpRuntimeContext>;
  readonly selectedContext: McpRuntimeContext | undefined;
  readonly snapshot: McpRuntimeSnapshot | null;
  readonly contextError: string | null;
  readonly runtimeError: string | null;
  readonly isLoading: boolean;
}

export function shouldSubscribeMcpRuntime(input: {
  readonly workspaceVersion: number | undefined;
  readonly providerInstanceId: string | null | undefined;
}): boolean {
  return (input.workspaceVersion ?? 0) >= 1 && Boolean(input.providerInstanceId);
}

export function selectMcpRuntimeContext(input: {
  readonly contexts: ReadonlyArray<McpRuntimeContext>;
  readonly selectedContextId: string | null;
  readonly preferredThreadId?: string;
  readonly preferredRuntimeSessionId?: string;
  readonly requirePreferredExact?: boolean;
}): McpRuntimeContext | undefined {
  const selected = input.contexts.find(
    (context) => mcpRuntimeContextId(context) === input.selectedContextId,
  );
  if (selected) return selected;
  if (input.selectedContextId !== null) return undefined;

  const preferred = input.contexts.find(
    (context) =>
      String(context.threadId) === input.preferredThreadId &&
      String(context.runtimeSessionId) === input.preferredRuntimeSessionId,
  );
  if (preferred) return preferred;
  if (
    input.requirePreferredExact &&
    input.preferredThreadId !== undefined &&
    input.preferredRuntimeSessionId !== undefined
  ) {
    return undefined;
  }

  return input.contexts.find((context) => context.state === "active") ?? input.contexts[0];
}

export function useMcpManagementRuntime(
  input: McpManagementRuntimeInput,
): McpManagementRuntimeState {
  const supported = shouldSubscribeMcpRuntime(input);
  const contextsEnabled = input.enabled && supported && input.environmentId !== null;
  const contextsQuery = useEnvironmentQuery(
    contextsEnabled
      ? agentSettingsEnvironment.mcp.runtimeContextProjection({
          environmentId: input.environmentId,
          input: { providerInstanceId: input.providerInstanceId! },
        })
      : null,
  );
  const contexts = contextsQuery.data?.contexts ?? EMPTY_CONTEXTS;
  const selectedContext = selectMcpRuntimeContext({
    contexts,
    selectedContextId: input.selectedContextId,
    ...(input.preferredThreadId ? { preferredThreadId: input.preferredThreadId } : {}),
    ...(input.preferredRuntimeSessionId
      ? { preferredRuntimeSessionId: input.preferredRuntimeSessionId }
      : {}),
    ...(input.requirePreferredExact ? { requirePreferredExact: true } : {}),
  });
  const runtimeQuery = useEnvironmentQuery(
    contextsEnabled && selectedContext
      ? agentSettingsEnvironment.mcp.runtimeProjection({
          environmentId: input.environmentId,
          input: {
            providerInstanceId: input.providerInstanceId!,
            threadId: selectedContext.threadId,
            runtimeSessionId: selectedContext.runtimeSessionId,
          },
        })
      : null,
  );

  return {
    supported,
    contexts,
    selectedContext,
    snapshot: runtimeQuery.data,
    contextError: contextsQuery.error,
    runtimeError: runtimeQuery.error,
    isLoading: contextsQuery.isPending || runtimeQuery.isPending,
  };
}
