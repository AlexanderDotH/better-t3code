import {
  EventId,
  MessageId,
  ProviderDriverKind,
  RuntimeSessionId,
  RuntimeItemId,
  SubagentId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { it, expect } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import {
  ASSISTANT_TEXT_BATCH_MAX_BYTES,
  makeAssistantTextBatcher,
  type AssistantTextBatch,
  type AssistantTextBatcher,
  type AssistantTextFlushInput,
} from "./assistantTextBatcher.ts";

type ContentDeltaEvent = Extract<ProviderRuntimeEvent, { type: "content.delta" }>;
type Input =
  | { readonly kind: "delta"; readonly event: ContentDeltaEvent; readonly messageId: MessageId }
  | { readonly kind: "flush"; readonly input: AssistantTextFlushInput }
  | { readonly kind: "boundary"; readonly event: ProviderRuntimeEvent };

function delta(
  eventId: string,
  text: string,
  overrides: Partial<ContentDeltaEvent> = {},
): ContentDeltaEvent {
  return {
    type: "content.delta",
    eventId: EventId.make(eventId),
    provider: ProviderDriverKind.make("codex"),
    threadId: ThreadId.make("thread-1"),
    turnId: TurnId.make("turn-1"),
    runtimeSessionId: RuntimeSessionId.make("session-1"),
    itemId: RuntimeItemId.make("item-1"),
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: { streamKind: "assistant_text", delta: text },
    ...overrides,
  };
}

const makeHarness = Effect.fnUntraced(function* () {
  const batches: AssistantTextBatch[] = [];
  const clock = yield* Clock.Clock;
  let timerStarts = 0;
  let activeTimers = 0;
  const trackedClock: Clock.Clock = {
    ...clock,
    sleep: (duration) =>
      Effect.suspend(() => {
        timerStarts += 1;
        activeTimers += 1;
        return clock.sleep(duration).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              activeTimers -= 1;
            }),
          ),
        );
      }),
  };
  const timerInputs = yield* Queue.unbounded<AssistantTextFlushInput>();
  const batcher: AssistantTextBatcher = yield* makeAssistantTextBatcher(
    (input): Effect.Effect<void> =>
      worker
        .enqueue({ kind: "flush", input })
        .pipe(Effect.andThen(Queue.offer(timerInputs, input)), Effect.asVoid),
  );
  const worker = yield* makeDrainableWorker((input: Input) =>
    Effect.gen(function* () {
      const ready =
        input.kind === "delta"
          ? yield* batcher.append(input.event, input.messageId)
          : input.kind === "flush"
            ? yield* batcher.flush(input.input)
            : yield* batcher.flushBefore(input.event);
      batches.push(...ready);
    }).pipe(Effect.provideService(Clock.Clock, trackedClock)),
  );
  const append = (event: ContentDeltaEvent, messageId = MessageId.make("assistant:item-1")) =>
    worker.enqueue({ kind: "delta", event, messageId }).pipe(Effect.andThen(worker.drain));
  const boundary = (event: ProviderRuntimeEvent) =>
    worker.enqueue({ kind: "boundary", event }).pipe(Effect.andThen(worker.drain));
  const drain = Effect.gen(function* () {
    yield* worker.drain;
    for (const input of yield* batcher.pendingFlushes) {
      yield* worker.enqueue({ kind: "flush", input: { ...input, reason: "drain" } });
    }
    yield* worker.drain;
  });
  return {
    append,
    boundary,
    batches,
    timerInputs,
    worker,
    batcher,
    drain,
    timerStarts: () => timerStarts,
    activeTimers: () => activeTimers,
  };
});

it.effect("delivers the first chunk immediately and waits 50ms to batch later chunks", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.append(delta("first", "Hello"));
    expect(harness.batches.map((batch) => batch.text)).toEqual(["Hello"]);
    expect(harness.timerStarts()).toBe(0);
    expect(harness.activeTimers()).toBe(0);

    yield* harness.append(delta("second", " "));
    yield* harness.append(delta("third", "world"));
    expect(harness.batches).toHaveLength(1);
    yield* TestClock.adjust("49 millis");
    yield* harness.worker.drain;
    expect(harness.batches).toHaveLength(1);
    yield* TestClock.adjust("1 millis");
    yield* Queue.take(harness.timerInputs);
    yield* harness.worker.drain;
    expect(harness.batches.map((batch) => batch.text)).toEqual(["Hello", " world"]);
    expect(harness.batches[1]).toMatchObject({ reason: "timer", deltaCount: 2, byteLength: 6 });
    expect(harness.activeTimers()).toBe(0);
  }).pipe(Effect.scoped),
);

