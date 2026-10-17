import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeSessionId,
  RuntimeRequestId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as PubSub from "effect/PubSub";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { it as effectIt } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../../project/RepositoryIdentityResolver.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { TurnAbortCoordinator } from "../Services/TurnAbortCoordinator.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProviderRuntimeIngestionLive } from "./ProviderRuntimeIngestion.ts";

const provider = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const projectId = ProjectId.make("compaction-project");
const createdAt = "2026-01-01T00:00:00.000Z";

interface TestThread {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly turnId: TurnId;
}

const eventBase = (thread: TestThread, id: string) => ({
  ...thread,
  provider,
  providerInstanceId,
  eventId: EventId.make(id),
  createdAt,
});

const usageEvent = (thread: TestThread, usedTokens = 60_000): ProviderRuntimeEvent => ({
  ...eventBase(thread, `usage:${thread.threadId}:${usedTokens}`),
  type: "thread.token-usage.updated",
  payload: { usage: { usedTokens, maxTokens: 100_000 } },
});

const finalMessageEvent = (thread: TestThread): ProviderRuntimeEvent => ({
  ...eventBase(thread, `final:${thread.threadId}`),
  type: "item.completed",
  itemId: RuntimeItemId.make(`final:${thread.threadId}`),
  payload: { itemType: "assistant_message", status: "completed", detail: "Final answer" },
});

const questionEvent = (thread: TestThread): ProviderRuntimeEvent => ({
  ...eventBase(thread, `question:${thread.threadId}`),
  type: "user-input.requested",
  requestId: RuntimeRequestId.make(`question:${thread.threadId}`),
  payload: { questions: [{ id: "choice", header: "Choice", question: "Continue?", options: [] }] },
});

const milestoneEvent = (thread: TestThread, id = "milestone"): ProviderRuntimeEvent => ({
  ...eventBase(thread, `${id}:${thread.threadId}`),
  type: "turn.completed",
  payload: { state: "completed" },
});

