import {
  McpRuntimeError,
  McpRuntimeServerKey,
  McpServerName,
  type McpLiveApplyResult,
  type McpRuntimeActionInput,
  type McpRuntimeActionResult,
  type McpRuntimeChange,
  type McpRuntimeContext,
  type McpRuntimeContextChange,
  type McpRuntimeContextChangesInput,
  type McpRuntimeContextSnapshot,
  type McpRuntimeContextsInput,
  type McpRuntimeContextsResult,
  type McpRuntimeServer,
  type McpRuntimeServerDetailsInput,
  type McpRuntimeServerDetailsResult,
  type McpRuntimeSnapshot,
  type McpRuntimeSnapshotInput,
  type McpRuntimeResource,
  type McpRuntimeResourceTemplate,
  type McpRuntimeTool,
  type McpServerDefinition,
  type McpSetProviderEnabledInput,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { ProviderAdapterError } from "../provider/Errors.ts";
import type {
  ProviderMcpRuntimeTarget,
  ProviderMcpSupportMode,
} from "../provider/Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../provider/Services/ProviderAdapterRegistry.ts";
import { sanitizeMcpRuntimeText } from "./McpRuntimeSanitizer.ts";

export interface McpRuntimeSubscription {
  readonly latest: McpRuntimeSnapshot;
  readonly changes: Stream.Stream<McpRuntimeChange>;
}

export interface McpRuntimeContextSubscription {
  readonly latest: McpRuntimeContextSnapshot;
  readonly changes: Stream.Stream<McpRuntimeContextChange>;
}

export interface McpRuntimeConfigurationReconcileInput {
  readonly generation: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly previousServers: ReadonlyArray<McpServerDefinition>;
  readonly desiredServers: ReadonlyArray<McpServerDefinition>;
}

export interface McpRuntimeRegistryShape {
  readonly registerSession: (session: ProviderSession) => Effect.Effect<void>;
  readonly endSession: (input: McpRuntimeSnapshotInput) => Effect.Effect<void>;
  readonly listContexts: (
    input: McpRuntimeContextsInput,
  ) => Effect.Effect<McpRuntimeContextsResult>;
  readonly subscribeContexts: (
    input: McpRuntimeContextChangesInput,
  ) => Effect.Effect<McpRuntimeContextSubscription, never, Scope.Scope>;
  readonly providerCapability: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderMcpSupportMode>;
  readonly snapshot: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly refresh: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly subscribe: (
    input: McpRuntimeSnapshotInput,
  ) => Effect.Effect<McpRuntimeSubscription, McpRuntimeError, Scope.Scope>;
  readonly getServerDetails: (
    input: McpRuntimeServerDetailsInput,
  ) => Effect.Effect<McpRuntimeServerDetailsResult, McpRuntimeError>;
  readonly runAction: (
    input: McpRuntimeActionInput,
  ) => Effect.Effect<McpRuntimeActionResult, McpRuntimeError>;
  readonly applyConfiguration: (
    input: McpSetProviderEnabledInput,
    server?: McpServerDefinition,
  ) => Effect.Effect<ReadonlyArray<McpLiveApplyResult>>;
  readonly reconcileConfiguration: (
    input: McpRuntimeConfigurationReconcileInput,
  ) => Effect.Effect<ReadonlyArray<McpLiveApplyResult>>;
  readonly observeProviderEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}

export class McpRuntimeRegistry extends Context.Service<
  McpRuntimeRegistry,
  McpRuntimeRegistryShape
>()("t3/mcp/McpRuntimeRegistry") {}

interface RuntimeEntry {
  readonly context: McpRuntimeContext;
  readonly revision: number;
  readonly observedAt: string;
  readonly servers: ReadonlyMap<string, McpRuntimeServer>;
}

interface EntryMutation {
  readonly entry: RuntimeEntry | undefined;
  readonly events: ReadonlyArray<McpRuntimeChange>;
}

interface RuntimeChangeEnvelope {
  readonly target: McpRuntimeSnapshotInput;
  readonly change: McpRuntimeChange;
}

interface RuntimeContextChangeEnvelope {
  readonly providerInstanceId: ProviderInstanceId;
  readonly change: McpRuntimeContextChange;
}

interface RuntimeRefreshFlight {
  readonly result: Deferred.Deferred<McpRuntimeSnapshot, McpRuntimeError>;
  readonly allowTrailing: boolean;
}

interface RuntimeRefreshFlightSelection {
  readonly flight: RuntimeRefreshFlight;
  readonly owner: boolean;
}

interface ProviderContextVersion {
  readonly revision: number;
  readonly observedAt: string;
}

const MAX_RUNTIME_TOOL_DETAILS = 256;
const MAX_INACTIVE_CONTEXTS_PER_PROVIDER = 20;
const INACTIVE_CONTEXT_TTL_MILLIS = Duration.toMillis(Duration.hours(24));

function managedMcpProviderKey(serverId: McpServerDefinition["id"]): string {
  return serverId === "t3-code" ? `t3-managed:${serverId}` : serverId;
}

function contextKey(input: McpRuntimeSnapshotInput): string {
  return JSON.stringify([input.providerInstanceId, input.threadId, input.runtimeSessionId]);
}

function sameThread(
  context: McpRuntimeContext,
  input: Pick<McpRuntimeSnapshotInput, "threadId">,
): boolean {
  return context.threadId === input.threadId;
}

function normalizeRuntimePath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized ? normalized : undefined;
}

