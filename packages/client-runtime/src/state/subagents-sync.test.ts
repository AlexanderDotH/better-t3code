import {
  EnvironmentId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  SubagentId,
  ThreadId,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentDetailSnapshot,
  type OrchestrationSubagentStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import {
  makeEnvironmentSubagentState,
  SubagentSnapshotLoader,
  type EnvironmentSubagentState,
} from "./subagents.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const THREAD_ID = ThreadId.make("thread-1");
const SUBAGENT_ID = SubagentId.make("agent-client-runtime");
const SNAPSHOT_SEQUENCE = 5;
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};
const BASE_SUBAGENT: OrchestrationSubagentDetail = {
  id: SUBAGENT_ID,
  providerThreadId: "provider-agent-client-runtime",
  parentId: null,
  path: "/root/client_runtime",
  name: "client_runtime",
  nickname: "Carson",
  role: "worker",
  task: "Implement client runtime",
  model: "gpt-5.6-codex",
  reasoningEffort: "ultra",
  depth: 1,
  status: "running",
  statusMessage: "Implementing",
  latestProgress: null,
  latestTurn: null,
  startedAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
  completedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
};

type TestSubagentInput = OrchestrationSubagentStreamItem | Error;

function testSession(client: WsRpcProtocolClient): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function awaitSubagentState(
  observed: Queue.Queue<EnvironmentSubagentState>,
  predicate: (state: EnvironmentSubagentState) => boolean,
) {
  return Queue.take(observed).pipe(Effect.repeat({ until: predicate }));
}

const makeHarness = Effect.fn("TestEnvironmentSubagents.makeHarness")(function* (options?: {
  readonly httpSnapshot?: Option.Option<OrchestrationSubagentDetailSnapshot>;
}) {
  const inputs = yield* Queue.unbounded<TestSubagentInput>();
  const observed = yield* Queue.unbounded<EnvironmentSubagentState>();
  const subscriptionCount = yield* Ref.make(0);
  const loaderCalls = yield* Ref.make(0);
  const subscribeInputs = yield* Ref.make<
    ReadonlyArray<{
      readonly threadId: ThreadId;
      readonly subagentId: SubagentId;
      readonly afterSequence?: number;
    }>
  >([]);
  const supervisorState = yield* SubscriptionRef.make<SupervisorConnectionState>(
    AVAILABLE_CONNECTION_STATE,
  );
  const streamFrom = (queue: Queue.Queue<TestSubagentInput>) =>
    Stream.fromQueue(queue).pipe(
      Stream.mapEffect((input) =>
        input instanceof Error ? Effect.fail(input) : Effect.succeed(input),
      ),
    );
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeSubagent]: (input: {
      readonly threadId: ThreadId;
      readonly subagentId: SubagentId;
      readonly afterSequence?: number;
    }) =>
      Stream.unwrap(
        Ref.updateAndGet(subscriptionCount, (count) => count + 1).pipe(
          Effect.andThen(Ref.update(subscribeInputs, (current) => [...current, input])),
          Effect.as(streamFrom(inputs)),
        ),
      ),
  } as unknown as WsRpcProtocolClient;
  const supervisorSession = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(
    Option.some(testSession(client)),
  );
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
    Option.some(PREPARED),
  );
  const snapshotLoader = SubagentSnapshotLoader.of({
    load: (_prepared, threadId, subagentId) =>
      Ref.update(loaderCalls, (count) => count + 1).pipe(
        Effect.as(
          threadId === THREAD_ID && subagentId === SUBAGENT_ID
            ? (options?.httpSnapshot ?? Option.none<OrchestrationSubagentDetailSnapshot>())
            : Option.none<OrchestrationSubagentDetailSnapshot>(),
        ),
      ),
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: supervisorState,
    session: supervisorSession,
    prepared,
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
  const subagentState = yield* makeEnvironmentSubagentState(THREAD_ID, SUBAGENT_ID).pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(SubagentSnapshotLoader, snapshotLoader),
  );
  yield* SubscriptionRef.changes(subagentState).pipe(
    Stream.runForEach((state) => Queue.offer(observed, state)),
    Effect.forkScoped,
  );

  return {
    inputs,
    observed,
    subscriptionCount,
    loaderCalls,
    subscribeInputs,
    supervisorSession,
    replaceSession: SubscriptionRef.set(supervisorSession, Option.some(testSession(client))),
  };
});

