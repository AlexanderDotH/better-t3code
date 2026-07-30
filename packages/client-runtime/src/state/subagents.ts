import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  SubagentId,
  ThreadId,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentStreamItem,
  type SubagentId as SubagentIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { subscribe } from "../rpc/client.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import { applySubagentDetailEvent } from "./subagentReducer.ts";
import {
  EMPTY_ENVIRONMENT_SUBAGENT_STATE,
  type EnvironmentSubagentState,
  type EnvironmentSubagentStatus,
} from "./subagentState.ts";

export const SUBAGENT_STATE_IDLE_TTL_MS = 2 * 60_000;

function statusWithoutLiveData(
  data: Option.Option<OrchestrationSubagentDetail>,
): EnvironmentSubagentStatus {
  return Option.isSome(data) ? "cached" : "empty";
}

function formatSubagentError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not synchronize the subagent.";
}

export const makeEnvironmentSubagentState = Effect.fn("EnvironmentSubagentState.make")(function* (
  threadId: ThreadIdType,
  subagentId: SubagentIdType,
) {
  const supervisor = yield* EnvironmentSupervisor;
  const state = yield* SubscriptionRef.make<EnvironmentSubagentState>(
    EMPTY_ENVIRONMENT_SUBAGENT_STATE,
  );
  const lastSequence = yield* SubscriptionRef.make(0);

  const setSynchronizing = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: "synchronizing" as const,
    error: Option.none(),
  }));
  const setReady = SubscriptionRef.update(state, (current) =>
    current.status === "live" || current.status === "deleted"
      ? current
      : {
          ...current,
          status: "synchronizing" as const,
          error: Option.none(),
        },
  );
  const setDisconnected = SubscriptionRef.update(state, (current) => ({
    ...current,
    status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
  }));
  const setStreamError = (cause: Cause.Cause<unknown>) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
      error: Option.some(formatSubagentError(cause)),
    }));
  const setSubagent = (subagent: OrchestrationSubagentDetail) =>
    SubscriptionRef.set(state, {
      data: Option.some(subagent),
      status: "live",
      error: Option.none(),
    });
  const setDeleted = SubscriptionRef.set(state, {
    data: Option.none(),
    status: "deleted",
    error: Option.none(),
  });

  const applyItem = Effect.fn("EnvironmentSubagentState.applyItem")(function* (
    item: OrchestrationSubagentStreamItem,
  ) {
    if (item.kind === "snapshot") {
      yield* SubscriptionRef.set(lastSequence, item.snapshot.snapshotSequence);
      yield* setSubagent(item.snapshot.subagent);
      return;
    }

    const sequence = yield* SubscriptionRef.get(lastSequence);
    if (item.event.sequence <= sequence) {
      return;
    }
    yield* SubscriptionRef.set(lastSequence, item.event.sequence);

    const current = yield* SubscriptionRef.get(state);
    if (Option.isNone(current.data)) {
      if (item.event.type === "thread.deleted") {
        yield* setDeleted;
      }
      return;
    }

    const result = applySubagentDetailEvent(current.data.value, item.event);
    if (result.kind === "updated") {
      yield* setSubagent(result.subagent);
      return;
    }
    if (result.kind === "deleted") {
      yield* setDeleted;
    }
  });

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.runForEach((connectionState) => {
      switch (connectionProjectionPhase(connectionState)) {
        case "synchronizing":
          return setSynchronizing;
        case "disconnected":
          return setDisconnected;
        case "ready":
          return setReady;
      }
    }),
    Effect.forkScoped,
  );

  yield* setSynchronizing;
  yield* subscribe(
    ORCHESTRATION_WS_METHODS.subscribeSubagent,
    { threadId, subagentId },
    {
      onExpectedFailure: setStreamError,
      retryExpectedFailureAfter: "250 millis",
    },
  ).pipe(Stream.runForEach(applyItem), Effect.forkScoped);

  return state;
});

export function subagentStateChanges(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  subagentId: SubagentIdType,
) {
  return followStreamInEnvironment(
    environmentId,
    Stream.unwrap(
      makeEnvironmentSubagentState(threadId, subagentId).pipe(Effect.map(SubscriptionRef.changes)),
    ),
  );
}

function subagentKey(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  subagentId: SubagentIdType,
): string {
  return JSON.stringify([environmentId, threadId, subagentId]);
}

function parseSubagentKey(key: string): {
  readonly environmentId: EnvironmentIdType;
  readonly threadId: ThreadIdType;
  readonly subagentId: SubagentIdType;
} {
  const [environmentId, threadId, subagentId] = JSON.parse(key) as [string, string, string];
  return {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(threadId),
    subagentId: SubagentId.make(subagentId),
  };
}

export function createEnvironmentSubagentStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, threadId, subagentId } = parseSubagentKey(key);
    return runtime
      .atom(subagentStateChanges(environmentId, threadId, subagentId), {
        initialValue: EMPTY_ENVIRONMENT_SUBAGENT_STATE,
      })
      .pipe(
        Atom.setIdleTTL(SUBAGENT_STATE_IDLE_TTL_MS),
        Atom.withLabel(`environment-subagent-state:${key}`),
      );
  });

  return {
    stateAtom: (
      environmentId: EnvironmentIdType,
      threadId: ThreadIdType,
      subagentId: SubagentIdType,
    ) => family(subagentKey(environmentId, threadId, subagentId)),
  };
}

export * from "./subagentReducer.ts";
export * from "./subagentState.ts";
