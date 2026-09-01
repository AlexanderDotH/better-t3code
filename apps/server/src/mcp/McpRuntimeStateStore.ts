import {
  McpRuntimeError,
  McpRuntimeServerKey,
  type McpRuntimeChange,
  type McpRuntimeContextChange,
  type McpRuntimeContextChangesInput,
  type McpRuntimeContextSnapshot,
  type McpRuntimeContextsInput,
  type McpRuntimeContextsResult,
  type McpRuntimeServer,
  type McpRuntimeSnapshot,
  type McpRuntimeSnapshotInput,
  type McpServerDefinition,
  type McpSetProviderEnabledInput,
  type ProviderInstanceId,
  type ProviderSession,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { managedMcpProviderKey } from "./McpProviderConfigProjection.ts";
import {
  changedRuntimeContextProviders as changedContextProviders,
  type EntryMutation,
  isSameRuntimeThread as sameThread,
  type ProviderContextVersion,
  pruneInactiveRuntimeContexts as pruneInactiveContexts,
  type RuntimeChangeEnvelope,
  runtimeChangeMatchesTarget as matchesTarget,
  runtimeChangeRevision as changeRevision,
  runtimeContextKey as contextKey,
  type RuntimeContextChangeEnvelope,
  type RuntimeEntry,
  sortedProviderContexts,
  toMcpRuntimeSnapshot as toSnapshot,
} from "./McpRuntimeContextState.ts";
import {
  makeMcpRuntimeError as runtimeError,
  mcpRuntimeErrorDetail as errorDetail,
  sanitizeMcpRuntimeServer as sanitizeServer,
} from "./McpRuntimeProjection.ts";

export interface McpRuntimeSubscription {
  readonly latest: McpRuntimeSnapshot;
  readonly changes: Stream.Stream<McpRuntimeChange>;
}

export interface McpRuntimeContextSubscription {
  readonly latest: McpRuntimeContextSnapshot;
  readonly changes: Stream.Stream<McpRuntimeContextChange>;
}

export const makeMcpRuntimeStateStore = Effect.fn("makeMcpRuntimeStateStore")(function* () {
  const state = yield* Ref.make<ReadonlyMap<string, RuntimeEntry>>(new Map());
  const contextVersions = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderContextVersion>>(
    new Map(),
  );
  const changes = yield* PubSub.unbounded<RuntimeChangeEnvelope>();
  const contextChanges = yield* PubSub.unbounded<RuntimeContextChangeEnvelope>();
  const mutex = yield* Semaphore.make(1);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const publish = (events: ReadonlyArray<RuntimeChangeEnvelope>) =>
    Effect.forEach(events, (event) => PubSub.publish(changes, event), { discard: true });

  const publishFor = (target: McpRuntimeSnapshotInput, events: ReadonlyArray<McpRuntimeChange>) =>
    publish(events.map((change) => ({ target, change })));

  const makeContextChanges = Effect.fn("McpRuntimeStateStore.makeContextChanges")(function* (
    previous: ReadonlyMap<string, RuntimeEntry>,
    next: ReadonlyMap<string, RuntimeEntry>,
    observedAt: string,
  ) {
    const envelopes: RuntimeContextChangeEnvelope[] = [];
    for (const providerInstanceId of changedContextProviders(previous, next)) {
      const version = yield* Ref.modify(contextVersions, (versions) => {
        const revision = (versions.get(providerInstanceId)?.revision ?? 0) + 1;
        const current = { revision, observedAt } satisfies ProviderContextVersion;
        const updated = new Map(versions);
        updated.set(providerInstanceId, current);
        return [current, updated] as const;
      });
      const before = sortedProviderContexts(previous, providerInstanceId);
      const after = sortedProviderContexts(next, providerInstanceId);
      const removed = before.filter(
        (context) =>
          !after.some(
            (candidate) =>
              candidate.threadId === context.threadId &&
              candidate.runtimeSessionId === context.runtimeSessionId,
          ),
      );
      const upserted = after.filter((context) => {
        const prior = previous.get(contextKey(context))?.context;
        return prior !== context;
      });
      let change: McpRuntimeContextChange;
      if (removed.length === 1 && upserted.length === 0) {
        const context = removed[0]!;
        change = {
          type: "context-removed",
          revision: version.revision,
          observedAt,
          threadId: context.threadId,
          runtimeSessionId: context.runtimeSessionId,
        };
      } else if (removed.length === 0 && upserted.length === 1) {
        change = {
          type: "context-upserted",
          revision: version.revision,
          observedAt,
          context: upserted[0]!,
        };
      } else {
        change = {
          type: "snapshot",
          snapshot: {
            providerInstanceId,
            revision: version.revision,
            observedAt,
            contexts: after,
          },
        };
      }
      envelopes.push({ providerInstanceId, change });
    }
    return envelopes;
  });

  const publishContextChanges = (events: ReadonlyArray<RuntimeContextChangeEnvelope>) =>
    Effect.forEach(events, (event) => PubSub.publish(contextChanges, event), { discard: true });

  const requireEntry = Effect.fn("McpRuntimeStateStore.requireEntry")(function* (
    input: McpRuntimeSnapshotInput,
    requireActive: boolean,
  ) {
    const entries = yield* Ref.get(state);
    const entry = entries.get(contextKey(input));
    if (entry !== undefined && (!requireActive || entry.context.state === "active")) {
      return entry;
    }
    const replacement = Array.from(entries.values()).find(
      (candidate) => sameThread(candidate.context, input) && candidate.context.state === "active",
    );
    if (replacement !== undefined) {
      return yield* runtimeError(
        "session-replaced",
        `Runtime session '${input.runtimeSessionId}' was replaced for thread '${input.threadId}'.`,
      );
    }
    return yield* runtimeError(
      "context-not-found",
      `No MCP runtime context exists for thread '${input.threadId}'.`,
    );
  });
  const replaceServers = Effect.fn("McpRuntimeStateStore.replaceServers")(function* (
    input: McpRuntimeSnapshotInput,
    incoming: ReadonlyArray<McpRuntimeServer>,
  ) {
    const observedAt = yield* nowIso;
    const result = yield* mutex.withPermits(1)(
      Ref.modify(state, (entries): readonly [EntryMutation, ReadonlyMap<string, RuntimeEntry>] => {
        const key = contextKey(input);
        const current = entries.get(key);
        if (current === undefined || current.context.state !== "active") {
          return [{ entry: undefined, events: [] }, entries] as const;
        }
        const servers = new Map<string, McpRuntimeServer>();
        for (const rawServer of incoming) {
          const server = sanitizeServer(rawServer, input);
          servers.set(server.providerKey, server);
        }
        const revision = current.revision + 1;
        const entry: RuntimeEntry = {
          ...current,
          context: { ...current.context, updatedAt: observedAt },
          revision,
          observedAt,
          servers,
        };
        const next = new Map(entries);
        next.set(key, entry);
        return [
          { entry, events: [{ type: "snapshot", snapshot: toSnapshot(entry) }] },
          next,
        ] as const;
      }),
    );
    if (result.entry === undefined) {
      return yield* runtimeError(
        "session-replaced",
        `Runtime session '${input.runtimeSessionId}' ended while MCP status was loading.`,
      );
    }
    yield* publishFor(input, result.events);
    return toSnapshot(result.entry);
  });

  const markStale = Effect.fn("McpRuntimeStateStore.markStale")(function* (
    input: McpRuntimeSnapshotInput,
    error: unknown,
  ) {
    const observedAt = yield* nowIso;
    const message = errorDetail(error);
    const result = yield* mutex.withPermits(1)(
      Ref.modify(state, (entries): readonly [EntryMutation, ReadonlyMap<string, RuntimeEntry>] => {
        const key = contextKey(input);
        const current = entries.get(key);
        if (current === undefined || current.context.state !== "active") {
          return [{ entry: undefined, events: [] }, entries] as const;
        }
        const revision = current.revision + 1;
        const servers = new Map<string, McpRuntimeServer>();
        for (const currentServer of current.servers.values()) {
          const server: McpRuntimeServer = {
            ...currentServer,
            state: "stale",
            observedAt,
            issue: { code: "status-refresh-failed", message },
          };
          servers.set(server.providerKey, server);
        }
        const entry: RuntimeEntry = {
          ...current,
          context: { ...current.context, updatedAt: observedAt },
          revision,
          observedAt,
          servers,
        };
        const next = new Map(entries);
        next.set(key, entry);
        return [
          { entry, events: [{ type: "snapshot", snapshot: toSnapshot(entry) }] },
          next,
        ] as const;
      }),
    );
    if (result.entry === undefined) {
      return yield* runtimeError(
        "session-replaced",
        `Runtime session '${input.runtimeSessionId}' ended while MCP status was loading.`,
      );
    }
    if (result.entry.servers.size === 0) {
      return yield* runtimeError(
        "provider-error",
        `MCP runtime status could not be loaded: ${message}`,
      );
    }
    yield* publishFor(input, result.events);
    return toSnapshot(result.entry);
  });
  const upsertServer = Effect.fn("McpRuntimeStateStore.upsertServer")(function* (
    input: McpRuntimeSnapshotInput,
    incoming: McpRuntimeServer,
  ) {
    const observedAt = yield* nowIso;
    const server = sanitizeServer(incoming, input);
    const result = yield* mutex.withPermits(1)(
      Ref.modify(state, (entries): readonly [EntryMutation, ReadonlyMap<string, RuntimeEntry>] => {
        const key = contextKey(input);
        const current = entries.get(key);
        if (current === undefined || current.context.state !== "active") {
          return [{ entry: undefined, events: [] }, entries] as const;
        }
        const revision = current.revision + 1;
        const servers = new Map(current.servers);
        servers.set(server.providerKey, server);
        const entry: RuntimeEntry = {
          ...current,
          context: { ...current.context, updatedAt: observedAt },
          revision,
          observedAt,
          servers,
        };
        const next = new Map(entries);
        next.set(key, entry);
        return [
          {
            entry,
            events: [{ type: "server-upserted", revision, observedAt, server }],
          },
          next,
        ] as const;
      }),
    );
    if (result.entry === undefined) {
      return yield* runtimeError(
        "session-replaced",
        `Runtime session '${input.runtimeSessionId}' ended while MCP tools were loading.`,
      );
    }
    yield* publishFor(input, result.events);
    return server;
  });

  const markConfigurationDrift = Effect.fn("McpRuntimeStateStore.markConfigurationDrift")(
    function* (
      target: McpRuntimeSnapshotInput,
      input: McpSetProviderEnabledInput,
      definition?: McpServerDefinition,
    ) {
      const observedAt = yield* nowIso;
      const result = yield* mutex.withPermits(1)(
        Ref.modify(
          state,
          (
            entries,
          ): readonly [ReadonlyArray<McpRuntimeChange>, ReadonlyMap<string, RuntimeEntry>] => {
            const key = contextKey(target);
            const current = entries.get(key);
            if (current === undefined || current.context.state !== "active") {
              return [[], entries] as const;
            }
            const matching = Array.from(current.servers.values()).filter(
              (server) => server.serverId === input.serverId,
            );
            if (matching.length === 0 && (!input.enabled || definition === undefined)) {
              return [[], entries] as const;
            }
            const revision = current.revision + 1;
            const servers = new Map(current.servers);
            const driftedServers = matching.map(
              (currentServer): McpRuntimeServer => ({
                ...currentServer,
                observedAt,
                configDrift: input.enabled ? "pending-enable" : "pending-disable",
              }),
            );
            if (driftedServers.length === 0 && definition !== undefined) {
              driftedServers.push({
                serverId: definition.id,
                providerKey: McpRuntimeServerKey.make(managedMcpProviderKey(definition.id)),
                source: "t3-managed",
                providerInstanceId: target.providerInstanceId,
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                name: definition.name,
                transport: definition.transport,
                state: "not-started",
                statusSource: "configuration",
                observedAt,
                authState: "unknown",
                availableActions: ["refresh"],
                reportsTools: false,
                configDrift: "pending-enable",
              });
            }
            for (const server of driftedServers) {
              servers.set(server.providerKey, server);
            }
            const next = new Map(entries);
            const entry: RuntimeEntry = {
              ...current,
              context: { ...current.context, updatedAt: observedAt },
              revision,
              observedAt,
              servers,
            };
            next.set(key, entry);
            return [[{ type: "snapshot", snapshot: toSnapshot(entry) }], next] as const;
          },
        ),
      );
      yield* publishFor(target, result);
    },
  );

  const markConfigurationSetDrift = Effect.fn("McpRuntimeStateStore.markConfigurationSetDrift")(
    function* (
      target: McpRuntimeSnapshotInput,
      enableDefinitions: ReadonlyArray<McpServerDefinition>,
      disableDefinitions: ReadonlyArray<McpServerDefinition>,
    ) {
      if (enableDefinitions.length === 0 && disableDefinitions.length === 0) return;
      const observedAt = yield* nowIso;
      const enableIds = new Set(enableDefinitions.map((server) => server.id));
      const disableIds = new Set(disableDefinitions.map((server) => server.id));
      const result = yield* mutex.withPermits(1)(
        Ref.modify(
          state,
          (entries): readonly [EntryMutation, ReadonlyMap<string, RuntimeEntry>] => {
            const key = contextKey(target);
            const current = entries.get(key);
            if (current === undefined || current.context.state !== "active") {
              return [{ entry: undefined, events: [] }, entries] as const;
            }
            const servers = new Map(current.servers);
            for (const [providerKey, currentServer] of servers) {
              const serverId = currentServer.serverId;
              if (serverId !== undefined && enableIds.has(serverId)) {
                servers.set(providerKey, {
                  ...currentServer,
                  observedAt,
                  configDrift: "pending-enable",
                });
              }
              if (serverId !== undefined && disableIds.has(serverId)) {
                servers.set(providerKey, {
                  ...currentServer,
                  observedAt,
                  configDrift: "pending-disable",
                });
              }
            }
            for (const definition of enableDefinitions) {
              const providerKey = McpRuntimeServerKey.make(managedMcpProviderKey(definition.id));
              if (servers.has(providerKey)) continue;
              servers.set(providerKey, {
                serverId: definition.id,
                providerKey,
                source: "t3-managed",
                providerInstanceId: target.providerInstanceId,
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                name: definition.name,
                transport: definition.transport,
                state: "not-started",
                statusSource: "configuration",
                observedAt,
                authState: "unknown",
                availableActions: ["refresh"],
                reportsTools: false,
                configDrift: "pending-enable",
              });
            }
            const entry: RuntimeEntry = {
              ...current,
              context: { ...current.context, updatedAt: observedAt },
              revision: current.revision + 1,
              observedAt,
              servers,
            };
            const next = new Map(entries);
            next.set(key, entry);
            return [
              { entry, events: [{ type: "snapshot", snapshot: toSnapshot(entry) }] },
              next,
            ] as const;
          },
        ),
      );
      yield* publishFor(target, result.events);
    },
  );

  const registerSession = (session: ProviderSession) =>
    Effect.gen(function* () {
      if (session.providerInstanceId === undefined || session.runtimeSessionId === undefined) {
        return;
      }
      const providerInstanceId = session.providerInstanceId;
      const runtimeSessionId = session.runtimeSessionId;
      const observedAt = yield* nowIso;
      const target = {
        providerInstanceId,
        threadId: session.threadId,
        runtimeSessionId,
      };
      const mutation = yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const entries = yield* Ref.get(state);
          const next = new Map(entries);
          const runtimeEvents: RuntimeChangeEnvelope[] = [];
          for (const [key, candidate] of entries) {
            if (
              !sameThread(candidate.context, target) ||
              candidate.context.runtimeSessionId === target.runtimeSessionId ||
              candidate.context.state === "inactive"
            ) {
              continue;
            }
            const revision = candidate.revision + 1;
            const stoppedServers = new Map<string, McpRuntimeServer>();
            for (const currentServer of candidate.servers.values()) {
              const server = { ...currentServer, state: "not-started" as const, observedAt };
              stoppedServers.set(server.providerKey, server);
            }
            const inactiveEntry: RuntimeEntry = {
              ...candidate,
              context: { ...candidate.context, state: "inactive", updatedAt: observedAt },
              revision,
              observedAt,
              servers: stoppedServers,
            };
            next.set(key, inactiveEntry);
            runtimeEvents.push({
              target: {
                providerInstanceId: candidate.context.providerInstanceId,
                threadId: candidate.context.threadId,
                runtimeSessionId: candidate.context.runtimeSessionId,
              },
              change: { type: "snapshot", snapshot: toSnapshot(inactiveEntry) },
            });
          }
          const key = contextKey(target);
          const existing = entries.get(key);
          next.set(key, {
            context: {
              providerInstanceId,
              driver: session.provider,
              threadId: session.threadId,
              runtimeSessionId,
              ...(session.cwd === undefined ? {} : { projectCwd: session.cwd }),
              state: "active",
              startedAt: session.createdAt,
              updatedAt: observedAt,
            },
            revision: existing?.revision ?? 0,
            observedAt,
            servers: existing?.servers ?? new Map(),
          });
          const pruned = pruneInactiveContexts(next, observedAt);
          yield* Ref.set(state, pruned);
          const contextEvents = yield* makeContextChanges(entries, pruned, observedAt);
          return { runtimeEvents, contextEvents };
        }),
      );
      yield* publish(mutation.runtimeEvents);
      yield* publishContextChanges(mutation.contextEvents);
    });

  const endSession = (input: McpRuntimeSnapshotInput) =>
    Effect.gen(function* () {
      const observedAt = yield* nowIso;
      const mutation = yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const entries = yield* Ref.get(state);
          const key = contextKey(input);
          const current = entries.get(key);
          if (current === undefined || current.context.state === "inactive") {
            return { runtimeEvents: [], contextEvents: [] };
          }
          const servers = new Map<string, McpRuntimeServer>();
          for (const currentServer of current.servers.values()) {
            const server = { ...currentServer, state: "not-started" as const, observedAt };
            servers.set(server.providerKey, server);
          }
          const entry: RuntimeEntry = {
            ...current,
            context: { ...current.context, state: "inactive", updatedAt: observedAt },
            revision: current.revision + 1,
            observedAt,
            servers,
          };
          const next = new Map(entries);
          next.set(key, entry);
          const pruned = pruneInactiveContexts(next, observedAt);
          yield* Ref.set(state, pruned);
          const contextEvents = yield* makeContextChanges(entries, pruned, observedAt);
          return {
            runtimeEvents: [
              { type: "snapshot", snapshot: toSnapshot(entry) } satisfies McpRuntimeChange,
            ],
            contextEvents,
          };
        }),
      );
      yield* publishFor(input, mutation.runtimeEvents);
      yield* publishContextChanges(mutation.contextEvents);
    });

  const readContextSnapshot = Effect.fn("McpRuntimeStateStore.readContextSnapshot")(function* (
    input: McpRuntimeContextsInput,
  ) {
    const observedAt = yield* nowIso;
    const result = yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* Ref.get(state);
        const pruned = pruneInactiveContexts(entries, observedAt);
        if (pruned.size !== entries.size) {
          yield* Ref.set(state, pruned);
        }
        const events = yield* makeContextChanges(entries, pruned, observedAt);
        const version = (yield* Ref.get(contextVersions)).get(input.providerInstanceId) ?? {
          revision: 0,
          observedAt,
        };
        return {
          events,
          snapshot: {
            providerInstanceId: input.providerInstanceId,
            revision: version.revision,
            observedAt: version.observedAt,
            contexts: sortedProviderContexts(pruned, input.providerInstanceId),
          } satisfies McpRuntimeContextSnapshot,
        };
      }),
    );
    yield* publishContextChanges(result.events);
    return result.snapshot;
  });

  const listContexts = (input: McpRuntimeContextsInput): Effect.Effect<McpRuntimeContextsResult> =>
    readContextSnapshot(input).pipe(Effect.map(({ contexts }) => ({ contexts })));

  const subscribeContexts = (input: McpRuntimeContextChangesInput) =>
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(contextChanges);
      const latest = yield* readContextSnapshot(input);
      const laterChanges = Stream.fromSubscription(subscription).pipe(
        Stream.filter((envelope) => envelope.providerInstanceId === input.providerInstanceId),
        Stream.map((envelope) => envelope.change),
        Stream.filter((change) => {
          const revision = change.type === "snapshot" ? change.snapshot.revision : change.revision;
          return revision > latest.revision;
        }),
      );
      return { latest, changes: laterChanges };
    });

  const snapshot = (input: McpRuntimeSnapshotInput) =>
    requireEntry(input, false).pipe(Effect.map(toSnapshot));

  const subscribe = (
    input: McpRuntimeSnapshotInput,
    loadLatest: Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>,
  ) =>
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const latest = yield* loadLatest;
      const laterChanges = Stream.fromSubscription(subscription).pipe(
        Stream.filter((envelope) => matchesTarget(envelope, input)),
        Stream.map((envelope) => envelope.change),
        Stream.filter((change) => changeRevision(change) > latest.revision),
      );
      return { latest, changes: laterChanges };
    });

  return {
    state,
    requireEntry,
    replaceServers,
    markStale,
    upsertServer,
    markConfigurationDrift,
    markConfigurationSetDrift,
    registerSession,
    endSession,
    listContexts,
    subscribeContexts,
    snapshot,
    subscribe,
  };
});
