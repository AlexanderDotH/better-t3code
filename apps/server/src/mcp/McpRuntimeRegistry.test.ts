import {
  EventId,
  McpRuntimeServerKey,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeServer,
  type McpServerDefinition,
  type ProviderSession,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ProviderAdapterRequestError, type ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../provider/Services/ProviderAdapterRegistry.ts";
import { makeAdapterRegistryMock } from "../provider/testUtils/providerAdapterRegistryMock.ts";
import {
  makeMcpRuntimeRegistry,
  McpRuntimeRegistry,
  McpRuntimeRegistryLive,
} from "./McpRuntimeRegistry.ts";

const driver = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const threadId = ThreadId.make("thread-1");
const firstRuntimeSessionId = RuntimeSessionId.make("runtime-1");
const secondRuntimeSessionId = RuntimeSessionId.make("runtime-2");
const providerKey = McpRuntimeServerKey.make("notion");
const secondProviderKey = McpRuntimeServerKey.make("linear");

function session(
  runtimeSessionId: RuntimeSessionId,
  overrides: Partial<ProviderSession> = {},
): ProviderSession {
  return {
    provider: driver,
    providerInstanceId,
    status: "ready",
    runtimeMode: "local",
    cwd: "/workspace",
    threadId,
    runtimeSessionId,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

function runtimeServer(
  runtimeSessionId: RuntimeSessionId,
  overrides: Partial<McpRuntimeServer> = {},
): McpRuntimeServer {
  return {
    serverId: "notion",
    providerKey,
    source: "t3-managed",
    providerInstanceId,
    threadId,
    runtimeSessionId,
    name: "Notion",
    transport: "http",
    state: "connected",
    statusSource: "provider-query",
    observedAt: "2026-08-02T12:00:00.000Z",
    authState: "authenticated",
    availableActions: ["refresh", "reconnect", "authorize"],
    reportsTools: true,
    toolCount: 3,
    configDrift: "none",
    ...overrides,
  };
}

function serverDefinition(
  id: string,
  overrides: Partial<McpServerDefinition> = {},
): McpServerDefinition {
  return {
    id,
    name: id === "notion" ? "Notion" : "Linear",
    enabled: true,
    providerRouting: { mode: "selected", instanceIds: [providerInstanceId] },
    scope: "global",
    transport: "http",
    url: `https://${id}.example.test/mcp`,
    headers: {},
    ...overrides,
  } as McpServerDefinition;
}

function makeAdapter(
  getSnapshot: NonNullable<ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]>["getSnapshot"],
  options: {
    readonly getServerDetails?: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]
    >["getServerDetails"];
    readonly runAction?: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]
    >["runAction"];
    readonly applyConfiguration?: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]
    >["applyConfiguration"];
  } = {},
): ProviderAdapterShape<ProviderAdapterError> {
  const unsupported = () => Effect.die("not used by MCP registry tests");
  return {
    provider: driver,
    capabilities: { sessionModelSwitch: "unsupported", mcp: "sessionConfig" },
    mcpRuntime: {
      getSnapshot,
      ...(options.getServerDetails === undefined
        ? {}
        : { getServerDetails: options.getServerDetails }),
      ...(options.runAction === undefined ? {} : { runAction: options.runAction }),
      ...(options.applyConfiguration === undefined
        ? {}
        : { applyConfiguration: options.applyConfiguration }),
    },
    startSession: unsupported,
    sendTurn: unsupported,
    interruptTurn: unsupported,
    forceStopSession: unsupported,
    respondToRequest: unsupported,
    respondToUserInput: unsupported,
    stopSession: unsupported,
    listSessions: () => Effect.succeed([]),
    hasSession: () => Effect.succeed(false),
    readThread: unsupported,
    rollbackThread: unsupported,
    stopAll: () => Effect.void,
    streamEvents: Stream.empty,
  };
}

function registryLayer(adapter: ProviderAdapterShape<ProviderAdapterError>) {
  return McpRuntimeRegistryLive.pipe(
    Layer.provide(
      Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistry,
        makeAdapterRegistryMock({ codex: adapter }),
      ),
    ),
  );
}

function makeRegistry(adapter: ProviderAdapterShape<ProviderAdapterError>) {
  return makeMcpRuntimeRegistry().pipe(
    Effect.provide(
      Layer.succeed(
        ProviderAdapterRegistry.ProviderAdapterRegistry,
        makeAdapterRegistryMock({ codex: adapter }),
      ),
    ),
  );
}

