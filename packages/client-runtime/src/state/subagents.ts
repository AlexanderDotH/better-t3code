import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  SubagentId,
  ThreadId,
  type EnvironmentId as EnvironmentIdType,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentDetailPage,
  type OrchestrationSubagentDetailSnapshot,
  type OrchestrationSubagentStreamItem,
  type SubagentId as SubagentIdType,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { connectionProjectionPhase } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { subscribeDynamic } from "../rpc/client.ts";
import { followStreamInEnvironment } from "./runtime.ts";
import { applySubagentDetailEvent } from "./subagentReducer.ts";
import {
  EMPTY_ENVIRONMENT_SUBAGENT_STATE,
  type EnvironmentSubagentPageState,
  type EnvironmentSubagentState,
  type EnvironmentSubagentStatus,
} from "./subagentState.ts";
import { SubagentSnapshotLoader, type SubagentSnapshotWindow } from "./subagentSnapshotHttp.ts";

// Selected transcripts are intentionally in-memory and lazy. Retain one across
// brief layout changes, but release large transcript snapshots promptly after
// their last viewer unmounts.
export const SUBAGENT_STATE_IDLE_TTL_MS = 30_000;
export const INITIAL_SUBAGENT_ACTIVITY_LIMIT = 100;
export const OLDER_SUBAGENT_ACTIVITY_LIMIT = 200;

function pageStateFromSnapshot(
  page: OrchestrationSubagentDetailPage | undefined,
): Option.Option<EnvironmentSubagentPageState> {
  return page === undefined
    ? Option.none()
    : Option.some({
        beforeCursor: page.beforeCursor,
        hasMore: page.hasMore,
        loadingOlder: false,
      });
}

interface SubagentOlderActivityRequestRegistry {
  readonly register: (key: string, handler: () => void) => () => void;
  readonly request: (key: string) => boolean;
}

function makeSubagentOlderActivityRequestRegistry(): SubagentOlderActivityRequestRegistry {
  const handlers = new Map<string, () => void>();
  return {
    register: (key, handler) => {
      handlers.set(key, handler);
      return () => {
        if (handlers.get(key) === handler) handlers.delete(key);
      };
    },
    request: (key) => {
      const handler = handlers.get(key);
      if (handler === undefined) return false;
      handler();
      return true;
    },
  };
}

const defaultOlderActivityRequestRegistry = makeSubagentOlderActivityRequestRegistry();

export class SubagentOlderActivityRequests extends Context.Reference<SubagentOlderActivityRequestRegistry>(
  "@t3tools/client-runtime/state/subagents/SubagentOlderActivityRequests",
  { defaultValue: () => defaultOlderActivityRequestRegistry },
) {}

