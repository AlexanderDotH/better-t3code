import { assert, it } from "@effect/vitest";
import { KnowledgeGraphScopeId, type KnowledgeGraphScopeV1 } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { makeKnowledgeGraphWatcherMultiplexer } from "./KnowledgeGraphWatcherMultiplexer.ts";

class SyntheticWatcherFailure extends Data.TaggedError("SyntheticWatcherFailure")<{}> {}

function scope(scopeId: string, root: string): KnowledgeGraphScopeV1 {
  return {
    version: 1,
    scopeId: KnowledgeGraphScopeId.make(scopeId),
    environmentId: "environment-1" as KnowledgeGraphScopeV1["environmentId"],
    projectId: "project-1" as KnowledgeGraphScopeV1["projectId"],
    effectiveWorkspaceRoot: root,
    isWorktree: root !== "/repo",
  };
}

it.effect("multiplexes scopes by root and coalesces external edit bursts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ readonly path: string }>();
      const watchCalls: Array<{
        readonly root: string;
        readonly recursive: boolean | undefined;
      }> = [];
      const changes = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
      const firstChange = yield* Deferred.make<void>();
      const multiplexer = yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: "100 millis",
        watchWorkspaceRoot: (root, options) => {
          watchCalls.push({ root, recursive: options.recursive });
          return Stream.fromQueue(queue);
        },
      });
      const onChange = (scopes: ReadonlyArray<KnowledgeGraphScopeV1>) =>
        Ref.update(changes, (events) => [
          ...events,
          scopes.map(({ scopeId }) => String(scopeId)),
        ]).pipe(Effect.andThen(Deferred.succeed(firstChange, undefined)), Effect.asVoid);

      yield* multiplexer.reconcile(
        [scope("scope-main", "/repo"), scope("scope-alias", "/repo")],
        onChange,
      );
      yield* Effect.yieldNow;
      assert.deepStrictEqual(watchCalls, [{ root: "/repo", recursive: true }]);

      yield* Queue.offer(queue, { path: "/repo/.git/index" });
      yield* Queue.offer(queue, { path: "/repo/config/secrets/provider.json" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      assert.deepStrictEqual(yield* Ref.get(changes), []);

      yield* Queue.offer(queue, { path: "/repo/src/a.ts" });
      yield* Queue.offer(queue, { path: "/repo/src/b.ts" });
      yield* Queue.offer(queue, { path: "/repo/src/c.ts" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      yield* Deferred.await(firstChange);

      assert.deepStrictEqual(yield* Ref.get(changes), [["scope-alias", "scope-main"]]);
      assert.deepStrictEqual(yield* multiplexer.watchedRoots, ["/repo"]);

      yield* multiplexer.clear;
      assert.deepStrictEqual(yield* multiplexer.watchedRoots, []);
    }),
  ),
);

it.effect("restarts a failed root watcher before accepting later external edits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ readonly path: string }>();
      const changed = yield* Deferred.make<void>();
      let attempts = 0;
      const multiplexer = yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: "25 millis",
        watchWorkspaceRoot: () => {
          attempts += 1;
          return attempts === 1
            ? Stream.fail(new Error("native watcher closed"))
            : Stream.fromQueue(queue);
        },
      });

      yield* multiplexer.reconcile([scope("scope-main", "/repo")], () =>
        Deferred.succeed(changed, undefined).pipe(Effect.asVoid),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");

      assert.strictEqual(attempts, 2);
      yield* Queue.offer(queue, { path: "/repo/src/recovered.ts" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      yield* Deferred.await(changed);
    }),
  ),
);

it.effect("keeps index watchers active when the graph consumer is cleared", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ readonly path: string }>();
      const received = yield* Queue.unbounded<string>();
      let watchCalls = 0;
      const multiplexer = yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: "25 millis",
        watchWorkspaceRoot: () => {
          watchCalls += 1;
          return Stream.fromQueue(queue);
        },
      });
      yield* multiplexer.reconcile([scope("graph", "/repo")], (scopes) =>
        Queue.offer(received, `graph:${scopes.map((item) => item.scopeId).join(",")}`).pipe(
          Effect.asVoid,
        ),
      );
      yield* multiplexer.reconcile(
        [scope("index", "/repo")],
        (scopes) =>
          Queue.offer(received, `index:${scopes.map((item) => item.scopeId).join(",")}`).pipe(
            Effect.asVoid,
          ),
        "project-indexing",
      );
      yield* Effect.yieldNow;
      assert.strictEqual(watchCalls, 1);

      yield* Queue.offer(queue, { path: "/repo/src/first.ts" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      assert.strictEqual(yield* Queue.take(received), "graph:graph");
      assert.strictEqual(yield* Queue.take(received), "index:index");

      yield* multiplexer.clear;
      assert.deepStrictEqual(yield* multiplexer.watchedRoots, ["/repo"]);
      yield* Queue.offer(queue, { path: "/repo/src/second.ts" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      assert.strictEqual(yield* Queue.take(received), "index:index");
      assert.strictEqual(yield* Queue.size(received), 0);
      yield* multiplexer.reconcile([], () => Effect.void, "project-indexing");
      assert.deepStrictEqual(yield* multiplexer.watchedRoots, []);
    }),
  ),
);

it.effect("recognizes index metadata without observing private or generated index writes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ readonly path: string }>();
      const received = yield* Queue.unbounded<void>();
      const multiplexer = yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: "25 millis",
        watchWorkspaceRoot: () => Stream.fromQueue(queue),
      });
      yield* multiplexer.reconcile(
        [scope("index", "/repo")],
        () => Queue.offer(received, undefined).pipe(Effect.asVoid),
        "project-indexing",
      );
      yield* Effect.yieldNow;
      for (const path of [
        "/repo/.t3/knowledge/INDEX.md",
        "/repo/.t3/knowledge/.gitignore",
        "/repo/.t3/worktrees/app/obj/project.assets.json",
        "/repo/node_modules/example/.editorconfig",
        "/repo/config/secrets/.gitignore",
        "/repo/.agents/secrets/token.json",
        "/repo/.git/HEAD.lock",
        "/outside/.editorconfig",
      ]) {
        yield* Queue.offer(queue, { path });
      }
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      assert.strictEqual(yield* Queue.size(received), 0);

      for (const path of [
        "/repo/.git/HEAD",
        "/repo/.git/index",
        "/repo/.git/refs/heads/feature",
        "/repo/src/.editorconfig",
        "/repo/src/.agents/rules/style.md",
        "/repo/src/obj/project.assets.json",
      ]) {
        yield* Queue.offer(queue, { path });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("25 millis");
        yield* Queue.take(received);
      }
    }),
  ),
);

it.effect("isolates failed consumers so index invalidation still receives changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<{ readonly path: string }>();
      const changed = yield* Deferred.make<void>();
      const multiplexer = yield* makeKnowledgeGraphWatcherMultiplexer({
        debounce: "25 millis",
        watchWorkspaceRoot: () => Stream.fromQueue(queue),
      });
      yield* multiplexer.reconcile([scope("graph", "/repo")], () =>
        Effect.fail(new SyntheticWatcherFailure()),
      );
      yield* multiplexer.reconcile(
        [scope("index", "/repo")],
        () => Deferred.succeed(changed, undefined).pipe(Effect.asVoid),
        "project-indexing",
      );
      yield* Effect.yieldNow;
      yield* Queue.offer(queue, { path: "/repo/src/changed.ts" });
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      yield* Deferred.await(changed);
    }),
  ),
);
