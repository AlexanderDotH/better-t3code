import type {
  McpRuntimeChange,
  McpRuntimeServer,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
} from "@t3tools/contracts";

type RuntimeIdentity = Pick<
  McpRuntimeSnapshotInput,
  "providerInstanceId" | "threadId" | "runtimeSessionId"
>;

export function matchesMcpRuntimeSelector(
  selector: McpRuntimeSnapshotInput,
  candidate: RuntimeIdentity,
): boolean {
  return (
    candidate.providerInstanceId === selector.providerInstanceId &&
    candidate.threadId === selector.threadId &&
    candidate.runtimeSessionId === selector.runtimeSessionId
  );
}

function applyServerUpsert(
  current: McpRuntimeSnapshot,
  change: Extract<McpRuntimeChange, { readonly type: "server-upserted" }>,
): McpRuntimeSnapshot {
  const existingIndex = current.servers.findIndex(
    (server) => server.providerKey === change.server.providerKey,
  );
  const servers = [...current.servers];
  if (existingIndex === -1) {
    servers.push(change.server);
  } else {
    servers[existingIndex] = change.server;
  }
  return { ...current, revision: change.revision, observedAt: change.observedAt, servers };
}

function applyServerRemoval(
  current: McpRuntimeSnapshot,
  change: Extract<McpRuntimeChange, { readonly type: "server-removed" }>,
): McpRuntimeSnapshot {
  return {
    ...current,
    revision: change.revision,
    observedAt: change.observedAt,
    servers: current.servers.filter((server) => server.providerKey !== change.providerKey),
  };
}

function applyAuthoritativeSnapshot(
  current: McpRuntimeSnapshot | null,
  snapshot: McpRuntimeSnapshot,
  selector: McpRuntimeSnapshotInput,
): McpRuntimeSnapshot | null {
  if (!matchesMcpRuntimeSelector(selector, snapshot.context)) {
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

export function applyMcpRuntimeChange(
  current: McpRuntimeSnapshot | null,
  change: McpRuntimeChange,
  selector: McpRuntimeSnapshotInput,
): McpRuntimeSnapshot | null {
  if (change.type === "snapshot") {
    return applyAuthoritativeSnapshot(current, change.snapshot, selector);
  }
  if (current === null || change.revision <= current.revision) {
    return current;
  }
  if (change.type === "server-upserted") {
    return matchesMcpRuntimeSelector(selector, change.server)
      ? applyServerUpsert(current, change)
      : current;
  }
  return applyServerRemoval(current, change);
}

export function mcpRuntimeServersByKey(
  snapshot: McpRuntimeSnapshot,
): ReadonlyMap<McpRuntimeServer["providerKey"], McpRuntimeServer> {
  return new Map(snapshot.servers.map((server) => [server.providerKey, server]));
}
