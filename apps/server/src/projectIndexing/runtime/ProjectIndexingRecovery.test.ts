import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectIndexingRecovery from "./ProjectIndexingRecovery.ts";
import * as ProjectIndexingRuntime from "./ProjectIndexingRuntime.ts";

it.effect("makes server layers available while project indexing recovers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const finished = yield* Deferred.make<void>();
      const recover = Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Deferred.succeed(finished, undefined)),
        Effect.asVoid,
      );
      const layer = ProjectIndexingRecovery.layer.pipe(
        Layer.provide(Layer.mock(ProjectIndexingRuntime.ProjectIndexingRuntime)({ recover })),
      );

      yield* Layer.build(layer);
      yield* Deferred.await(started);
      assert.isFalse(yield* Deferred.isDone(finished));

      yield* Deferred.succeed(release, undefined);
      yield* Deferred.await(finished);
    }),
  ),
);
