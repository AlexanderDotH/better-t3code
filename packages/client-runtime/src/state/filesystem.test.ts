import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

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

import {
  FILESYSTEM_BROWSE_REFRESH_INTERVAL_MS,
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  createFilesystemEnvironmentAtoms,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "./filesystem.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("filesystem-test-environment"),
  label: "Filesystem test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

describe("filesystem browse model", () => {
  it("derives the browse target and navigation state", () => {
    expect(getFilesystemBrowsePath("~/projects/t3")).toEqual({
      isBrowsing: true,
      directoryPath: "~/projects/",
      filterQuery: "t3",
      parentPath: "~/",
      canBrowseUp: true,
    });
    expect(getFilesystemBrowsePath("C:\\Users\\test", "MacIntel").isBrowsing).toBe(false);
    expect(getFilesystemBrowsePath("~/projects/", "", false).isBrowsing).toBe(false);
  });

  it("filters names, hidden directories, and exact matches consistently", () => {
    const entries = [
      { name: ".config", fullPath: "/Users/test/.config" },
      { name: "Code", fullPath: "/Users/test/Code" },
      { name: "codething", fullPath: "/Users/test/codething" },
    ];

    expect(filterFilesystemBrowseEntries(entries, "co")).toEqual({
      visibleEntries: entries.slice(1, 3),
      exactEntry: null,
    });
    expect(filterFilesystemBrowseEntries(entries, "").visibleEntries).toEqual(entries.slice(1));
    expect(filterFilesystemBrowseEntries(entries, ".").visibleEntries).toEqual(entries.slice(0, 1));
    expect(filterFilesystemBrowseEntries(entries, "Code").exactEntry).toEqual(entries[1]);
  });
});

describe("browse navigation", () => {
  it("only commits the latest valid navigation", async () => {
    const navigation = createBrowseNavigationCoordinator();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const commits: string[] = [];
    const commit = (name: string) => () => commits.push(name);
    const firstRun = navigation.run(() => first.promise, commit("first"));
    const secondRun = navigation.run(() => second.promise, commit("second"));

    second.resolve();
    await expect(secondRun).resolves.toBe(true);
    first.resolve();
    await expect(firstRun).resolves.toBe(false);

    const invalidated = Promise.withResolvers<void>();
    const invalidatedRun = navigation.run(() => invalidated.promise, commit("stale"));
    navigation.invalidate();
    invalidated.resolve();

    await expect(invalidatedRun).resolves.toBe(false);
    expect(commits).toEqual(["second"]);
  });

  it("only preloads connected environments", () => {
    expect(canPreloadBrowsePath("connected")).toBe(true);
    expect(canPreloadBrowsePath("offline")).toBe(false);
    expect(canPreloadBrowsePath("reconnecting")).toBe(false);
    expect(canPreloadBrowsePath(null)).toBe(false);
  });
});

describe("filesystem browse queries", () => {
  effectIt.effect("refreshes the visible directory while the picker remains mounted", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      let requests = 0;
      let folderExists = false;
      const client = {
        [WS_METHODS.filesystemBrowse]: () =>
          Effect.sync(() => {
            requests += 1;
            return {
              parentPath: "/work",
              entries: folderExists ? [{ name: "new-folder", fullPath: "/work/new-folder" }] : [],
            };
          }),
      } as unknown as WsRpcProtocolClient;
      const connectionState: SupervisorConnectionState = {
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        network: "online",
        phase: "connected",
        attempt: 1,
        generation: 1,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(connectionState),
        session: yield* SubscriptionRef.make(Option.some(session(client))),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const run: EnvironmentRegistry.EnvironmentRegistry["Service"]["run"] = (
        _environmentId,
        effect,
      ) => Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
      const followStream: EnvironmentRegistry.EnvironmentRegistry["Service"]["followStream"] = (
        _environmentId,
        stream,
      ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
      const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
        run,
        followStream,
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]);
      const runtime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
      );
      const atom = createFilesystemEnvironmentAtoms(runtime).browse({
        environmentId: TARGET.environmentId,
        input: { partialPath: "/work/" },
      });
      const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
        Effect.sync(() => registry.dispose()),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => registry.mount(atom)),
        (unmount) => Effect.sync(unmount),
      );

      const first = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
      expect(first.entries).toEqual([]);
      expect(requests).toBe(1);

      folderExists = true;
      yield* Effect.promise(() =>
        vi.advanceTimersByTimeAsync(FILESYSTEM_BROWSE_REFRESH_INTERVAL_MS),
      );
      const refreshed = yield* AtomRegistry.getResult(registry, atom, {
        suspendOnWaiting: true,
      });
      expect(refreshed.entries).toEqual([{ name: "new-folder", fullPath: "/work/new-folder" }]);
      expect(requests).toBe(2);
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.useRealTimers()))),
  );
});