export function requestOlderSubagentActivities(
  environmentId: EnvironmentIdType,
  threadId: ThreadIdType,
  subagentId: SubagentIdType,
): boolean {
  return defaultOlderActivityRequestRegistry.request(
    subagentKey(environmentId, threadId, subagentId),
  );
}

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
  const snapshotLoader = yield* SubagentSnapshotLoader;
  const environmentId = supervisor.target.environmentId;
  const state = yield* SubscriptionRef.make<EnvironmentSubagentState>({
    data: Option.none(),
    status: "empty",
    error: Option.none(),
    page: Option.none(),
  });
  const lastSequence = yield* SubscriptionRef.make(0);
  const historyEpoch = yield* Ref.make(0);
  const applyLock = yield* Semaphore.make(1);
  const paginationSupported = yield* Ref.make(false);
  const pendingOlderPage = yield* Ref.make<{
    readonly snapshot: OrchestrationSubagentDetailSnapshot;
    readonly epoch: number;
  } | null>(null);

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
  const setDisconnected = Effect.gen(function* () {
    yield* Ref.set(paginationSupported, false);
    yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
    yield* Ref.set(pendingOlderPage, null);
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
      page: Option.map(current.page, (page) => ({ ...page, loadingOlder: false })),
    }));
  });
  const setStreamError = (cause: Cause.Cause<unknown>) =>
    SubscriptionRef.update(state, (current) => ({
      ...current,
      status: current.status === "deleted" ? current.status : statusWithoutLiveData(current.data),
      error: Option.some(formatSubagentError(cause)),
    }));
  const setSubagent = (
    subagent: OrchestrationSubagentDetail,
    page: Option.Option<EnvironmentSubagentPageState> | "keep",
  ) =>
    SubscriptionRef.update(state, (current) => ({
      data: Option.some(subagent),
      status: "live" as const,
      error: Option.none(),
      page: page === "keep" ? current.page : page,
    }));
  const setDeleted = Effect.gen(function* () {
    yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
    yield* Ref.set(pendingOlderPage, null);
    yield* SubscriptionRef.set(state, {
      data: Option.none(),
      status: "deleted",
      error: Option.none(),
      page: Option.none(),
    });
  });

  const mergeOlderPage = Effect.fn("EnvironmentSubagentState.mergeOlderPage")(function* (
    snapshot: OrchestrationSubagentDetailSnapshot,
  ) {
    yield* SubscriptionRef.update(state, (current) => {
      if (Option.isNone(current.data)) return current;
      const loaded = current.data.value;
      const seen = new Set(loaded.activities.map((activity) => activity.id));
      return {
        ...current,
        data: Option.some({
          ...loaded,
          activities: [
            ...snapshot.subagent.activities.filter((activity) => !seen.has(activity.id)),
            ...loaded.activities,
          ],
        }),
        page: pageStateFromSnapshot(snapshot.page),
      };
    });
  });

  const tryMergePendingOlderPage = Effect.fn("EnvironmentSubagentState.tryMergePendingOlderPage")(
    function* () {
      const pending = yield* Ref.get(pendingOlderPage);
      if (pending === null) return;
      const epoch = yield* Ref.get(historyEpoch);
      if (epoch !== pending.epoch) {
        yield* Ref.set(pendingOlderPage, null);
        yield* SubscriptionRef.update(state, (current) => ({
          ...current,
          page: Option.map(current.page, (page) => ({ ...page, loadingOlder: false })),
        }));
        return;
      }
      const watermark = pending.snapshot.page?.threadSequence;
      if (watermark !== undefined && watermark > (yield* SubscriptionRef.get(lastSequence))) return;
      yield* Ref.set(pendingOlderPage, null);
      yield* mergeOlderPage(pending.snapshot);
    },
  );

  const applyItemLocked = Effect.fn("EnvironmentSubagentState.applyItemLocked")(function* (
    item: OrchestrationSubagentStreamItem,
  ) {
    if (item.kind === "snapshot") {
      yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
      yield* Ref.set(pendingOlderPage, null);
      yield* SubscriptionRef.set(lastSequence, item.snapshot.snapshotSequence);
      yield* setSubagent(item.snapshot.subagent, pageStateFromSnapshot(item.snapshot.page));
      return;
    }

    const sequence = yield* SubscriptionRef.get(lastSequence);
    if (item.kind === "cursor") {
      if (item.sequence > sequence) {
        yield* SubscriptionRef.set(lastSequence, item.sequence);
      }
      yield* tryMergePendingOlderPage();
      return;
    }
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
      yield* setSubagent(result.subagent, "keep");
      yield* tryMergePendingOlderPage();
      return;
    }
    if (result.kind === "deleted") {
      yield* setDeleted;
    }
  });

  const applyItem = Effect.fn("EnvironmentSubagentState.applyItem")(function* (
    item: OrchestrationSubagentStreamItem,
  ) {
    yield* applyLock.withPermits(1)(applyItemLocked(item));
  });

  const loadOlderActivities = Effect.fn("EnvironmentSubagentState.loadOlderActivities")(
    function* () {
      if (!(yield* Ref.get(paginationSupported))) return;
      const current = yield* SubscriptionRef.get(state);
      const page = Option.getOrNull(current.page);
      if (page === null || page.loadingOlder || !page.hasMore || page.beforeCursor === null) return;
      const prepared = Option.getOrNull(yield* SubscriptionRef.get(supervisor.prepared));
      if (prepared === null) return;
      const epochAtStart = yield* Ref.get(historyEpoch);
      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        page: Option.map(value.page, (existing) => ({ ...existing, loadingOlder: true })),
      }));
      const window: SubagentSnapshotWindow = {
        activityLimit: OLDER_SUBAGENT_ACTIVITY_LIMIT,
        beforeCursor: page.beforeCursor,
      };
      const response = yield* snapshotLoader.load(prepared, threadId, subagentId, window);
      yield* applyLock.withPermits(1)(
        Effect.gen(function* () {
          const epoch = yield* Ref.get(historyEpoch);
          const loadedSequence = yield* SubscriptionRef.get(lastSequence);
          const stale =
            epoch !== epochAtStart ||
            Option.match(response, {
              onNone: () => false,
              onSome: (snapshot) => snapshot.snapshotSequence < loadedSequence,
            });
          if (Option.isNone(response) || stale) {
            yield* SubscriptionRef.update(state, (value) => ({
              ...value,
              page: Option.map(value.page, (existing) => ({ ...existing, loadingOlder: false })),
            }));
            return;
          }
          const watermark = response.value.page?.threadSequence;
          if (watermark !== undefined && watermark > loadedSequence) {
            yield* Ref.set(pendingOlderPage, { snapshot: response.value, epoch });
            return;
          }
          yield* mergeOlderPage(response.value);
        }),
      );
    },
  );

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
  yield* subscribeDynamic(
    ORCHESTRATION_WS_METHODS.subscribeSubagent,
    Effect.fn("EnvironmentSubagentState.makeSubscribeInput")(function* (session) {
      const config = yield* session.initialConfig.pipe(
        Effect.orElseSucceed(() => ({}) as { subagentSnapshotPagination?: boolean }),
      );
      const supportsPagination = config.subagentSnapshotPagination === true;
      yield* Ref.set(paginationSupported, supportsPagination);
      yield* setSynchronizing;
      let current = yield* SubscriptionRef.get(state);
      if (!supportsPagination && Option.isSome(current.page)) {
        yield* Ref.update(historyEpoch, (epoch) => epoch + 1);
        yield* Ref.set(pendingOlderPage, null);
        yield* SubscriptionRef.set(lastSequence, 0);
        yield* SubscriptionRef.set(state, {
          data: Option.none(),
          status: "empty",
          error: Option.none(),
          page: Option.none(),
        });
        current = yield* SubscriptionRef.get(state);
      }
      if (Option.isNone(current.data) && current.status !== "deleted") {
        const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
          Effect.flatMap(
            Option.match({
              onSome: Effect.succeed,
              onNone: () =>
                SubscriptionRef.changes(supervisor.prepared).pipe(
                  Stream.filter(Option.isSome),
                  Stream.map((value) => value.value),
                  Stream.runHead,
                  Effect.map(Option.getOrThrow),
                ),
            }),
          ),
        );
        const base = yield* snapshotLoader.load(
          prepared,
          threadId,
          subagentId,
          supportsPagination ? { activityLimit: INITIAL_SUBAGENT_ACTIVITY_LIMIT } : undefined,
        );
        if (Option.isSome(base)) {
          yield* applyItem({ kind: "snapshot", snapshot: base.value });
          current = yield* SubscriptionRef.get(state);
        }
      }
      const canResume = Option.isSome(current.data);
      if (canResume) {
        yield* SubscriptionRef.update(state, (value) => ({
          ...value,
          status: value.status === "deleted" ? value.status : ("live" as const),
          error: Option.none(),
        }));
      }
      return {
        threadId,
        subagentId,
        ...(canResume ? { afterSequence: yield* SubscriptionRef.get(lastSequence) } : {}),
        ...(supportsPagination ? { activityLimit: INITIAL_SUBAGENT_ACTIVITY_LIMIT } : {}),
      };
    }),
    {
      onExpectedFailure: setStreamError,
      retryExpectedFailureAfter: "250 millis",
    },
  ).pipe(Stream.runForEach(applyItem), Effect.forkScoped);

  const requests = yield* SubagentOlderActivityRequests;
  const requestQueue = yield* Queue.sliding<void>(1);
  yield* Stream.fromQueue(requestQueue).pipe(
    Stream.runForEach(() => loadOlderActivities()),
    Effect.forkScoped,
  );
  const deregister = requests.register(subagentKey(environmentId, threadId, subagentId), () => {
    Queue.offerUnsafe(requestQueue, undefined);
  });
  yield* Effect.addFinalizer(() => Effect.sync(deregister));

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
  runtime: Atom.AtomRuntime<EnvironmentRegistry | SubagentSnapshotLoader | R, E>,
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
export * from "./subagentSnapshotHttp.ts";
export * from "./subagentState.ts";
