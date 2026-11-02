import { ThreadId, TurnId, RunId, RunAttemptId, ProviderDriverKind } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

import { isCapturedExecutionQuiesced, isRunQuiesced } from "./GitWorkbenchRuntime.ts";
import { TurnQuiescenceNotifier, TurnQuiescenceNotifierLive } from "./TurnQuiescenceNotifier.ts";

it.layer(TurnQuiescenceNotifierLive)("TurnQuiescenceNotifier", (it) => {
  it.effect("broadcasts production quiescence events to every current subscriber", () =>
    Effect.gen(function* () {
      const notifier = yield* TurnQuiescenceNotifier;
      const first = yield* notifier.subscribe;
      const second = yield* notifier.subscribe;
      const event = {
        type: "turn.processing.quiesced",
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 3,
        createdAt: "2026-08-02T10:00:00.000Z",
      } as const;

      yield* notifier.publish(event);

      expect(yield* PubSub.take(first)).toEqual(event);
      expect(yield* PubSub.take(second)).toEqual(event);
    }),
  );
});

it("resolves real legacy native turn IDs and waits while a newer V2 run is active", () => {
  const id = RunId.make("captured-run");
  const attemptId = RunAttemptId.make("captured-attempt");
  const projection = {
    runs: [{ id, status: "completed" as const }],
    checkpoints: [{ runId: id, status: "ready" as const }],
    attempts: [{ id: attemptId, runId: id }],
    providerTurns: [
      {
        runAttemptId: attemptId,
        nativeTurnRef: {
          driver: ProviderDriverKind.make("codex"),
          nativeId: "actual-native-turn",
          strength: "strong" as const,
        },
      },
    ],
  };
  expect(isCapturedExecutionQuiesced(projection, id, "run")).toBe(true);
  expect(isCapturedExecutionQuiesced(projection, "actual-native-turn", "native-turn")).toBe(true);
  expect(isCapturedExecutionQuiesced(projection, id, "native-turn")).toBe(false);
  expect(isCapturedExecutionQuiesced(projection, "missing", "native-turn")).toBe(false);
  expect(isCapturedExecutionQuiesced(projection, "missing", "run")).toBe(false);
  const newer = RunId.make("newer-run");
  const busy = {
    ...projection,
    runs: [...projection.runs, { id: newer, status: "running" as const }],
  };
  expect(isCapturedExecutionQuiesced(busy, id, "run")).toBe(false);
  expect(isCapturedExecutionQuiesced(busy, "actual-native-turn", "native-turn")).toBe(false);
  const idle = {
    ...projection,
    runs: [...projection.runs, { id: newer, status: "completed" as const }],
  };
  expect(isCapturedExecutionQuiesced(idle, id, "run")).toBe(true);
});

it("waits for the V2 run and its checkpoint before releasing a queued Git workflow", () => {
  const id = RunId.make("run-1");
  for (const status of ["preparing", "queued", "starting", "running", "waiting"] as const) {
    expect(
      isRunQuiesced({ runs: [{ id, status }], checkpoints: [{ runId: id, status: "ready" }] }, id),
    ).toBe(false);
  }
  for (const status of ["missing", "error", "stale"] as const) {
    expect(
      isRunQuiesced(
        { runs: [{ id, status: "completed" }], checkpoints: [{ runId: id, status }] },
        id,
      ),
    ).toBe(false);
  }
  expect(isRunQuiesced({ runs: [{ id, status: "completed" }], checkpoints: [] }, id)).toBe(false);
  expect(
    isRunQuiesced(
      {
        runs: [{ id, status: "completed" }],
        checkpoints: [{ runId: RunId.make("other"), status: "ready" }],
      },
      id,
    ),
  ).toBe(false);
  for (const status of [
    "completed",
    "interrupted",
    "failed",
    "cancelled",
    "rolled_back",
  ] as const) {
    expect(
      isRunQuiesced({ runs: [{ id, status }], checkpoints: [{ runId: id, status: "ready" }] }, id),
    ).toBe(true);
  }
  expect(
    isRunQuiesced(
      {
        runs: [
          { id, status: "completed" },
          { id: RunId.make("next"), status: "running" },
        ],
        checkpoints: [{ runId: id, status: "ready" }],
      },
      id,
    ),
  ).toBe(false);
});
