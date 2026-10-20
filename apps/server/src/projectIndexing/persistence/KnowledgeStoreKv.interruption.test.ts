// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { DEFAULT_PROJECT_INDEX_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { vi } from "vite-plus/test";

import { openExistingKnowledgeKvStore } from "./KnowledgeStoreKv.ts";

const nativeIo = vi.hoisted(() => ({
  get: (): Promise<unknown> => Promise.resolve(undefined),
  closed: false,
}));

vi.mock("../../knowledge/KvKeys.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../knowledge/KvKeys.ts")>()),
  openKnowledgeKvDatabase: () => ({
    get: () => nativeIo.get(),
    close: () => {
      nativeIo.closed = true;
    },
  }),
}));

it.effect("drains an interrupted native read before closing its scoped database", () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-io-"))),
      (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
    );
    yield* Effect.promise(() =>
      NodeFSP.mkdir(NodePath.join(root, ".t3", "knowledge", "knowledge.rocksdb"), {
        recursive: true,
      }),
    );
    const canonicalRoot = yield* Effect.promise(() => NodeFSP.realpath(root));
    const state = {
      schemaVersion: 1,
      workspaceId: NodeCrypto.createHash("sha256").update(canonicalRoot).digest("hex"),
      revision: 0,
      publishedRevision: null,
      activeRevision: null,
      status: "idle",
      settings: DEFAULT_PROJECT_INDEX_SETTINGS,
      coverage: null,
      updatedAt: 0,
      lease: null,
    };
    const entered = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<unknown>();
    nativeIo.closed = false;
    nativeIo.get = () => {
      entered.resolve();
      return pending.promise;
    };
    const reading = yield* Effect.scoped(
      openExistingKnowledgeKvStore({ workspaceRoot: root }),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.promise(() => entered.promise);
    const interrupting = yield* Fiber.interrupt(reading).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    try {
      expect(nativeIo.closed).toBe(false);
    } finally {
      pending.resolve(state);
    }
    yield* Fiber.join(interrupting);
    expect(nativeIo.closed).toBe(true);
  }),
);
