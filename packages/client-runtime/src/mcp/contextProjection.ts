import type {
  McpRuntimeContext,
  McpRuntimeContextChange,
  McpRuntimeContextSnapshot,
  ProviderInstanceId,
} from "@t3tools/contracts";

function contextIdentity(context: McpRuntimeContext): string {
  return JSON.stringify([context.threadId, context.runtimeSessionId]);
}

function applyContextUpsert(
  current: McpRuntimeContextSnapshot,
  change: Extract<McpRuntimeContextChange, { readonly type: "context-upserted" }>,
): McpRuntimeContextSnapshot {
  const identity = contextIdentity(change.context);
  const index = current.contexts.findIndex((context) => contextIdentity(context) === identity);
  const contexts = [...current.contexts];
  if (index === -1) {
    contexts.push(change.context);
  } else {
    contexts[index] = change.context;
  }
  return { ...current, revision: change.revision, observedAt: change.observedAt, contexts };
}

function applyContextRemoval(
  current: McpRuntimeContextSnapshot,
  change: Extract<McpRuntimeContextChange, { readonly type: "context-removed" }>,
): McpRuntimeContextSnapshot {
  return {
    ...current,
    revision: change.revision,
    observedAt: change.observedAt,
    contexts: current.contexts.filter(
      (context) =>
        context.threadId !== change.threadId ||
        context.runtimeSessionId !== change.runtimeSessionId,
    ),
  };
}

function applyContextSnapshot(
  current: McpRuntimeContextSnapshot | null,
  snapshot: McpRuntimeContextSnapshot,
  providerInstanceId: ProviderInstanceId,
): McpRuntimeContextSnapshot | null {
  if (snapshot.providerInstanceId !== providerInstanceId) {
    return current;
  }
  if (current === null || snapshot.revision > current.revision) {
    return snapshot;
  }
  if (snapshot.revision < current.revision) {
    return snapshot.observedAt > current.observedAt ? snapshot : current;
  }
  if (snapshot.observedAt < current.observedAt) {
    return current;
  }
  return snapshot;
}

export function applyMcpRuntimeContextChange(
  current: McpRuntimeContextSnapshot | null,
  change: McpRuntimeContextChange,
  providerInstanceId: ProviderInstanceId,
): McpRuntimeContextSnapshot | null {
  if (change.type === "snapshot") {
    return applyContextSnapshot(current, change.snapshot, providerInstanceId);
  }
  if (current === null || change.revision <= current.revision) {
    return current;
  }
  if (change.type === "context-upserted") {
    return change.context.providerInstanceId === providerInstanceId
      ? applyContextUpsert(current, change)
      : current;
  }
  return applyContextRemoval(current, change);
}
