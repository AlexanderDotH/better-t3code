import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import {
  FORCE_ABORT_GRACE_PERIOD,
  makeProviderTurnAbortCoordinator,
  type ProviderAbortControl,
} from "./ProviderTurnAbortCoordinator.ts";
import type { ProviderAbortTarget } from "../Services/ProviderService.ts";

const target: ProviderAbortTarget = {
  threadId: ThreadId.make("thread-1"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: "provider-session-1",
  turnGeneration: "provider-turn-1",
};

function makeControl() {
  const interrupted: ProviderAbortTarget[] = [];
  const forced: ProviderAbortTarget[] = [];
  let activeTarget: ProviderAbortTarget | null = target;

  const control: ProviderAbortControl = {
    captureAbortTarget: () => Effect.succeed(activeTarget),
    interruptAbortTarget: (captured) =>
      Effect.sync(() => {
        interrupted.push(captured);
      }),
    forceStopAbortTarget: (captured) =>
      Effect.sync(() => {
        if (
          activeTarget?.providerSessionId !== captured.providerSessionId ||
          activeTarget.turnGeneration !== captured.turnGeneration
        ) {
          return "target-changed" as const;
        }
        forced.push(captured);
        activeTarget = null;
        return "forced" as const;
      }),
  };

  return {
    control,
    interrupted,
    forced,
    replaceTarget: (next: ProviderAbortTarget | null) => {
      activeTarget = next;
    },
  };
}

it.effect("force-stops the same turn after the five-second cancellation grace period", () => {
  const fixture = makeControl();

  return Effect.gen(function* () {
    const coordinator = yield* makeProviderTurnAbortCoordinator({
      abortControl: fixture.control,
    });

    yield* coordinator.requestAbort({
      threadId: target.threadId,
      turnId: TurnId.make("orchestration-turn-1"),
    });
    yield* Effect.yieldNow;

    assert.strictEqual(fixture.interrupted.length, 1);
    assert.strictEqual(fixture.forced.length, 0);

    yield* TestClock.adjust(Duration.subtract(FORCE_ABORT_GRACE_PERIOD, Duration.millis(1)));
    yield* Effect.yieldNow;
    assert.strictEqual(fixture.forced.length, 0);

    yield* TestClock.adjust(Duration.millis(1));
    yield* Effect.yieldNow;
    assert.strictEqual(fixture.forced.length, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));
});

it.effect("a second click force-stops immediately without waiting for the deadline", () => {
  const fixture = makeControl();

  return Effect.gen(function* () {
    const coordinator = yield* makeProviderTurnAbortCoordinator({
      abortControl: fixture.control,
    });
    const turnId = TurnId.make("orchestration-turn-1");

    yield* coordinator.requestAbort({ threadId: target.threadId, turnId });
    yield* coordinator.forceAbort({ threadId: target.threadId, turnId });
    yield* Effect.yieldNow;

    assert.strictEqual(fixture.forced.length, 1);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));
});

it.effect("does not kill a replacement provider session when the deadline expires", () => {
  const fixture = makeControl();

  return Effect.gen(function* () {
    const coordinator = yield* makeProviderTurnAbortCoordinator({
      abortControl: fixture.control,
    });

    yield* coordinator.requestAbort({
      threadId: target.threadId,
      turnId: TurnId.make("orchestration-turn-1"),
    });
    fixture.replaceTarget({
      ...target,
      providerSessionId: "provider-session-2",
      turnGeneration: "provider-turn-2",
    });

    yield* TestClock.adjust(FORCE_ABORT_GRACE_PERIOD);
    yield* Effect.yieldNow;

    assert.strictEqual(fixture.forced.length, 0);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));
});