function isServerInRuntimeScope(
  server: McpServerDefinition | undefined,
  context: McpRuntimeContext,
): boolean {
  if (server === undefined || server.scope === "global") return true;
  const serverCwd = normalizeRuntimePath(server.projectCwd);
  const runtimeCwd = normalizeRuntimePath(context.projectCwd);
  return serverCwd !== undefined && runtimeCwd !== undefined && serverCwd === runtimeCwd;
}

function isServerAssignedToProvider(
  server: McpServerDefinition,
  providerInstanceId: ProviderInstanceId,
): boolean {
  return (
    server.providerRouting.mode === "all" ||
    server.providerRouting.instanceIds.includes(providerInstanceId)
  );
}

function toSnapshot(entry: RuntimeEntry): McpRuntimeSnapshot {
  return {
    context: entry.context,
    revision: entry.revision,
    observedAt: entry.observedAt,
    servers: Array.from(entry.servers.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function sortedProviderContexts(
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

function pruneInactiveContexts(
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
    if (entry.context.state === "active" || retainedKeys.has(key)) {
      next.set(key, entry);
    }
  }
  return next;
}

function changedContextProviders(
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

function errorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return sanitizeMcpRuntimeText(error.message);
  }
  return sanitizeMcpRuntimeText(error);
}

function runtimeError(code: McpRuntimeError["code"], detail: string): McpRuntimeError {
  return new McpRuntimeError({ code, detail: sanitizeMcpRuntimeText(detail) });
}

function sanitizeServer(
  server: McpRuntimeServer,
  target: McpRuntimeSnapshotInput,
): McpRuntimeServer {
  return {
    ...(server.serverId === undefined ? {} : { serverId: server.serverId }),
    providerKey: server.providerKey,
    source: server.source,
    providerInstanceId: target.providerInstanceId,
    threadId: target.threadId,
    runtimeSessionId: target.runtimeSessionId,
    name: McpServerName.make(sanitizeMcpRuntimeText(server.name).slice(0, 128)),
    ...(server.transport === undefined ? {} : { transport: server.transport }),
    state: server.state,
    statusSource: server.statusSource,
    observedAt: server.observedAt,
    authState: server.authState,
    availableActions: Array.from(new Set(server.availableActions)),
    reportsTools: server.reportsTools,
    ...(server.serverInfo === undefined
      ? {}
      : {
          serverInfo: {
            name: sanitizeMcpRuntimeText(server.serverInfo.name).slice(0, 512),
            ...(server.serverInfo.version === undefined
              ? {}
              : { version: sanitizeMcpRuntimeText(server.serverInfo.version).slice(0, 512) }),
          },
        }),
    ...(server.toolCount === undefined ? {} : { toolCount: Math.max(0, server.toolCount) }),
    ...(server.resourceCount === undefined
      ? {}
      : { resourceCount: Math.max(0, server.resourceCount) }),
    ...(server.templateCount === undefined
      ? {}
      : { templateCount: Math.max(0, server.templateCount) }),
    ...(server.issue === undefined
      ? {}
      : {
          issue: {
            ...(server.issue.code === undefined
              ? {}
              : { code: sanitizeMcpRuntimeText(server.issue.code).slice(0, 256) }),
            message: sanitizeMcpRuntimeText(server.issue.message),
          },
        }),
    configDrift: server.configDrift,
  };
}

function sanitizeTool(tool: McpRuntimeTool): McpRuntimeTool {
  return {
    name: sanitizeMcpRuntimeText(tool.name),
    ...(tool.title === undefined ? {} : { title: sanitizeMcpRuntimeText(tool.title) }),
    ...(tool.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(tool.description) }),
    ...(tool.readOnly === undefined ? {} : { readOnly: tool.readOnly }),
    ...(tool.destructive === undefined ? {} : { destructive: tool.destructive }),
    ...(tool.openWorld === undefined ? {} : { openWorld: tool.openWorld }),
  };
}

function sanitizeResource(resource: McpRuntimeResource): McpRuntimeResource {
  return {
    uri: sanitizeMcpRuntimeText(resource.uri).slice(0, 8_192),
    name: sanitizeMcpRuntimeText(resource.name).slice(0, 512),
    ...(resource.title === undefined
      ? {}
      : { title: sanitizeMcpRuntimeText(resource.title).slice(0, 512) }),
    ...(resource.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(resource.description).slice(0, 65_536) }),
    ...(resource.mimeType === undefined
      ? {}
      : { mimeType: sanitizeMcpRuntimeText(resource.mimeType).slice(0, 512) }),
    ...(resource.size === undefined ? {} : { size: Math.max(0, resource.size) }),
  };
}

