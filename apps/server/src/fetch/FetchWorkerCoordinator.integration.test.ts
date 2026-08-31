import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  RuntimeSessionId,
  SubagentId,
  TextGenerationError,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationSession,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { describe, expect } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  FETCH_ABORT_FORCE_DELAY,
  FETCH_WORKER_TIMEOUT,
  FetchWorkerCoordinator,
  FetchWorkerCoordinatorLive,
  type FetchRunInput,
} from "./FetchWorkerCoordinator.ts";

const parentThreadId = ThreadId.make("thread-fetch-parent");
const codexDriver = ProviderDriverKind.make("codex");
const codexInstance = ProviderInstanceId.make("codex-fetch");
const createdAt = "2026-08-09T10:00:00.000Z";
const selection: ModelSelection = {
  instanceId: codexInstance,
  model: "gpt-5.3-codex-spark",
  options: [
    { id: "reasoningEffort", value: "low" },
    { id: "serviceTier", value: "priority" },
  ],
};

type EventMode =
  | "normal"
  | "isolation-approvals"
  | "native-read"
  | "workspace-context"
  | "other-mcp"
  | "hidden-input"
  | "mutation"
  | "command"
  | "completed-command"
  | "unknown-dynamic"
  | "nested";

interface HarnessOptions {
  readonly workerCount?: number;
  readonly skip?: boolean;
  readonly gateStarts?: boolean;
  readonly neverStart?: boolean;
  readonly neverStop?: boolean;
  readonly eventMode?: EventMode;
  readonly assistantDeltaCount?: number;
  readonly failureIndexes?: ReadonlySet<number>;
  readonly failAbortProjection?: boolean;
  readonly failWorkerMessageImport?: boolean;
  readonly failActivityAppendOnce?: boolean;
  readonly failAssistantDeltaOnce?: boolean;
  readonly mainRuntimeSessionId?: RuntimeSessionId | null;
  readonly plan?: TextGeneration.TextGeneration["Service"]["planFetchExploration"];
}

function makeTextGeneration(
  planFetchExploration: TextGeneration.TextGeneration["Service"]["planFetchExploration"],
): TextGeneration.TextGeneration["Service"] {
  return TextGeneration.TextGeneration.of({
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: () => Effect.die("unused"),
    translateTranscriptToEnglish: () => Effect.die("unused"),
    improvePrompt: () => Effect.die("unused"),
    reviewPlanParallelism: () => Effect.die("unused"),
    planFetchExploration,
  });
}

function workerIndex(threadId: ThreadId): number {
  return Number(String(threadId).split(":").at(-1) ?? "0");
}