function detailSnapshot(sequence = SNAPSHOT_SEQUENCE): OrchestrationSubagentDetailSnapshot {
  return {
    snapshotSequence: sequence,
    threadId: THREAD_ID,
    subagent: BASE_SUBAGENT,
  };
}

function message(
  text: string,
  sequence: number,
  messageId = `message-${sequence}`,
): OrchestrationSubagentStreamItem {
  const timestamp = `2026-07-30T10:00:${sequence.toString().padStart(2, "0")}.000Z`;
  return {
    kind: "event",
    event: {
      eventId: EventId.make(`event-${sequence}`),
      sequence,
      occurredAt: timestamp,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      type: "thread.message-sent",
      payload: {
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        messageId: MessageId.make(messageId),
        role: "assistant",
        text,
        turnId: null,
        streaming: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
}

describe("EnvironmentSubagents", () => {
  it.effect("loads the selected transcript over HTTP and resumes its filtered stream", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: Option.some(detailSnapshot()),
      });
      yield* Queue.offer(harness.inputs, message("Live output", 6));

      const state = yield* awaitSubagentState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.messages[0]?.text === "Live output",
      );

      expect(yield* Ref.get(harness.loaderCalls)).toBe(1);
      expect((yield* Ref.get(harness.subscribeInputs))[0]).toEqual({
        threadId: THREAD_ID,
        subagentId: SUBAGENT_ID,
        afterSequence: SNAPSHOT_SEQUENCE,
      });
      expect(Option.getOrThrow(state.data).messages).toHaveLength(1);
    }),
  );

  it.effect("advances cursor frames so older filtered events cannot regress the transcript", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: Option.some(detailSnapshot()),
      });
      yield* Queue.offer(harness.inputs, { kind: "cursor", sequence: 9 });
      yield* Queue.offer(harness.inputs, message("Stale output", 8));
      yield* Queue.offer(harness.inputs, message("Live output", 10));

      const state = yield* awaitSubagentState(
        harness.observed,
        (value) =>
          value.status === "live" &&
          Option.isSome(value.data) &&
          value.data.value.messages.some((entry) => entry.text === "Live output"),
      );

      expect(Option.getOrThrow(state.data).messages.map((entry) => entry.text)).toEqual([
        "Live output",
      ]);
    }),
  );

  it.effect("deduplicates replay after the connection replaces its RPC session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        httpSnapshot: Option.some(detailSnapshot()),
      });
      yield* Queue.offer(harness.inputs, message("First output", 6, "message-first"));
      yield* awaitSubagentState(
        harness.observed,
        (value) => Option.isSome(value.data) && value.data.value.messages.length === 1,
      );

      yield* harness.replaceSession;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((yield* Ref.get(harness.subscriptionCount)) >= 2) {
          break;
        }
        yield* Effect.yieldNow;
      }
      yield* Queue.offer(harness.inputs, message("First output", 6, "message-first"));
      yield* Queue.offer(harness.inputs, message("Second output", 7, "message-second"));

      const state = yield* awaitSubagentState(
        harness.observed,
        (value) => Option.isSome(value.data) && value.data.value.messages.length === 2,
      );

      expect(Option.getOrThrow(state.data).messages.map((entry) => entry.id)).toEqual([
        "message-first",
        "message-second",
      ]);
      expect(yield* Ref.get(harness.subscriptionCount)).toBe(2);
    }),
  );
});