function sanitizeResourceTemplate(
  template: McpRuntimeResourceTemplate,
): McpRuntimeResourceTemplate {
  return {
    uriTemplate: sanitizeMcpRuntimeText(template.uriTemplate).slice(0, 8_192),
    name: sanitizeMcpRuntimeText(template.name).slice(0, 512),
    ...(template.title === undefined
      ? {}
      : { title: sanitizeMcpRuntimeText(template.title).slice(0, 512) }),
    ...(template.description === undefined
      ? {}
      : { description: sanitizeMcpRuntimeText(template.description).slice(0, 65_536) }),
    ...(template.mimeType === undefined
      ? {}
      : { mimeType: sanitizeMcpRuntimeText(template.mimeType).slice(0, 512) }),
  };
}

function changeRevision(change: McpRuntimeChange): number {
  return change.type === "snapshot" ? change.snapshot.revision : change.revision;
}

function matchesTarget(envelope: RuntimeChangeEnvelope, target: McpRuntimeSnapshotInput): boolean {
  return (
    envelope.target.providerInstanceId === target.providerInstanceId &&
    envelope.target.threadId === target.threadId &&
    envelope.target.runtimeSessionId === target.runtimeSessionId
  );
}

export const makeMcpRuntimeRegistry = Effect.fn("makeMcpRuntimeRegistry")(function* () {
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistry;
  const state = yield* Ref.make<ReadonlyMap<string, RuntimeEntry>>(new Map());
  const refreshFlights = yield* Ref.make<ReadonlyMap<string, RuntimeRefreshFlight>>(new Map());
  const trailingRefreshes = yield* Ref.make<ReadonlySet<string>>(new Set());
  const contextVersions = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderContextVersion>>(
    new Map(),
  );
  const configurationGenerations = yield* Ref.make<ReadonlyMap<ProviderInstanceId, number>>(
    new Map(),
  );
  const runtimeActionMutexes = yield* Ref.make<ReadonlyMap<string, Semaphore.Semaphore>>(new Map());
  const changes = yield* PubSub.unbounded<RuntimeChangeEnvelope>();
  const contextChanges = yield* PubSub.unbounded<RuntimeContextChangeEnvelope>();
  const mutex = yield* Semaphore.make(1);
  const configurationMutex = yield* Semaphore.make(1);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const withRuntimeActionLock = <A, E, R>(
    input: McpRuntimeActionInput,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const key = `${contextKey(input)}\u0000${input.providerKey}`;
      const candidate = yield* Semaphore.make(1);
      const mutex = yield* Ref.modify(runtimeActionMutexes, (current) => {
        const existing = current.get(key);
        if (existing) return [existing, current] as const;
        const next = new Map(current);
        next.set(key, candidate);
        return [candidate, next] as const;
      });
      return yield* mutex.withPermits(1)(effect);
    });

  const publish = (events: ReadonlyArray<RuntimeChangeEnvelope>) =>
    Effect.forEach(events, (event) => PubSub.publish(changes, event), { discard: true });

  const publishFor = (target: McpRuntimeSnapshotInput, events: ReadonlyArray<McpRuntimeChange>) =>
    publish(events.map((change) => ({ target, change })));

  const makeContextChanges = Effect.fn("McpRuntimeRegistry.makeContextChanges")(function* (
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

  const requireEntry = Effect.fn("McpRuntimeRegistry.requireEntry")(function* (
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

  const adapterFor = (providerInstanceId: ProviderInstanceId) =>
    adapters
      .getByInstance(providerInstanceId)
      .pipe(
        Effect.mapError((error) =>
          runtimeError("provider-error", `Provider adapter is unavailable: ${errorDetail(error)}`),
        ),
      );

  const replaceServers = Effect.fn("McpRuntimeRegistry.replaceServers")(function* (
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

  const markStale = Effect.fn("McpRuntimeRegistry.markStale")(function* (
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

  const upsertServer = Effect.fn("McpRuntimeRegistry.upsertServer")(function* (
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

  const markConfigurationDrift = Effect.fn("McpRuntimeRegistry.markConfigurationDrift")(function* (
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
  });

  const markConfigurationSetDrift = Effect.fn("McpRuntimeRegistry.markConfigurationSetDrift")(
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

  const registerSession: McpRuntimeRegistryShape["registerSession"] = (session) =>
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

  const endSession: McpRuntimeRegistryShape["endSession"] = (input) =>
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

  const readContextSnapshot = Effect.fn("McpRuntimeRegistry.readContextSnapshot")(function* (
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

  const listContexts: McpRuntimeRegistryShape["listContexts"] = (input) =>
    readContextSnapshot(input).pipe(Effect.map(({ contexts }) => ({ contexts })));

  const subscribeContexts: McpRuntimeRegistryShape["subscribeContexts"] = (input) =>
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

  const providerCapability: McpRuntimeRegistryShape["providerCapability"] = (providerInstanceId) =>
    adapters.getByInstance(providerInstanceId).pipe(
      Effect.map((adapter) => adapter.capabilities.mcp),
      Effect.orElseSucceed(() => "unsupported" as const),
    );

  const snapshot: McpRuntimeRegistryShape["snapshot"] = (input) =>
    requireEntry(input, false).pipe(Effect.map(toSnapshot));

  const refreshOnce: McpRuntimeRegistryShape["refresh"] = (input) =>
    Effect.gen(function* () {
      const current = yield* requireEntry(input, false);
      if (current.context.state === "inactive") {
        return toSnapshot(current);
      }
      const adapter = yield* adapterFor(input.providerInstanceId);
      const mcpRuntime = adapter.mcpRuntime;
      if (mcpRuntime === undefined) {
        return yield* replaceServers(input, []);
      }
      const result = yield* Effect.exit(mcpRuntime.getSnapshot(input));
      if (result._tag === "Failure") {
        return yield* markStale(input, Cause.squash(result.cause));
      }
      return yield* replaceServers(input, result.value);
    });

  const removeRefreshFlight = (key: string, flight: RuntimeRefreshFlight) =>
    Ref.update(refreshFlights, (current) => {
      if (current.get(key) !== flight) {
        return current;
      }
      const next = new Map(current);
      next.delete(key);
      return next;
    });

  const runRefreshFlight = Effect.fn("McpRuntimeRegistry.runRefreshFlight")(function* (
    input: McpRuntimeSnapshotInput,
    allowTrailing: boolean,
  ) {
    const key = contextKey(input);
    const flight: RuntimeRefreshFlight = {
      result: yield* Deferred.make<McpRuntimeSnapshot, McpRuntimeError>(),
      allowTrailing,
    };
    const selected = yield* Ref.modify(
      refreshFlights,
      (
        current,
      ): readonly [RuntimeRefreshFlightSelection, ReadonlyMap<string, RuntimeRefreshFlight>] => {
        const existing = current.get(key);
        if (existing !== undefined) {
          return [{ flight: existing, owner: false }, current] as const;
        }

        const next = new Map(current);
        next.set(key, flight);
        return [{ flight, owner: true }, next] as const;
      },
    );
    if (!selected.owner) {
      return yield* Deferred.await(selected.flight.result);
    }
    const result = yield* Effect.exit(refreshOnce(input));
    yield* removeRefreshFlight(key, flight);
    if (result._tag === "Failure") {
      yield* Deferred.failCause(flight.result, result.cause);
      return yield* Effect.failCause(result.cause);
    }
    yield* Deferred.succeed(flight.result, result.value);
    return result.value;
  });

  const refresh: McpRuntimeRegistryShape["refresh"] = (input) => runRefreshFlight(input, true);

  const refreshAfterProviderEvent = Effect.fn("McpRuntimeRegistry.refreshAfterProviderEvent")(
    function* (input: McpRuntimeSnapshotInput) {
      const key = contextKey(input);
      const active = (yield* Ref.get(refreshFlights)).get(key);
      if (active === undefined) {
        yield* runRefreshFlight(input, true).pipe(Effect.ignore);
        return;
      }
      if (!active.allowTrailing) {
        yield* Deferred.await(active.result).pipe(Effect.ignore);
        return;
      }
      yield* Ref.update(trailingRefreshes, (current) => new Set(current).add(key));
      yield* Effect.exit(Deferred.await(active.result));
      const claimed = yield* Ref.modify(trailingRefreshes, (current) => {
        if (!current.has(key)) return [false, current] as const;
        const next = new Set(current);
        next.delete(key);
        return [true, next] as const;
      });
      if (claimed) {
        yield* runRefreshFlight(input, false).pipe(Effect.ignore);
      }
    },
  );

  const subscribe: McpRuntimeRegistryShape["subscribe"] = (input) =>
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const latest = yield* refresh(input);
      const laterChanges = Stream.fromSubscription(subscription).pipe(
        Stream.filter((envelope) => matchesTarget(envelope, input)),
        Stream.map((envelope) => envelope.change),
        Stream.filter((change) => changeRevision(change) > latest.revision),
      );
      return { latest, changes: laterChanges };
    });

  const getServerDetails: McpRuntimeRegistryShape["getServerDetails"] = (input) =>
    Effect.gen(function* () {
      const current = yield* requireEntry(input, true);
      const server = current.servers.get(input.providerKey);
      if (server === undefined) {
        return yield* runtimeError(
          "server-not-found",
          `MCP server '${input.providerKey}' is not present in this runtime.`,
        );
      }
      const adapter = yield* adapterFor(input.providerInstanceId);
      const readDetails = adapter.mcpRuntime?.getServerDetails;
      if (readDetails === undefined) {
        return { server, tools: [], resources: [], templates: [] };
      }
      const details = yield* readDetails(input).pipe(
        Effect.mapError((error) =>
          runtimeError("provider-error", `Could not read MCP inventory: ${errorDetail(error)}`),
        ),
      );
      const safeServer = yield* upsertServer(input, details.server);
      return {
        server: safeServer,
        tools: details.tools.slice(0, MAX_RUNTIME_TOOL_DETAILS).map(sanitizeTool),
        resources: details.resources.slice(0, MAX_RUNTIME_TOOL_DETAILS).map(sanitizeResource),
        templates: details.templates
          .slice(0, MAX_RUNTIME_TOOL_DETAILS)
          .map(sanitizeResourceTemplate),
      };
    });

  const runAction: McpRuntimeRegistryShape["runAction"] = (input) =>
    withRuntimeActionLock(
      input,
      Effect.gen(function* () {
        const current = yield* requireEntry(input, true);
        const server = current.servers.get(input.providerKey);
        if (server === undefined) {
          return yield* runtimeError(
            "server-not-found",
            `MCP server '${input.providerKey}' is not present in this runtime.`,
          );
        }
        if (!server.availableActions.includes(input.action)) {
          return yield* runtimeError(
            input.action === "authorize" ? "authorization-unavailable" : "action-unsupported",
            `MCP action '${input.action}' is not supported for '${input.providerKey}'.`,
          );
        }
        const adapter = yield* adapterFor(input.providerInstanceId);
        if (input.action === "refresh") {
          yield* refresh(input);
          return { accepted: true, action: input.action, providerKey: input.providerKey };
        }
        const execute = adapter.mcpRuntime?.runAction;
        if (execute === undefined) {
          return yield* runtimeError(
            "action-unsupported",
            `Provider '${adapter.provider}' does not expose MCP runtime actions.`,
          );
        }
        const result = yield* execute(input).pipe(
          Effect.mapError((error) =>
            runtimeError("provider-error", `MCP action failed: ${errorDetail(error)}`),
          ),
        );
        if (result.accepted) {
          yield* refresh(input);
        }
        return {
          accepted: result.accepted,
          action: input.action,
          providerKey: input.providerKey,
          ...(result.authorizationUrl === undefined
            ? {}
            : { authorizationUrl: result.authorizationUrl }),
          ...(result.message === undefined
            ? {}
            : { message: sanitizeMcpRuntimeText(result.message) }),
        };
      }),
    );

  const applyConfiguration: McpRuntimeRegistryShape["applyConfiguration"] = (input, server) =>
    Effect.gen(function* () {
      const providerInstanceId = input.providerInstanceId;
      const entries = Array.from((yield* Ref.get(state)).values()).filter(
        (entry) =>
          entry.context.providerInstanceId === providerInstanceId &&
          entry.context.state === "active" &&
          isServerInRuntimeScope(server, entry.context),
      );
      const adapterResult = yield* Effect.exit(adapterFor(providerInstanceId));
      if (adapterResult._tag === "Failure") {
        return yield* Effect.forEach(entries, (entry) => {
          const target = {
            providerInstanceId,
            threadId: entry.context.threadId,
            runtimeSessionId: entry.context.runtimeSessionId,
          };
          return markConfigurationDrift(target, input, server).pipe(
            Effect.as({
              threadId: entry.context.threadId,
              runtimeSessionId: entry.context.runtimeSessionId,
              outcome: "failed" as const,
              message: errorDetail(Cause.squash(adapterResult.cause)),
            } satisfies McpLiveApplyResult),
          );
        });
      }
      const adapter = adapterResult.value;
      const apply = adapter.mcpRuntime?.applyConfiguration;
      if (apply === undefined) {
        const outcome: McpLiveApplyResult["outcome"] =
          adapter.capabilities.mcp === "unsupported" ? "unsupported" : "pending-next-session";
        return yield* Effect.forEach(entries, (entry) => {
          const target = {
            providerInstanceId,
            threadId: entry.context.threadId,
            runtimeSessionId: entry.context.runtimeSessionId,
          };
          const markDrift =
            outcome === "pending-next-session"
              ? markConfigurationDrift(target, input, server)
              : Effect.void;
          return markDrift.pipe(
            Effect.as({
              threadId: entry.context.threadId,
              runtimeSessionId: entry.context.runtimeSessionId,
              outcome,
            } satisfies McpLiveApplyResult),
          );
        });
      }
      return yield* Effect.forEach(entries, (entry) => {
        const target: ProviderMcpRuntimeTarget = {
          providerInstanceId,
          threadId: entry.context.threadId,
          runtimeSessionId: entry.context.runtimeSessionId,
        };
        return apply(target).pipe(
          Effect.flatMap((adapterOutcome) =>
            Effect.gen(function* () {
              const outcome: McpLiveApplyResult["outcome"] = adapterOutcome ?? "applied";
              if (outcome !== "applied") {
                if (outcome === "pending-next-session") {
                  yield* markConfigurationDrift(target, input, server);
                }
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }

              const refreshed = yield* Effect.exit(refresh(target));
              if (refreshed._tag === "Failure") {
                yield* markConfigurationDrift(target, input, server);
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session",
                  message: "The provider did not confirm the live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }

              const expectedProviderKey =
                server === undefined ? undefined : managedMcpProviderKey(server.id);
              const matching = refreshed.value.servers.filter(
                (candidate) =>
                  candidate.serverId === input.serverId ||
                  candidate.providerKey === expectedProviderKey,
              );
              const reflected = input.enabled
                ? matching.some(
                    (candidate) =>
                      candidate.state !== "disabled" &&
                      candidate.state !== "stale" &&
                      candidate.statusSource !== "configuration",
                  )
                : matching.every((candidate) => candidate.state === "disabled");
              if (!reflected) {
                yield* markConfigurationDrift(target, input, server);
                return {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session",
                  message: "The provider will use this MCP assignment in the next session.",
                } satisfies McpLiveApplyResult;
              }

              return {
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "applied",
              } satisfies McpLiveApplyResult;
            }),
          ),
          Effect.catch((error: ProviderAdapterError) =>
            markConfigurationDrift(target, input, server).pipe(
              Effect.as({
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "failed" as const,
                message: errorDetail(error),
              } satisfies McpLiveApplyResult),
            ),
          ),
        );
      });
    });

  const reconcileConfiguration: McpRuntimeRegistryShape["reconcileConfiguration"] = (input) =>
    Effect.gen(function* () {
      const accepted = yield* Ref.modify(configurationGenerations, (current) => {
        const latest = current.get(input.providerInstanceId) ?? -1;
        if (input.generation < latest) return [false, current] as const;
        const next = new Map(current);
        next.set(input.providerInstanceId, input.generation);
        return [true, next] as const;
      });
      if (!accepted) return [];

      return yield* configurationMutex.withPermits(1)(
        Effect.gen(function* () {
          const isCurrentGeneration = Effect.map(
            Ref.get(configurationGenerations),
            (generations) => generations.get(input.providerInstanceId) === input.generation,
          );
          if (!(yield* isCurrentGeneration)) return [];

          const entries = Array.from((yield* Ref.get(state)).values()).filter((entry) => {
            if (
              entry.context.providerInstanceId !== input.providerInstanceId ||
              entry.context.state !== "active"
            ) {
              return false;
            }
            return [...input.previousServers, ...input.desiredServers].some(
              (server) =>
                isServerAssignedToProvider(server, input.providerInstanceId) &&
                isServerInRuntimeScope(server, entry.context),
            );
          });
          const adapterResult = yield* Effect.exit(adapterFor(input.providerInstanceId));
          if (adapterResult._tag === "Failure") {
            if (!(yield* isCurrentGeneration)) return [];
            return yield* Effect.forEach(entries, (entry) => {
              const target = {
                providerInstanceId: input.providerInstanceId,
                threadId: entry.context.threadId,
                runtimeSessionId: entry.context.runtimeSessionId,
              };
              const previous = input.previousServers.filter(
                (server) =>
                  server.enabled &&
                  isServerAssignedToProvider(server, input.providerInstanceId) &&
                  isServerInRuntimeScope(server, entry.context),
              );
              const desired = input.desiredServers.filter(
                (server) =>
                  server.enabled &&
                  isServerAssignedToProvider(server, input.providerInstanceId) &&
                  isServerInRuntimeScope(server, entry.context),
              );
              const previousById = new Map(previous.map((server) => [server.id, server]));
              const desiredIds = new Set(desired.map((server) => server.id));
              const enable = desired.filter((server) => {
                const prior = previousById.get(server.id);
                return prior === undefined || JSON.stringify(prior) !== JSON.stringify(server);
              });
              const disable = previous.filter((server) => !desiredIds.has(server.id));
              return markConfigurationSetDrift(target, enable, disable).pipe(
                Effect.as({
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "failed" as const,
                  message: errorDetail(Cause.squash(adapterResult.cause)),
                } satisfies McpLiveApplyResult),
              );
            });
          }

          const adapter = adapterResult.value;
          const apply = adapter.mcpRuntime?.applyConfiguration;
          return yield* Effect.forEach(entries, (entry) =>
            Effect.gen(function* () {
              const target: ProviderMcpRuntimeTarget = {
                providerInstanceId: input.providerInstanceId,
                threadId: entry.context.threadId,
                runtimeSessionId: entry.context.runtimeSessionId,
              };
              const previous = input.previousServers.filter(
                (server) =>
                  server.enabled &&
                  isServerAssignedToProvider(server, input.providerInstanceId) &&
                  isServerInRuntimeScope(server, entry.context),
              );
              const desired = input.desiredServers.filter(
                (server) =>
                  server.enabled &&
                  isServerAssignedToProvider(server, input.providerInstanceId) &&
                  isServerInRuntimeScope(server, entry.context),
              );
              const previousById = new Map(previous.map((server) => [server.id, server]));
              const desiredIds = new Set(desired.map((server) => server.id));
              const transitionEnable = desired.filter((server) => {
                const prior = previousById.get(server.id);
                return prior === undefined || JSON.stringify(prior) !== JSON.stringify(server);
              });
              const transitionDisable = previous.filter((server) => !desiredIds.has(server.id));
              if (apply === undefined) {
                const outcome: McpLiveApplyResult["outcome"] =
                  adapter.capabilities.mcp === "unsupported"
                    ? "unsupported"
                    : "pending-next-session";
                if (outcome === "pending-next-session") {
                  yield* markConfigurationSetDrift(target, transitionEnable, transitionDisable);
                }
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }

              const applied = yield* Effect.exit(apply(target));
              if (!(yield* isCurrentGeneration)) return undefined;
              if (applied._tag === "Failure") {
                yield* markConfigurationSetDrift(target, transitionEnable, transitionDisable);
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "failed" as const,
                  message: errorDetail(Cause.squash(applied.cause)),
                } satisfies McpLiveApplyResult;
              }
              const outcome = applied.value ?? "applied";
              if (outcome !== "applied") {
                if (outcome === "pending-next-session") {
                  yield* markConfigurationSetDrift(target, transitionEnable, transitionDisable);
                }
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome,
                } satisfies McpLiveApplyResult;
              }

              const refreshed = yield* Effect.exit(refresh(target));
              if (!(yield* isCurrentGeneration)) return undefined;
              if (refreshed._tag === "Failure") {
                yield* markConfigurationSetDrift(target, transitionEnable, transitionDisable);
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session" as const,
                  message: "The provider did not confirm the complete live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }

              const healthyManaged = refreshed.value.servers.filter(
                (server) =>
                  server.source === "t3-managed" &&
                  server.state !== "disabled" &&
                  server.state !== "stale" &&
                  server.statusSource !== "configuration",
              );
              const missing = desired.filter((definition) => {
                const providerKey = managedMcpProviderKey(definition.id);
                return !healthyManaged.some(
                  (server) =>
                    server.serverId === definition.id || server.providerKey === providerKey,
                );
              });
              const unexpected = healthyManaged
                .filter(
                  (server) =>
                    !desired.some(
                      (definition) =>
                        server.serverId === definition.id ||
                        server.providerKey === managedMcpProviderKey(definition.id),
                    ),
                )
                .flatMap((server) => {
                  const definition = previous.find(
                    (candidate) =>
                      candidate.id === server.serverId ||
                      managedMcpProviderKey(candidate.id) === server.providerKey,
                  );
                  return definition === undefined ? [] : [definition];
                });
              if (missing.length > 0 || unexpected.length > 0) {
                yield* markConfigurationSetDrift(target, missing, unexpected);
                return {
                  providerInstanceId: input.providerInstanceId,
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  outcome: "pending-next-session" as const,
                  message: "The provider did not confirm the complete live MCP configuration.",
                } satisfies McpLiveApplyResult;
              }
              return {
                providerInstanceId: input.providerInstanceId,
                threadId: target.threadId,
                runtimeSessionId: target.runtimeSessionId,
                outcome: "applied" as const,
              } satisfies McpLiveApplyResult;
            }),
          ).pipe(Effect.map((results) => results.filter((result) => result !== undefined)));
        }),
      );
    });

  const observeProviderEvent: McpRuntimeRegistryShape["observeProviderEvent"] = (event) => {
    if (event.providerInstanceId === undefined || event.runtimeSessionId === undefined) {
      return Effect.void;
    }
    const target = {
      providerInstanceId: event.providerInstanceId,
      threadId: event.threadId,
      runtimeSessionId: event.runtimeSessionId,
    };
    if (event.type === "session.exited") {
      return endSession(target);
    }
    if (event.type !== "mcp.status.updated" && event.type !== "mcp.oauth.completed") {
      return Effect.void;
    }
    return refreshAfterProviderEvent(target);
  };

  return {
    registerSession,
    endSession,
    listContexts,
    subscribeContexts,
    providerCapability,
    snapshot,
    refresh,
    subscribe,
    getServerDetails,
    runAction,
    applyConfiguration,
    reconcileConfiguration,
    observeProviderEvent,
  } satisfies McpRuntimeRegistryShape;
});

export const McpRuntimeRegistryLive = Layer.effect(McpRuntimeRegistry, makeMcpRuntimeRegistry());
