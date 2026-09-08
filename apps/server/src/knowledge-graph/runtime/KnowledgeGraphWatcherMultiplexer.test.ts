import { assert, it } from "@effect/vitest";
import { KnowledgeGraphScopeId, type KnowledgeGraphScopeV1 } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { makeKnowledgeGraphWatcherMultiplexer } from "./KnowledgeGraphWatcherMultiplexer.ts";

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