it.effect("flushes at 16KiB of UTF8 text and preserves split surrogate pairs", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.append(delta("first", "Start"));
    yield* harness.append(delta("ascii", "a".repeat(ASSISTANT_TEXT_BATCH_MAX_BYTES - 4)));
    yield* harness.append(delta("high-surrogate", "\ud83d"));
    expect(harness.batches).toHaveLength(1);
    yield* harness.append(delta("low-surrogate", "\ude00"));
    expect(harness.batches[1]).toMatchObject({
      reason: "size",
      deltaCount: 3,
      byteLength: ASSISTANT_TEXT_BATCH_MAX_BYTES,
      text: "a".repeat(ASSISTANT_TEXT_BATCH_MAX_BYTES - 4) + "😀",
    });
    expect(harness.activeTimers()).toBe(0);
    yield* harness.drain;
    expect(harness.batches).toHaveLength(2);
  }).pipe(Effect.scoped),
);

it.effect("keeps thread and subagent text independent", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    const targets = [
      {},
      { threadId: ThreadId.make("thread-2") },
      { subagentId: SubagentId.make("child-a") },
      { subagentId: SubagentId.make("child-b") },
    ];
    for (const [index, target] of targets.entries()) {
      yield* harness.append(delta(`first-${index}`, `first ${index}`, target));
      yield* harness.append(delta(`second-${index}`, ` + tail ${index}`, target));
    }
    expect(harness.batches).toHaveLength(4);
    yield* harness.drain;
    expect(harness.batches.slice(4).map((batch) => batch.text)).toEqual([
      " + tail 0",
      " + tail 1",
      " + tail 2",
      " + tail 3",
    ]);
    expect(harness.batches.map((batch) => batch.commandId)).toHaveLength(
      new Set(harness.batches.map((batch) => batch.commandId)).size,
    );
    expect(harness.activeTimers()).toBe(0);
  }).pipe(Effect.scoped),
);

it.effect("flushes before a role, message, segment or turn changes", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.append(delta("first", "A"));
    yield* harness.append(delta("pending-a", "a"));
    yield* harness.boundary(
      delta("reasoning", "thinking", {
        payload: { streamKind: "reasoning_text", delta: "thinking" },
      }),
    );
    expect(harness.batches.map((batch) => batch.text)).toEqual(["A", "a"]);
    yield* harness.append(delta("pending-b", "b"));
    yield* harness.append(delta("new-message", "B"), MessageId.make("assistant:item-2"));
    yield* harness.append(delta("pending-c", "c"), MessageId.make("assistant:item-2"));
    yield* harness.append(
      delta("new-segment", "C", {
        payload: { streamKind: "assistant_text", delta: "C", contentIndex: 1 },
      }),
      MessageId.make("assistant:item-2"),
    );
    yield* harness.append(
      delta("pending-d", "d", {
        payload: { streamKind: "assistant_text", delta: "d", contentIndex: 1 },
      }),
      MessageId.make("assistant:item-2"),
    );
    yield* harness.append(delta("new-turn", "D", { turnId: TurnId.make("turn-2") }));
    expect(harness.batches.map((batch) => batch.text)).toEqual([
      "A",
      "a",
      "b",
      "B",
      "c",
      "C",
      "d",
      "D",
    ]);
    expect(harness.activeTimers()).toBe(0);
  }).pipe(Effect.scoped),
);

it.effect("ignores an old timer input after a new turn has buffered text", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.append(delta("old-first", "Old"));
    yield* harness.append(delta("old-tail", " tail"));
    const [oldInput] = yield* harness.batcher.pendingFlushes;
    expect(oldInput).toBeDefined();
    yield* harness.boundary({
      ...delta("completed", ""),
      type: "turn.completed",
      payload: { state: "completed" },
    });
    yield* harness.append(delta("new-first", "New", { turnId: TurnId.make("turn-2") }));
    yield* harness.append(delta("new-tail", " tail", { turnId: TurnId.make("turn-2") }));
    yield* harness.worker.enqueue({ kind: "flush", input: oldInput! });
    yield* harness.worker.drain;
    expect(harness.batches.map((batch) => batch.text)).toEqual(["Old", " tail", "New"]);
    yield* TestClock.adjust("50 millis");
    const input = yield* Queue.take(harness.timerInputs);
    yield* harness.worker.drain;
    expect(harness.batches.map((batch) => batch.text)).toEqual(["Old", " tail", "New", " tail"]);
    const batchCommandId = harness.batches.at(-1)?.commandId;
    yield* harness.worker.enqueue({ kind: "flush", input });
    yield* harness.worker.drain;
    expect(harness.batches).toHaveLength(4);
    expect(harness.batches.at(-1)?.commandId).toBe(batchCommandId);
  }).pipe(Effect.scoped),
);

it.effect("drains scheduled flush work and cancels timers without advancing time", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* harness.append(delta("first", "One"));
    yield* harness.append(delta("second", " two"));
    yield* harness.append(delta("third", " three"));
    yield* harness.drain;
    expect(harness.batches.map((batch) => batch.text)).toEqual(["One", " two three"]);
    expect(harness.batches.at(-1)).toMatchObject({ reason: "drain", deltaCount: 2 });
    expect(harness.activeTimers()).toBe(0);
  }).pipe(Effect.scoped),
);
