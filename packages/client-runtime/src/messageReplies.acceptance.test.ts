import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  OrchestrationEvent,
  OrchestrationThreadDetailSnapshot,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationSubagentSummary,
  type OrchestrationThread,
  type OrchestrationThreadStreamItem,
  type ServerConfig,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./connection/model.ts";
import { EnvironmentSupervisor } from "./connection/supervisor.ts";
import {
  createMessageReplyReference,
  getMessageReplyPreview,
  mergeMessageReplyTimeline,
} from "./messageReplies.ts";
import { derivePendingRequests } from "./pendingRequests.ts";
import { EnvironmentCacheStore } from "./platform/persistence.ts";
import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import type { RpcSession } from "./rpc/session.ts";
import { applyThreadDetailEvent } from "./state/threadReducer.ts";
import { threadHasActiveReplyTopics } from "./state/threadState.ts";
import {
  makeEnvironmentThreadState,
  ThreadSnapshotLoader,
  type EnvironmentThreadState,
} from "./state/threads.ts";

const THREAD_ID = ThreadId.make("reply-acceptance-thread");
const FIRST_TOPIC_ID = SubagentId.make("first-reply-topic");
const SECOND_TOPIC_ID = SubagentId.make("second-reply-topic");
const BASE_TIME = "2026-10-13T10:00:00.000Z";
const BASE_DATE = DateTime.makeUnsafe(BASE_TIME);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationThreadDetailSnapshot);
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-6",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ],
};
const QUOTE = {
  messageId: MessageId.make("original-message"),
  role: "assistant" as const,
  text: "Keep this source even when it is outside the loaded history window.",
  authorLabel: "Assistant",
};

function at(sequence: number) {
  return DateTime.formatIso(DateTime.add(BASE_DATE, { seconds: sequence }));
}

function topic(id: SubagentId): OrchestrationSubagentSummary {
  return {
    id,
    origin: "t3-managed",
    providerInstanceId: MODEL_SELECTION.instanceId,
    providerDriver: ProviderDriverKind.make("codex"),
    providerThreadId: `provider-${id}`,
    parentId: null,
    path: null,
    name: "Reply topic",
    nickname: null,
    role: null,
    task: null,
    model: MODEL_SELECTION.model,
    reasoningEffort: "high",
    serviceTier: "priority",
    depth: 1,
    status: "running",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: BASE_TIME,
    updatedAt: BASE_TIME,
    completedAt: null,
    messageReply: {
      rootMessageId: QUOTE.messageId,
      replyTo: QUOTE,
      modelSelection: MODEL_SELECTION,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspacePath: "/workspace/shared-project",
    },
  };
}

function message(id: string, text: string, replyTopicId?: SubagentId): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role: "assistant",
    text,
    turnId: TurnId.make(replyTopicId ? `turn-${replyTopicId}` : "main-turn"),
    streaming: true,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...(replyTopicId ? { replyTopicId, replyTo: QUOTE } : {}),
  };
}

function thread(): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("shared-project"),
    title: "Main conversation",
    titleState: {
      source: "manual",
      version: CommandId.make("manual-title"),
      needsRefinement: false,
    },
    modelSelection: MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/workspace/shared-project",
    latestTurn: {
      turnId: TurnId.make("main-turn"),
      state: "running",
      requestedAt: BASE_TIME,
      startedAt: BASE_TIME,
      completedAt: null,
      assistantMessageId: MessageId.make("main-response"),
    },
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    pullRequests: [],
    deletedAt: null,
    messages: [message("main-response", "Main work")],
    replyMessages: [message("provider-message-1", "First", FIRST_TOPIC_ID)],
    replyActivities: [],
    proposedPlans: [],
    activities: [],
    subagents: [topic(FIRST_TOPIC_ID), topic(SECOND_TOPIC_ID)],
    checkpoints: [],
    session: {
      threadId: THREAD_ID,
      status: "running",
      runtimeSessionId: null,
      abortState: null,
      providerName: "codex",
      providerInstanceId: MODEL_SELECTION.instanceId,
      runtimeMode: "full-access",
      activeTurnId: TurnId.make("main-turn"),
      lastError: null,
      updatedAt: BASE_TIME,
    },
  };
}

function event(
  type: OrchestrationEvent["type"],
  sequence: number,
  payload: Record<string, unknown>,
) {
  return decodeEvent({
    type,
    sequence,
    eventId: `reply-event-${sequence}`,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: at(sequence),
    payload: { threadId: THREAD_ID, ...payload },
  });
}

function apply(thread: OrchestrationThread, event: OrchestrationEvent) {
  const result = applyThreadDetailEvent(thread, event);
  if (result.kind !== "updated") throw new Error(`Expected ${event.type} to update the thread`);
  return result.thread;
}

