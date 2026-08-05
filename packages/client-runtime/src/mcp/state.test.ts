import {
  EnvironmentId,
  McpServerId,
  McpRuntimeServerKey,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  WS_METHODS,
  type McpRuntimeChange,
  type McpRuntimeContextChange,
  type McpRuntimeContextSnapshot,
  type McpRuntimeServer,
  type McpRuntimeSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { runAtomCommand } from "../state/runtime.ts";
import { createMcpEnvironmentAtoms } from "./state.ts";

const environmentId = EnvironmentId.make("environment-one");
const providerInstanceId = ProviderInstanceId.make("codex-work");
const threadId = ThreadId.make("thread-one");
const runtimeSessionId = RuntimeSessionId.make("runtime-one");
const target = new PrimaryConnectionTarget({
  environmentId,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const connected: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};

function runtimeServer(providerKey: string): McpRuntimeServer {
  return {
    providerKey: McpRuntimeServerKey.make(providerKey),
    source: "t3-managed",
    providerInstanceId,
    threadId,
    runtimeSessionId,
    name: providerKey,
    state: "connected",
    statusSource: "provider-query",
    observedAt: "2026-08-03T10:00:00.000Z",
    authState: "authenticated",
    availableActions: ["refresh"],
    reportsTools: true,
    configDrift: "none",
  };
}

function runtimeSnapshot(
  revision: number,
  servers: readonly McpRuntimeServer[],
  observedAt = "2026-08-03T10:00:00.000Z",
): McpRuntimeSnapshot {
  return {
    context: {
      providerInstanceId,
      driver: ProviderDriverKind.make("codex"),
      threadId,
      runtimeSessionId,
      state: "active",
      updatedAt: observedAt,
    },
    revision,
    observedAt,
    servers,
  };
}

function contextSnapshot(revision: number, runtime: RuntimeSessionId): McpRuntimeContextSnapshot {
  return {
    providerInstanceId,
    revision,
    observedAt: `2026-08-03T10:00:0${revision}.000Z`,
    contexts: [
      {
        providerInstanceId,
        driver: ProviderDriverKind.make("codex"),
        threadId,
        runtimeSessionId: runtime,
        state: "active",
        updatedAt: `2026-08-03T10:00:0${revision}.000Z`,
      },
    ],
  };
}

function rpcSession(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function environmentRegistry(
  supervisor: EnvironmentSupervisor.EnvironmentSupervisor["Service"],
): EnvironmentRegistry.EnvironmentRegistry["Service"] {
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_id, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const runStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["runStream"] = (
    _id,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _id,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  return EnvironmentRegistry.EnvironmentRegistry.of({
    run,
    runStream,
    followStream,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
}

function makeSupervisor(client: WsRpcProtocolClient) {
  return Effect.gen(function* () {
    const sessions = yield* SubscriptionRef.make(Option.some(rpcSession(client)));
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target,
      state: yield* SubscriptionRef.make(connected),
      session: sessions,
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    return { supervisor, sessions };
  });
}

function deferredPromise(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function mcpDefinition(id: string) {
  return {
    id: McpServerId.make(id),
    name: id,
    enabled: true,
    providerRouting: { mode: "all" as const },
    scope: "global" as const,
    transport: "stdio" as const,
    command: "node",
    args: [],
    env: {},
  };
}

function waitForRevision<A extends { readonly revision: number }>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
  revision: number,
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = registry.get(atom);
      if (AsyncResult.isSuccess(result) && result.value.revision === revision) {
        return result.value;
      }
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(`MCP projection did not reach revision ${revision}`);
  });
}

describe("MCP environment atoms", () => {
  it("keys projections and details by normalized complete selectors", () => {
    const runtime = Atom.runtime(Layer.empty) as Atom.AtomRuntime<
      EnvironmentRegistry.EnvironmentRegistry,
      never
    >;
    const atoms = createMcpEnvironmentAtoms(runtime);
    const projection = atoms.runtimeProjection({
      environmentId,
      input: { providerInstanceId, threadId, runtimeSessionId },
    });
    const details = atoms.runtimeServerDetailsQuery({
      environmentId,
      input: {
        providerInstanceId,
        threadId,
        runtimeSessionId,
        providerKey: McpRuntimeServerKey.make("notion"),
      },
    });

    expect(projection).toBe(
      atoms.runtimeProjection({
        environmentId,
        input: { runtimeSessionId, threadId, providerInstanceId },
      }),
    );
    expect(projection).not.toBe(
      atoms.runtimeProjection({
        environmentId,
        input: {
          providerInstanceId,
          threadId,
          runtimeSessionId: RuntimeSessionId.make("runtime-two"),
        },
      }),
    );
    expect(details).toBe(
      atoms.runtimeServerDetailsQuery({
        environmentId,
        input: {
          providerKey: McpRuntimeServerKey.make("notion"),
          runtimeSessionId,
          threadId,
          providerInstanceId,
        },
      }),
    );
  });

  it.effect("stores a complete accumulated runtime snapshot for late consumers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes: readonly McpRuntimeChange[] = [
          { type: "snapshot", snapshot: runtimeSnapshot(1, [runtimeServer("notion")]) },
          {
            type: "server-upserted",
            revision: 2,
            observedAt: "2026-08-03T10:00:02.000Z",
            server: runtimeServer("linear"),
          },
          {
            type: "server-removed",
            revision: 3,
            observedAt: "2026-08-03T10:00:03.000Z",
            providerKey: McpRuntimeServerKey.make("notion"),
          },
        ];
        const client = {
          [WS_METHODS.mcpRuntimeChanges]: () =>
            Stream.fromIterable(changes).pipe(Stream.concat(Stream.never)),
        } as unknown as WsRpcProtocolClient;
        const { supervisor } = yield* makeSupervisor(client);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime);
        const projection = atoms.runtimeProjection({
          environmentId,
          input: { providerInstanceId, threadId, runtimeSessionId },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );
        const unmount = registry.mount(projection);

        const current = yield* waitForRevision(registry, projection, 3);
        const lateUnmount = registry.mount(projection);
        const late = registry.get(projection);

        expect(current.servers.map((server) => server.providerKey)).toEqual(["linear"]);
        expect(AsyncResult.isSuccess(late)).toBe(true);
        if (AsyncResult.isSuccess(late)) {
          expect(late.value).toEqual(current);
        }
        lateUnmount();
        unmount();
      }),
    ),
  );

  it.effect("replaces accumulated runtime state after a lower-revision server restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = (value: McpRuntimeSnapshot) =>
          ({
            [WS_METHODS.mcpRuntimeChanges]: () =>
              Stream.make({ type: "snapshot", snapshot: value } satisfies McpRuntimeChange).pipe(
                Stream.concat(Stream.never),
              ),
          }) as unknown as WsRpcProtocolClient;
        const { supervisor, sessions } = yield* makeSupervisor(
          client(runtimeSnapshot(4, [runtimeServer("notion"), runtimeServer("linear")])),
        );
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime);
        const projection = atoms.runtimeProjection({
          environmentId,
          input: { providerInstanceId, threadId, runtimeSessionId },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );
        const unmount = registry.mount(projection);
        yield* waitForRevision(registry, projection, 4);

        yield* SubscriptionRef.set(
          sessions,
          Option.some(
            rpcSession(
              client(runtimeSnapshot(1, [runtimeServer("github")], "2026-08-03T10:00:04.000Z")),
            ),
          ),
        );
        let current: McpRuntimeSnapshot | undefined;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const result = registry.get(projection);
          if (AsyncResult.isSuccess(result) && result.value.servers[0]?.providerKey === "github") {
            current = result.value;
            break;
          }
          yield* Effect.yieldNow;
        }

        expect(current?.servers.map((server) => server.providerKey)).toEqual(["github"]);
        unmount();
      }),
    ),
  );

  it.effect("projects provider context lifecycle changes without polling", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const replacement = RuntimeSessionId.make("runtime-two");
        const changes: readonly McpRuntimeContextChange[] = [
          { type: "snapshot", snapshot: contextSnapshot(1, runtimeSessionId) },
          {
            type: "context-upserted",
            revision: 2,
            observedAt: "2026-08-03T10:00:02.000Z",
            context: contextSnapshot(2, replacement).contexts[0]!,
          },
          {
            type: "context-removed",
            revision: 3,
            observedAt: "2026-08-03T10:00:03.000Z",
            threadId,
            runtimeSessionId,
          },
        ];
        const client = {
          [WS_METHODS.mcpRuntimeContextChanges]: () =>
            Stream.fromIterable(changes).pipe(Stream.concat(Stream.never)),
        } as unknown as WsRpcProtocolClient;
        const { supervisor } = yield* makeSupervisor(client);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime);
        const projection = atoms.runtimeContextProjection({
          environmentId,
          input: { providerInstanceId },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );
        const unmount = registry.mount(projection);

        const current = yield* waitForRevision(registry, projection, 3);

        expect(current.contexts.map((context) => context.runtimeSessionId)).toEqual([replacement]);
        unmount();
      }),
    ),
  );

  it.effect("releases inactive runtime streams after the configured idle TTL", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let cleanups = 0;
        const client = {
          [WS_METHODS.mcpRuntimeChanges]: () =>
            Stream.make({
              type: "snapshot",
              snapshot: runtimeSnapshot(1, []),
            } satisfies McpRuntimeChange).pipe(
              Stream.concat(Stream.never),
              Stream.ensuring(
                Effect.sync(() => {
                  cleanups += 1;
                }),
              ),
            ),
        } as unknown as WsRpcProtocolClient;
        const { supervisor } = yield* makeSupervisor(client);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime, { liveIdleTtlMs: 0 });
        const projection = atoms.runtimeProjection({
          environmentId,
          input: { providerInstanceId, threadId, runtimeSessionId },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );
        const unmount = registry.mount(projection);
        yield* waitForRevision(registry, projection, 1);

        unmount();
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (cleanups > 0) break;
          yield* Effect.yieldNow;
        }

        expect(cleanups).toBe(1);
      }),
    ),
  );

  it.effect("serializes configuration mutations within one environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = deferredPromise();
        const starts: string[] = [];
        const client = {
          [WS_METHODS.mcpCreate]: (input: { readonly server: { readonly id: string } }) => {
            starts.push(input.server.id);
            const wait = input.server.id === "first" ? first.promise : Promise.resolve();
            return Effect.promise(() => wait).pipe(Effect.as({ servers: [] }));
          },
        } as unknown as WsRpcProtocolClient;
        const { supervisor } = yield* makeSupervisor(client);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime);
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );

        const firstRun = runAtomCommand(registry, atoms.create, {
          environmentId,
          input: { server: mcpDefinition("first") },
        });
        const secondRun = runAtomCommand(registry, atoms.create, {
          environmentId,
          input: { server: mcpDefinition("second") },
        });
        for (let attempt = 0; attempt < 100 && starts.length === 0; attempt += 1) {
          yield* Effect.yieldNow;
        }

        expect(starts).toEqual(["first"]);
        first.resolve();
        const results = yield* Effect.promise(() => Promise.all([firstRun, secondRun]));

        expect(results.every(AsyncResult.isSuccess)).toBe(true);
        expect(starts).toEqual(["first", "second"]);
      }),
    ),
  );

  it.effect("serializes runtime actions only for the same runtime and server target", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const notion = deferredPromise();
        const linear = deferredPromise();
        const starts: string[] = [];
        let notionCalls = 0;
        const client = {
          [WS_METHODS.mcpRuntimeAction]: (input: {
            readonly providerKey: ReturnType<typeof McpRuntimeServerKey.make>;
            readonly action: "refresh" | "reconnect" | "authorize";
          }) => {
            starts.push(input.providerKey);
            const isFirstNotion = input.providerKey === "notion" && notionCalls++ === 0;
            const wait = isFirstNotion
              ? notion.promise
              : input.providerKey === "linear"
                ? linear.promise
                : Promise.resolve();
            return Effect.promise(() => wait).pipe(
              Effect.as({
                accepted: true,
                action: input.action,
                providerKey: input.providerKey,
              }),
            );
          },
        } as unknown as WsRpcProtocolClient;
        const { supervisor } = yield* makeSupervisor(client);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createMcpEnvironmentAtoms(runtime);
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (value) =>
          Effect.sync(() => value.dispose()),
        );
        const action = (providerKey: string) => ({
          environmentId,
          input: {
            providerInstanceId,
            threadId,
            runtimeSessionId,
            providerKey: McpRuntimeServerKey.make(providerKey),
            action: "refresh" as const,
          },
        });

        const firstNotion = runAtomCommand(registry, atoms.runtimeAction, action("notion"));
        const secondNotion = runAtomCommand(registry, atoms.runtimeAction, action("notion"));
        const linearRun = runAtomCommand(registry, atoms.runtimeAction, action("linear"));
        for (let attempt = 0; attempt < 100 && starts.length < 2; attempt += 1) {
          yield* Effect.yieldNow;
        }

        expect(starts).toEqual(["notion", "linear"]);
        notion.resolve();
        linear.resolve();
        const results = yield* Effect.promise(() =>
          Promise.all([firstNotion, secondNotion, linearRun]),
        );

        expect(results.every(AsyncResult.isSuccess)).toBe(true);
        expect(starts).toEqual(["notion", "linear", "notion"]);
      }),
    ),
  );
});
