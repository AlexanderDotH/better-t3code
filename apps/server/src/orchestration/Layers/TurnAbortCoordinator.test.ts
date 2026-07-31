import {
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  ProviderService,
  type ProviderAbortTarget,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import { TurnAbortCoordinator } from "../Services/TurnAbortCoordinator.ts";
import { TurnAbortCoordinatorLive } from "./TurnAbortCoordinator.ts";

const threadId = ThreadId.make("thread-abort");
const turnId = TurnId.make("turn-abort");
const runtimeSessionId = RuntimeSessionId.make("runtime-abort-1");
const providerInstanceId = ProviderInstanceId.make("codex");
const requestedAt = "1970-01-01T00:00:00.000Z";

function makeThread(session: OrchestrationSession | null): OrchestrationThread {
  return {
    id: threadId,
    runtimeMode: "full-access",
    session,
  } as OrchestrationThread;
}

function runningSession(runtimeId: RuntimeSessionId = runtimeSessionId): OrchestrationSession {
  return {
    threadId,
    status: "running",
    providerName: "codex",
    providerInstanceId,
    runtimeSessionId: runtimeId,
    runtimeMode: "full-access",
    activeTurnId: turnId,
    abortState: null,
    lastError: null,
    updatedAt: requestedAt,
  };
}

const makeHarness = (initialSession: OrchestrationSession | null = runningSession()) =>
  Effect.gen(function* () {
    const sessionRef = yield* Ref.make<OrchestrationSession | null>(initialSession);
    const currentRuntimeRef = yield* Ref.make<RuntimeSessionId>(runtimeSessionId);
    const commandsRef = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    const resolveAbortTarget = vi.fn<ProviderServiceShape["resolveAbortTarget"]>((input) =>
      Effect.succeed({
        threadId,
        runtimeSessionId,
        turnId: input.turnId ?? null,
        providerInstanceId,
      }),
    );
    const interruptAbortTarget = vi.fn<ProviderServiceShape["interruptAbortTarget"]>(
      () => Effect.never,
    );
    const forceStopAbortTarget = vi.fn<ProviderServiceShape["forceStopAbortTarget"]>(() =>
      Effect.succeed({
        outcome: "terminated",
        mechanism: "process-tree",
      }),
    );

    const providerService = {
      resolveAbortTarget,
      interruptAbortTarget,
      forceStopAbortTarget,
      isAbortTargetCurrent: (candidate: ProviderAbortTarget) =>
        Ref.get(currentRuntimeRef).pipe(
          Effect.map((current) => current === candidate.runtimeSessionId),
        ),
    } as unknown as ProviderServiceShape;

    let sequence = 0;
    const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
      Effect.gen(function* () {
        yield* Ref.update(commandsRef, (commands) => [...commands, command]);
        if (command.type === "thread.session.set") {
          yield* Ref.set(sessionRef, command.session);
        }
        if (command.type === "thread.turn.abort.settle") {
          const current = yield* Ref.get(sessionRef);
          if (
            current?.abortState?.runtimeSessionId === command.runtimeSessionId &&
            current.abortState.targetTurnId === command.turnId
          ) {
            const forced = command.outcome !== "cooperative";
            yield* Ref.set(sessionRef, {
              ...current,
              status:
                command.outcome === "cooperative"
                  ? "ready"
                  : command.outcome === "force-failed"
                    ? "error"
                    : "stopped",
              runtimeSessionId: forced ? null : current.runtimeSessionId,
              activeTurnId: null,
              abortState: null,
              updatedAt: command.settledAt,
            });
          }
        }
        sequence += 1;
        return { sequence };
      });

    const engine = {
      dispatch,
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    } satisfies OrchestrationEngineShape;

    const query = {
      getThreadDetailById: () =>
        Ref.get(sessionRef).pipe(Effect.map((session) => Option.some(makeThread(session)))),
    } as unknown as ProjectionSnapshotQueryShape;

    const layer = TurnAbortCoordinatorLive.pipe(
      Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
      Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
      Layer.provideMerge(NodeServices.layer),
    );

    return {
      layer,
      sessionRef,
      currentRuntimeRef,
      commandsRef,
      resolveAbortTarget,
      interruptAbortTarget,
      forceStopAbortTarget,
    };
  });

it.effect("force-stops at 5000ms after the initiating request scope closes", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* Effect.scoped(coordinator.requestAbort({ threadId, turnId, requestedAt }));
      yield* Effect.yieldNow;

      yield* TestClock.adjust("4999 millis");
      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 0);

      yield* TestClock.adjust("1 millis");
      yield* Effect.yieldNow;
      assert.strictEqual(harness.interruptAbortTarget.mock.calls.length, 1);
      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 1);
      assert.strictEqual((yield* Ref.get(harness.sessionRef))?.status, "stopped");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("arms the watchdog while provider startup has a lease but no projection yet", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(null);
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* coordinator.requestAbort({ threadId, requestedAt });
      yield* Effect.yieldNow;

      const stopping = yield* Ref.get(harness.sessionRef);
      assert.strictEqual(stopping?.status, "starting");
      assert.deepEqual(stopping?.abortState, {
        runtimeSessionId,
        targetTurnId: null,
        phase: "interrupting",
        requestedAt,
        forceAt: "1970-01-01T00:00:05.000Z",
      });

      yield* TestClock.adjust("5 seconds");
      yield* Effect.yieldNow;
      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("force-stops immediately on the second click for the same runtime and turn", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* coordinator.requestAbort({ threadId, turnId, requestedAt });
      yield* coordinator.requestAbort({ threadId, turnId, requestedAt });
      yield* Effect.yieldNow;

      assert.strictEqual(harness.resolveAbortTarget.mock.calls.length, 2);
      assert.strictEqual(harness.interruptAbortTarget.mock.calls.length, 1);
      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 1);
      assert.strictEqual((yield* Ref.get(harness.sessionRef))?.status, "stopped");
      const commands = yield* Ref.get(harness.commandsRef);
      assert.strictEqual(
        commands.filter((command) => command.type === "thread.session.set").length,
        2,
      );
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("force-stops exactly once when the second click races the watchdog", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* coordinator.requestAbort({ threadId, turnId, requestedAt });
      yield* TestClock.adjust("4999 millis");

      yield* Effect.all(
        [coordinator.requestAbort({ threadId, turnId, requestedAt }), TestClock.adjust("1 millis")],
        { concurrency: "unbounded", discard: true },
      );
      yield* Effect.yieldNow;

      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 1);
      assert.strictEqual((yield* Ref.get(harness.sessionRef))?.status, "stopped");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("does not force-stop a replacement runtime generation", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* coordinator.requestAbort({ threadId, turnId, requestedAt });
      yield* Effect.yieldNow;

      const replacementId = RuntimeSessionId.make("runtime-abort-2");
      yield* Ref.set(harness.currentRuntimeRef, replacementId);
      yield* Ref.set(harness.sessionRef, runningSession(replacementId));

      yield* TestClock.adjust("5 seconds");
      yield* Effect.yieldNow;
      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 0);
      assert.strictEqual((yield* Ref.get(harness.sessionRef))?.runtimeSessionId, replacementId);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("matching cooperative settlement cancels force escalation", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const coordinator = yield* TurnAbortCoordinator;
      yield* coordinator.requestAbort({ threadId, turnId, requestedAt });
      yield* Effect.yieldNow;

      assert.strictEqual(
        yield* coordinator.settleCooperative({
          threadId,
          runtimeSessionId,
          turnId,
          settledAt: "1970-01-01T00:00:03.000Z",
        }),
        true,
      );
      yield* TestClock.adjust("10 seconds");
      yield* Effect.yieldNow;

      assert.strictEqual(harness.forceStopAbortTarget.mock.calls.length, 0);
      assert.strictEqual((yield* Ref.get(harness.sessionRef))?.abortState, null);
    }).pipe(Effect.provide(harness.layer));
  }),
);