const makeRemoteThread = Effect.fn("MessageReplyAcceptance.makeRemoteThread")(function* (
  initial: OrchestrationThreadDetailSnapshot,
) {
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("reply-test-environment"),
    label: "Remote reply environment",
    httpBaseUrl: "https://reply.example.test",
    wsBaseUrl: "wss://reply.example.test",
  });
  const prepared: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  const inputs = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const subscriptions = yield* Queue.unbounded<{ readonly afterSequence?: number }>();
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input: { readonly afterSequence?: number }) =>
      Stream.unwrap(Queue.offer(subscriptions, input).pipe(Effect.as(Stream.fromQueue(inputs)))),
  } as unknown as WsRpcProtocolClient;
  const session = (): RpcSession => ({
    client,
    initialConfig: Effect.succeed({ threadResumeCompletionMarker: true } as ServerConfig),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  });
  const sessions = yield* SubscriptionRef.make(Option.some(session()));
  const supervisor = EnvironmentSupervisor.of({
    target,
    state: yield* SubscriptionRef.make<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE),
    session: sessions,
    prepared: yield* SubscriptionRef.make(Option.some(prepared)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const cache = EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeedNone,
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const state = yield* makeEnvironmentThreadState(THREAD_ID).pipe(
    Effect.provideService(EnvironmentSupervisor, supervisor),
    Effect.provideService(EnvironmentCacheStore, cache),
    Effect.provideService(ThreadSnapshotLoader, { load: () => Effect.succeedSome(initial) }),
  );
  yield* SubscriptionRef.changes(state).pipe(
    Stream.runForEach((value) => Queue.offer(observed, value)),
    Effect.forkScoped,
  );
  return {
    inputs,
    subscriptions,
    reconnect: SubscriptionRef.set(sessions, Option.some(session())),
    awaitThread: (predicate: (thread: OrchestrationThread) => boolean) =>
      Queue.take(observed).pipe(
        Effect.repeat({
          until: (value) =>
            value.status === "live" && Option.isSome(value.data) && predicate(value.data.value),
        }),
        Effect.map((value) => Option.getOrThrow(value.data)),
      ),
  };
});

