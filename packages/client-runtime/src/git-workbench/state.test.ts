import { EnvironmentId, WS_METHODS, type GitWorkbenchStreamEvent } from "@t3tools/contracts";
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
import { createGitWorkbenchEnvironmentAtoms } from "./state.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const TARGET = new PrimaryConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const CONNECTED: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};

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
  const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const runStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["runStream"] = (
    _environmentId,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
    _environmentId,
    stream,
  ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
  return EnvironmentRegistry.EnvironmentRegistry.of({
    run,
    runStream,
    followStream,
  } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
}

function snapshotEvent(stateToken: string): GitWorkbenchStreamEvent {
  return {
    _tag: "snapshot",
    snapshot: {
      isRepository: true,
      registeredCwd: "/repo",
      repositoryRoot: "/repo",
      worktreeRoot: "/repo",
      gitCommonDir: "/repo/.git",
      refName: "main",
      upstreamRef: "origin/main",
      headOid: "a".repeat(40),
      unborn: false,
      detached: false,
      aheadCount: 0,
      behindCount: 0,
      files: [],
      totals: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        insertions: 0,
        deletions: 0,
      },
      operation: { kind: "none" },
      truncated: false,
      generatedAt: "2026-08-02T12:00:00.000Z",
      stateToken,
    },
    queuedWorkflow: null,
    undoSnapshots: [],
  };
}

describe("Git workbench environment atoms", () => {
  it.effect("starts the detailed subscription lazily and follows replacement sessions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const subscriptions: string[] = [];
        const cleanups: string[] = [];
        const client = (name: string, stateToken: string) =>
          ({
            [WS_METHODS.gitSubscribeWorkbench]: () => {
              subscriptions.push(name);
              return Stream.make(snapshotEvent(stateToken)).pipe(
                Stream.concat(Stream.never),
                Stream.ensuring(
                  Effect.sync(() => {
                    cleanups.push(name);
                  }),
                ),
              );
            },
          }) as unknown as WsRpcProtocolClient;
        const sessions = yield* SubscriptionRef.make(
          Option.some(rpcSession(client("first", "token-1"))),
        );
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(CONNECTED),
          session: sessions,
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createGitWorkbenchEnvironmentAtoms(runtime);
        const state = atoms.workbench({
          environmentId: ENVIRONMENT_ID,
          input: { cwd: "/repo" },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
          Effect.sync(() => registry.dispose()),
        );

        expect(subscriptions).toEqual([]);
        const unmount = registry.mount(state);
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (AsyncResult.isSuccess(registry.get(state))) break;
          yield* Effect.yieldNow;
        }
        const first = registry.get(state);
        expect(AsyncResult.isSuccess(first)).toBe(true);
        if (!AsyncResult.isSuccess(first)) return;
        expect(first.value.snapshot?.stateToken).toBe("token-1");
        expect(subscriptions).toEqual(["first"]);

        yield* SubscriptionRef.set(sessions, Option.some(rpcSession(client("second", "token-2"))));
        for (let attempt = 0; attempt < 100 && subscriptions.length < 2; attempt += 1) {
          yield* Effect.yieldNow;
        }
        expect(subscriptions).toEqual(["first", "second"]);
        expect(cleanups).toContain("first");

        unmount();
      }),
    ),
  );

  it.effect("cancels a stale insights request and revalidates after reconnect", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        let interruptions = 0;
        const insights = {
          snapshotOid: "b".repeat(40),
          windowStart: "2025-08-02T00:00:00.000Z",
          windowEnd: "2026-08-02T00:00:00.000Z",
          scannedCommits: 0,
          truncated: false,
          contributors: [],
          activity: [],
          codeMix: {
            entries: [],
            trackedFileCount: 0,
            classifiedFileCount: 0,
            excludedFileCount: 0,
            scannedFileCount: 0,
            truncated: false,
          },
        } as const;
        const client = {
          [WS_METHODS.gitGetRepositoryInsights]: () => {
            calls += 1;
            return calls === 1
              ? Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interruptions += 1;
                    }),
                  ),
                )
              : Effect.succeed(insights);
          },
        } as unknown as WsRpcProtocolClient;
        const connection = yield* SubscriptionRef.make(CONNECTED);
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: connection,
          session: yield* SubscriptionRef.make(Option.some(rpcSession(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry(supervisor)),
        );
        const atoms = createGitWorkbenchEnvironmentAtoms(runtime);
        const state = atoms.insights({
          environmentId: ENVIRONMENT_ID,
          input: { cwd: "/repo" },
        });
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
          Effect.sync(() => registry.dispose()),
        );
        const unmount = registry.mount(state);

        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (calls > 0) break;
          yield* Effect.yieldNow;
        }
        yield* SubscriptionRef.set(connection, { ...CONNECTED, generation: 2 });
        const result = yield* AtomRegistry.getResult(registry, state, { suspendOnWaiting: true });

        expect(result).toEqual(insights);
        expect(calls).toBe(2);
        expect(interruptions).toBe(1);
        unmount();
      }),
    ),
  );

  it("keys history and file queries by environment, snapshot, cursor, and path", () => {
    const runtime = Atom.runtime(Layer.empty) as Atom.AtomRuntime<
      EnvironmentRegistry.EnvironmentRegistry,
      never
    >;
    const atoms = createGitWorkbenchEnvironmentAtoms(runtime);
    const base = {
      environmentId: ENVIRONMENT_ID,
      input: {
        cwd: "/repo",
        snapshotOid: "a".repeat(40),
        cursor: 0,
        limit: 50,
        path: "src/main.ts",
      },
    } as const;

    expect(atoms.history(base)).toBe(
      atoms.history({
        environmentId: ENVIRONMENT_ID,
        input: {
          path: "src/main.ts",
          limit: 50,
          cursor: 0,
          snapshotOid: "a".repeat(40),
          cwd: "/repo",
        },
      }),
    );
    expect(atoms.history(base)).not.toBe(
      atoms.history({ ...base, input: { ...base.input, cursor: 50 } }),
    );
    expect(atoms.history(base)).not.toBe(
      atoms.history({ ...base, input: { ...base.input, path: "src/other.ts" } }),
    );
    expect(atoms.history(base)).not.toBe(
      atoms.history({
        ...base,
        environmentId: EnvironmentId.make("environment-2"),
      }),
    );
  });
});
