import {
  DeepPlanRunId,
  EnvironmentId,
  EventId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "./connection/model.ts";
import { EnvironmentSupervisor } from "./connection/supervisor.ts";
import { EnvironmentCacheStore } from "./platform/persistence.ts";
import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import type { RpcSession } from "./rpc/session.ts";
import { applyThreadDetailEvent } from "./state/threadReducer.ts";
import {
  makeEnvironmentThreadState,
  ThreadSnapshotLoader,
  type EnvironmentThreadState,
} from "./state/threads.ts";

const createdAt = "2026-10-16T08:00:00.000Z";
const ownerId = ThreadId.make("plan-owner");
const implementationId = ThreadId.make("plan-implementation");
const modelSelection = {
  instanceId: ProviderInstanceId.make("acceptance-provider"),
  model: "implementation-model",
};
const run = {
  id: DeepPlanRunId.make("acceptance-run"),
  threadId: ownerId,
  phase: "implementing",
  revision: 3,
  plan: {
    schemaVersion: 1,
    version: 1,
    goal: "Preserve the approved work",
    scope: ["Thread state"],
    decisions: [],
    affectedAreas: [],
    steps: [
      {
        id: "persist",
        title: "Persist the work",
        description: "Save the approved work.",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "restore",
            description: "Saved work survives restart",
            checkMethod: "Restore a saved run",
          },
        ],
      },
    ],
    finalValidation: {
      description: "Restore the complete workflow",
      checkMethod: "Reconnect and inspect the saved run",
    },
  },
  approvalKey: "approved-key",
  approval: {
    planVersion: 1,
    approvalKey: "approved-key",
    approvedAt: createdAt,
    approvedBy: "user",
    implementation: modelSelection,
    implementationThreadId: implementationId,
    implementerId: `thread:${implementationId}`,
  },
  sources: [],
  sourceCoverage: [],
  stepStates: [{ stepId: "persist", status: "pending", evidence: [], updatedAt: createdAt }],
  finalValidation: {
    status: "pending",
    evidence: [],
    updatedAt: null,
    attempt: 0,
    requestId: null,
    turnId: null,
  },
  procedureAdjustments: [],
  operations: [],
  createdAt,
  updatedAt: createdAt,
  pauseReason: null,
} satisfies DeepPlanRun;

function thread(id: ThreadId, deepPlan?: DeepPlanRun | null): OrchestrationThread {
  return {
    id,
    projectId: ProjectId.make("acceptance-project"),
    title: "Thread",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    pullRequests: [],
    messages: [],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
    ...(deepPlan === undefined ? {} : { deepPlan }),
  };
}

function event(nextRun: DeepPlanRun): OrchestrationEvent {
  return {
    type: "thread.deep-plan-updated",
    sequence: nextRun.revision,
    eventId: EventId.make(`deep-plan:${nextRun.revision}`),
    aggregateKind: "thread",
    aggregateId: nextRun.threadId,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    occurredAt: nextRun.updatedAt,
    metadata: {},
    payload: { threadId: nextRun.threadId, run: nextRun, updatedAt: nextRun.updatedAt },
  };
}

