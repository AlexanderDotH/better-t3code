import { ProjectId, ThreadId } from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface ReplyThreadState {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly archivedAt: DateTime.Utc | null;
  readonly deletedAt: DateTime.Utc | null;
  readonly messageReply?: { readonly sourceThreadId: ThreadId } | undefined;
}

type ReadThread<E, R> = (
  threadId: ThreadId,
) => Effect.Effect<ReplyThreadState | null | undefined, E, R>;
type UnavailableReason = "closed" | "missing" | "cycle" | "project-mismatch";

export interface ReplySourceClosure {
  readonly sourceThreadId: ThreadId;
  readonly action: "stop" | "delete";
  readonly reason: UnavailableReason;
  readonly closedAt: DateTime.Utc | null;
}

export class ReplySourceUnavailableError extends Schema.TaggedError<ReplySourceUnavailableError>()(
  "ReplySourceUnavailableError",
  {
    threadId: ThreadId,
    sourceThreadId: ThreadId,
    reason: Schema.Literals(["closed", "missing", "cycle", "project-mismatch"]),
  },
) {
  override get message(): string {
    return "The reply's source thread is unavailable.";
  }
}

export const findReplySourceClosure = Effect.fn("ReplyThreadScope.findSourceClosure")(function* <
  E,
  R,
>(
  thread: ReplyThreadState,
  readThread: ReadThread<E, R>,
): Effect.fn.Return<ReplySourceClosure | undefined, E, R> {
  const seen = new Set<ThreadId>([thread.id]);
  let current = thread;
  let archived: ReplySourceClosure | undefined;
  while (current.messageReply !== undefined) {
    const sourceThreadId = current.messageReply.sourceThreadId;
    if (seen.has(sourceThreadId))
      return { sourceThreadId, action: "delete", reason: "cycle", closedAt: null };
    seen.add(sourceThreadId);
    const source = yield* readThread(sourceThreadId);
    if (source == null)
      return { sourceThreadId, action: "delete", reason: "missing", closedAt: null };
    if (source.projectId !== thread.projectId)
      return { sourceThreadId, action: "delete", reason: "project-mismatch", closedAt: null };
    if (source.deletedAt !== null)
      return { sourceThreadId, action: "delete", reason: "closed", closedAt: source.deletedAt };
    if (source.archivedAt !== null)
      archived = { sourceThreadId, action: "stop", reason: "closed", closedAt: source.archivedAt };
    current = source;
  }
  return archived;
});

export const assertReplySourceAvailable = Effect.fn("ReplyThreadScope.assertSourceAvailable")(
  function* <E, R>(
    thread: ReplyThreadState,
    readThread: ReadThread<E, R>,
  ): Effect.fn.Return<void, E | ReplySourceUnavailableError, R> {
    if (thread.archivedAt !== null || thread.deletedAt !== null)
      return yield* new ReplySourceUnavailableError({
        threadId: thread.id,
        sourceThreadId: thread.id,
        reason: "closed",
      });
    const closure = yield* findReplySourceClosure(thread, readThread);
    if (closure !== undefined)
      return yield* new ReplySourceUnavailableError({
        threadId: thread.id,
        sourceThreadId: closure.sourceThreadId,
        reason: closure.reason,
      });
  },
);
