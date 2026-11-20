import {
  ORCHESTRATION_V2_WS_METHODS,
  type InlineReplyPage,
  type InlineReplyRow,
  type MessageId,
  type OrchestrationV2ProjectedTurnItem,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { request, subscribeDynamicWithSession } from "../rpc/client.ts";
import type { RpcSession } from "../rpc/session.ts";
import { parseThreadKey, threadKey } from "./entities.ts";
import { followStreamInEnvironment } from "./environmentStreams.ts";

export interface InlineReplyTimelineState {
  readonly rows: ReadonlyArray<InlineReplyRow>;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

const EMPTY_TIMELINE: InlineReplyTimelineState = {
  rows: [],
  hasMore: false,
  loading: false,
  error: null,
};
const LOADING_TIMELINE = { ...EMPTY_TIMELINE, loading: true };

function replyMessageKey(threadId: ThreadId, messageId: MessageId): string {
  return `${threadId}\u0000${messageId}`;
}

function replyRowKey(reply: InlineReplyRow): string {
  return replyMessageKey(reply.threadId, reply.row.item.messageId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareReplies(left: InlineReplyRow, right: InlineReplyRow): number {
  return (
    compareText(left.createdAt, right.createdAt) ||
    compareText(left.threadId, right.threadId) ||
    left.row.position - right.row.position ||
    compareText(left.row.sourceItemId, right.row.sourceItemId)
  );
}

function updateReplyRows(
  rows: ReadonlyArray<InlineReplyRow>,
  changes: Map<string, InlineReplyRow | null>,
): ReadonlyArray<InlineReplyRow> {
  if (changes.size === 0) return rows;
  let needsSort = false;
  let changed = false;
  const next: InlineReplyRow[] = [];
  for (const row of rows) {
    const key = replyRowKey(row);
    const replacement = changes.get(key);
    if (replacement === undefined) {
      next.push(row);
      continue;
    }
    changes.delete(key);
    changed ||= replacement !== row;
    if (replacement !== null) {
      needsSort ||= compareReplies(row, replacement) !== 0;
      next.push(replacement);
    }
  }
  for (const row of changes.values()) {
    if (row === null) continue;
    changed = true;
    needsSort = true;
    next.push(row);
  }
  if (needsSort) next.sort(compareReplies);
  return changed ? next : rows;
}

type PageRequest = { readonly before: string; readonly session: RpcSession };
type TimelineProgress = {
  readonly value: InlineReplyTimelineState;
  readonly pageRequest: PageRequest | null;
};

function replyError(cause: Cause.Cause<unknown>, fallback: string): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

const makeInlineReplyTimeline = Effect.fn("InlineReplies.makeTimeline")(function* (
  threadId: ThreadId,
  loadRequests: Stream.Stream<number>,
) {
  const supervisor = yield* EnvironmentSupervisor;
  const progress = yield* SubscriptionRef.make<TimelineProgress>({
    value: LOADING_TIMELINE,
    pageRequest: null,
  });
  // Removals keep their sequence so an in-flight page cannot restore a deleted message.
  const versions = new Map<string, number>();
  let snapshotSession: RpcSession | null = null;
  let cursor: string | null = null;
  let requestedPages = 0;
  let loadedPages = 0;
  let liveSequence = -1;

  const applyRows = (
    current: ReadonlyArray<InlineReplyRow>,
    incoming: ReadonlyArray<InlineReplyRow>,
    sequence: number,
    fromPage: boolean,
  ) => {
    const changes = new Map<string, InlineReplyRow>();
    for (const row of incoming) {
      const key = replyRowKey(row);
      const version = versions.get(key);
      if (version !== undefined && (version > sequence || (fromPage && version === sequence))) {
        continue;
      }
      versions.set(key, sequence);
      changes.set(key, row);
    }
    return updateReplyRows(current, changes);
  };

  const pageProgress = (rows: ReadonlyArray<InlineReplyRow>): TimelineProgress => {
    const pageRequest =
      snapshotSession !== null && cursor !== null && loadedPages < requestedPages
        ? { before: cursor, session: snapshotSession }
        : null;
    return {
      value: { rows, hasMore: cursor !== null, loading: pageRequest !== null, error: null },
      pageRequest,
    };
  };

  const reportStreamError = (cause: Cause.Cause<unknown>) =>
    SubscriptionRef.update(progress, ({ value }) => ({
      value: {
        ...value,
        loading: false,
        error: replyError(cause, "Could not synchronize message replies."),
      },
      pageRequest: null,
    }));

  yield* subscribeDynamicWithSession(
    ORCHESTRATION_V2_WS_METHODS.subscribeInlineReplies,
    () => Effect.succeed({ threadId }),
    {
      onExpectedFailure: reportStreamError,
    },
  ).pipe(
    Stream.runForEach(([session, update]) =>
      SubscriptionRef.get(supervisor.session).pipe(
        Effect.flatMap((currentSession) =>
          !Option.isSome(currentSession) || currentSession.value !== session
            ? Effect.void
            : SubscriptionRef.update(progress, (current) => {
                if (update.kind === "snapshot") {
                  const { page } = update;
                  snapshotSession = session;
                  versions.clear();
                  loadedPages = 0;
                  cursor = page.nextCursor;
                  liveSequence = page.snapshotSequence;
                  return pageProgress(applyRows([], page.rows, liveSequence, true));
                }
                if (snapshotSession !== session || update.sequence < liveSequence) return current;
                liveSequence = update.sequence;
                const rows = current.value.rows;
                let next: typeof rows;
                if (update.kind === "upsert") {
                  next = applyRows(rows, update.rows, liveSequence, false);
                } else {
                  const removals = new Map<string, null>();
                  for (const messageId of update.messageIds) {
                    const key = replyMessageKey(update.threadId, messageId);
                    if ((versions.get(key) ?? -1) > liveSequence) continue;
                    versions.set(key, liveSequence);
                    removals.set(key, null);
                  }
                  next = updateReplyRows(rows, removals);
                }
                return rows === next
                  ? current
                  : { ...current, value: { ...current.value, rows: next } };
              }),
        ),
      ),
    ),
    Effect.catchCause(reportStreamError),
    Effect.forkScoped,
  );

  yield* loadRequests.pipe(
    Stream.drop(1),
    Stream.runForEach(() =>
      SubscriptionRef.update(progress, (current) => {
        if (cursor === null || current.pageRequest !== null) return current;
        requestedPages = Math.max(requestedPages, loadedPages + 1);
        return pageProgress(current.value.rows);
      }),
    ),
    Effect.forkScoped,
  );

  const finishPage = (
    pending: PageRequest,
    finish: (current: TimelineProgress) => TimelineProgress,
  ) =>
    SubscriptionRef.get(supervisor.session).pipe(
      Effect.flatMap((session) =>
        SubscriptionRef.update(progress, (current) => {
          if (current.pageRequest !== pending) return current;
          if (Option.isSome(session) && session.value === pending.session) return finish(current);
          return { value: { ...current.value, loading: false }, pageRequest: null };
        }),
      ),
    );

  yield* SubscriptionRef.changes(progress).pipe(
    Stream.map(({ pageRequest }) => pageRequest),
    Stream.changes,
    Stream.switchMap((pending) =>
      pending === null
        ? Stream.empty
        : Stream.fromEffect(
            request(ORCHESTRATION_V2_WS_METHODS.getInlineReplyPage, {
              threadId,
              before: pending.before,
            }).pipe(
              Effect.matchCauseEffect({
                onSuccess: (page: InlineReplyPage) =>
                  finishPage(pending, ({ value }) => {
                    cursor = page.nextCursor;
                    loadedPages += 1;
                    return pageProgress(
                      applyRows(value.rows, page.rows, page.snapshotSequence, true),
                    );
                  }),
                onFailure: (cause) =>
                  finishPage(pending, ({ value }) => ({
                    value: {
                      ...value,
                      loading: false,
                      error: replyError(cause, "Could not load earlier replies."),
                    },
                    pageRequest: null,
                  })),
              }),
            ),
          ),
    ),
    Stream.runDrain,
    Effect.forkScoped,
  );

  return SubscriptionRef.changes(progress).pipe(
    Stream.map(({ value }) => value),
    Stream.changes,
  );
});

const disabledTimelineAtom = Atom.writable(
  () => EMPTY_TIMELINE,
  (_context, _input: void) => {},
);

export function createInlineReplyTimelineAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, threadId } = parseThreadKey(key);
    const loads = Atom.make(0).pipe(Atom.setIdleTTL(0));
    const subscription = runtime
      .atom(
        (get) =>
          followStreamInEnvironment(
            environmentId,
            Stream.unwrap(
              makeInlineReplyTimeline(threadId, AtomRegistry.toStream(get.registry, loads)),
            ),
          ),
        { initialValue: LOADING_TIMELINE },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`inline-replies:subscription:${key}`));
    const read = (result: Atom.Type<typeof subscription>) =>
      AsyncResult.getOrElse(result, () => LOADING_TIMELINE);
    return Atom.writable(
      (get) => read(get(subscription)),
      (context, _input: void) => {
        const { hasMore, loading } = read(context.get(subscription));
        if (hasMore && !loading) context.set(loads, context.get(loads) + 1);
      },
    ).pipe(Atom.setIdleTTL(0), Atom.withLabel(`inline-replies:timeline:${key}`));
  });
  const timelineAtom = (ref: ScopedThreadRef | null) =>
    ref === null ? disabledTimelineAtom : family(threadKey(ref));
  return { stateAtom: timelineAtom, loadEarlierAtom: timelineAtom };
}

