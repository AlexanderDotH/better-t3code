import { RuntimeSessionId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionThreadSessionRepository } from "../Services/ProjectionThreadSessions.ts";
import { ProjectionThreadSessionRepositoryLive } from "./ProjectionThreadSessions.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadSessionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadSessionRepository", (it) => {
  it.effect("round-trips runtime identity and synchronized abort state", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadSessionRepository;
      const threadId = ThreadId.make("thread-aborting");
      const runtimeSessionId = RuntimeSessionId.make("runtime-session-1");
      const turnId = TurnId.make("turn-1");

      yield* repository.upsert({
        threadId,
        status: "running",
        providerName: "codex",
        providerInstanceId: null,
        runtimeSessionId,
        runtimeMode: "full-access",
        activeTurnId: turnId,
        abortState: {
          runtimeSessionId,
          targetTurnId: turnId,
          phase: "interrupting",
          requestedAt: "2026-07-30T00:00:00.000Z",
          forceAt: "2026-07-30T00:00:05.000Z",
        },
        lastError: null,
        updatedAt: "2026-07-30T00:00:00.000Z",
      });

      const persisted = Option.getOrThrow(yield* repository.getByThreadId({ threadId }));
      assert.strictEqual(persisted.runtimeSessionId, runtimeSessionId);
      assert.deepStrictEqual(persisted.abortState, {
        runtimeSessionId,
        targetTurnId: turnId,
        phase: "interrupting",
        requestedAt: "2026-07-30T00:00:00.000Z",
        forceAt: "2026-07-30T00:00:05.000Z",
      });
    }),
  );

  it.effect("round-trips the legacy-compatible null state", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadSessionRepository;
      const threadId = ThreadId.make("thread-without-abort");

      yield* repository.upsert({
        threadId,
        status: "ready",
        providerName: "codex",
        providerInstanceId: null,
        runtimeSessionId: null,
        runtimeMode: "full-access",
        activeTurnId: null,
        abortState: null,
        lastError: null,
        updatedAt: "2026-07-30T00:00:00.000Z",
      });

      const persisted = Option.getOrThrow(yield* repository.getByThreadId({ threadId }));
      assert.strictEqual(persisted.runtimeSessionId, null);
      assert.strictEqual(persisted.abortState, null);
    }),
  );
});
