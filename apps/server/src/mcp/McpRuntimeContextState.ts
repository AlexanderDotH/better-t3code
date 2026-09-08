import type {
  McpRuntimeChange,
  McpRuntimeContext,
  McpRuntimeContextChange,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
  McpRuntimeServer,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";

export interface RuntimeEntry {
  readonly context: McpRuntimeContext;
  readonly revision: number;
  readonly observedAt: string;
  readonly servers: ReadonlyMap<string, McpRuntimeServer>;
}

export interface EntryMutation {
  readonly entry: RuntimeEntry | undefined;
  readonly events: ReadonlyArray<McpRuntimeChange>;
}

export interface RuntimeChangeEnvelope {
  readonly target: McpRuntimeSnapshotInput;
  readonly change: McpRuntimeChange;
}

export interface RuntimeContextChangeEnvelope {
  readonly providerInstanceId: ProviderInstanceId;
  readonly change: McpRuntimeContextChange;
}

export interface ProviderContextVersion {
  readonly revision: number;
  readonly observedAt: string;
}

const MAX_INACTIVE_CONTEXTS_PER_PROVIDER = 20;
const INACTIVE_CONTEXT_TTL_MILLIS = Duration.toMillis(Duration.hours(24));

export function runtimeContextKey(input: McpRuntimeSnapshotInput): string {
  return JSON.stringify([input.providerInstanceId, input.threadId, input.runtimeSessionId]);
}

export function isSameRuntimeThread(
  context: McpRuntimeContext,
  input: Pick<McpRuntimeSnapshotInput, "threadId">,
): boolean {
  return context.threadId === input.threadId;
}

export function toMcpRuntimeSnapshot(entry: RuntimeEntry): McpRuntimeSnapshot {
  return {
    context: entry.context,
    revision: entry.revision,
    observedAt: entry.observedAt,
    servers: Array.from(entry.servers.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

export function sortedProviderContexts(
  entries: ReadonlyMap<string, RuntimeEntry>,
  providerInstanceId: ProviderInstanceId,
): ReadonlyArray<McpRuntimeContext> {
  return Array.from(entries.values())
    .map((entry) => entry.context)
    .filter((context) => context.providerInstanceId === providerInstanceId)
    .sort((left, right) => {
      if (left.state !== right.state) return left.state === "active" ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function pruneInactiveRuntimeContexts(
  entries: ReadonlyMap<string, RuntimeEntry>,
  observedAt: string,
): ReadonlyMap<string, RuntimeEntry> {
  const cutoff =
    DateTime.toEpochMillis(DateTime.makeUnsafe(observedAt)) - INACTIVE_CONTEXT_TTL_MILLIS;
  const inactiveByProvider = new Map<ProviderInstanceId, Array<readonly [string, RuntimeEntry]>>();
  for (const pair of entries) {
    const [key, entry] = pair;
    if (entry.context.state === "active") continue;
    const contexts = inactiveByProvider.get(entry.context.providerInstanceId) ?? [];
    contexts.push([key, entry]);
    inactiveByProvider.set(entry.context.providerInstanceId, contexts);
  }

  const retainedKeys = new Set<string>();
  for (const contexts of inactiveByProvider.values()) {
    contexts
      .filter(([, entry]) => {
        const updatedAt = DateTime.toEpochMillis(DateTime.makeUnsafe(entry.context.updatedAt));
        return updatedAt >= cutoff;
      })
      .sort(([, left], [, right]) => right.context.updatedAt.localeCompare(left.context.updatedAt))
      .slice(0, MAX_INACTIVE_CONTEXTS_PER_PROVIDER)
      .forEach(([key]) => retainedKeys.add(key));
  }

  const next = new Map<string, RuntimeEntry>();
  for (const [key, entry] of entries) {
    if (entry.context.state === "active" || retainedKeys.has(key)) next.set(key, entry);
  }
  return next;
}

export function changedRuntimeContextProviders(
  previous: ReadonlyMap<string, RuntimeEntry>,
  next: ReadonlyMap<string, RuntimeEntry>,
): ReadonlySet<ProviderInstanceId> {
  const providers = new Set<ProviderInstanceId>();
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const before = previous.get(key)?.context;
    const after = next.get(key)?.context;
    if (before === after) continue;
    if (before !== undefined) providers.add(before.providerInstanceId);
    if (after !== undefined) providers.add(after.providerInstanceId);
  }
  return providers;
}

export function runtimeChangeRevision(change: McpRuntimeChange): number {
  return change.type === "snapshot" ? change.snapshot.revision : change.revision;
}

export function runtimeChangeMatchesTarget(
  envelope: RuntimeChangeEnvelope,
  target: McpRuntimeSnapshotInput,
): boolean {
  return (
    envelope.target.providerInstanceId === target.providerInstanceId &&
    envelope.target.threadId === target.threadId &&
    envelope.target.runtimeSessionId === target.runtimeSessionId
  );
}