const makeHarness = (options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const workerCount = options.workerCount ?? 1;
    const eventMode = options.eventMode ?? "normal";
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const starts = yield* Ref.make<ReadonlyArray<ProviderSessionStartInput>>([]);
    const workspaceContextThreads = yield* Ref.make<ReadonlyArray<ThreadId | undefined>>([]);
    const sends = yield* Ref.make<ReadonlyArray<ProviderSendTurnInput>>([]);
    const stops = yield* Ref.make<
      ReadonlyArray<{ threadId: ThreadId; runtimeSessionId: RuntimeSessionId }>
    >([]);
    const lifecycle = yield* Ref.make<ReadonlyArray<string>>([]);
    const interrupts = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
    const forces = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
    const responses = yield* Ref.make<
      ReadonlyArray<{ requestId: ApprovalRequestId; decision: string }>
    >([]);
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const planInputs = yield* Ref.make<
      ReadonlyArray<TextGeneration.FetchExplorationGenerationInput>
    >([]);
    const allStartsEntered = yield* Deferred.make<void>();
    const firstStartEntered = yield* Deferred.make<void>();
    const allInterruptsEntered = yield* Deferred.make<void>();
    const firstInterruptEntered = yield* Deferred.make<void>();
    const releaseStarts = yield* Deferred.make<void>();
    const plannerEntered = yield* Deferred.make<void>();
    const stopEntered = yield* Deferred.make<void>();
    const runtimeByThread = new Map<
      ThreadId,
      { readonly runtimeSessionId: RuntimeSessionId; readonly instanceId: ProviderInstanceId }
    >();
    let eventSequence = 0;
    let dispatchSequence = 0;
    let workerMessageImportFailed = false;
    let activityAppendFailed = false;
    let assistantDeltaFailed = false;

    const initialSession: OrchestrationSession = {
      threadId: parentThreadId,
      status: "starting",
      providerName: "codex",
      providerInstanceId: codexInstance,
      runtimeSessionId: options.mainRuntimeSessionId ?? null,
      runtimeMode: "full-access",
      activeTurnId: null,
      abortState: null,
      lastError: null,
      updatedAt: createdAt,
    };
    const session = yield* Ref.make<OrchestrationSession>(initialSession);
    const backgroundLiveness = ThreadBackgroundLiveness.make();

    const publish = (event: ProviderRuntimeEvent) =>
      PubSub.publish(events, event).pipe(Effect.asVoid);
    const baseEvent = (
      threadId: ThreadId,
      runtimeSessionId: RuntimeSessionId,
      instanceId: ProviderInstanceId,
    ) => {
      eventSequence += 1;
      return {
        eventId: EventId.make(`fetch-event-${eventSequence}`),
        provider: codexDriver,
        providerInstanceId: instanceId,
        threadId,
        runtimeSessionId,
        createdAt,
      } as const;
    };

    const publishWorkerEvents = Effect.fn("test.publishWorkerEvents")(function* (
      input: ProviderSendTurnInput,
    ) {
      const binding = runtimeByThread.get(input.threadId);
      if (!binding) return;
      const index = workerIndex(input.threadId);
      const turnId = TurnId.make(`fetch-turn-${index}`);
      yield* Effect.yieldNow;

      if (eventMode === "isolation-approvals") {
        yield* publish({
          ...baseEvent(
            input.threadId,
            RuntimeSessionId.make(`wrong-generation-${index}`),
            binding.instanceId,
          ),
          type: "content.delta",
          turnId,
          payload: { streamKind: "assistant_text", delta: "LEAK-WRONG-GENERATION" },
        });
        yield* publish({
          ...baseEvent(
            input.threadId,
            binding.runtimeSessionId,
            ProviderInstanceId.make("wrong-instance"),
          ),
          type: "content.delta",
          turnId,
          payload: { streamKind: "assistant_text", delta: "LEAK-WRONG-INSTANCE" },
        });
        yield* publish({
          ...baseEvent(parentThreadId, binding.runtimeSessionId, binding.instanceId),
          type: "content.delta",
          turnId,
          payload: { streamKind: "assistant_text", delta: "LEAK-PARENT-THREAD" },
        });
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "request.opened",
          turnId,
          requestId: RuntimeRequestId.make(`read-${index}`),
          payload: { requestType: "file_read_approval", detail: "Read source" },
        });
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "request.opened",
          turnId,
          requestId: RuntimeRequestId.make(`command-${index}`),
          payload: { requestType: "command_execution_approval", detail: "Run git status" },
        });
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "request.opened",
          turnId,
          requestId: RuntimeRequestId.make(`dynamic-${index}`),
          payload: { requestType: "dynamic_tool_call", detail: "Unknown dynamic tool" },
        });
      }

      if (eventMode === "hidden-input") {
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "user-input.requested",
          turnId,
          requestId: RuntimeRequestId.make(`question-${index}`),
          payload: {
            questions: [
              {
                id: "choice",
                header: "Choice",
                question: "Which path?",
                options: [{ label: "A", description: "Path A" }],
              },
            ],
          },
        });
      }
      if (eventMode === "mutation") {
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "item.started",
          turnId,
          payload: { itemType: "file_change", title: "Edit source" },
        });
      }
      if (eventMode === "command") {
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "item.started",
          turnId,
          payload: { itemType: "command_execution", title: "Run git status" },
        });
      }
      if (eventMode === "native-read" || eventMode === "unknown-dynamic") {
        for (const type of eventMode === "native-read"
          ? (["item.started", "item.updated", "item.completed"] as const)
          : (["item.started"] as const)) {
          yield* publish({
            ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
            type,
            turnId,
            payload: {
              itemType: "dynamic_tool_call",
              title: eventMode === "native-read" ? "Read" : "Unknown tool",
              data:
                eventMode === "native-read"
                  ? { toolName: "Read", kind: "read" }
                  : { toolName: "arbitrary-code", kind: "other" },
            },
          });
        }
      }
      if (eventMode === "workspace-context" || eventMode === "other-mcp") {
        const tool = eventMode === "workspace-context" ? "workspace_context" : "preview_status";
        for (const type of ["item.started", "item.completed"] as const) {
          yield* publish({
            ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
            type,
            turnId,
            payload: {
              itemType: "mcp_tool_call",
              title: `t3-code · ${tool}`,
              data: { item: { type: "mcpToolCall", server: "t3-code", tool } },
            },
          });
        }
      }
      if (eventMode === "completed-command") {
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "item.completed",
          turnId,
          payload: { itemType: "command_execution", title: "Ran a hidden command" },
        });
      }
      if (eventMode === "nested") {
        yield* publish({
          ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
          type: "subagent.discovered",
          turnId,
          payload: {
            subagentId: SubagentId.make(`nested-${index}`),
            providerThreadId: `nested-provider-${index}`,
          },
        });
      }

      if (
        eventMode === "normal" ||
        eventMode === "isolation-approvals" ||
        eventMode === "native-read" ||
        eventMode === "workspace-context"
      ) {
        for (let deltaIndex = 0; deltaIndex < (options.assistantDeltaCount ?? 1); deltaIndex += 1) {
          yield* publish({
            ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
            type: "content.delta",
            turnId,
            payload: {
              streamKind: "assistant_text",
              delta:
                deltaIndex === 0
                  ? `Evidence from worker ${index}`
                  : `; additional evidence ${deltaIndex}`,
            },
          });
        }
      }
      const failed = options.failureIndexes?.has(index) === true;
      yield* publish({
        ...baseEvent(input.threadId, binding.runtimeSessionId, binding.instanceId),
        type: "turn.completed",
        turnId,
        payload: {
          state: failed ? "failed" : "completed",
          ...(failed ? { errorMessage: `Worker ${index} failed` } : {}),
        },
      });
    });

    const startTransientSession: ProviderServiceShape["startTransientSession"] = (
      threadId,
      input,
      sessionOptions,
    ) =>
      Effect.gen(function* () {
        yield* Ref.update(starts, (values) => [...values, input]);
        yield* Ref.update(workspaceContextThreads, (values) => [
          ...values,
          sessionOptions?.workspaceContextThreadId,
        ]);
        yield* Ref.update(lifecycle, (values) => [...values, `start:${workerIndex(threadId)}`]);
        const runtimeSessionId = input.runtimeSessionId!;
        const instanceId = input.providerInstanceId!;
        runtimeByThread.set(threadId, { runtimeSessionId, instanceId });
        const count = (yield* Ref.get(starts)).length;
        if (count === 1) yield* Deferred.succeed(firstStartEntered, undefined).pipe(Effect.ignore);
        if (count >= workerCount)
          yield* Deferred.succeed(allStartsEntered, undefined).pipe(Effect.ignore);
        if (options.neverStart === true) return yield* Effect.never;
        if (options.gateStarts === true) yield* Deferred.await(releaseStarts);
        return {
          provider: codexDriver,
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model: input.modelSelection?.model,
          threadId,
          runtimeSessionId,
          createdAt,
          updatedAt: createdAt,
        } as ProviderSession;
      });

    const providerService = {
      startTransientSession,
      sendTurn: (input: ProviderSendTurnInput) =>
        Effect.gen(function* () {
          yield* Ref.update(sends, (values) => [...values, input]);
          yield* publishWorkerEvents(input);
          return {
            threadId: input.threadId,
            turnId: TurnId.make(`fetch-turn-${workerIndex(input.threadId)}`),
          };
        }),
      respondToRequest: (input) =>
        Ref.update(responses, (values) => [
          ...values,
          { requestId: input.requestId, decision: input.decision },
        ]),
      interruptAbortTarget: (target) =>
        Ref.updateAndGet(interrupts, (values) => [...values, target.threadId]).pipe(
          Effect.tap((values) =>
            Effect.all(
              [
                values.length === 1
                  ? Deferred.succeed(firstInterruptEntered, undefined).pipe(Effect.ignore)
                  : Effect.void,
                values.length >= workerCount
                  ? Deferred.succeed(allInterruptsEntered, undefined).pipe(Effect.ignore)
                  : Effect.void,
              ],
              { discard: true },
            ),
          ),
        ),
      forceStopAbortTarget: (target) =>
        Ref.update(forces, (values) => [...values, target.threadId]).pipe(
          Effect.as({ outcome: "terminated" as const, mechanism: "adapter-stop" as const }),
        ),
      stopTransientSession: (target) =>
        Ref.update(stops, (values) => [
          ...values,
          { threadId: target.threadId, runtimeSessionId: target.runtimeSessionId },
        ]).pipe(
          Effect.andThen(
            Ref.update(lifecycle, (values) => [...values, `stop:${workerIndex(target.threadId)}`]),
          ),
          Effect.andThen(Deferred.succeed(stopEntered, undefined).pipe(Effect.ignore)),
          Effect.andThen(options.neverStop === true ? Effect.never : Effect.void),
        ),
      streamEvents: Stream.fromPubSub(events),
    } as unknown as ProviderServiceShape;

    const engine: OrchestrationEngineShape = {
      dispatch: (command) =>
        Effect.gen(function* () {
          yield* Ref.update(commands, (values) => [...values, command]);
          if (
            options.failActivityAppendOnce === true &&
            !activityAppendFailed &&
            command.type === "thread.activity.append"
          ) {
            activityAppendFailed = true;
            return yield* Effect.die("activity append failed");
          }
          if (
            options.failAssistantDeltaOnce === true &&
            !assistantDeltaFailed &&
            command.type === "thread.message.assistant.delta"
          ) {
            assistantDeltaFailed = true;
            return yield* Effect.die("assistant transcript delta failed");
          }
          if (
            options.failWorkerMessageImport === true &&
            !workerMessageImportFailed &&
            command.type === "thread.message.import"
          ) {
            workerMessageImportFailed = true;
            return yield* Effect.die("worker message import failed");
          }
          if (
            options.failAbortProjection === true &&
            command.type === "thread.session.set" &&
            command.session.abortState !== null
          ) {
            return yield* Effect.die("abort projection failed");
          }
          if (command.type === "thread.session.set") yield* Ref.set(session, command.session);
          dispatchSequence += 1;
          return { sequence: dispatchSequence };
        }),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    };
    const query = {
      getThreadDetailById: () =>
        Ref.get(session).pipe(
          Effect.map((current) =>
            Option.some({
              id: parentThreadId,
              runtimeMode: "full-access",
              session: current,
            } as unknown as OrchestrationThread),
          ),
        ),
    } as unknown as ProjectionSnapshotQueryShape;
    const defaultPlan: TextGeneration.TextGeneration["Service"]["planFetchExploration"] = (
      _input,
    ) =>
      Effect.succeed(
        options.skip === true
          ? { decision: "skip" as const, workers: [] }
          : {
              decision: "run" as const,
              workers: Array.from({ length: workerCount }, (_, index) => ({
                scope: `Area ${index}`,
                questions: [`What owns area ${index}?`],
              })),
            },
      );
    const suppliedPlan = options.plan;
    const plan: TextGeneration.TextGeneration["Service"]["planFetchExploration"] = (input) =>
      Ref.update(planInputs, (values) => [...values, input]).pipe(
        Effect.andThen(Deferred.succeed(plannerEntered, undefined).pipe(Effect.ignore)),
        Effect.andThen(suppliedPlan ? suppliedPlan(input) : defaultPlan(input)),
      );
    const layer = FetchWorkerCoordinatorLive.pipe(
      Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
      Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
      Layer.provideMerge(
        Layer.succeed(ThreadBackgroundLiveness.ThreadBackgroundLivenessService, backgroundLiveness),
      ),
      Layer.provideMerge(Layer.succeed(TextGeneration.TextGeneration, makeTextGeneration(plan))),
      Layer.provideMerge(NodeServices.layer),
    );

    return {
      layer,
      starts,
      workspaceContextThreads,
      sends,
      stops,
      lifecycle,
      interrupts,
      forces,
      responses,
      commands,
      backgroundLiveness,
      planInputs,
      session,
      allStartsEntered,
      firstStartEntered,
      allInterruptsEntered,
      firstInterruptEntered,
      releaseStarts,
      plannerEntered,
      stopEntered,
    };
  });