type ProjectedRows = ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
const normalizedReplyRows = new WeakMap<InlineReplyRow, OrchestrationV2ProjectedTurnItem>();

function normalizeReplyRow(reply: InlineReplyRow): OrchestrationV2ProjectedTurnItem {
  const { row, replyTopicId } = reply;
  if (row.item.replyTopicId === replyTopicId) return row;
  const cached = normalizedReplyRows.get(reply);
  if (cached !== undefined) return cached;
  const normalized = { ...row, item: { ...row.item, replyTopicId } };
  normalizedReplyRows.set(reply, normalized);
  return normalized;
}

const merges = new WeakMap<
  ProjectedRows,
  {
    readonly replies: ReadonlyArray<InlineReplyRow>;
    readonly merged: ProjectedRows;
    readonly positions: ReadonlyArray<number | undefined>;
  }
>();

function projectedRowKey(row: OrchestrationV2ProjectedTurnItem): string {
  return `${row.sourceThreadId}\u0000${row.sourceItemId}`;
}

export function mergeInlineReplyItems(
  main: ProjectedRows,
  replies: ReadonlyArray<InlineReplyRow>,
): ProjectedRows {
  if (replies.length === 0) return main;
  const previous = merges.get(main);
  if (previous !== undefined && previous.replies === replies) return previous.merged;

  // Streamed text can replace a reply row without changing its timeline position.
  if (
    previous !== undefined &&
    replies.length === previous.replies.length &&
    replies.every((reply, index) => {
      const priorReply = previous.replies[index]!;
      return reply === priorReply || compareReplies(reply, priorReply) === 0;
    })
  ) {
    let merged: OrchestrationV2ProjectedTurnItem[] | undefined;
    for (const [index, reply] of replies.entries()) {
      const position = previous.positions[index];
      if (position !== undefined && reply !== previous.replies[index]) {
        merged ??= previous.merged.slice();
        merged[position] = normalizeReplyRow(reply);
      }
    }
    const next = merged ?? previous.merged;
    merges.set(main, { replies, merged: next, positions: previous.positions });
    return next;
  }

  const seen = new Set(main.map(projectedRowKey));
  const ordered = replies
    .map((reply, inputIndex) => ({ reply, inputIndex, timestamp: Date.parse(reply.createdAt) }))
    .sort((left, right) => compareReplies(left.reply, right.reply))
    .filter(({ reply }) => {
      const key = projectedRowKey(reply.row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (ordered.length === 0) {
    merges.set(main, { replies, merged: main, positions: [] });
    return main;
  }
  const merged: OrchestrationV2ProjectedTurnItem[] = [];
  const positions: Array<number | undefined> = [];
  let index = 0;
  const appendReply = ({ reply, inputIndex }: (typeof ordered)[number]) => {
    positions[inputIndex] = merged.length;
    merged.push(normalizeReplyRow(reply));
  };
  for (const row of main) {
    const timestamp = DateTime.toEpochMillis(
      row.item.startedAt ?? row.item.completedAt ?? row.item.updatedAt,
    );
    while (index < ordered.length && ordered[index]!.timestamp < timestamp) {
      appendReply(ordered[index++]!);
    }
    merged.push(row);
  }
  for (; index < ordered.length; index += 1) appendReply(ordered[index]!);
  merges.set(main, { replies, merged, positions });
  return merged;
}
