import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  type DeepPlanSourceSnapshot,
  type RuntimeMode,
  makeBetterT3SettingsV1,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeProviderEventHub } from "../provider/providerEventHub.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import {
  GeneralSubagentCoordinator,
  GeneralSubagentCoordinatorLive,
  GENERAL_SUBAGENT_TIMEOUT,
} from "./GeneralSubagentCoordinator.ts";

const parentThreadId = ThreadId.make("thread-general-parent");
const parentTurnId = TurnId.make("turn-general-parent");
const codexInstance = ProviderInstanceId.make("codex-work");
const securityInstance = ProviderInstanceId.make("codex-security");
const codexDriver = ProviderDriverKind.make("codex");
const createdAt = "2026-08-22T12:00:00.000Z";
const streamedCommentary =
  "Streaming implementation commentary stays in the projected transcript. " +
  "Detailed intermediate analysis. ".repeat(96);

function provider(input: {
  readonly instanceId: typeof codexInstance;
  readonly model: string;
  readonly reasoningEfforts: ReadonlyArray<string>;
}): ServerProvider {
  return {
    instanceId: input.instanceId,
    driver: codexDriver,
    displayName: input.instanceId,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: createdAt,
    models: [
      {
        slug: input.model,
        name: input.model,
        isCustom: false,
        isDefault: true,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning effort",
              type: "select",
              options: input.reasoningEfforts.map((effort) => ({ id: effort, label: effort })),
            },
          ],
        },
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

const makeHarness = Effect.fn("GeneralSubagentCoordinator.test.makeHarness")(function* (options?: {
  readonly failMessageImport?: boolean;
  readonly runtimeMode?: RuntimeMode;
  readonly completeTurn?: boolean;
  readonly sessionEvents?: boolean;
  readonly blockFirstActivity?: boolean;
  readonly resourceGovernor?: ResourceProtection.SubagentResourceGovernor["Service"];
}) {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const eventHub = options?.sessionEvents ? yield* makeProviderEventHub() : undefined;
  let subscriptionReady = false;
  let blockedThreadId: ThreadId | undefined;
  let activityBlockedOnce = false;
  const starts = yield* Ref.make<
    ReadonlyArray<{
      readonly input: ProviderSessionStartInput;
      readonly options: Parameters<ProviderServiceShape["startTransientSession"]>[2];
    }>
  >([]);
  const sends = yield* Ref.make<ReadonlyArray<ProviderSendTurnInput>>([]);
  const stops = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const interruptTargets = yield* Ref.make<
    ReadonlyArray<Parameters<ProviderServiceShape["interruptAbortTarget"]>[0]>
  >([]);
  const forceStopTargets = yield* Ref.make<
    ReadonlyArray<Parameters<ProviderServiceShape["forceStopAbortTarget"]>[0]>
  >([]);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const startedSignal = yield* Deferred.make<void>();
  const secondTurnSentSignal = yield* Deferred.make<void>();
  const stoppedSignal = yield* Deferred.make<void>();
  const activityBlocked = yield* Deferred.make<void>();
  const releaseActivity = yield* Deferred.make<void>();
  const bindings = new Map<ThreadId, RuntimeSessionId>();
  const providerBindings = new Map<ThreadId, ProviderInstanceId>();
  let eventSequence = 0;
  let commandSequence = 0;

  const publish = (event: ProviderRuntimeEvent) =>
    (eventHub ? eventHub.publish(event) : PubSub.publish(events, event)).pipe(Effect.asVoid);
  const eventBase = (threadId: ThreadId, runtimeSessionId: RuntimeSessionId) => ({
    eventId: EventId.make(`general-event-${++eventSequence}`),
    provider: codexDriver,
    providerInstanceId: providerBindings.get(threadId) ?? securityInstance,
    threadId,
    runtimeSessionId,
    createdAt,
  });
  const finalResult = (threadId: ThreadId, outcome: string) =>
    JSON.stringify({
      outcome,
      changesOrFindings: [
        {
          path: "apps/server/src/security/review.ts",
          details: "Implemented the isolated security review.",
        },
      ],
      verification: [{ command: "vp test run security-review.test.ts", result: "1 test passed" }],
      risksOrBlockers: [],
      transcriptRef: `subagent:${threadId}`,
    });

  const providerService: Partial<ProviderServiceShape> = {
    startTransientSession: (threadId, input, options) =>
      Effect.gen(function* () {
        if (eventHub) expect(subscriptionReady).toBe(true);
        if (blockedThreadId === undefined) blockedThreadId = threadId;
        yield* Ref.update(starts, (values) => [...values, { input, options }]);
        yield* Deferred.succeed(startedSignal, undefined).pipe(Effect.ignore);
        const runtimeSessionId = input.runtimeSessionId!;
        bindings.set(threadId, runtimeSessionId);
        providerBindings.set(threadId, input.providerInstanceId!);
        if (eventHub) {
          yield* publish({
            ...eventBase(threadId, runtimeSessionId),
            type: "request.opened",
            requestId: RuntimeRequestId.make(`startup-read-${threadId}`),
            payload: { requestType: "file_read_approval", detail: "Read during startup" },
          });
          yield* publish({
            ...eventBase(threadId, runtimeSessionId),
            type: "thread.started",
            payload: { providerThreadId: "provider-startup-worker" },
          });
          yield* publish({
            ...eventBase(threadId, runtimeSessionId),
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Session startup output. " },
          });
        }
        return {
          provider: codexDriver,
          providerInstanceId: securityInstance,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model: input.modelSelection?.model,
          threadId,
          runtimeSessionId,
          createdAt,
          updatedAt: createdAt,
        } as ProviderSession;
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(sends, (values) => [...values, input]);
        if ((yield* Ref.get(sends)).length >= 2) {
          yield* Deferred.succeed(secondTurnSentSignal, undefined).pipe(Effect.ignore);
        }
        const runtimeSessionId = bindings.get(input.threadId)!;
        const turnId = TurnId.make("general-worker-turn");
        yield* publish({
          ...eventBase(input.threadId, runtimeSessionId),
          type: "thread.started",
          payload: { providerThreadId: "provider-general-worker" },
        });
        yield* publish({
          ...eventBase(input.threadId, runtimeSessionId),
          type: "turn.started",
          turnId,
          payload: { model: input.modelSelection?.model ?? "unknown" },
        });
        yield* publish({
          ...eventBase(input.threadId, runtimeSessionId),
          type: "content.delta",
          turnId,
          payload: {
            streamKind: "assistant_text",
            delta: streamedCommentary,
          },
        });
        yield* publish({
          ...eventBase(input.threadId, runtimeSessionId),
          type: "item.completed",
          turnId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            detail: finalResult(input.threadId, "Stale assistant message must not win."),
          },
        });
        yield* publish({
          ...eventBase(input.threadId, runtimeSessionId),
          type: "item.completed",
          turnId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            detail: finalResult(
              input.threadId,
              "Implemented the isolated security review and its focused test.",
            ),
          },
        });
        if (options?.completeTurn !== false) {
          yield* publish({
            ...eventBase(input.threadId, runtimeSessionId),
            type: "turn.completed",
            turnId,
            payload: { state: "completed" },
          });
        }
        return { threadId: input.threadId, turnId };
      }),
    respondToRequest: () => Effect.void,
    interruptAbortTarget: (target) =>
      Ref.update(interruptTargets, (targets) => [...targets, target]),
    forceStopAbortTarget: (target) =>
      Ref.update(forceStopTargets, (targets) => [...targets, target]).pipe(
        Effect.as({ outcome: "terminated" as const, mechanism: "runtime-close" as const }),
      ),
    stopTransientSession: (target) =>
      Ref.update(stops, (values) => [...values, target.threadId]).pipe(
        Effect.andThen(Deferred.succeed(stoppedSignal, undefined).pipe(Effect.ignore)),
      ),
    ...(eventHub
      ? ({
          consumeEvents: (handler, subscription) =>
            eventHub.consumeEvents(handler, subscription).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  subscriptionReady = true;
                }),
              ),
            ),
        } satisfies Pick<ProviderServiceShape, "consumeEvents">)
      : {}),
    streamEvents: eventHub
      ? Stream.die("Session event consumers must not use the aggregate stream")
      : Stream.fromPubSub(events),
  };

  const providerRegistry = ProviderRegistry.of({
    refreshWorkspaceSnapshot: () => Effect.succeed([]),
    getProviders: Effect.succeed([
      provider({
        instanceId: codexInstance,
        model: "gpt-5.6-sol",
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      }),
      provider({
        instanceId: securityInstance,
        model: "gpt-daybreak-blue-latest",
        reasoningEfforts: ["medium", "high", "xhigh", "max"],
      }),
    ]),
    refresh: () => Effect.die("unused"),
    refreshInstance: () => Effect.die("unused"),
    getProviderMaintenanceCapabilitiesForInstance: () => Effect.die("unused"),
    setProviderMaintenanceActionState: () => Effect.die("unused"),
    streamChanges: Stream.empty,
  });

  const parentThread = {
    id: parentThreadId,
    projectId: "project-general",
    modelSelection: {
      instanceId: codexInstance,
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    runtimeMode: options?.runtimeMode ?? "full-access",
    archivedAt: null,
    deletedAt: null,
    session: {
      threadId: parentThreadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: codexInstance,
      runtimeSessionId: RuntimeSessionId.make("runtime-parent"),
      runtimeMode: options?.runtimeMode ?? "full-access",
      activeTurnId: parentTurnId,
      abortState: null,
      lastError: null,
      updatedAt: createdAt,
    },
  } as unknown as OrchestrationThread;
  const query = {
    getThreadDetailById: () => Effect.succeed(Option.some(parentThread)),
    getThreadCheckpointContext: () =>
      Effect.succeed(
        Option.some({
          threadId: parentThreadId,
          projectId: parentThread.projectId,
          workspaceRoot: process.cwd(),
          worktreePath: null,
          checkpointsEnabled: true,
          checkpoints: [],
        }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
  const engine: Partial<OrchestrationEngineShape> = {
    dispatch: (command) =>
      Effect.gen(function* () {
        if (
          options?.blockFirstActivity &&
          !activityBlockedOnce &&
          command.type === "thread.activity.append" &&
          String(command.subagentId) === blockedThreadId
        ) {
          activityBlockedOnce = true;
          yield* Deferred.succeed(activityBlocked, undefined);
          yield* Deferred.await(releaseActivity);
        }
        yield* Ref.update(commands, (values) => [...values, command]);
        if (options?.failMessageImport && command.type === "thread.message.import") {
          return yield* Effect.die(new Error("synthetic import failure"));
        }
        return { sequence: ++commandSequence };
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  };
  const backgroundLiveness = ThreadBackgroundLiveness.make();
  const coordinatorLayer = GeneralSubagentCoordinatorLive.pipe(
    Layer.provideMerge(Layer.mock(ProviderService, providerService)),
    Layer.provideMerge(Layer.succeed(ProviderRegistry, providerRegistry)),
    Layer.provideMerge(Layer.mock(OrchestrationEngineService, engine)),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
    Layer.provideMerge(
      Layer.succeed(ThreadBackgroundLiveness.ThreadBackgroundLivenessService, backgroundLiveness),
    ),
    Layer.provideMerge(
      ServerSettingsService.layerTest({
        betterT3Environment: makeBetterT3SettingsV1("existing-install-migration"),
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  const layer = options?.resourceGovernor
    ? coordinatorLayer.pipe(
        Layer.provideMerge(
          Layer.succeed(ResourceProtection.SubagentResourceGovernor, options.resourceGovernor),
        ),
      )
    : coordinatorLayer;

  const publishParentCompletion = publish({
    eventId: EventId.make("general-parent-completed"),
    provider: codexDriver,
    providerInstanceId: codexInstance,
    threadId: parentThreadId,
    runtimeSessionId: RuntimeSessionId.make("runtime-parent"),
    turnId: parentTurnId,
    createdAt,
    type: "turn.completed",
    payload: { state: "completed" },
  });

  return {
    layer,
    starts,
    sends,
    stops,
    interruptTargets,
    forceStopTargets,
    commands,
    startedSignal,
    secondTurnSentSignal,
    stoppedSignal,
    publishParentCompletion,
    activityBlocked,
    releaseActivity,
  };
});

const makeResourceGovernorHarness = Effect.fn(
  "GeneralSubagentCoordinator.test.makeResourceGovernorHarness",
)(function* () {
  const admissions = yield* Ref.make<ReadonlyArray<ResourceProtection.SubagentAdmissionRequest>>(
    [],
  );
  const cancelledThreads = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const admissionRequested = yield* Deferred.make<void>();
  const releaseAdmission = yield* Deferred.make<boolean>();
  const governor = ResourceProtection.SubagentResourceGovernor.of({
    awaitAdmission: (request) =>
      Ref.update(admissions, (requests) => [...requests, request]).pipe(
        Effect.andThen(Deferred.succeed(admissionRequested, undefined).pipe(Effect.ignore)),
        Effect.andThen(Deferred.await(releaseAdmission)),
      ),
    acquireInProcessLease: () => Effect.succeed(undefined),
    confirmSubagent: () => Effect.void,
    releaseSubagent: () => Effect.void,
    releaseRootTurn: () => Effect.void,
    observe: () => Effect.void,
    telemetryUnavailable: Effect.void,
    registerProviderProcess: () => Effect.void,
    unregisterProviderProcess: () => Effect.void,
    cancelThread: (threadId) =>
      Ref.update(cancelledThreads, (threadIds) => [...threadIds, threadId]),
    setPolicy: () => Effect.void,
    shutdown: Effect.void,
    latest: Effect.die("unused resource snapshot"),
    inProcessUsage: Effect.die("unused in-process usage"),
    changes: Stream.empty,
    monitoringDemand: Stream.empty,
    subscribe: Effect.die("unused resource subscription"),
  });
  return {
    governor,
    admissions,
    cancelledThreads,
    admissionRequested,
    releaseAdmission,
  };
});

const sourceAnalysisBinding = {
  runId: DeepPlanRunId.make("deep-batch-run"),
  runThreadId: parentThreadId,
  phase: "planning" as const,
  approvedPlanVersion: null,
  readOnly: true,
  modelSelection: {
    instanceId: codexInstance,
    model: "gpt-5.6-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
};

function frozenSources(count: number): Array<DeepPlanSourceSnapshot> {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: DeepPlanSourceId.make(`source-${index}`),
    origin: {
      environmentId: EnvironmentId.make("local"),
      projectId: ProjectId.make("project"),
      threadId: ThreadId.make(`chat-${index}`),
    },
    projectTitle: "Project",
    threadTitle: `Chat ${index}`,
    archived: index % 2 === 0,
    capturedAt: createdAt,
    contentVersion: "version-1",
    contentHash: `hash-${index}`,
    messageCount: index + 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: index + 1,
    forkOrigin: null,
  }));
}

describe("GeneralSubagentCoordinator", () => {
  it.effect(
    "registers session lanes before startup and isolates blocked subagent projections",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ sessionEvents: true, blockFirstActivity: true });
        yield* Effect.gen(function* () {
          const coordinator = yield* GeneralSubagentCoordinator;
          const caller = { parentThreadId, callerProviderInstanceId: codexInstance };
          const first = yield* coordinator.spawn({ ...caller, task: "Inspect the first area." });
          yield* Deferred.await(harness.activityBlocked);
          const second = yield* coordinator.spawn({ ...caller, task: "Inspect the second area." });
          yield* Deferred.await(harness.stoppedSignal);
          expect(yield* Ref.get(harness.stops)).toEqual([second.agentId]);
          const completedSecond = yield* coordinator.wait({
            ...caller,
            agentIds: [second.agentId],
            timeoutSeconds: 5,
          });
          expect(completedSecond.agents[0]?.status).toBe("completed");

          yield* Deferred.succeed(harness.releaseActivity, undefined);
          const completedFirst = yield* coordinator.wait({
            ...caller,
            agentIds: [first.agentId],
            timeoutSeconds: 5,
          });
          expect(completedFirst.agents[0]?.status).toBe("completed");
          expect(
            (yield* Ref.get(harness.commands)).some(
              (command) =>
                command.type === "thread.message.assistant.delta" &&
                command.delta.includes("Session startup output"),
            ),
          ).toBe(true);
        }).pipe(Effect.provide(harness.layer));
      }),
  );
  it.effect(
    "analyzes all 33 chats in parallel waves and binds each child to its own source IDs",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const coordinator = yield* GeneralSubagentCoordinator;
          const caller = { parentThreadId, callerProviderInstanceId: codexInstance };
          const sources = frozenSources(33);
          let pending = sources;
          const covered: string[] = [];
          while (pending.length > 0) {
            const agents = yield* coordinator.analyzeDeepPlanSources({
              ...caller,
              binding: sourceAnalysisBinding,
              sources: pending,
            });
            expect(agents.length).toBeLessThanOrEqual(4);
            const waited = yield* coordinator.wait({
              ...caller,
              agentIds: agents.map((agent) => agent.agentId),
            });
            expect(waited.allTerminal).toBe(true);
            const ids = agents.flatMap((agent) => agent.sourceIds);
            expect(new Set(ids).size).toBe(ids.length);
            covered.push(...ids);
            pending = pending.filter((source) => !ids.includes(source.sourceId));
          }
          expect(covered).toEqual(sources.map((source) => source.sourceId));
          const starts = yield* Ref.get(harness.starts);
          expect(starts).toHaveLength(9);
          for (const start of starts) {
            expect(start.input).toMatchObject({
              runtimeMode: "full-access",
              modelSelection: sourceAnalysisBinding.modelSelection,
            });
            expect(start.input).not.toHaveProperty("sandboxMode");
            expect(start.options?.deepPlan).toMatchObject({
              runId: sourceAnalysisBinding.runId,
              sourceAnalysis: { workerThreadId: start.input.threadId },
            });
            expect(start.options?.deepPlan?.sourceAnalysis?.sourceIds.length).toBeLessThanOrEqual(
              4,
            );
          }
          expect(
            (yield* Ref.get(harness.sends)).every((send) => send.interactionMode === "plan"),
          ).toBe(true);
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect(
    "reuses active batches and does not duplicate assignments on repeated analysis calls",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ completeTurn: false });
        yield* Effect.gen(function* () {
          const coordinator = yield* GeneralSubagentCoordinator;
          const input = {
            parentThreadId,
            callerProviderInstanceId: codexInstance,
            binding: sourceAnalysisBinding,
            sources: frozenSources(33),
          };
          const first = yield* coordinator.analyzeDeepPlanSources(input);
          const repeated = yield* coordinator.analyzeDeepPlanSources(input);
          expect(first).toHaveLength(4);
          expect(repeated.map((agent) => agent.agentId)).toEqual(
            first.map((agent) => agent.agentId),
          );
          expect(repeated.flatMap((agent) => agent.sourceIds)).toEqual(
            first.flatMap((agent) => agent.sourceIds),
          );
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "inherits %s from the composer for analysis workers",
    (runtimeMode) =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({ runtimeMode });
        yield* Effect.gen(function* () {
          const coordinator = yield* GeneralSubagentCoordinator;
          const caller = { parentThreadId, callerProviderInstanceId: codexInstance };
          const agents = yield* coordinator.analyzeDeepPlanSources({
            ...caller,
            binding: sourceAnalysisBinding,
            sources: frozenSources(1),
          });
          yield* coordinator.wait({ ...caller, agentIds: agents.map((agent) => agent.agentId) });
          const start = (yield* Ref.get(harness.starts))[0];
          expect(start?.input.runtimeMode).toBe(runtimeMode);
          expect(start?.input).not.toHaveProperty("sandboxMode");
        }).pipe(Effect.provide(harness.layer));
      }),
  );

  it.effect("fences concurrent cancel and feature-off cleanup to the exact child runtime", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ completeTurn: false });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const settings = yield* ServerSettingsService;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Stay active while cancellation races the feature toggle.",
        });
        yield* Deferred.await(harness.startedSignal);

        yield* Effect.all(
          [
            coordinator.cancel({
              parentThreadId,
              callerProviderInstanceId: codexInstance,
              agentId: spawned.agentId,
            }),
            settings.updateSettings({
              betterT3Environment: { flags: { "agent.generalSubagents": false } },
            }),
          ],
          { concurrency: "unbounded" },
        );
        yield* Deferred.await(harness.stoppedSignal);

        const [start] = yield* Ref.get(harness.starts);
        const interruptTargets = yield* Ref.get(harness.interruptTargets);
        expect(interruptTargets.length).toBeGreaterThan(0);
        expect(interruptTargets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              runtimeSessionId: start?.input.runtimeSessionId,
              providerInstanceId: codexInstance,
            }),
          ]),
        );
        expect(
          interruptTargets.every(
            (target) => target.runtimeSessionId === start?.input.runtimeSessionId,
          ),
        ).toBe(true);
        expect(yield* Ref.get(harness.forceStopTargets)).toEqual([]);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("waits for resource admission before launching and releases ownership on cleanup", () =>
    Effect.gen(function* () {
      const resource = yield* makeResourceGovernorHarness();
      const harness = yield* makeHarness({
        completeTurn: false,
        resourceGovernor: resource.governor,
      });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawn({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Wait for memory, then run the focused check.",
        });
        yield* Deferred.await(resource.admissionRequested);
        expect(yield* Ref.get(harness.starts)).toEqual([]);

        yield* Deferred.succeed(resource.releaseAdmission, true);
        yield* Deferred.await(harness.startedSignal);
        const [admission] = yield* Ref.get(resource.admissions);
        expect(admission).toMatchObject({
          threadId: ThreadId.make(spawned.agentId),
          providerInstanceId: codexInstance,
        });

        yield* coordinator.cancel({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
        });
        expect(yield* Ref.get(resource.cancelledThreads)).toContain(ThreadId.make(spawned.agentId));
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("drains active workers when disabled and rejects new work until re-enabled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ completeTurn: false });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const settings = yield* ServerSettingsService;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Keep this direct child active until the feature is disabled.",
        });
        yield* Deferred.await(harness.startedSignal);

        yield* settings.updateSettings({
          betterT3Environment: { flags: { "agent.generalSubagents": false } },
        });
        const rejected = yield* Effect.exit(
          coordinator.spawnAgent({
            parentThreadId,
            callerProviderInstanceId: codexInstance,
            task: "This work must not start while the feature is disabled.",
          }),
        );
        expect(rejected._tag).toBe("Failure");
        if (rejected._tag === "Failure") {
          expect(String(rejected.cause)).toContain("disabled in Better T3 settings");
        }
        yield* Deferred.await(harness.stoppedSignal);

        const retained = yield* coordinator.listAgents({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
        });
        expect(retained.agents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ agentId: spawned.agentId, status: "interrupted" }),
          ]),
        );

        yield* settings.updateSettings({
          betterT3Environment: { flags: { "agent.generalSubagents": true } },
        });
        const resumed = yield* coordinator.spawn({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Run again after the reversible feature toggle is enabled.",
        });
        expect(resumed.status).toBe("starting");
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("runs a selected specialist as a full general-purpose transient agent", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawn({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Review the authentication change for exploitable edge cases and add a test.",
          providerInstanceId: securityInstance,
          model: "gpt-daybreak-blue-latest",
          reasoningEffort: "max",
        });
        const waited = yield* coordinator.wait({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 5,
        });

        expect(waited.allTerminal).toBe(true);
        expect(waited.timedOut).toBe(false);
        expect(waited.agents[0]).toMatchObject({
          status: "completed",
          providerInstanceId: securityInstance,
          model: "gpt-daybreak-blue-latest",
          reasoningEffort: "max",
          result: {
            outcome: "Implemented the isolated security review and its focused test.",
            changesOrFindings: [
              {
                path: "apps/server/src/security/review.ts",
                details: "Implemented the isolated security review.",
              },
            ],
            verification: [
              { command: "vp test run security-review.test.ts", result: "1 test passed" },
            ],
            risksOrBlockers: [],
            transcriptRef: `subagent:${spawned.agentId}`,
          },
        });
        expect(waited.agents[0]).not.toHaveProperty("task");
        expect(waited.agents[0]).not.toHaveProperty("output");
        // @effect-diagnostics-next-line preferSchemaOverJson:off - Inspect every returned field without a schema dropping unexpected commentary.
        expect(JSON.stringify(waited)).not.toContain("Streaming implementation commentary");
        const start = (yield* Ref.get(harness.starts))[0]!;
        expect(start.input).toMatchObject({
          purpose: "subagent-worker",
          providerInstanceId: securityInstance,
          runtimeMode: "full-access",
          freshSession: true,
          modelSelection: {
            instanceId: securityInstance,
            model: "gpt-daybreak-blue-latest",
            options: [{ id: "reasoningEffort", value: "max" }],
          },
        });
        expect(start.options).toMatchObject({
          workspaceContextThreadId: parentThreadId,
          mcpMode: "full",
        });
        expect((yield* Ref.get(harness.sends))[0]).toMatchObject({
          interactionMode: "default",
          modelSelection: {
            instanceId: securityInstance,
            model: "gpt-daybreak-blue-latest",
          },
        });
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        const commands = yield* Ref.get(harness.commands);
        expect(
          commands.some(
            (command) =>
              command.type === "thread.subagent.upsert" &&
              command.subagent.origin === "t3-managed" &&
              command.subagent.providerInstanceId === securityInstance,
          ),
        ).toBe(true);
        expect(
          commands.some(
            (command) =>
              command.type === "thread.message.assistant.delta" &&
              command.delta.includes("Streaming implementation commentary"),
          ),
        ).toBe(true);
        expect(
          commands.some(
            (command) =>
              command.type === "thread.message.import" &&
              command.message.text.includes("inspect, edit, and test"),
          ),
        ).toBe(true);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("lists compact identities and returns structured results for all eight agents", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => index),
          (index) =>
            coordinator.spawn({
              parentThreadId,
              callerProviderInstanceId: codexInstance,
              task: `Run isolated fixture task ${index + 1}.`,
            }),
          { concurrency: "unbounded" },
        );
        const waited = yield* coordinator.wait({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: spawned.map(({ agentId }) => agentId),
          timeoutSeconds: 5,
        });

        expect(waited).toMatchObject({ allTerminal: true, timedOut: false });
        expect(waited.agents).toHaveLength(8);
        expect(waited.agents.every((agent) => !("task" in agent) && !("output" in agent))).toBe(
          true,
        );
        expect(
          waited.agents.every(
            (agent) =>
              agent.result?.outcome ===
                "Implemented the isolated security review and its focused test." &&
              agent.result.transcriptRef === `subagent:${agent.agentId}` &&
              Object.keys(agent.result).length === 5,
          ),
        ).toBe(true);

        const listed = yield* coordinator.listAgents({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
        });
        expect(listed.agents).toHaveLength(8);
        expect(Object.keys(listed.agents[0]!).sort()).toEqual(
          [
            "agentId",
            "model",
            "providerDriver",
            "providerInstanceId",
            "reasoningEffort",
            "status",
          ].sort(),
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("settles and forgets a worker when its initial projection fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ failMessageImport: true });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const result = yield* Effect.exit(
          coordinator.spawn({
            parentThreadId,
            callerProviderInstanceId: codexInstance,
            task: "Implement the isolated parser fix.",
          }),
        );

        expect(result._tag).toBe("Failure");
        expect(yield* Ref.get(harness.starts)).toHaveLength(0);
        expect(yield* Ref.get(harness.sends)).toHaveLength(0);
        expect(yield* Ref.get(harness.stops)).toHaveLength(0);
        const commands = yield* Ref.get(harness.commands);
        expect(
          commands.some(
            (command) =>
              command.type === "thread.subagent.upsert" && command.subagent.status === "error",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("cancels one exact active worker and preserves its terminal result", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ completeTurn: false });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawn({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Run the focused verification and report the result.",
        });
        yield* Deferred.await(harness.startedSignal);

        const cancelled = yield* coordinator.cancel({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
        });

        expect(cancelled.cancelled).toBe(true);
        expect(cancelled.agent).toMatchObject({
          agentId: spawned.agentId,
          status: "interrupted",
          detail: "Cancelled by the parent agent.",
        });
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
        const waited = yield* coordinator.wait({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 1,
        });
        expect(waited).toMatchObject({ allTerminal: true, timedOut: false });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("reuses one provider session for mailbox-aware follow-up work", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Implement the parser and stop at the first safe boundary.",
        });
        const initial = yield* coordinator.waitAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 5,
        });
        expect(initial).toMatchObject({ allTerminal: true, timedOut: false });
        expect(yield* Ref.get(harness.starts)).toHaveLength(1);
        expect(yield* Ref.get(harness.stops)).toHaveLength(0);

        yield* coordinator.sendMessage({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
          message: "Preserve the compatibility fixture while making the follow-up change.",
        });
        yield* coordinator.followUp({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
          task: "Add the focused regression test now.",
        });
        const followedUp = yield* coordinator.waitAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 5,
        });

        expect(followedUp).toMatchObject({ allTerminal: true, timedOut: false });
        expect(yield* Ref.get(harness.starts)).toHaveLength(1);
        const sends = yield* Ref.get(harness.sends);
        expect(sends).toHaveLength(2);
        expect(sends[1]?.input).toContain("Add the focused regression test now.");
        expect(sends[1]?.input).toContain(
          "Preserve the compatibility fixture while making the follow-up change.",
        );
        expect(sends[1]?.input).toContain('"changesOrFindings"');
        expect(sends[1]?.input).toContain(`"transcriptRef": "subagent:${spawned.agentId}"`);

        yield* coordinator.cancel({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
        });
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("interrupts an active turn while retaining the session for a queued follow-up", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ completeTurn: false });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Inspect the slow path until interrupted.",
        });
        yield* Deferred.await(harness.startedSignal);

        const interrupted = yield* coordinator.interruptAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
        });
        expect(interrupted).toMatchObject({ interrupted: true, agent: { status: "interrupted" } });
        expect(yield* Ref.get(harness.stops)).toHaveLength(0);

        yield* coordinator.followUp({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
          task: "Resume with the smaller focused check.",
        });
        yield* Deferred.await(harness.secondTurnSentSignal);
        expect(yield* Ref.get(harness.starts)).toHaveLength(1);
        expect(yield* Ref.get(harness.sends)).toHaveLength(2);

        yield* coordinator.cancel({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentId: spawned.agentId,
        });
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("caps roots at forty live direct children and rejects nested spawning", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ completeTurn: false });
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* Effect.forEach(
          Array.from({ length: 40 }, (_, index) => index),
          (index) =>
            coordinator.spawnAgent({
              parentThreadId,
              callerProviderInstanceId: codexInstance,
              task: `Run isolated direct-child task ${index + 1}.`,
            }),
          { concurrency: 1 },
        );
        const overflow = yield* Effect.exit(
          coordinator.spawnAgent({
            parentThreadId,
            callerProviderInstanceId: codexInstance,
            task: "This forty-first child must be rejected.",
          }),
        );
        expect(overflow._tag).toBe("Failure");
        if (overflow._tag === "Failure") {
          expect(String(overflow.cause)).toContain("40 live direct children");
        }

        const nested = yield* Effect.exit(
          coordinator.spawnAgent({
            parentThreadId: ThreadId.make(spawned[0]!.agentId),
            callerProviderInstanceId: codexInstance,
            task: "Nested work is intentionally unavailable.",
          }),
        );
        expect(nested._tag).toBe("Failure");
        if (nested._tag === "Failure") {
          expect(String(nested.cause)).toContain("cannot spawn nested agents");
        }

        yield* Effect.forEach(
          spawned,
          ({ agentId }) =>
            coordinator.cancel({
              parentThreadId,
              callerProviderInstanceId: codexInstance,
              agentId,
            }),
          { concurrency: "unbounded", discard: true },
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("cleans retained child sessions when the owning parent turn completes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Finish and retain the child session for follow-up.",
        });
        yield* coordinator.waitAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 5,
        });
        expect(yield* Ref.get(harness.stops)).toHaveLength(0);

        yield* harness.publishParentCompletion;
        yield* Deferred.await(harness.stoppedSignal);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("expires an idle retained session after thirty minutes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const coordinator = yield* GeneralSubagentCoordinator;
        const spawned = yield* coordinator.spawnAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          task: "Finish and wait for a possible follow-up.",
        });
        yield* coordinator.waitAgent({
          parentThreadId,
          callerProviderInstanceId: codexInstance,
          agentIds: [spawned.agentId],
          timeoutSeconds: 5,
        });
        expect(yield* Ref.get(harness.stops)).toHaveLength(0);

        yield* TestClock.adjust(GENERAL_SUBAGENT_TIMEOUT);
        yield* Deferred.await(harness.stoppedSignal);
        expect(yield* Ref.get(harness.stops)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );
});