function runInput(overrides: Partial<FetchRunInput> = {}): FetchRunInput {
  return {
    threadId: parentThreadId,
    cwd: process.cwd(),
    userRequest: "Inspect the repository for Fetch integration.",
    modelSelection: selection,
    providerDriver: codexDriver,
    maxRecommendedWorkers: 8,
    commandExecutionPolicy: "deny",
    ...overrides,
  };
}

describe("FetchWorkerCoordinator service", () => {
  it.effect("drains exact worker runtimes when coordinator ownership ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness({ gateStarts: true });
        const coordinatorScope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(harness.layer, coordinatorScope);
        const coordinator = Context.get(context, FetchWorkerCoordinator);
        const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.firstStartEntered);

        yield* Scope.close(coordinatorScope, Exit.void);

        expect(yield* Ref.get(harness.forces)).toHaveLength(1);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        const finalUpsert = (yield* Ref.get(harness.commands)).findLast(
          (command) => command.type === "thread.subagent.upsert",
        );
        expect(finalUpsert?.type).toBe("thread.subagent.upsert");
        if (finalUpsert?.type === "thread.subagent.upsert") {
          expect(finalUpsert.subagent.status).toBe("interrupted");
        }
        yield* Deferred.succeed(harness.releaseStarts, undefined);
        yield* Fiber.interrupt(runFiber);
        expect(yield* Ref.get(harness.forces)).toHaveLength(1);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        const terminalUpserts = (yield* Ref.get(harness.commands)).filter(
          (command) =>
            command.type === "thread.subagent.upsert" && command.subagent.status === "interrupted",
        );
        expect(terminalUpserts).toHaveLength(1);
      }),
    ),
  );

  it.effect("rejects a legacy Fetch command policy before planning and still hands off", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const mainTurnSent = yield* Deferred.make<void>();
        const result = yield* coordinator.run(
          runInput({ commandExecutionPolicy: "read-only-sandbox" }),
        );

        expect(result.status).toBe("unavailable");
        expect(result.warnings.join(" ")).toContain("command denial");
        expect(yield* Ref.get(harness.planInputs)).toHaveLength(0);
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);
        expect(
          yield* coordinator.handoffToMain(
            { threadId: parentThreadId, runId: result.runId },
            Deferred.succeed(mainTurnSent, undefined).pipe(Effect.asVoid),
          ),
        ).toBe(true);
        yield* Deferred.await(mainTurnSent);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a skip plan creates zero transient workers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ skip: true, workerCount: 0 });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.status).toBe("skipped");
        expect(result.plannedWorkers).toBe(0);
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);
        expect(
          yield* coordinator.handoffToMain(
            { threadId: parentThreadId, runId: result.runId },
            Effect.void,
          ),
        ).toBe(true);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a planner failure leaves repository inspection to the main agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        plan: () =>
          Effect.fail(
            new TextGenerationError({
              operation: "planFetchExploration",
              detail: "planner failed",
            }),
          ),
      });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput({ userRequest: "Briefly inspect this." }));

        expect(result.status).toBe("skipped");
        expect(result.plannedWorkers).toBe(0);
        expect(result.warnings).toContain(
          "Fetch planning failed; the main agent continued without repository workers.",
        );
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("terminalizes a registered worker when its initial transcript import fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failWorkerMessageImport: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(0);
        expect(result.warnings.join(" ")).toContain("failed internally");
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        const upserts = (yield* Ref.get(harness.commands)).filter(
          (command) => command.type === "thread.subagent.upsert",
        );
        expect(upserts).toHaveLength(2);
        expect(upserts.at(-1)?.type).toBe("thread.subagent.upsert");
        if (upserts.at(-1)?.type === "thread.subagent.upsert") {
          expect(upserts.at(-1)?.subagent.status).toBe("error");
        }
        expect(
          yield* coordinator.handoffToMain(
            { threadId: parentThreadId, runId: result.runId },
            Effect.void,
          ),
        ).toBe(true);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect(
    "force-cleans and terminalizes registered workers when the run fiber is interrupted",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ gateStarts: true });
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
          yield* Deferred.await(harness.firstStartEntered);
          yield* Fiber.interrupt(runFiber);

          expect(yield* Ref.get(harness.forces)).toHaveLength(1);
          expect(yield* Ref.get(harness.stops)).toHaveLength(1);
          const upserts = (yield* Ref.get(harness.commands)).filter(
            (command) => command.type === "thread.subagent.upsert",
          );
          const finalUpsert = upserts.at(-1);
          expect(finalUpsert?.type).toBe("thread.subagent.upsert");
          if (finalUpsert?.type === "thread.subagent.upsert") {
            expect(finalUpsert.subagent.status).toBe("interrupted");
          }
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );

  it.effect("runs the full advertised worker budget serially with one exact selection", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ workerCount: 8 });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        const starts = yield* Ref.get(harness.starts);
        expect(starts).toHaveLength(8);
        for (const start of starts) {
          expect(start.modelSelection).toEqual(selection);
          expect(start.purpose).toBe("fetch-worker");
          expect(start.runtimeMode).toBe("approval-required");
          expect(start.sandboxMode).toBe("read-only");
          expect(start.freshSession).toBe(true);
        }
        expect(result.successfulWorkers).toBe(8);
        expect(yield* Ref.get(harness.workspaceContextThreads)).toEqual(
          Array.from({ length: 8 }, () => parentThreadId),
        );
        expect(yield* Ref.get(harness.sends)).toHaveLength(8);
        expect(yield* Ref.get(harness.stops)).toHaveLength(8);
        expect(yield* Ref.get(harness.lifecycle)).toEqual(
          Array.from({ length: 8 }, (_, index) => [`start:${index}`, `stop:${index}`]).flat(),
        );
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("waits for shared resource admission immediately before a Fetch session starts", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const governor = yield* ResourceProtection.makeSubagentResourceGovernor();
      yield* governor.observe({
        sampledAtMs: 0,
        memory: {
          totalBytes: 16 * ResourceProtection.GIBIBYTE,
          availableBytes: 3 * ResourceProtection.GIBIBYTE,
          swapTotalBytes: 8 * ResourceProtection.GIBIBYTE,
          swapFreeBytes: 8 * ResourceProtection.GIBIBYTE,
        },
        processes: [],
      });
      const protectedLayer = harness.layer.pipe(
        Layer.provideMerge(Layer.succeed(ResourceProtection.SubagentResourceGovernor, governor)),
      );

      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const waitingSnapshot = yield* governor.changes.pipe(
          Stream.filter((snapshot) => snapshot.state === "waiting"),
          Stream.runHead,
          Effect.forkChild,
        );
        const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        const waiting = yield* Fiber.join(waitingSnapshot);
        expect(waiting._tag).toBe("Some");
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);

        yield* governor.observe({
          sampledAtMs: 1_000,
          memory: {
            totalBytes: 16 * ResourceProtection.GIBIBYTE,
            availableBytes: 10 * ResourceProtection.GIBIBYTE,
            swapTotalBytes: 8 * ResourceProtection.GIBIBYTE,
            swapFreeBytes: 8 * ResourceProtection.GIBIBYTE,
          },
          processes: [],
        });
        const result = yield* Fiber.join(runFiber);

        expect(result.successfulWorkers).toBe(1);
        expect(yield* Ref.get(harness.starts)).toHaveLength(1);
        expect((yield* governor.latest).waitingStarts).toBe(0);
        expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
      }).pipe(Effect.provide(protectedLayer), Effect.scoped, Effect.ensuring(governor.shutdown));
    }),
  );

  it.effect("reports Fetch workers as active background work until they settle", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ gateStarts: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.firstStartEntered);

        expect(harness.backgroundLiveness.getThreadBackgroundLiveness(parentThreadId)).toBe(
          "working",
        );

        yield* Deferred.succeed(harness.releaseStarts, undefined);
        yield* Fiber.join(runFiber);
        expect(harness.backgroundLiveness.getThreadBackgroundLiveness(parentThreadId)).toBeNull();
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("coalesces repeated Fetch findings progress across streaming deltas", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ assistantDeltaCount: 200 });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        yield* coordinator.run(runInput());

        const findingsProgress = (yield* Ref.get(harness.commands)).filter(
          (command) =>
            command.type === "thread.subagent.progress.set" &&
            command.progress?.kind === "fetch.findings",
        );
        expect(findingsProgress).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect(
    "projects cross-provider model and effort metadata without changing the selection",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const claudeSelection: ModelSelection = {
          instanceId: ProviderInstanceId.make("claude-fetch"),
          model: "claude-opus-4-1",
          options: [
            { id: "effort", value: "high" },
            { id: "serviceTier", value: "priority" },
          ],
        };
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const result = yield* coordinator.run(
            runInput({
              modelSelection: claudeSelection,
              providerDriver: ProviderDriverKind.make("claude-agent-sdk"),
              commandExecutionPolicy: "deny",
            }),
          );
          expect(result.successfulWorkers).toBe(1);
          expect((yield* Ref.get(harness.starts))[0]?.modelSelection).toEqual(claudeSelection);
          const upsert = (yield* Ref.get(harness.commands)).find(
            (command) => command.type === "thread.subagent.upsert",
          );
          expect(upsert?.type).toBe("thread.subagent.upsert");
          if (upsert?.type !== "thread.subagent.upsert") return;
          expect(upsert.subagent).toMatchObject({
            origin: "t3-fetch",
            providerInstanceId: "claude-fetch",
            providerDriver: "claude-agent-sdk",
            model: "claude-opus-4-1",
            reasoningEffort: "high",
          });
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );

  it.effect("fences runtime generation, provider instance, and parent-thread events", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ eventMode: "isolation-approvals" });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.context).toContain("Evidence from worker 0");
        expect(result.context).not.toContain("LEAK-");
        expect(yield* Ref.get(harness.responses)).toEqual([
          { requestId: "read-0", decision: "accept" },
          { requestId: "command-0", decision: "decline" },
          { requestId: "dynamic-0", decision: "decline" },
        ]);
        const approvalCommands = (yield* Ref.get(harness.commands)).filter(
          (command) =>
            command.type === "thread.activity.append" && command.activity.tone === "approval",
        );
        expect(approvalCommands.length).toBeGreaterThan(0);
        expect(
          approvalCommands.every(
            (command) =>
              command.type === "thread.activity.append" && command.subagentId !== undefined,
          ),
        ).toBe(true);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("handles approvals and terminalizes the worker when activity projection fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        eventMode: "isolation-approvals",
        failActivityAppendOnce: true,
      });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(1);
        expect(yield* Ref.get(harness.responses)).toEqual([
          { requestId: "read-0", decision: "accept" },
          { requestId: "command-0", decision: "decline" },
          { requestId: "dynamic-0", decision: "decline" },
        ]);
        const upserts = (yield* Ref.get(harness.commands)).filter(
          (command) => command.type === "thread.subagent.upsert",
        );
        const finalUpsert = upserts.at(-1);
        expect(finalUpsert?.type).toBe("thread.subagent.upsert");
        if (finalUpsert?.type === "thread.subagent.upsert") {
          expect(finalUpsert.subagent.status).toBe("completed");
        }
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("allows a provider-native bounded read tool", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ eventMode: "native-read" });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(1);
        expect(result.context).toContain("Evidence from worker 0");
        expect(yield* Ref.get(harness.interrupts)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("allows only the authenticated workspace_context MCP tool", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ eventMode: "workspace-context" });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(1);
        expect(result.context).toContain("Evidence from worker 0");
        expect(yield* Ref.get(harness.interrupts)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("terminalizes the worker when transcript projection fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failAssistantDeltaOnce: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(1);
        expect(result.context).toContain("Evidence from worker 0");
        const upserts = (yield* Ref.get(harness.commands)).filter(
          (command) => command.type === "thread.subagent.upsert",
        );
        const finalUpsert = upserts.at(-1);
        expect(finalUpsert?.type).toBe("thread.subagent.upsert");
        if (finalUpsert?.type === "thread.subagent.upsert") {
          expect(finalUpsert.subagent.status).toBe("completed");
        }
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  for (const eventMode of [
    "hidden-input",
    "mutation",
    "command",
    "completed-command",
    "unknown-dynamic",
    "other-mcp",
    "nested",
  ] as const) {
    it.effect(`fails and interrupts a worker after a ${eventMode} policy violation`, () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ eventMode });
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const result = yield* coordinator.run(runInput());
          expect(result.successfulWorkers).toBe(0);
          expect(result.warnings.join(" ")).toContain("Every Fetch worker failed");
          expect((yield* Ref.get(harness.interrupts)).length).toBeGreaterThan(0);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
    );
  }

  it.effect("times out a never-completing startup after five total minutes and cleans it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ neverStart: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const fiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.allStartsEntered);
        yield* TestClock.adjust(FETCH_WORKER_TIMEOUT);
        const result = yield* Fiber.join(fiber);
        expect(result.successfulWorkers).toBe(0);
        expect(yield* Ref.get(harness.forces)).toHaveLength(1);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("force-stops exact runtimes when graceful transient cleanup hangs", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ neverStop: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const fiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.stopEntered);
        yield* TestClock.adjust(FETCH_ABORT_FORCE_DELAY);
        const result = yield* Fiber.join(fiber);
        expect(result.successfulWorkers).toBe(1);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        expect(yield* Ref.get(harness.forces)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("keeps partial findings and continues after all-worker failure", () =>
    Effect.gen(function* () {
      const partial = yield* makeHarness({ workerCount: 2, failureIndexes: new Set([1]) });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(1);
        expect(result.context).toContain("Evidence from worker 0");
        expect(result.context).toContain("Worker 1 failed");
        expect(result.warnings.join(" ")).toContain("partial results");
      }).pipe(Effect.provide(partial.layer), Effect.scoped);

      const failed = yield* makeHarness({ workerCount: 2, failureIndexes: new Set([0, 1]) });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        expect(result.successfulWorkers).toBe(0);
        expect(result.context).toBeUndefined();
        expect(result.warnings.join(" ")).toContain("Every Fetch worker failed");
      }).pipe(Effect.provide(failed.layer), Effect.scoped);
    }),
  );

  it.effect(
    "first stop interrupts, second stop force-stops, and null main runtime is projected safely",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          workerCount: 2,
          gateStarts: true,
          mainRuntimeSessionId: null,
        });
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
          yield* Deferred.await(harness.firstStartEntered);
          expect(
            yield* coordinator.requestInterrupt({
              threadId: parentThreadId,
              requestedAt: createdAt,
            }),
          ).toBe(true);
          const interrupting = yield* Ref.get(harness.session);
          expect(interrupting.abortState?.phase).toBe("interrupting");
          expect(String(interrupting.runtimeSessionId)).toContain("fetch:thread-fetch-parent:");
          expect(
            yield* coordinator.requestInterrupt({
              threadId: parentThreadId,
              requestedAt: createdAt,
            }),
          ).toBe(true);
          expect((yield* Ref.get(harness.forces)).length).toBe(1);
          yield* Deferred.succeed(harness.releaseStarts, undefined);
          const result = yield* Fiber.join(runFiber);
          expect(result.status).toBe("cancelled");
          expect(yield* Ref.get(harness.starts)).toHaveLength(1);
          expect((yield* Ref.get(harness.session)).runtimeSessionId).toBeNull();
          expect(
            yield* coordinator.handoffToMain(
              { threadId: parentThreadId, runId: result.runId },
              Effect.die("main must not start"),
            ),
          ).toBe(false);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );

  it.effect("interrupts and force-stops exact workers even when abort projection fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        workerCount: 2,
        gateStarts: true,
        failAbortProjection: true,
      });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.firstStartEntered);

        expect(
          yield* coordinator.requestInterrupt({
            threadId: parentThreadId,
            requestedAt: createdAt,
          }),
        ).toBe(true);
        yield* Deferred.await(harness.firstInterruptEntered);
        expect(yield* Ref.get(harness.interrupts)).toHaveLength(1);

        expect(
          yield* coordinator.requestInterrupt({
            threadId: parentThreadId,
            requestedAt: createdAt,
          }),
        ).toBe(true);
        expect(yield* Ref.get(harness.forces)).toHaveLength(1);

        yield* Deferred.succeed(harness.releaseStarts, undefined);
        expect((yield* Fiber.join(runFiber)).status).toBe("cancelled");
        expect(yield* Ref.get(harness.starts)).toHaveLength(1);
        const restored = yield* Ref.get(harness.session);
        expect(restored.status).toBe("ready");
        expect(restored.abortState).toBeNull();
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("the five-second watchdog projects force-stopping and stops exact workers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ gateStarts: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const runFiber = yield* coordinator.run(runInput()).pipe(Effect.forkChild);
        yield* Deferred.await(harness.allStartsEntered);
        yield* coordinator.requestInterrupt({ threadId: parentThreadId, requestedAt: createdAt });
        yield* TestClock.adjust(FETCH_ABORT_FORCE_DELAY);
        expect((yield* Ref.get(harness.session)).abortState?.phase).toBe("force-stopping");
        expect(yield* Ref.get(harness.forces)).toHaveLength(1);
        yield* Deferred.succeed(harness.releaseStarts, undefined);
        yield* Fiber.join(runFiber);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("forks main handoff atomically without holding the Fetch lock for the main turn", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ skip: true, workerCount: 0 });
      const mainStarted = yield* Deferred.make<void>();
      const releaseMain = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run(runInput());
        const handedOff = yield* coordinator.handoffToMain(
          { threadId: parentThreadId, runId: result.runId },
          Deferred.succeed(mainStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseMain)),
          ),
        );
        expect(handedOff).toBe(true);
        yield* Deferred.await(mainStarted);
        expect(yield* coordinator.hasActiveRun(parentThreadId)).toBe(false);
        expect(
          yield* coordinator.requestInterrupt({ threadId: parentThreadId, requestedAt: createdAt }),
        ).toBe(false);
        yield* Deferred.succeed(releaseMain, undefined);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect.each(["model-unavailable", "rate-limited"] as const)(
    "retries typed Auto Spark $0 once with exact Luna metadata",
    (reason) =>
      Effect.gen(function* () {
        const fallbackSelection: ModelSelection = {
          instanceId: ProviderInstanceId.make("codex-secondary"),
          model: "gpt-5.6-luna",
          options: [{ id: "reasoningEffort", value: "low" }],
        };
        const harness = yield* makeHarness({
          plan: (input) =>
            input.modelSelection.model.includes("spark")
              ? Effect.fail(
                  new TextGenerationError({
                    operation: "planFetchExploration",
                    detail: "model unavailable",
                    reason,
                  }),
                )
              : Effect.succeed({
                  decision: "run",
                  workers: [{ scope: "Fallback", questions: ["Where is it?"] }],
                }),
        });
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const result = yield* coordinator.run(
            runInput({
              lunaFallback: {
                modelSelection: fallbackSelection,
                providerDriver: codexDriver,
                maxRecommendedWorkers: 10,
                commandExecutionPolicy: "deny",
              },
            }),
          );
          expect(result.modelSelection).toEqual(fallbackSelection);
          expect(result.successfulWorkers).toBe(1);
          expect((yield* Ref.get(harness.starts))[0]?.modelSelection).toEqual(fallbackSelection);
          expect(
            (yield* Ref.get(harness.planInputs)).map((input) => input.maxRecommendedWorkers),
          ).toEqual([8, 10]);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );
});
