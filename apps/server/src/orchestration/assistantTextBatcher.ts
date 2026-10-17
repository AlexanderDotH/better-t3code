import {
  CommandId,
  type MessageId,
  type ProviderRuntimeEvent,
  type SubagentId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

type ContentDeltaEvent = Extract<ProviderRuntimeEvent, { type: "content.delta" }>;

const ASSISTANT_TEXT_BATCH_WINDOW_MS = 50;
export const ASSISTANT_TEXT_BATCH_MAX_BYTES = 16 * 1024;

export interface AssistantTextFlushInput {
  readonly key: string;
  readonly generation: number;
  readonly event: ContentDeltaEvent;
  readonly reason?: "timer" | "drain";
}

export interface AssistantTextBatch {
  readonly commandId: CommandId;
  readonly event: ContentDeltaEvent;
  readonly messageId: MessageId;
  readonly text: string;
  readonly byteLength: number;
  readonly deltaCount: number;
  readonly reason: "first" | "size" | "timer" | "boundary" | "drain";
}

interface TextScope {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly turnId: string | undefined;
  readonly subagentId: SubagentId | undefined;
  readonly runtimeSessionId: ContentDeltaEvent["runtimeSessionId"];
  readonly itemId: ContentDeltaEvent["itemId"];
  readonly contentIndex: number | undefined;
  readonly messageId: MessageId;
}

interface PendingText {
  readonly input: AssistantTextFlushInput;
  readonly chunks: string[];
  byteLength: number;
  lastCodeUnit: number;
  deltaCount: number;
  timer: Fiber.Fiber<void> | undefined;
}

interface TextStream {
  readonly scope: TextScope;
  pending: PendingText | undefined;
}

export interface AssistantTextTarget {
  readonly threadId: ThreadId;
  readonly subagentId?: SubagentId | undefined;
  readonly turnId?: TurnId | undefined;
  readonly messageId?: MessageId | undefined;
  readonly allSubagents?: boolean;
}

const textStreamKey = (...parts: ReadonlyArray<string | undefined>) =>
  parts.map((part) => (part === undefined ? "-" : `${part.length}:${part}`)).join(":");

const targetKey = (threadId: ThreadId, subagentId: SubagentId | undefined) =>
  textStreamKey(threadId, subagentId);

function matchesTarget(scope: TextScope, target: AssistantTextTarget): boolean {
  return (
    scope.threadId === target.threadId &&
    (target.allSubagents === true || scope.subagentId === target.subagentId) &&
    (target.turnId === undefined || scope.turnId === target.turnId) &&
    (target.messageId === undefined || scope.messageId === target.messageId)
  );
}

function matchesSource(scope: TextScope, event: ContentDeltaEvent): boolean {
  return (
    scope.turnId === event.turnId &&
    scope.runtimeSessionId === event.runtimeSessionId &&
    scope.itemId === event.itemId &&
    scope.contentIndex === event.payload.contentIndex
  );
}

function batchFromPending(
  stream: TextStream,
  pending: PendingText,
  reason: AssistantTextBatch["reason"],
): AssistantTextBatch {
  return {
    commandId: CommandId.make(
      `provider:assistant-text-batch:${stream.scope.key}:${pending.input.event.eventId}`,
    ),
    event: pending.input.event,
    messageId: stream.scope.messageId,
    text: pending.chunks.join(""),
    byteLength: pending.byteLength,
    deltaCount: pending.deltaCount,
    reason,
  };
}

// Only the ingestion worker reads or changes buffers. Timer fibers enqueue a
// generation-tagged input so a delayed timer cannot flush a newer batch.
export const makeAssistantTextBatcher = Effect.fnUntraced(function* (
  enqueueFlush: (input: AssistantTextFlushInput) => Effect.Effect<unknown>,
) {
  const batcherScope = yield* Effect.scope;
  const streams = new Map<string, TextStream>();
  let generation = 0;

  const takePending = Effect.fnUntraced(function* (
    stream: TextStream,
    reason: AssistantTextBatch["reason"],
  ) {
    const pending = stream.pending;
    if (!pending) return [];
    stream.pending = undefined;
    if (pending.timer) yield* Fiber.interrupt(pending.timer);
    return [batchFromPending(stream, pending, reason)];
  });

  const flushTarget = Effect.fnUntraced(function* (
    target: AssistantTextTarget,
    reason: AssistantTextBatch["reason"] = "boundary",
    release = false,
  ) {
    const batches: AssistantTextBatch[] = [];
    for (const [key, stream] of streams) {
      if (!matchesTarget(stream.scope, target)) continue;
      batches.push(...(yield* takePending(stream, reason)));
      if (release) streams.delete(key);
    }
    return batches;
  });

  const flushBefore = Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
    const stream = streams.get(targetKey(event.threadId, event.subagentId));
    if (
      event.type === "content.delta" &&
      event.payload.streamKind === "assistant_text" &&
      (!stream || matchesSource(stream.scope, event))
    ) {
      return [];
    }
    const isSessionExit = event.type === "session.exited";
    const isTerminal = event.type === "turn.completed" || event.type === "turn.aborted";
    return yield* flushTarget(
      {
        threadId: event.threadId,
        subagentId: event.subagentId,
        ...(isTerminal && event.turnId !== undefined
          ? { turnId: TurnId.make(String(event.turnId)) }
          : {}),
        allSubagents: isSessionExit && event.subagentId === undefined,
      },
      "boundary",
      isSessionExit || isTerminal || event.type === "runtime.error",
    );
  });

  const append = Effect.fnUntraced(function* (event: ContentDeltaEvent, messageId: MessageId) {
    const delta = event.payload.delta;
    if (delta.length === 0) return [];
    const key = targetKey(event.threadId, event.subagentId);
    let stream = streams.get(key);
    const batches: AssistantTextBatch[] = [];
    if (stream && (!matchesSource(stream.scope, event) || stream.scope.messageId !== messageId)) {
      batches.push(...(yield* takePending(stream, "boundary")));
      streams.delete(key);
      stream = undefined;
    }
    if (!stream) {
      const scope: TextScope = {
        key: textStreamKey(
          event.threadId,
          event.runtimeSessionId,
          event.turnId,
          event.subagentId,
          messageId,
          event.itemId,
          event.payload.contentIndex?.toString(),
        ),
        threadId: event.threadId,
        turnId: event.turnId,
        subagentId: event.subagentId,
        runtimeSessionId: event.runtimeSessionId,
        itemId: event.itemId,
        contentIndex: event.payload.contentIndex,
        messageId,
      };
      stream = { scope, pending: undefined };
      streams.set(key, stream);
      batches.push({
        commandId: CommandId.make(`provider:assistant-text-batch:${scope.key}:${event.eventId}`),
        event,
        messageId,
        text: delta,
        byteLength: Buffer.byteLength(delta, "utf8"),
        deltaCount: 1,
        reason: "first",
      });
      return batches;
    }

    if (!stream.pending) {
      stream.pending = {
        input: { key, generation: ++generation, event },
        chunks: [],
        byteLength: 0,
        lastCodeUnit: -1,
        deltaCount: 0,
        timer: undefined,
      };
    }
    const pending = stream.pending;
    const firstCodeUnit = delta.charCodeAt(0);
    // Joining split surrogate pairs encodes four bytes instead of two
    // replacement characters, each of which would encode three bytes.
    const joinsSurrogatePair =
      pending.lastCodeUnit >= 0xd800 &&
      pending.lastCodeUnit <= 0xdbff &&
      firstCodeUnit >= 0xdc00 &&
      firstCodeUnit <= 0xdfff;
    pending.chunks.push(delta);
    pending.byteLength += Buffer.byteLength(delta, "utf8") - (joinsSurrogatePair ? 2 : 0);
    pending.lastCodeUnit = delta.charCodeAt(delta.length - 1);
    pending.deltaCount += 1;

    if (pending.byteLength >= ASSISTANT_TEXT_BATCH_MAX_BYTES) {
      batches.push(...(yield* takePending(stream, "size")));
    } else if (!pending.timer) {
      pending.timer = yield* Effect.sleep(ASSISTANT_TEXT_BATCH_WINDOW_MS).pipe(
        Effect.andThen(enqueueFlush(pending.input)),
        Effect.asVoid,
        Effect.forkIn(batcherScope, { startImmediately: true }),
      );
    }
    return batches;
  });

  const flush = Effect.fnUntraced(function* (input: AssistantTextFlushInput) {
    const stream = streams.get(input.key);
    if (stream?.pending?.input.generation !== input.generation) return [];
    return yield* takePending(stream, input.reason ?? "timer");
  });

  const pendingFlushes = Effect.sync(() =>
    Array.from(streams.values()).flatMap((stream) =>
      stream.pending ? [stream.pending.input] : [],
    ),
  );

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      streams.clear();
    }),
  );

  return { append, flush, flushBefore, flushTarget, pendingFlushes };
});

export type AssistantTextBatcher = Effect.Success<ReturnType<typeof makeAssistantTextBatcher>>;
