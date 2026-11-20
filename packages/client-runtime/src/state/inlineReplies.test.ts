import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ORCHESTRATION_V2_WS_METHODS,
  SubagentId,
  ThreadId,
  TurnItemId,
  type InlineReplyPage,
  type InlineReplyRow,
  type InlineReplyStreamItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createInlineReplyTimelineAtoms,
  mergeInlineReplyItems,
  type InlineReplyTimelineState,
} from "./inlineReplies.ts";

const sourceThread = ThreadId.make("source");
const replyThread = ThreadId.make("reply");
const topic = SubagentId.make("topic");
const environmentId = EnvironmentId.make("environment");
const ref = { environmentId, threadId: sourceThread };

function row(id: string, minute: number, text = id, threadId = replyThread) {
  const startedAt = DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, minute));
  const itemId = TurnItemId.make(id);
  return {
    position: minute,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: itemId,
    item: {
      type: "assistant_message",
      id: itemId,
      threadId,
      messageId: MessageId.make(id),
      text,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: minute,
      status: "running",
      title: null,
      startedAt,
      completedAt: null,
      updatedAt: startedAt,
      streaming: true,
    },
  } satisfies InlineReplyRow["row"];
}

function reply(id: string, minute: number, text = id): InlineReplyRow {
  return {
    threadId: replyThread,
    replyTopicId: topic,
    createdAt: DateTime.formatIso(DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, minute))),
    row: row(id, minute, text),
  };
}

function snapshot(
  rows: ReadonlyArray<InlineReplyRow>,
  snapshotSequence: number,
  nextCursor: string | null = null,
): InlineReplyStreamItem {
  return { kind: "snapshot", page: { rows, snapshotSequence, nextCursor } };
}

const makeConnection = Effect.fn("TestInlineReplies.makeConnection")(function* () {
  const events = yield* Queue.unbounded<InlineReplyStreamItem>();
  const pageRequests = yield* Queue.unbounded<{
    readonly before: string | undefined;
    readonly response: Deferred.Deferred<InlineReplyPage>;
  }>();
  const session = {
    client: {
      [ORCHESTRATION_V2_WS_METHODS.subscribeInlineReplies]: () => Stream.fromQueue(events),
      [ORCHESTRATION_V2_WS_METHODS.getInlineReplyPage]: (input: { readonly before?: string }) =>
        Effect.gen(function* () {
          const response = yield* Deferred.make<InlineReplyPage>();
          yield* Queue.offer(pageRequests, { before: input.before, response });
          return yield* Deferred.await(response);
        }),
    },
  } as unknown as RpcSession;
  return { session, events, pageRequests };
});