describe("message reply acceptance", () => {
  it.each(["user", "assistant"] as const)(
    "keeps the complete %s quote across a snapshot while the composer preview stays short",
    (role) => {
      const text = `# Original message\n\n**Details** [documentation](https://example.test)\n${"Complete source context. ".repeat(30)}`;
      const source = { id: QUOTE.messageId, role, text };
      const reference = createMessageReplyReference(source, role === "user" ? "You" : "Assistant");
      expect(reference).not.toBeNull();
      const preview = getMessageReplyPreview(source);
      expect(preview.length).toBeLessThanOrEqual(120);
      expect(preview).not.toMatch(/\n|\*\*|https:\/\//);
      source.text = "The original was edited after selecting Reply.";

      const snapshot = decodeSnapshot(
        JSON.parse(
          JSON.stringify({
            snapshotSequence: 10,
            thread: {
              ...thread(),
              replyMessages: [
                {
                  ...message("follow-up", "Explain this", FIRST_TOPIC_ID),
                  role: "user",
                  replyTo: reference,
                },
              ],
            },
          }),
        ),
      );
      const reply = snapshot.thread.replyMessages?.[0];
      expect(snapshot.thread.messages.some((entry) => entry.id === QUOTE.messageId)).toBe(false);
      expect(reply?.replyTo).toEqual({
        messageId: QUOTE.messageId,
        role,
        text,
        authorLabel: role === "user" ? "You" : "Assistant",
      });
      expect(reply?.replyTopicId).toBe(FIRST_TOPIC_ID);
      expect(snapshot.thread.subagents[0]?.messageReply?.modelSelection).toEqual(MODEL_SELECTION);
      expect(snapshot.thread.subagents[0]?.messageReply?.workspacePath).toBe(
        "/workspace/shared-project",
      );
    },
  );

  it.effect("resumes remote reply streams once without changing the running main turn", () =>
    Effect.gen(function* () {
      const initial = thread();
      const remote = yield* makeRemoteThread({ snapshotSequence: 10, thread: initial });
      expect((yield* Queue.take(remote.subscriptions)).afterSequence).toBe(10);
      yield* Queue.offer(remote.inputs, { kind: "synchronized" });
      yield* remote.awaitThread(() => true);

      const replyDelta = event("thread.message-sent", 11, {
        subagentId: FIRST_TOPIC_ID,
        messageId: "provider-message-1",
        role: "assistant",
        text: " answer",
        turnId: "turn-first-reply-topic",
        streaming: true,
        createdAt: BASE_TIME,
        updatedAt: at(11),
      });
      const finishReply = event("thread.message-sent", 12, {
        ...replyDelta.payload,
        text: "",
        streaming: false,
        updatedAt: at(12),
      });
      const secondReply = event("thread.message-sent", 13, {
        ...replyDelta.payload,
        subagentId: SECOND_TOPIC_ID,
        text: "Second answer",
        turnId: "turn-second-reply-topic",
        replyTo: QUOTE,
        streaming: false,
        updatedAt: at(13),
      });
      yield* Queue.offerAll(
        remote.inputs,
        [replyDelta, replyDelta, finishReply, secondReply].map(
          (event): OrchestrationThreadStreamItem => ({ kind: "event", event }),
        ),
      );
      const live = yield* remote.awaitThread((value) => value.replyMessages?.length === 2);
      expect(live.replyMessages?.map((reply) => reply.text)).toEqual([
        "First answer",
        "Second answer",
      ]);
      expect(live.latestTurn).toEqual(initial.latestTurn);
      expect(live.session).toEqual(initial.session);
      expect(live.messages).toEqual(initial.messages);
      expect(live.titleState).toEqual(initial.titleState);
      expect(live.checkpoints).toEqual(initial.checkpoints);

      yield* remote.reconnect;
      expect((yield* Queue.take(remote.subscriptions)).afterSequence).toBe(13);
      const mainDelta = event("thread.message-sent", 14, {
        messageId: "main-response",
        role: "assistant",
        text: " continues",
        turnId: "main-turn",
        streaming: true,
        createdAt: BASE_TIME,
        updatedAt: at(14),
      });
      yield* Queue.offerAll(remote.inputs, [
        { kind: "event", event: replyDelta },
        { kind: "event", event: finishReply },
        { kind: "event", event: mainDelta },
        { kind: "synchronized" },
      ]);
      const resumed = yield* remote.awaitThread(
        (value) => value.messages[0]?.text === "Main work continues",
      );
      const timeline = mergeMessageReplyTimeline(resumed.messages, resumed.replyMessages);
      expect(timeline.map((entry) => entry.text)).toEqual([
        "Main work continues",
        "First answer",
        "Second answer",
      ]);
      expect(resumed.replyMessages?.map((entry) => entry.replyTo)).toEqual([QUOTE, QUOTE]);
      expect(resumed.latestTurn?.turnId).toBe(initial.latestTurn?.turnId);
    }),
  );

  it("scopes reused approval and question IDs to the topic through reply event routing", () => {
    let current = thread();
    let sequence = 10;
    for (const kind of ["approval", "user-input"] as const) {
      for (const subagentId of [undefined, FIRST_TOPIC_ID, SECOND_TOPIC_ID]) {
        current = apply(
          current,
          event("thread.activity-appended", ++sequence, {
            ...(subagentId ? { subagentId } : {}),
            activity: {
              id: EventId.make(`${kind}-${subagentId ?? "main"}`),
              tone: "approval",
              kind: `${kind}.requested`,
              summary: "Response needed",
              payload: {
                requestId: "provider-request-1",
                requestKind: "command",
                questions: [{ id: "q", header: "Scope", question: "Continue?", options: [] }],
              },
              turnId: null,
              createdAt: at(sequence),
            },
          }),
        );
      }
      current = apply(
        current,
        event("thread.activity-appended", ++sequence, {
          subagentId: FIRST_TOPIC_ID,
          activity: {
            id: EventId.make(`${kind}-first-resolved`),
            tone: "info",
            kind: `${kind}.resolved`,
            summary: "Response sent",
            payload: { requestId: "provider-request-1" },
            turnId: null,
            createdAt: at(sequence),
          },
        }),
      );
    }
    const main = derivePendingRequests(current.activities);
    const first = derivePendingRequests(
      current.replyActivities?.filter((activity) => activity.replyTopicId === FIRST_TOPIC_ID) ?? [],
    );
    const second = derivePendingRequests(
      current.replyActivities?.filter((activity) => activity.replyTopicId === SECOND_TOPIC_ID) ??
        [],
    );
    expect(first).toEqual({ approvals: [], userInputs: [] });
    expect(main.approvals).toHaveLength(1);
    expect(main.userInputs).toHaveLength(1);
    expect(second.approvals).toHaveLength(1);
    expect(second.userInputs).toHaveLength(1);
  });

  it("retains interrupted topic history while releasing the restore guard after recovery", () => {
    const active = thread();
    const waiting = apply(
      active,
      event("thread.subagent-state-set", 10, {
        subagentId: FIRST_TOPIC_ID,
        status: "waiting",
        statusMessage: null,
        updatedAt: at(10),
      }),
    );
    expect(threadHasActiveReplyTopics(waiting)).toBe(true);
    let recovered = waiting;
    for (const [index, subagentId] of [FIRST_TOPIC_ID, SECOND_TOPIC_ID].entries()) {
      recovered = apply(
        recovered,
        event("thread.subagent-state-set", 11 + index, {
          subagentId,
          status: "interrupted",
          statusMessage: null,
          updatedAt: at(11 + index),
        }),
      );
    }
    const reloaded = decodeSnapshot(
      JSON.parse(JSON.stringify({ snapshotSequence: 12, thread: recovered })),
    ).thread;
    expect(threadHasActiveReplyTopics(reloaded)).toBe(false);
    expect(reloaded.replyMessages).toEqual(active.replyMessages);
    expect(reloaded.subagents.map((entry) => entry.messageReply)).toEqual(
      active.subagents.map((entry) => entry.messageReply),
    );
    expect(reloaded.latestTurn).toEqual(active.latestTurn);
  });
});