describe("ProviderRuntimeIngestion milestone compaction", () => {
  const createHarness = Effect.fn("createCompactionHarness")(function* (options?: {
    readonly compactThread?: ProviderServiceShape["compactThread"];
    readonly getCapabilities?: ProviderServiceShape["getCapabilities"];
  }) {
    const runtimeEvents = yield* PubSub.unbounded<{
      readonly events: ReadonlyArray<ProviderRuntimeEvent>;
      readonly enqueued: Deferred.Deferred<void>;
    }>();
    const sessions = new Map<ThreadId, ProviderSession>();
    const compactCalls: Array<{
      readonly threadId: ThreadId;
      readonly expectedRuntimeSessionId: Parameters<ProviderServiceShape["compactThread"]>[1];
    }> = [];
    const compactionTasks = yield* Queue.unbounded<Fiber.Fiber<unknown, unknown>>();
    const nativeCompactions = yield* Queue.unbounded<(typeof compactCalls)[number]>();
    const commandWaiters: Array<{
      readonly predicate: (command: OrchestrationCommand) => boolean;
      readonly receipt: Deferred.Deferred<OrchestrationCommand>;
    }> = [];
    const getCapabilities: ProviderServiceShape["getCapabilities"] =
      options?.getCapabilities ??
      (() => Effect.succeed({ sessionModelSwitch: "in-session", manualCompaction: true }));
    const providerLayer = Layer.mock(ProviderService, {
      listSessions: () => Effect.sync(() => [...sessions.values()]),
      getCapabilities: (instanceId) =>
        Effect.withFiber((fiber) =>
          Queue.offer(compactionTasks, fiber).pipe(Effect.andThen(getCapabilities(instanceId))),
        ),
      compactThread: (threadId, expectedRuntimeSessionId) =>
        Effect.suspend(() => {
          const call = { threadId, expectedRuntimeSessionId };
          compactCalls.push(call);
          return Queue.offer(nativeCompactions, call).pipe(
            Effect.andThen(
              options?.compactThread?.(threadId, expectedRuntimeSessionId) ?? Effect.void,
            ),
          );
        }),
      streamEvents: Stream.fromPubSub(runtimeEvents).pipe(
        Stream.flatMap(({ events, enqueued }) =>
          Stream.concat(
            Stream.fromIterable(events),
            Stream.fromEffect(Deferred.succeed(enqueued, undefined)).pipe(Stream.drain),
          ),
        ),
      ),
    });
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const observedEngineLayer = Layer.effect(
      OrchestrationEngineService,
      Effect.map(OrchestrationEngineService, (engine) =>
        OrchestrationEngineService.of({
          ...engine,
          dispatch: (command, dispatchOptions) =>
            engine
              .dispatch(command, dispatchOptions)
              .pipe(
                Effect.tap(() =>
                  Effect.forEach(commandWaiters, ({ predicate, receipt }) =>
                    predicate(command) ? Deferred.succeed(receipt, command) : Effect.void,
                  ),
                ),
              ),
        }),
      ),
    ).pipe(Layer.provide(orchestrationLayer));
    const layer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(observedEngineLayer),
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
      Layer.provideMerge(ThreadBackgroundLiveness.layer),
      Layer.provideMerge(ThreadPlanProgress.layer),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(providerLayer),
      Layer.provide(
        Layer.mock(TurnAbortCoordinator, { settleCooperative: () => Effect.succeed(false) }),
      ),
      Layer.provide(
        Layer.mock(CheckpointStore.CheckpointStore, {
          isGitRepository: () => Effect.succeed(false),
        }),
      ),
      Layer.provide(
        Layer.succeed(RepositoryIdentityResolver, { resolve: () => Effect.succeed(null) }),
      ),
      Layer.provide(ServerSettingsService.layerTest()),
      Layer.provide(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provide(NodeServices.layer),
    );
    const serviceScope = yield* Scope.fork(yield* Effect.scope, "sequential");
    const context = yield* Layer.buildWithMemoMap(layer, yield* Layer.makeMemoMap, serviceScope);
    const fork = <A, E>(effect: Effect.Effect<A, E>) => Effect.forkIn(effect, serviceScope);
    const engine = Context.get(context, OrchestrationEngineService);
    const query = Context.get(context, ProjectionSnapshotQuery);
    const ingestion = Context.get(context, ProviderRuntimeIngestionService);
    const scope = yield* Scope.fork(serviceScope, "sequential");
    const close = () => Scope.close(serviceScope, Exit.void);
    yield* ingestion.start().pipe(Scope.provide(scope));
    yield* engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("create-compaction-project"),
      projectId,
      title: "Compaction",
      workspaceRoot: process.cwd(),
      defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5-codex" },
      createdAt,
    });

    let sessionSequence = 0;
    const setSession = (
      thread: TestThread,
      overrides: Partial<NonNullable<OrchestrationThread["session"]>> = {},
    ) =>
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make(`session:${thread.threadId}:${sessionSequence++}`),
        threadId: thread.threadId,
        session: {
          threadId: thread.threadId,
          runtimeSessionId: thread.runtimeSessionId,
          providerName: "codex",
          providerInstanceId,
          status: "ready",
          activeTurnId: null,
          runtimeMode: "approval-required",
          abortState: null,
          lastError: null,
          updatedAt: createdAt,
          ...overrides,
        },
        createdAt,
      });

    const seedThread = Effect.fnUntraced(function* (id: string) {
      const thread = {
        threadId: ThreadId.make(id),
        runtimeSessionId: RuntimeSessionId.make(`runtime:${id}`),
        turnId: TurnId.make(`turn:${id}`),
      };
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`create:${id}`),
        threadId: thread.threadId,
        projectId,
        title: id,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      yield* setSession(thread, { status: "running", activeTurnId: thread.turnId });
      sessions.set(thread.threadId, {
        threadId: thread.threadId,
        runtimeSessionId: thread.runtimeSessionId,
        provider,
        providerInstanceId,
        status: "running",
        activeTurnId: thread.turnId,
        runtimeMode: "approval-required",
        createdAt,
        updatedAt: createdAt,
      });
      return thread;
    });

    return {
      fork,
      seedThread,
      setSession,
      close,
      compactCalls,
      nextCompactionTask: Queue.take(compactionTasks),
      nextNativeCompaction: Queue.take(nativeCompactions),
      drain: ingestion.drain,
      readModel: () => query.getSnapshot(),
      observeCommand: (predicate: (command: OrchestrationCommand) => boolean) => {
        const receipt = Deferred.makeUnsafe<OrchestrationCommand>();
        commandWaiters.push({ predicate, receipt });
        return fork(Deferred.await(receipt));
      },
      emitAndDrain: Effect.fnUntraced(function* (events: ReadonlyArray<ProviderRuntimeEvent>) {
        for (const event of events) {
          const session = sessions.get(event.threadId);
          if (session === undefined || session.runtimeSessionId !== event.runtimeSessionId)
            continue;
          if (event.type === "turn.started" || event.type === "turn.completed") {
            sessions.set(event.threadId, {
              ...session,
              status: event.type === "turn.started" ? "running" : "ready",
              activeTurnId:
                event.type === "turn.started" && event.turnId !== undefined
                  ? TurnId.make(event.turnId)
                  : undefined,
            });
          }
        }
        const enqueued = Deferred.makeUnsafe<void>();
        yield* PubSub.publish(runtimeEvents, { events, enqueued });
        yield* Deferred.await(enqueued);
        yield* ingestion.drain;
      }),
    };
  });

  effectIt.effect(
    "persists same-thread and other-thread final messages and drains while compaction is held",
    () =>
      Effect.gen(function* () {
        const compactStarted = Deferred.makeUnsafe<void>();
        const releaseCompaction = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({
          compactThread: () =>
            Deferred.succeed(compactStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseCompaction)),
            ),
        });
        const heldThread = yield* harness.seedThread("held");
        const otherThread = yield* harness.seedThread("other");
        yield* harness.emitAndDrain([usageEvent(heldThread), milestoneEvent(heldThread)]);
        yield* Deferred.await(compactStarted);

        const receiptFor = (thread: TestThread) =>
          harness.observeCommand(
            (command) =>
              command.type === "thread.message.assistant.complete" &&
              command.threadId === thread.threadId,
          );
        const heldReceipt = yield* receiptFor(heldThread);
        const otherReceipt = yield* receiptFor(otherThread);
        yield* harness.emitAndDrain([
          finalMessageEvent(heldThread),
          finalMessageEvent(otherThread),
        ]);
        yield* harness.drain;

        try {
          expect(yield* Deferred.isDone(releaseCompaction)).toBe(false);
          expect((yield* Fiber.await(otherReceipt))._tag).toBe("Success");
          expect((yield* Fiber.await(heldReceipt))._tag).toBe("Success");
        } finally {
          yield* Deferred.succeed(releaseCompaction, undefined);
          yield* harness.drain;
        }
      }),
  );

  effectIt.effect(
    "persists questions and terminal cleanup while native compaction remains held",
    () =>
      Effect.gen(function* () {
        const release = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({ compactThread: () => Deferred.await(release) });
        const thread = yield* harness.seedThread("terminal");
        yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
        yield* harness.nextNativeCompaction;
        const question = yield* harness.observeCommand(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "user-input.requested",
        );
        const dismissed = yield* harness.observeCommand(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "user-input.resolved",
        );
        const completed = yield* harness.observeCommand(
          (command) => command.type === "thread.message.assistant.complete",
        );
        try {
          yield* harness.emitAndDrain([
            {
              ...eventBase(thread, "terminal-text"),
              type: "content.delta",
              itemId: RuntimeItemId.make("terminal-text"),
              payload: { streamKind: "assistant_text", delta: "Answer before question" },
            },
            questionEvent(thread),
            milestoneEvent(thread, "terminal-again"),
          ]);
          yield* harness.drain;

          expect((yield* Fiber.await(question))._tag).toBe("Success");
          expect((yield* Fiber.await(dismissed))._tag).toBe("Success");
          expect((yield* Fiber.await(completed))._tag).toBe("Success");

          expect(harness.compactCalls).toHaveLength(1);
          expect(yield* Deferred.isDone(release)).toBe(false);
          const projected = (yield* harness.readModel()).threads.find(
            (entry) => entry.id === thread.threadId,
          );
          expect(projected?.session).toMatchObject({ status: "ready", activeTurnId: null });
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
      }),
  );

  effectIt.effect(
    "keeps a further thread and drain progressing with nine held native compactions",
    () =>
      Effect.gen(function* () {
        const release = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({ compactThread: () => Deferred.await(release) });
        const threads: TestThread[] = [];
        for (let index = 0; index < 9; index++) {
          threads.push(yield* harness.seedThread(`held-${index}`));
        }
        const other = yield* harness.seedThread("beyond-worker-capacity");
        const receipt = yield* harness.observeCommand(
          (command) =>
            command.type === "thread.message.assistant.complete" &&
            command.threadId === other.threadId,
        );
        try {
          yield* harness.emitAndDrain([
            ...threads.flatMap((thread) => [usageEvent(thread), milestoneEvent(thread)]),
            finalMessageEvent(other),
          ]);
          yield* harness.drain;

          yield* Effect.forEach(threads, () => harness.nextNativeCompaction);
          expect(harness.compactCalls.map((call) => call.threadId).toSorted()).toEqual(
            threads.map((thread) => thread.threadId).toSorted(),
          );
          expect((yield* Fiber.await(receipt))._tag).toBe("Success");

          expect(yield* Deferred.isDone(release)).toBe(false);
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
      }),
  );

  effectIt.effect(
    "deduplicates in-flight milestones and records only the usage actually attempted",
    () =>
      Effect.gen(function* () {
        const release = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({ compactThread: () => Deferred.await(release) });
        const thread = yield* harness.seedThread("duplicates");
        try {
          yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
          const firstTask = yield* harness.nextCompactionTask;
          yield* harness.nextNativeCompaction;
          yield* harness.emitAndDrain([
            milestoneEvent(thread, "duplicate"),
            usageEvent(thread, 70_000),
            milestoneEvent(thread, "increased-in-flight"),
          ]);
          yield* harness.drain;
          expect(harness.compactCalls).toEqual([
            { threadId: thread.threadId, expectedRuntimeSessionId: thread.runtimeSessionId },
          ]);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.await(firstTask);
          yield* harness.emitAndDrain([milestoneEvent(thread, "increased-after-completion")]);
          yield* harness.nextNativeCompaction;
          yield* Fiber.await(yield* harness.nextCompactionTask);
          yield* harness.emitAndDrain([milestoneEvent(thread, "same-attempted-usage")]);
          expect(harness.compactCalls).toHaveLength(2);
        } finally {
          yield* Deferred.succeed(release, undefined);
        }
      }),
  );

  effectIt.effect.each([
    "new turn",
    "approval",
    "question",
    "active child",
    "lower usage",
  ] as const)("rechecks %s before native start and does not consume a skipped attempt", (race) =>
    Effect.gen(function* () {
      const capabilitiesStarted = Deferred.makeUnsafe<void>();
      const releaseCapabilities = Deferred.makeUnsafe<void>();
      let capabilityCalls = 0;
      const harness = yield* createHarness({
        getCapabilities: () =>
          Effect.gen(function* () {
            capabilityCalls++;
            yield* Deferred.succeed(capabilitiesStarted, undefined);
            yield* Deferred.await(releaseCapabilities);
            return { sessionModelSwitch: "in-session" as const, manualCompaction: true };
          }),
      });
      const thread = yield* harness.seedThread(`race-${race}`);
      yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
      const scheduledTask = yield* harness.nextCompactionTask;
      yield* Deferred.await(capabilitiesStarted);
      yield* harness.emitAndDrain([milestoneEvent(thread, "duplicate-before-capabilities")]);
      expect(capabilityCalls).toBe(1);
      const childId = SubagentId.make("race-child");
      const requestId = RuntimeRequestId.make("race-approval");
      const newerTurn = { ...thread, turnId: TurnId.make("newer-turn") };
      const changed: ProviderRuntimeEvent =
        race === "new turn"
          ? { ...eventBase(newerTurn, "newer-started"), type: "turn.started", payload: {} }
          : race === "approval"
            ? {
                ...eventBase(thread, "race-approval-opened"),
                type: "request.opened",
                requestId,
                payload: { requestType: "command_execution_approval", detail: "pwd" },
              }
            : race === "question"
              ? questionEvent(thread)
              : race === "active child"
                ? {
                    ...eventBase(thread, "race-child-started"),
                    type: "subagent.state.changed",
                    subagentId: childId,
                    payload: { subagentId: childId, state: "running" },
                  }
                : usageEvent(thread, 49_999);
      yield* harness.emitAndDrain([changed]);
      yield* harness.drain;
      yield* Deferred.succeed(releaseCapabilities, undefined);
      yield* Fiber.await(scheduledTask);
      expect(harness.compactCalls).toHaveLength(0);

      const settled: ProviderRuntimeEvent[] =
        race === "new turn"
          ? [milestoneEvent(newerTurn, "newer-finished")]
          : race === "approval"
            ? [
                {
                  ...eventBase(thread, "race-approval-resolved"),
                  type: "request.resolved",
                  requestId,
                  payload: { requestType: "command_execution_approval", decision: "accept" },
                },
                milestoneEvent(thread, "after-approval"),
              ]
            : race === "question"
              ? [
                  {
                    ...eventBase(thread, "race-question-resolved"),
                    type: "user-input.resolved",
                    requestId: RuntimeRequestId.make(`question:${thread.threadId}`),
                    payload: { answers: {} },
                  },
                  milestoneEvent(thread, "after-question"),
                ]
              : race === "active child"
                ? [
                    {
                      ...eventBase(thread, "race-child-settled"),
                      type: "subagent.state.changed",
                      subagentId: childId,
                      payload: { subagentId: childId, state: "completed" },
                    },
                  ]
                : [usageEvent(thread), milestoneEvent(thread, "usage-restored")];
      yield* harness.emitAndDrain(settled);
      yield* harness.nextNativeCompaction;
      yield* Fiber.await(yield* harness.nextCompactionTask);
      expect(harness.compactCalls).toEqual([
        { threadId: thread.threadId, expectedRuntimeSessionId: thread.runtimeSessionId },
      ]);
    }),
  );

  effectIt.effect("uses the latest eligible usage after an asynchronous capability lookup", () =>
    Effect.gen(function* () {
      const release = Deferred.makeUnsafe<void>();
      const harness = yield* createHarness({
        getCapabilities: () =>
          Deferred.await(release).pipe(
            Effect.as({ sessionModelSwitch: "in-session" as const, manualCompaction: true }),
          ),
      });
      const thread = yield* harness.seedThread("latest-usage");
      yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
      const scheduledTask = yield* harness.nextCompactionTask;
      yield* harness.emitAndDrain([usageEvent(thread, 75_000)]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.await(scheduledTask);
      expect(harness.compactCalls).toHaveLength(1);
      yield* harness.emitAndDrain([milestoneEvent(thread, "already-attempted-current-usage")]);
      expect(harness.compactCalls).toHaveLength(1);
    }),
  );

  effectIt.effect(
    "rejects a scheduled task after runtime replacement and requires usage from the new runtime",
    () =>
      Effect.gen(function* () {
        const release = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({
          getCapabilities: () =>
            Deferred.await(release).pipe(
              Effect.as({ sessionModelSwitch: "in-session" as const, manualCompaction: true }),
            ),
        });
        const old = yield* harness.seedThread("replaced-before-start");
        yield* harness.emitAndDrain([usageEvent(old), milestoneEvent(old)]);
        const scheduledTask = yield* harness.nextCompactionTask;
        const replacement = {
          ...old,
          runtimeSessionId: RuntimeSessionId.make("replacement-runtime"),
        };
        yield* harness.setSession(replacement);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.await(scheduledTask);
        expect(harness.compactCalls).toHaveLength(0);
        yield* harness.emitAndDrain([milestoneEvent(replacement, "no-new-runtime-usage")]);
        expect(harness.compactCalls).toHaveLength(0);
        yield* harness.emitAndDrain([
          usageEvent(replacement),
          milestoneEvent(replacement, "new-runtime-usage"),
        ]);
        yield* harness.nextNativeCompaction;
        yield* Fiber.await(yield* harness.nextCompactionTask);
        expect(harness.compactCalls).toEqual([
          { threadId: old.threadId, expectedRuntimeSessionId: replacement.runtimeSessionId },
        ]);
      }),
  );

  effectIt.effect(
    "keeps a replacement task reserved when the old runtime finalizer finishes later",
    () =>
      Effect.gen(function* () {
        const releaseOld = Deferred.makeUnsafe<void>();
        const releaseNew = Deferred.makeUnsafe<void>();
        const oldFinalized = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({
          compactThread: (_threadId, runtimeSessionId) =>
            runtimeSessionId === RuntimeSessionId.make("old-held-runtime")
              ? Deferred.await(releaseOld).pipe(
                  Effect.uninterruptible,
                  Effect.ensuring(Deferred.succeed(oldFinalized, undefined)),
                )
              : Deferred.await(releaseNew),
        });
        const seeded = yield* harness.seedThread("replacement-in-flight");
        const old = { ...seeded, runtimeSessionId: RuntimeSessionId.make("old-held-runtime") };
        const replacement = {
          ...seeded,
          runtimeSessionId: RuntimeSessionId.make("new-held-runtime"),
        };
        yield* harness.setSession(old);
        try {
          yield* harness.emitAndDrain([usageEvent(old), milestoneEvent(old)]);
          const oldTask = yield* harness.nextCompactionTask;
          yield* harness.nextNativeCompaction;
          yield* harness.setSession(replacement);
          yield* harness.emitAndDrain([
            usageEvent(replacement),
            milestoneEvent(replacement, "replacement"),
          ]);
          yield* harness.nextNativeCompaction;
          expect(harness.compactCalls).toHaveLength(2);
          yield* Deferred.succeed(releaseOld, undefined);
          yield* Deferred.await(oldFinalized);
          yield* Fiber.await(oldTask);
          yield* harness.emitAndDrain([
            usageEvent(replacement, 80_000),
            milestoneEvent(replacement, "after-old-finalizer"),
            milestoneEvent(old, "stale-old-terminal"),
          ]);
          yield* harness.drain;
          expect(harness.compactCalls).toHaveLength(2);
          expect(yield* Deferred.isDone(releaseNew)).toBe(false);
          const projected = (yield* harness.readModel()).threads.find(
            (entry) => entry.id === replacement.threadId,
          );
          expect(projected?.session?.runtimeSessionId).toBe(replacement.runtimeSessionId);
        } finally {
          yield* Deferred.succeed(releaseOld, undefined);
          yield* Deferred.succeed(releaseNew, undefined);
        }
      }),
  );

  effectIt.effect(
    "retains per-runtime attempted usage after failure and releases the in-flight token",
    () =>
      Effect.gen(function* () {
        const failure = new ProviderAdapterRequestError({
          provider: "codex",
          method: "thread/compact/start",
          detail: "injected milestone failure",
        });
        const harness = yield* createHarness({ compactThread: () => Effect.fail(failure) });
        const thread = yield* harness.seedThread("failure");
        yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
        yield* harness.nextNativeCompaction;
        yield* Fiber.await(yield* harness.nextCompactionTask);
        expect(harness.compactCalls).toHaveLength(1);
        yield* harness.emitAndDrain([milestoneEvent(thread, "failed-same-usage")]);
        expect(harness.compactCalls).toHaveLength(1);
        yield* harness.emitAndDrain([
          usageEvent(thread, 70_000),
          milestoneEvent(thread, "failed-increased-usage"),
        ]);
        yield* harness.nextNativeCompaction;
        yield* Fiber.await(yield* harness.nextCompactionTask);
        expect(harness.compactCalls).toHaveLength(2);
        const replacement = { ...thread, runtimeSessionId: RuntimeSessionId.make("after-failure") };
        yield* harness.setSession(replacement);
        yield* harness.emitAndDrain([
          usageEvent(replacement, 70_000),
          milestoneEvent(replacement, "new-runtime-same-usage"),
          finalMessageEvent(replacement),
        ]);
        yield* harness.nextNativeCompaction;
        yield* Fiber.await(yield* harness.nextCompactionTask);
        expect(harness.compactCalls).toHaveLength(3);
        const projected = (yield* harness.readModel()).threads.find(
          (entry) => entry.id === thread.threadId,
        );
        expect(projected?.session).toMatchObject({ status: "ready", lastError: null });
        expect(projected?.messages.some((message) => message.text === "Final answer")).toBe(true);
      }),
  );

  effectIt.effect("does not consume an attempt when the capability lookup fails", () =>
    Effect.gen(function* () {
      let capabilityCalls = 0;
      const harness = yield* createHarness({
        getCapabilities: () =>
          Effect.suspend(() => {
            capabilityCalls++;
            return capabilityCalls === 1
              ? Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "codex",
                    method: "capabilities",
                    detail: "injected capability failure",
                  }),
                )
              : Effect.succeed({
                  sessionModelSwitch: "in-session" as const,
                  manualCompaction: true,
                });
          }),
      });
      const thread = yield* harness.seedThread("capability-failure");
      yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
      yield* Fiber.await(yield* harness.nextCompactionTask);
      expect(harness.compactCalls).toHaveLength(0);
      yield* harness.emitAndDrain([milestoneEvent(thread, "retry-capability")]);
      yield* harness.nextNativeCompaction;
      yield* Fiber.await(yield* harness.nextCompactionTask);
      expect(harness.compactCalls).toHaveLength(1);
    }),
  );

  effectIt.effect(
    "cancels native background work on session exit and clears its runtime usage",
    () =>
      Effect.gen(function* () {
        const finalized = Deferred.makeUnsafe<void>();
        const harness = yield* createHarness({
          compactThread: () =>
            Effect.never.pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
        });
        const thread = yield* harness.seedThread("session-exit");
        yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
        const scheduledTask = yield* harness.nextCompactionTask;
        yield* harness.nextNativeCompaction;
        expect(harness.compactCalls).toHaveLength(1);
        yield* harness.emitAndDrain([
          { ...eventBase(thread, "exit"), type: "session.exited", payload: {} },
        ]);
        yield* Fiber.await(scheduledTask);
        expect(yield* Deferred.isDone(finalized)).toBe(true);
        const replacement = { ...thread, runtimeSessionId: RuntimeSessionId.make("after-exit") };
        yield* harness.setSession(replacement);
        yield* harness.emitAndDrain([milestoneEvent(replacement, "after-exit-without-usage")]);
        expect(harness.compactCalls).toHaveLength(1);
      }),
  );

  effectIt.effect("interrupts held compaction when the ingestion service scope closes", () =>
    Effect.gen(function* () {
      const finalized = Deferred.makeUnsafe<void>();
      const harness = yield* createHarness({
        compactThread: () =>
          Effect.never.pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
      });
      const thread = yield* harness.seedThread("service-close");
      yield* harness.emitAndDrain([usageEvent(thread), milestoneEvent(thread)]);
      yield* harness.nextNativeCompaction;
      expect(harness.compactCalls).toHaveLength(1);
      expect(yield* Deferred.isDone(finalized)).toBe(false);
      yield* harness.close();
      expect(yield* Deferred.isDone(finalized)).toBe(true);
    }),
  );

  effectIt.effect.each([
    { name: "below fifty percent", usedTokens: 49_999, maxTokens: 100_000, manual: true, calls: 0 },
    {
      name: "exactly fifty percent",
      usedTokens: 50_000,
      maxTokens: 100_000,
      manual: true,
      calls: 1,
    },
    {
      name: "the existing floored threshold",
      usedTokens: 50_000,
      maxTokens: 100_001,
      manual: true,
      calls: 1,
    },
    {
      name: "missing context maximum",
      usedTokens: 60_000,
      maxTokens: undefined,
      manual: true,
      calls: 0,
    },
    { name: "capability false", usedTokens: 60_000, maxTokens: 100_000, manual: false, calls: 0 },
    {
      name: "capability omitted",
      usedTokens: 60_000,
      maxTokens: 100_000,
      manual: undefined,
      calls: 0,
    },
  ])("preserves $name", ({ usedTokens, maxTokens, manual, calls }) =>
    Effect.gen(function* () {
      const harness = yield* createHarness({
        getCapabilities: () =>
          Effect.succeed({
            sessionModelSwitch: "in-session",
            ...(manual !== undefined ? { manualCompaction: manual } : {}),
          }),
      });
      const thread = yield* harness.seedThread("threshold");
      yield* harness.emitAndDrain([
        {
          ...eventBase(thread, "threshold-usage"),
          type: "thread.token-usage.updated",
          payload: { usage: { usedTokens, ...(maxTokens !== undefined ? { maxTokens } : {}) } },
        },
        milestoneEvent(thread),
      ]);
      if (maxTokens !== undefined && usedTokens >= 50_000) {
        yield* Fiber.await(yield* harness.nextCompactionTask);
      }
      expect(harness.compactCalls).toHaveLength(calls);
    }),
  );
});