describe("McpRuntimeRegistry", () => {
  it.effect("coalesces concurrent refreshes for the same runtime into one provider query", () => {
    const getSnapshot = vi.fn((input) =>
      Effect.yieldNow.pipe(Effect.as([runtimeServer(input.runtimeSessionId)])),
    );
    const adapter = makeAdapter(getSnapshot);
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const snapshots = yield* Effect.all(
        Array.from({ length: 32 }, () => registry.refresh(target)),
        { concurrency: "unbounded" },
      );

      expect(getSnapshot).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveLength(32);
      expect(
        snapshots.every(
          (snapshot) => snapshot.context.runtimeSessionId === target.runtimeSessionId,
        ),
      ).toBe(true);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("subscribes before its snapshot and emits only later revisions", () => {
    let servers: ReadonlyArray<McpRuntimeServer> = [runtimeServer(firstRuntimeSessionId)];
    const adapter = makeAdapter(() => Effect.succeed(servers));
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const subscription = yield* registry.subscribe({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      expect(subscription.latest.servers[0]?.state).toBe("connected");

      servers = [
        runtimeServer(firstRuntimeSessionId, {
          state: "auth-required",
          authState: "required",
        }),
      ];
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      const change = yield* Stream.runHead(subscription.changes);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some" && change.value.type === "server-upserted") {
        expect(change.value.revision).toBeGreaterThan(subscription.latest.revision);
        expect(change.value.server.state).toBe("auth-required");
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("publishes one authoritative snapshot when refresh replaces a server set", () => {
    let servers: ReadonlyArray<McpRuntimeServer> = [
      runtimeServer(firstRuntimeSessionId),
      runtimeServer(firstRuntimeSessionId, {
        serverId: "linear",
        providerKey: secondProviderKey,
        name: "Linear",
      }),
    ];
    const adapter = makeAdapter(() => Effect.succeed(servers));
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      const subscription = yield* registry.subscribe(target);

      servers = [
        runtimeServer(firstRuntimeSessionId, {
          serverId: "linear",
          providerKey: secondProviderKey,
          name: "Linear",
          state: "auth-required",
          authState: "required",
        }),
      ];
      yield* registry.refresh(target);
      const change = yield* Stream.runHead(subscription.changes);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some") {
        expect(change.value.type).toBe("snapshot");
        if (change.value.type === "snapshot") {
          expect(change.value.snapshot.revision).toBe(subscription.latest.revision + 1);
          expect(change.value.snapshot.servers).toEqual([
            expect.objectContaining({ providerKey: secondProviderKey, state: "auth-required" }),
          ]);
        }
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("publishes every stale server together in one authoritative snapshot", () => {
    let shouldFail = false;
    const adapter = makeAdapter((input) =>
      shouldFail
        ? Effect.fail(
            new ProviderAdapterRequestError({
              provider: driver,
              method: "mcp.snapshot",
              detail: "status failed",
            }),
          )
        : Effect.succeed([
            runtimeServer(input.runtimeSessionId),
            runtimeServer(input.runtimeSessionId, {
              serverId: "linear",
              providerKey: secondProviderKey,
              name: "Linear",
            }),
          ]),
    );
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      const subscription = yield* registry.subscribe(target);
      shouldFail = true;

      yield* registry.refresh(target);
      const change = yield* Stream.runHead(subscription.changes);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some" && change.value.type === "snapshot") {
        expect(change.value.snapshot.servers).toHaveLength(2);
        expect(change.value.snapshot.servers.every((server) => server.state === "stale")).toBe(
          true,
        );
      } else {
        expect(change._tag === "Some" ? change.value.type : "none").toBe("snapshot");
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("gives a late runtime subscriber the complete accumulated snapshot", () => {
    const adapter = makeAdapter((input) =>
      Effect.succeed([
        runtimeServer(input.runtimeSessionId),
        runtimeServer(input.runtimeSessionId, {
          serverId: "linear",
          providerKey: secondProviderKey,
          name: "Linear",
        }),
      ]),
    );
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh(target);

      const subscription = yield* registry.subscribe(target);

      expect(subscription.latest.servers.map((server) => server.providerKey)).toEqual([
        secondProviderKey,
        providerKey,
      ]);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("marks the last known snapshot stale and redacts provider failures", () => {
    let shouldFail = false;
    const adapter = makeAdapter((input) =>
      shouldFail
        ? Effect.fail(
            new ProviderAdapterRequestError({
              provider: driver,
              method: "mcp.snapshot",
              detail: "Authorization: Bearer secret-token NOTION_TOKEN=another-secret",
            }),
          )
        : Effect.succeed([runtimeServer(input.runtimeSessionId)]),
    );
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      shouldFail = true;

      const stale = yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });

      expect(stale.servers[0]?.state).toBe("stale");
      expect(stale.servers[0]?.issue?.message).not.toContain("secret-token");
      expect(stale.servers[0]?.issue?.message).not.toContain("another-secret");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("returns a sanitized error when the first status query fails", () => {
    const adapter = makeAdapter(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: driver,
          method: "mcp.snapshot",
          detail: "Authorization: Bearer first-secret failed",
        }),
      ),
    );
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const error = yield* registry
        .refresh({ providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId })
        .pipe(Effect.flip);

      expect(error.code).toBe("provider-error");
      expect(error.detail).not.toContain("first-secret");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("rejects actions from a replaced runtime generation", () => {
    const runAction = vi.fn((input) =>
      Effect.succeed({
        accepted: true,
        action: input.action,
        providerKey: input.providerKey,
      }),
    );
    const adapter = makeAdapter(
      (input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]),
      { runAction },
    );
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      yield* registry.registerSession(session(secondRuntimeSessionId));

      const error = yield* registry
        .runAction({
          providerInstanceId,
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          providerKey,
          action: "reconnect",
        })
        .pipe(Effect.flip);

      expect(error.code).toBe("session-replaced");
      expect(runAction).not.toHaveBeenCalled();
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("serializes runtime actions for one exact runtime and server", () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;
    let callNumber = 0;
    return Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const runAction = vi.fn((input) =>
        Effect.gen(function* () {
          callNumber += 1;
          const currentCall = callNumber;
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          if (currentCall === 1) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(releaseFirst);
          }
          activeCalls -= 1;
          return {
            accepted: true,
            action: input.action,
            providerKey: input.providerKey,
          };
        }),
      );
      const adapter = makeAdapter(
        (input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]),
        { runAction },
      );
      const registry = yield* makeRegistry(adapter);
      const target = {
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
        providerKey,
        action: "reconnect" as const,
      };
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh(target);

      const first = yield* Effect.forkChild(registry.runAction(target), { startImmediately: true });
      yield* Deferred.await(firstStarted);
      const second = yield* Effect.forkChild(registry.runAction(target), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      expect(runAction).toHaveBeenCalledTimes(1);
      expect(maxActiveCalls).toBe(1);

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      expect(runAction).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);
    });
  });

  it.effect("keeps ended sessions inspectable without retaining a connected state", () => {
    const getSnapshot = vi.fn((input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]));
    const adapter = makeAdapter(getSnapshot);
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh(target);
      yield* registry.endSession(target);

      const ended = yield* registry.refresh(target);

      expect(ended.context.state).toBe("inactive");
      expect(ended.servers[0]?.state).toBe("not-started");
      expect(getSnapshot).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("publishes one authoritative snapshot when a runtime session ends", () => {
    const adapter = makeAdapter((input) =>
      Effect.succeed([
        runtimeServer(input.runtimeSessionId),
        runtimeServer(input.runtimeSessionId, {
          serverId: "linear",
          providerKey: secondProviderKey,
          name: "Linear",
        }),
      ]),
    );
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      const subscription = yield* registry.subscribe(target);

      yield* registry.endSession(target);
      const change = yield* Stream.runHead(subscription.changes);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some" && change.value.type === "snapshot") {
        expect(change.value.snapshot.context.state).toBe("inactive");
        expect(
          change.value.snapshot.servers.every((server) => server.state === "not-started"),
        ).toBe(true);
      } else {
        expect(change._tag === "Some" ? change.value.type : "none").toBe("snapshot");
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("publishes one authoritative snapshot for a replaced runtime generation", () => {
    const adapter = makeAdapter((input) =>
      Effect.succeed([
        runtimeServer(input.runtimeSessionId),
        runtimeServer(input.runtimeSessionId, {
          serverId: "linear",
          providerKey: secondProviderKey,
          name: "Linear",
        }),
      ]),
    );
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      const subscription = yield* registry.subscribe(target);

      yield* registry.registerSession(session(secondRuntimeSessionId));
      const change = yield* Stream.runHead(subscription.changes);

      expect(change._tag).toBe("Some");
      if (change._tag === "Some" && change.value.type === "snapshot") {
        expect(change.value.snapshot.context.state).toBe("inactive");
        expect(change.value.snapshot.context.runtimeSessionId).toBe(firstRuntimeSessionId);
        expect(change.value.snapshot.servers).toHaveLength(2);
      } else {
        expect(change._tag === "Some" ? change.value.type : "none").toBe("snapshot");
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("invalidates connected state when the provider exits unexpectedly", () => {
    const adapter = makeAdapter((input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]));
    const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh(target);

      yield* registry.observeProviderEvent({
        eventId: EventId.make("event-session-exited"),
        provider: driver,
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
        createdAt: "2026-08-02T12:00:01.000Z",
        type: "session.exited",
        payload: {},
      });

      const ended = yield* registry.snapshot(target);
      expect(ended.context.state).toBe("inactive");
      expect(ended.servers[0]?.state).toBe("not-started");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("schedules one trailing refresh for provider events received during a refresh", () => {
    return Effect.gen(function* () {
      const firstRefreshStarted = yield* Deferred.make<void>();
      const releaseFirstRefresh = yield* Deferred.make<void>();
      let snapshotCalls = 0;
      const getSnapshot = vi.fn((input) =>
        Effect.gen(function* () {
          snapshotCalls += 1;
          if (snapshotCalls === 1) {
            yield* Deferred.succeed(firstRefreshStarted, undefined);
            yield* Deferred.await(releaseFirstRefresh);
          }
          return [runtimeServer(input.runtimeSessionId)];
        }),
      );
      const registry = yield* makeRegistry(makeAdapter(getSnapshot));
      const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const refreshFiber = yield* registry.refresh(target).pipe(Effect.forkChild);
      yield* Deferred.await(firstRefreshStarted);
      const eventsFiber = yield* Effect.all(
        Array.from({ length: 32 }, (_, index) =>
          registry.observeProviderEvent({
            eventId: EventId.make(`event-status-${index}`),
            provider: driver,
            providerInstanceId,
            threadId,
            runtimeSessionId: firstRuntimeSessionId,
            createdAt: "2026-08-02T12:00:01.000Z",
            type: "mcp.status.updated",
            payload: { status: { name: "notion", status: "ready" } },
          }),
        ),
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);

      yield* Effect.yieldNow;
      yield* Deferred.succeed(releaseFirstRefresh, undefined);
      yield* Fiber.join(refreshFiber);
      yield* Fiber.join(eventsFiber);

      expect(getSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  it.effect("applies live configuration per active session without failing the batch", () => {
    const applyConfiguration = vi.fn((input) =>
      input.threadId === threadId
        ? Effect.void
        : Effect.fail(
            new ProviderAdapterRequestError({
              provider: driver,
              method: "mcp.applyConfiguration",
              detail: "api_key=secret could not be applied",
            }),
          ),
    );
    const adapter = makeAdapter(
      (input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]),
      { applyConfiguration },
    );
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const results = yield* registry.applyConfiguration({
        serverId: "notion",
        providerInstanceId,
        enabled: true,
      });

      expect(results).toEqual([
        {
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          outcome: "applied",
        },
      ]);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("reports saved-but-unreflected configuration as pending next session", () => {
    const getSnapshot = vi.fn((input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]));
    const adapter = makeAdapter(getSnapshot, {
      applyConfiguration: () => Effect.succeed("pending-next-session" as const),
    });
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      getSnapshot.mockClear();

      const results = yield* registry.applyConfiguration({
        serverId: "notion",
        providerInstanceId,
        enabled: true,
      });

      expect(results).toEqual([
        {
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          outcome: "pending-next-session",
        },
      ]);
      expect(getSnapshot).not.toHaveBeenCalled();
      const pending = yield* registry.snapshot({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      expect(pending.servers[0]?.configDrift).toBe("pending-enable");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("requires a fresh provider snapshot before reporting a live enable as applied", () => {
    const adapter = makeAdapter(() => Effect.succeed([]), {
      applyConfiguration: () => Effect.void,
    });
    const definition: McpServerDefinition = {
      id: "notion",
      name: "Notion",
      enabled: true,
      providerRouting: { mode: "selected", instanceIds: [providerInstanceId] },
      scope: "global",
      transport: "http",
      url: "https://mcp.example.test",
      headers: {},
    };
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });

      const results = yield* registry.applyConfiguration(
        { serverId: "notion", providerInstanceId, enabled: true },
        definition,
      );

      expect(results).toEqual([
        {
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          outcome: "pending-next-session",
          message: "The provider will use this MCP assignment in the next session.",
        },
      ]);

      const pending = yield* registry.snapshot({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });
      expect(pending.servers).toEqual([
        expect.objectContaining({
          serverId: "notion",
          providerKey: "notion",
          state: "not-started",
          statusSource: "configuration",
          configDrift: "pending-enable",
        }),
      ]);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("does not report a stale verification snapshot as a live apply", () => {
    let shouldFail = false;
    const adapter = makeAdapter(
      (input) =>
        shouldFail
          ? Effect.fail(
              new ProviderAdapterRequestError({
                provider: driver,
                method: "mcp.snapshot",
                detail: "status refresh failed",
              }),
            )
          : Effect.succeed([runtimeServer(input.runtimeSessionId)]),
      { applyConfiguration: () => Effect.void },
    );
    const definition: McpServerDefinition = {
      id: "notion",
      name: "Notion",
      enabled: true,
      providerRouting: { mode: "all" },
      scope: "global",
      transport: "http",
      url: "https://mcp.example.test",
      headers: {},
    };
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh(target);
      shouldFail = true;

      const results = yield* registry.applyConfiguration(
        { serverId: "notion", providerInstanceId, enabled: true },
        definition,
      );

      expect(results[0]?.outcome).toBe("pending-next-session");
      const snapshot = yield* registry.snapshot(target);
      expect(snapshot.servers[0]).toMatchObject({
        state: "stale",
        configDrift: "pending-enable",
      });
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("applies project-scoped changes only to matching active sessions", () => {
    const otherThreadId = ThreadId.make("thread-2");
    const otherRuntimeSessionId = RuntimeSessionId.make("runtime-other");
    const applyConfiguration = vi.fn(() => Effect.void);
    const adapter = makeAdapter(() => Effect.succeed([]), { applyConfiguration });
    const projectServer: McpServerDefinition = {
      id: "notion",
      name: "Notion",
      enabled: true,
      providerRouting: { mode: "all" },
      scope: "project",
      projectCwd: "/workspace/",
      transport: "http",
      url: "https://mcp.example.test",
      headers: {},
    };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.registerSession(
        session(otherRuntimeSessionId, { threadId: otherThreadId, cwd: "/other-project" }),
      );

      const results = yield* registry.applyConfiguration(
        { serverId: "notion", providerInstanceId, enabled: false },
        projectServer,
      );

      expect(results).toEqual([
        {
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          outcome: "applied",
        },
      ]);
      expect(applyConfiguration).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("streams provider context start, replacement, and end lifecycle changes", () => {
    const adapter = makeAdapter(() => Effect.succeed([]));

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      const subscription = yield* registry.subscribeContexts({ providerInstanceId });
      expect(subscription.latest.contexts).toEqual([]);

      yield* registry.registerSession(session(firstRuntimeSessionId));
      const started = yield* Stream.runHead(subscription.changes);
      expect(started._tag).toBe("Some");
      if (started._tag === "Some" && started.value.type === "context-upserted") {
        expect(started.value.context.runtimeSessionId).toBe(firstRuntimeSessionId);
        expect(started.value.context.state).toBe("active");
      } else {
        expect(started._tag === "Some" ? started.value.type : "none").toBe("context-upserted");
      }

      yield* registry.registerSession(session(secondRuntimeSessionId));
      const replaced = yield* Stream.runHead(subscription.changes);
      expect(replaced._tag).toBe("Some");
      if (replaced._tag === "Some" && replaced.value.type === "snapshot") {
        expect(
          replaced.value.snapshot.contexts.map((context) => [
            context.runtimeSessionId,
            context.state,
          ]),
        ).toEqual([
          [secondRuntimeSessionId, "active"],
          [firstRuntimeSessionId, "inactive"],
        ]);
      } else {
        expect(replaced._tag === "Some" ? replaced.value.type : "none").toBe("snapshot");
      }

      yield* registry.endSession({
        providerInstanceId,
        threadId,
        runtimeSessionId: secondRuntimeSessionId,
      });
      const ended = yield* Stream.runHead(subscription.changes);
      expect(ended._tag).toBe("Some");
      if (ended._tag === "Some" && ended.value.type === "context-upserted") {
        expect(ended.value.context.runtimeSessionId).toBe(secondRuntimeSessionId);
        expect(ended.value.context.state).toBe("inactive");
      } else {
        expect(ended._tag === "Some" ? ended.value.type : "none").toBe("context-upserted");
      }
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("retains active contexts plus only 20 recent inactive contexts for 24 hours", () => {
    const adapter = makeAdapter(() => Effect.succeed([]));

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      for (let index = 0; index < 22; index += 1) {
        const runtimeSessionId = RuntimeSessionId.make(`inactive-runtime-${index}`);
        const contextThreadId = ThreadId.make(`inactive-thread-${index}`);
        yield* registry.registerSession(session(runtimeSessionId, { threadId: contextThreadId }));
        yield* registry.endSession({
          providerInstanceId,
          threadId: contextThreadId,
          runtimeSessionId,
        });
        yield* TestClock.adjust(Duration.seconds(1));
      }

      const retained = yield* registry.listContexts({ providerInstanceId });
      expect(retained.contexts).toHaveLength(20);
      expect(retained.contexts.map((context) => context.runtimeSessionId)).not.toContain(
        RuntimeSessionId.make("inactive-runtime-0"),
      );
      expect(retained.contexts.map((context) => context.runtimeSessionId)).not.toContain(
        RuntimeSessionId.make("inactive-runtime-1"),
      );

      yield* TestClock.adjust(Duration.hours(25));
      const activeRuntimeSessionId = RuntimeSessionId.make("active-runtime");
      const activeThreadId = ThreadId.make("active-thread");
      yield* registry.registerSession(
        session(activeRuntimeSessionId, { threadId: activeThreadId }),
      );

      const afterExpiry = yield* registry.listContexts({ providerInstanceId });
      expect(afterExpiry.contexts).toEqual([
        expect.objectContaining({
          threadId: activeThreadId,
          runtimeSessionId: activeRuntimeSessionId,
          state: "active",
        }),
      ]);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("reports MCP support from the selected provider adapter capability", () => {
    const adapter = {
      ...makeAdapter(() => Effect.succeed([])),
      capabilities: { sessionModelSwitch: "unsupported" as const, mcp: "nativeConfig" as const },
    };

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      const capability = yield* registry.providerCapability(providerInstanceId);

      expect(capability).toBe("nativeConfig");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect(
    "reconciles and verifies the complete desired managed server set once per runtime",
    () => {
      const applyConfiguration = vi.fn(() => Effect.void);
      const adapter = makeAdapter(
        (input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]),
        { applyConfiguration },
      );
      const target = { providerInstanceId, threadId, runtimeSessionId: firstRuntimeSessionId };

      return Effect.gen(function* () {
        const registry = yield* McpRuntimeRegistry;
        yield* registry.registerSession(session(firstRuntimeSessionId));
        yield* registry.refresh(target);

        const results = yield* registry.reconcileConfiguration({
          generation: 1,
          providerInstanceId,
          previousServers: [serverDefinition("notion")],
          desiredServers: [serverDefinition("notion"), serverDefinition("linear")],
        });

        expect(applyConfiguration).toHaveBeenCalledTimes(1);
        expect(results).toEqual([
          {
            providerInstanceId,
            threadId,
            runtimeSessionId: firstRuntimeSessionId,
            outcome: "pending-next-session",
            message: "The provider did not confirm the complete live MCP configuration.",
          },
        ]);
        expect((yield* registry.snapshot(target)).servers).toEqual([
          expect.objectContaining({
            providerKey: secondProviderKey,
            configDrift: "pending-enable",
          }),
          expect.objectContaining({ providerKey, configDrift: "none" }),
        ]);
      }).pipe(Effect.provide(registryLayer(adapter)));
    },
  );

  it.effect("treats reassignment to another provider account as removal from this runtime", () => {
    const otherProviderInstanceId = ProviderInstanceId.make("codex-personal");
    const applyConfiguration = vi.fn(() => Effect.void);
    const adapter = makeAdapter(() => Effect.succeed([]), { applyConfiguration });
    const assignedHere = serverDefinition("notion");
    const assignedElsewhere = serverDefinition("notion", {
      providerRouting: { mode: "selected", instanceIds: [otherProviderInstanceId] },
    });

    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));

      const results = yield* registry.reconcileConfiguration({
        generation: 1,
        providerInstanceId,
        previousServers: [assignedHere],
        desiredServers: [assignedElsewhere],
      });

      expect(applyConfiguration).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        {
          providerInstanceId,
          threadId,
          runtimeSessionId: firstRuntimeSessionId,
          outcome: "applied",
        },
      ]);
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("returns only safe lazy tool metadata and re-sanitizes provider issues", () => {
    const server = runtimeServer(firstRuntimeSessionId, {
      issue: { message: "Authorization: Bearer provider-secret" },
      serverInfo: { name: "Notion", version: "token=version-secret" },
    });
    const adapter = makeAdapter(() => Effect.succeed([server]), {
      getServerDetails: () =>
        Effect.succeed({
          server,
          tools: [
            {
              name: "search",
              title: "Search api_key=title-secret",
              description: "Search authorized pages with api_key=tool-secret",
              readOnly: true,
              inputSchema: { secret: "must-not-cross-wire" },
            } as never,
          ],
          resources: [
            {
              uri: "notion://api_key=resource-secret",
              name: "Workspace token=resource-name-secret",
              description: "Resource Bearer resource-description-secret",
            },
          ],
          templates: [
            {
              uriTemplate: "notion://api_key={template-secret}",
              name: "Template token=template-name-secret",
            },
          ],
        }),
    });
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });

      const details = yield* registry.getServerDetails({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
        providerKey,
      });

      expect(details.server.issue?.message).not.toContain("provider-secret");
      expect(JSON.stringify(details.server)).not.toContain("version-secret");
      expect(details.tools).toEqual([
        {
          name: "search",
          title: "Search api_key=[REDACTED]",
          description: "Search authorized pages with api_key=[REDACTED]",
          readOnly: true,
        },
      ]);
      expect(details.tools[0]).not.toHaveProperty("inputSchema");
      expect(JSON.stringify(details.resources)).not.toContain("resource-secret");
      expect(JSON.stringify(details.templates)).not.toContain("template-secret");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("bounds lazy tool inventories before they cross the wire", () => {
    const server = runtimeServer(firstRuntimeSessionId);
    const adapter = makeAdapter(() => Effect.succeed([server]), {
      getServerDetails: () =>
        Effect.succeed({
          server,
          tools: Array.from({ length: 300 }, (_, index) => ({ name: `tool-${index}` })),
          resources: [],
          templates: [],
        }),
    });
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.refresh({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
      });

      const details = yield* registry.getServerDetails({
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
        providerKey,
      });

      expect(details.tools).toHaveLength(256);
      expect(details.tools.at(-1)?.name).toBe("tool-255");
    }).pipe(Effect.provide(registryLayer(adapter)));
  });

  it.effect("ignores late provider events from a replaced runtime generation", () => {
    const getSnapshot = vi.fn((input) => Effect.succeed([runtimeServer(input.runtimeSessionId)]));
    const adapter = makeAdapter(getSnapshot);
    return Effect.gen(function* () {
      const registry = yield* McpRuntimeRegistry;
      yield* registry.registerSession(session(firstRuntimeSessionId));
      yield* registry.registerSession(session(secondRuntimeSessionId));

      yield* registry.observeProviderEvent({
        eventId: EventId.make("event-stale"),
        provider: driver,
        providerInstanceId,
        threadId,
        runtimeSessionId: firstRuntimeSessionId,
        createdAt: "2026-08-02T12:00:00.000Z",
        type: "mcp.status.updated",
        payload: { status: { name: "notion", status: "ready" } },
      });
      expect(getSnapshot).not.toHaveBeenCalled();

      yield* registry.observeProviderEvent({
        eventId: EventId.make("event-current"),
        provider: driver,
        providerInstanceId,
        threadId,
        runtimeSessionId: secondRuntimeSessionId,
        createdAt: "2026-08-02T12:00:00.000Z",
        type: "mcp.status.updated",
        payload: { status: { name: "notion", status: "ready" } },
      });
      expect(getSnapshot).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(registryLayer(adapter)));
  });
});