const makeHarness = Effect.fn("TestInlineReplies.makeHarness")(function* () {
  const connection = yield* makeConnection();
  const session = yield* SubscriptionRef.make(Option.some(connection.session));
  const target = new PrimaryConnectionTarget({
    environmentId,
    label: "Inline replies",
    httpBaseUrl: "https://replies.example.test",
    wsBaseUrl: "wss://replies.example.test",
  });
  const supervisor = EnvironmentSupervisor.of({
    target,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const followStream: EnvironmentRegistry["Service"]["followStream"] = (id, stream) =>
    id === environmentId
      ? Stream.provideService(stream, EnvironmentSupervisor, supervisor)
      : Stream.never;
  const runtime = Atom.runtime(
    Layer.succeed(
      EnvironmentRegistry,
      EnvironmentRegistry.of({
        followStream,
      } as EnvironmentRegistry["Service"]),
    ),
  );
  const atoms = createInlineReplyTimelineAtoms(runtime);
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  yield* Effect.acquireRelease(
    Effect.sync(() => registry.mount(atoms.stateAtom(ref))),
    (unmount) => Effect.sync(unmount),
  );
  return {
    ...connection,
    atoms,
    registry,
    read: () => registry.get(atoms.stateAtom(ref)),
    waitFor: (predicate: (state: InlineReplyTimelineState) => boolean) =>
      AtomRegistry.toStream(registry, atoms.stateAtom(ref)).pipe(
        Stream.filter(predicate),
        Stream.runHead,
      ),
    loadEarlier: () => Effect.sync(() => registry.set(atoms.loadEarlierAtom(ref), undefined)),
    reconnect: (next: RpcSession) => SubscriptionRef.set(session, Option.some(next)),
  };
});

describe("inline reply timeline", () => {
  it("inserts replies while preserving committed parent order and row identity", () => {
    const first = row("first", 3, "first", sourceThread);
    const second = row("second", 2, "second", sourceThread);
    const last = row("last", 6, "last", sourceThread);
    const parentRows = [first, second, last];
    const fourth = reply("fourth", 4);
    const {
      item: { streaming: _streaming, ...userItem },
      ...userRow
    } = row("fifth", 5);
    const fifth: InlineReplyRow = {
      ...reply("fifth", 5),
      row: {
        ...userRow,
        item: {
          ...userItem,
          type: "user_message",
          attachments: [],
          inputIntent: "turn_start",
          createdBy: "user",
          creationSource: "web",
        },
      },
    };
    const merged = mergeInlineReplyItems(parentRows, [fifth, fourth]);

    expect(merged.map(({ item }) => item.id)).toEqual([
      "first",
      "second",
      "fourth",
      "fifth",
      "last",
    ]);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(second);
    expect(merged[4]).toBe(last);
    expect(merged[2]?.item).toMatchObject({ messageId: "fourth", replyTopicId: topic });
    expect(merged[3]?.item).toMatchObject({ messageId: "fifth", replyTopicId: topic });

    const updated = mergeInlineReplyItems(parentRows, [fifth, reply("fourth", 4, "streamed")]);
    expect(updated[2]?.item).toMatchObject({ text: "streamed" });
    expect(updated[3]).toBe(merged[3]);
  });

  it.effect("keeps live edits and removals when an earlier page arrives late", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Queue.offer(harness.events, snapshot([reply("latest", 8)], 10, "earlier"));
      yield* harness.waitFor((state) => state.hasMore);
      yield* harness.loadEarlier();
      const pending = yield* Queue.take(harness.pageRequests);
      expect(pending.before).toBe("earlier");
      expect(harness.read().loading).toBe(true);

      yield* Queue.offer(harness.events, {
        kind: "upsert",
        sequence: 12,
        rows: [reply("updated", 5, "new text")],
      });
      yield* Queue.offer(harness.events, {
        kind: "remove",
        sequence: 13,
        threadId: replyThread,
        messageIds: [MessageId.make("deleted")],
      });
      yield* Queue.offer(harness.events, {
        kind: "upsert",
        sequence: 14,
        rows: [reply("latest", 8, "edited latest")],
      });
      yield* harness.waitFor((state) => {
        const item = state.rows.at(-1)?.row.item;
        return item?.type === "assistant_message" && item.text === "edited latest";
      });
      yield* Deferred.succeed(pending.response, {
        rows: [reply("oldest", 2), reply("deleted", 3), reply("updated", 5, "old text")],
        snapshotSequence: 11,
        nextCursor: null,
      });
      yield* harness.waitFor((state) => !state.loading);
      expect(
        harness
          .read()
          .rows.map(({ row: { item } }) => (item.type === "assistant_message" ? item.text : null)),
      ).toEqual(["oldest", "new text", "edited latest"]);
      expect(harness.read().hasMore).toBe(false);
    }),
  );

  it.effect("reloads the expanded history from the reconnect snapshot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Queue.offer(harness.events, snapshot([reply("latest", 8)], 10, "original"));
      yield* harness.waitFor((state) => state.hasMore);
      yield* harness.loadEarlier();
      const older = yield* Queue.take(harness.pageRequests);
      yield* Deferred.succeed(older.response, {
        rows: [reply("old-entry", 2)],
        snapshotSequence: 10,
        nextCursor: "oldest",
      });
      yield* harness.waitFor((state) => state.rows.length === 2 && !state.loading);
      yield* harness.loadEarlier();
      const oldest = yield* Queue.take(harness.pageRequests);
      expect(oldest.before).toBe("oldest");
      yield* Deferred.succeed(oldest.response, {
        rows: [reply("oldest-entry", 1)],
        snapshotSequence: 10,
        nextCursor: null,
      });
      yield* harness.waitFor((state) => state.rows.length === 3);

      const reconnect = yield* makeConnection();
      yield* harness.reconnect(reconnect.session);
      yield* Queue.offer(reconnect.events, snapshot([reply("new-entry", 9)], 20, "fresh"));
      const replay = yield* Queue.take(reconnect.pageRequests);
      expect(replay.before).toBe("fresh");
      yield* Deferred.succeed(replay.response, {
        rows: [reply("latest", 8, "new text")],
        snapshotSequence: 20,
        nextCursor: "fresh-oldest",
      });
      const replayOldest = yield* Queue.take(reconnect.pageRequests);
      expect(replayOldest.before).toBe("fresh-oldest");
      yield* Deferred.succeed(replayOldest.response, {
        rows: [reply("still-older", 7)],
        snapshotSequence: 20,
        nextCursor: null,
      });
      yield* harness.waitFor((state) => !state.loading && state.rows.length === 3);
      expect(
        harness
          .read()
          .rows.map(({ row: { item } }) => (item.type === "assistant_message" ? item.text : null)),
      ).toEqual(["still-older", "new text", "new-entry"]);
      expect(harness.registry.get(harness.atoms.stateAtom(null)).rows).toEqual([]);
      expect(
        harness.registry.get(
          harness.atoms.stateAtom({
            ...ref,
            environmentId: EnvironmentId.make("different-environment"),
          }),
        ).rows,
      ).toEqual([]);
    }),
  );
});
