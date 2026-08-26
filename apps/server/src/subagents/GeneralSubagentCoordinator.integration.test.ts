import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
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
  readonly completeTurn?: boolean;
}) {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const starts = yield* Ref.make<
    ReadonlyArray<{
      readonly input: ProviderSessionStartInput;
      readonly options: Parameters<ProviderServiceShape["startTransientSession"]>[2];
    }>
  >([]);
  const sends = yield* Ref.make<ReadonlyArray<ProviderSendTurnInput>>([]);
  const stops = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const startedSignal = yield* Deferred.make<void>();
  const secondTurnSentSignal = yield* Deferred.make<void>();
  const stoppedSignal = yield* Deferred.make<void>();
  const bindings = new Map<ThreadId, RuntimeSessionId>();
  const providerBindings = new Map<ThreadId, ProviderInstanceId>();
  let eventSequence = 0;
  let commandSequence = 0;

  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const eventBase = (threadId: ThreadId, runtimeSessionId: RuntimeSessionId) => ({
    eventId: EventId.make(`general-event-${++eventSequence}`),
    provider: codexDriver,
    providerInstanceId: providerBindings.get(threadId) ?? securityInstance,
    threadId,
    runtimeSessionId,
    createdAt,
  });

  const providerService = {
    startTransientSession: (threadId, input, options) =>
      Effect.gen(function* () {
        yield* Ref.update(starts, (values) => [...values, { input, options }]);
        yield* Deferred.succeed(startedSignal, undefined).pipe(Effect.ignore);
        const runtimeSessionId = input.runtimeSessionId!;
        bindings.set(threadId, runtimeSessionId);
        providerBindings.set(threadId, input.providerInstanceId!);
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
            delta: "Implemented the isolated security review and its focused test.",
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
    interruptAbortTarget: () => Effect.void,
    forceStopAbortTarget: () =>
      Effect.succeed({ outcome: "terminated", mechanism: "runtime-close" }),
    stopTransientSession: (target) =>
      Ref.update(stops, (values) => [...values, target.threadId]).pipe(
        Effect.andThen(Deferred.succeed(stoppedSignal, undefined).pipe(Effect.ignore)),
      ),
    streamEvents: Stream.fromPubSub(events),
  } as unknown as ProviderServiceShape;

  const providerRegistry = ProviderRegistry.of({
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
    runtimeMode: "full-access",
    archivedAt: null,
    deletedAt: null,
    session: {
      threadId: parentThreadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: codexInstance,
      runtimeSessionId: RuntimeSessionId.make("runtime-parent"),
      runtimeMode: "full-access",
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
  const engine: OrchestrationEngineShape = {
    dispatch: (command) =>
      Ref.update(commands, (values) => [...values, command]).pipe(
        Effect.andThen(
          options?.failMessageImport && command.type === "thread.message.import"
            ? Effect.fail(new Error("synthetic import failure"))
            : Effect.succeed({ sequence: ++commandSequence }),
        ),
      ),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  };
  const backgroundLiveness = ThreadBackgroundLiveness.make();
  const layer = GeneralSubagentCoordinatorLive.pipe(
    Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
    Layer.provideMerge(Layer.succeed(ProviderRegistry, providerRegistry)),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, query)),
    Layer.provideMerge(
      Layer.succeed(ThreadBackgroundLiveness.ThreadBackgroundLivenessService, backgroundLiveness),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

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
    commands,
    startedSignal,
    secondTurnSentSignal,
    stoppedSignal,
    publishParentCompletion,
  };
});

describe("GeneralSubagentCoordinator", () => {
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
          output: "Implemented the isolated security review and its focused test.",
        });
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
              command.type === "thread.message.import" &&
              command.message.text.includes("inspect, edit, and test"),
          ),
        ).toBe(true);
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