const makeStreamHarness = Effect.fnUntraced(function* () {
  const inputs = yield* Queue.unbounded<OrchestrationThreadStreamItem>();
  const observed = yield* Queue.unbounded<EnvironmentThreadState>();
  const saved = yield* Queue.unbounded<OrchestrationThreadDetailSnapshot>();
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("deep-plan-snapshot-environment"),
    label: "Acceptance environment",
    httpBaseUrl: "https://acceptance.example.test",
    wsBaseUrl: "wss://acceptance.example.test",
  });
  const client = {
    [ORCHESTRATION_WS_METHODS.subscribeThread]: () => Stream.fromQueue(inputs),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.succeed({ threadResumeCompletionMarker: true } as never),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  const supervisor = EnvironmentSupervisor.of({
    target,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(
      Option.some({
        environmentId: target.environmentId,
        label: target.label,
        httpBaseUrl: target.httpBaseUrl,
        socketUrl: target.wsBaseUrl,
        httpAuthorization: null,
        target,
      }),
    ),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const cache = EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeedSome({ snapshotSequence: 10, thread: thread(ownerId, run) }),
    saveThread: (_environmentId, snapshot) => Queue.offer(saved, snapshot).pipe(Effect.asVoid),
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const state = yield* makeEnvironmentThreadState(ownerId).pipe(
    Effect.provideService(EnvironmentSupervisor, supervisor),
    Effect.provideService(EnvironmentCacheStore, cache),
    Effect.provideService(
      ThreadSnapshotLoader,
      ThreadSnapshotLoader.of({ load: () => Effect.succeedNone }),
    ),
  );
  yield* SubscriptionRef.changes(state).pipe(
    Stream.runForEach((value) => Queue.offer(observed, value)),
    Effect.forkScoped,
  );
  const awaitThread = (title: string) =>
    Queue.take(observed).pipe(
      Effect.repeat({
        until: (value) => value.status === "live" && Option.getOrNull(value.data)?.title === title,
      }),
      Effect.map((value) => Option.getOrThrow(value.data)),
    );
  const awaitSaved = (title: string) =>
    Queue.take(saved).pipe(Effect.repeat({ until: (snapshot) => snapshot.thread.title === title }));
  return { inputs, state, awaitThread, awaitSaved };
});

describe("Deep Planning detail projection acceptance", () => {
  it.each([ownerId, implementationId])(
    "updates the owner or approved implementation thread %s",
    (id) => {
      const result = applyThreadDetailEvent(thread(id), event(run));
      expect(result.kind).toBe("updated");
      if (result.kind !== "updated") throw new Error("Deep Plan update was ignored");
      expect(result.thread.deepPlan).toEqual(run);
      expect(result.thread.id).toBe(id);
    },
  );

  it("ignores an unrelated run without changing the thread", () => {
    const unrelated = thread(ThreadId.make("unrelated-thread"));
    expect(applyThreadDetailEvent(unrelated, event(run))).toEqual({ kind: "unchanged" });
    expect(unrelated.deepPlan).toBeUndefined();
  });

  it.each([run.revision - 1, run.revision])(
    "ignores stale or duplicate revision %s",
    (revision) => {
      const current = thread(implementationId, run);
      const stale = {
        ...run,
        revision,
        phase: "awaitingApproval",
        approval: null,
      } satisfies DeepPlanRun;
      expect(applyThreadDetailEvent(current, event(stale))).toEqual({ kind: "unchanged" });
      expect(current.deepPlan).toBe(run);
    },
  );

  it("updates the owner and clears the previous implementation mirror when a revision needs approval", () => {
    const revised = {
      ...run,
      revision: run.revision + 1,
      phase: "awaitingApproval",
      approval: null,
    } satisfies DeepPlanRun;
    const owner = applyThreadDetailEvent(thread(ownerId, run), event(revised));
    const implementation = applyThreadDetailEvent(thread(implementationId, run), event(revised));
    expect(owner.kind).toBe("updated");
    expect(implementation.kind).toBe("updated");
    if (owner.kind !== "updated" || implementation.kind !== "updated")
      throw new Error("Revised plan did not update both projections");
    expect(owner.thread.deepPlan).toEqual(revised);
    expect(implementation.thread.deepPlan).toBeNull();
  });

  it("moves the mirror to the newly approved implementation thread", () => {
    const newImplementationId = ThreadId.make("new-implementation-thread");
    const reassigned = {
      ...run,
      revision: run.revision + 1,
      approval: {
        ...run.approval,
        implementationThreadId: newImplementationId,
        implementerId: `thread:${newImplementationId}`,
      },
    } satisfies DeepPlanRun;
    const previous = applyThreadDetailEvent(thread(implementationId, run), event(reassigned));
    const next = applyThreadDetailEvent(thread(newImplementationId), event(reassigned));
    expect(previous.kind).toBe("updated");
    expect(next.kind).toBe("updated");
    if (previous.kind !== "updated" || next.kind !== "updated")
      throw new Error("Implementation mirror was not reassigned");
    expect(previous.thread.deepPlan).toBeNull();
    expect(next.thread.deepPlan).toEqual(reassigned);
  });

  it.effect("replaces cached Deep Plan data when fresh snapshots omit or clear it", () =>
    Effect.gen(function* () {
      const replacements = [
        { ...thread(ownerId, null), title: "Explicitly cleared" },
        { ...thread(ownerId), title: "Omitted by the server" },
      ];
      for (const replacement of replacements) {
        const awaitSaved = yield* Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* makeStreamHarness();
            const cached = Option.getOrThrow((yield* SubscriptionRef.get(harness.state)).data);
            expect(cached.deepPlan).toEqual(run);
            yield* Queue.offer(harness.inputs, {
              kind: "snapshot",
              snapshot: { snapshotSequence: 12, thread: replacement },
            });
            yield* Queue.offer(harness.inputs, { kind: "synchronized" });
            expect((yield* harness.awaitThread(replacement.title)).deepPlan).toBe(
              replacement.deepPlan,
            );
            return harness.awaitSaved;
          }),
        );
        expect((yield* awaitSaved(replacement.title)).thread.deepPlan).toBe(replacement.deepPlan);
      }
    }),
  );
});
