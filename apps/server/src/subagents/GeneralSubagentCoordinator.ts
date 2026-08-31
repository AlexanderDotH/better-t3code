import {
  MessageId,
  resolveBetterT3FeatureFlag,
  type ModelSelection,
  type OrchestrationThreadActivity,
  type ProviderInstanceId,
  type SubagentId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  listGeneralSubagentModels,
  resolveGeneralSubagentParentSelection,
  resolveGeneralSubagentSelection,
} from "./GeneralSubagentSelection.ts";
import { buildGeneralSubagentPrompt } from "./GeneralSubagentPolicy.ts";
import {
  generalSubagentActionSnapshot as actionSnapshot,
  generalSubagentIdentity as identity,
  generalSubagentIsBusy as workerIsBusy,
  generalSubagentSnapshot as snapshot,
  makeActiveGeneralSubagent,
  makeGeneralSubagentStateStore,
  type ActiveGeneralSubagent,
} from "./GeneralSubagentState.ts";
import {
  GENERAL_SUBAGENT_ABORT_FORCE_DELAY,
  makeGeneralSubagentTransport,
} from "./GeneralSubagentTransport.ts";
import { makeGeneralSubagentProjection } from "./GeneralSubagentProjection.ts";
import { makeGeneralSubagentLifecycle } from "./GeneralSubagentLifecycle.ts";

import {
  GeneralSubagentCancelInput,
  GeneralSubagentCancelResult,
  GeneralSubagentError,
  GeneralSubagentFollowUpInput,
  GeneralSubagentFollowUpResult,
  GeneralSubagentInterruptInput,
  GeneralSubagentInterruptResult,
  GeneralSubagentListResult,
  GeneralSubagentModelsResult,
  GeneralSubagentSendMessageInput,
  GeneralSubagentSendMessageResult,
  GeneralSubagentSpawnInput,
  GeneralSubagentSpawnResult,
  GeneralSubagentWaitInput,
  GeneralSubagentWaitResult,
} from "./GeneralSubagentProtocol.ts";

export {
  assistantTextFromCompletedItem,
  buildGeneralSubagentFollowUpPrompt,
  buildGeneralSubagentPrompt,
  generalSubagentApprovalAction,
  parseGeneralSubagentFinalResult,
} from "./GeneralSubagentPolicy.ts";
export type { GeneralSubagentApprovalAction } from "./GeneralSubagentPolicy.ts";
export { GENERAL_SUBAGENT_ABORT_FORCE_DELAY } from "./GeneralSubagentTransport.ts";

export const GENERAL_SUBAGENT_TIMEOUT = Duration.minutes(30);
export const GENERAL_SUBAGENT_MAX_DIRECT_CHILDREN = 40;
const isGeneralSubagentError = Schema.is(GeneralSubagentError);

export interface GeneralSubagentCaller {
  readonly parentThreadId: ThreadId;
  readonly callerProviderInstanceId: ProviderInstanceId;
}

export interface GeneralSubagentCoordinatorShape {
  readonly listModels: (
    input: GeneralSubagentCaller,
  ) => Effect.Effect<GeneralSubagentModelsResult, GeneralSubagentError>;
  readonly spawn: (
    input: GeneralSubagentCaller & GeneralSubagentSpawnInput,
  ) => Effect.Effect<GeneralSubagentSpawnResult, GeneralSubagentError>;
  readonly wait: (
    input: GeneralSubagentCaller & GeneralSubagentWaitInput,
  ) => Effect.Effect<GeneralSubagentWaitResult, GeneralSubagentError>;
  readonly cancel: (
    input: GeneralSubagentCaller & GeneralSubagentCancelInput,
  ) => Effect.Effect<GeneralSubagentCancelResult, GeneralSubagentError>;
  readonly listAgents: (
    input: GeneralSubagentCaller,
  ) => Effect.Effect<GeneralSubagentListResult, GeneralSubagentError>;
  readonly spawnAgent: (
    input: GeneralSubagentCaller & GeneralSubagentSpawnInput,
  ) => Effect.Effect<GeneralSubagentSpawnResult, GeneralSubagentError>;
  readonly sendMessage: (
    input: GeneralSubagentCaller & GeneralSubagentSendMessageInput,
  ) => Effect.Effect<GeneralSubagentSendMessageResult, GeneralSubagentError>;
  readonly followUp: (
    input: GeneralSubagentCaller & GeneralSubagentFollowUpInput,
  ) => Effect.Effect<GeneralSubagentFollowUpResult, GeneralSubagentError>;
  readonly waitAgent: (
    input: GeneralSubagentCaller & GeneralSubagentWaitInput,
  ) => Effect.Effect<GeneralSubagentWaitResult, GeneralSubagentError>;
  readonly interruptAgent: (
    input: GeneralSubagentCaller & GeneralSubagentInterruptInput,
  ) => Effect.Effect<GeneralSubagentInterruptResult, GeneralSubagentError>;
}

export class GeneralSubagentCoordinator extends Context.Service<
  GeneralSubagentCoordinator,
  GeneralSubagentCoordinatorShape
>()("t3/subagents/GeneralSubagentCoordinator") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const providerService = yield* ProviderService;
  const providerRegistry = yield* ProviderRegistry;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const settings = yield* ServerSettingsService;
  const resourceGovernor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const transport = makeGeneralSubagentTransport({
    providerService,
    ...(resourceGovernor ? { resourceGovernor } : {}),
  });
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const state = makeGeneralSubagentStateStore();
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const projection = makeGeneralSubagentProjection({
    randomUUIDv4: crypto.randomUUIDv4,
    orchestrationEngine,
    threadBackgroundLiveness,
  });
  const { commandId, dispatchSummary } = projection;
  const lifecycle = makeGeneralSubagentLifecycle({
    state,
    transport,
    projection,
    orchestrationEngine,
    threadBackgroundLiveness,
    coordinatorScope,
    nowIso,
    timeout: GENERAL_SUBAGENT_TIMEOUT,
  });
  const { cancelWorker, finalizeWorker, runRetainedWorker, runWorker, settleWorker } = lifecycle;
  yield* lifecycle.startEventHandling;
  const resolveParent = Effect.fn("GeneralSubagentCoordinator.resolveParent")(function* (
    parentThreadId: ThreadId,
  ) {
    const [threadOption, workspaceOption] = yield* Effect.all([
      projectionSnapshotQuery.getThreadDetailById(parentThreadId),
      projectionSnapshotQuery.getThreadCheckpointContext(parentThreadId),
    ]);
    const thread = Option.getOrUndefined(threadOption);
    const workspace = Option.getOrUndefined(workspaceOption);
    if (!thread || !workspace || thread.deletedAt !== null || thread.archivedAt !== null) {
      return yield* new GeneralSubagentError({
        reason: "thread-unavailable",
        detail: `Parent thread '${parentThreadId}' is not available for delegation.`,
      });
    }
    return {
      thread,
      cwd: workspace.worktreePath ?? workspace.workspaceRoot,
      parentTurnId: thread.session?.activeTurnId ?? null,
      parentRuntimeSessionId: thread.session?.runtimeSessionId ?? null,
      parentProviderInstanceId: thread.session?.providerInstanceId ?? null,
    };
  });

  const parentModelSelection = (parent: {
    readonly thread: {
      readonly modelSelection: ModelSelection;
      readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
    };
    readonly parentTurnId: TurnId | null;
  }) =>
    resolveGeneralSubagentParentSelection({
      selection: parent.thread.modelSelection,
      activities: parent.thread.activities,
      parentTurnId: parent.parentTurnId,
    });

  const publicError =
    (operation: string) =>
    (cause: unknown): GeneralSubagentError =>
      isGeneralSubagentError(cause)
        ? cause
        : new GeneralSubagentError({
            reason: "operation-failed",
            detail: `${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          });

  const ensureFeatureEnabled = Effect.fn("GeneralSubagentCoordinator.ensureFeatureEnabled")(
    function* () {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) =>
            new GeneralSubagentError({
              reason: "operation-failed",
              detail: `Reading Better T3 settings failed: ${cause.message}`,
            }),
        ),
      );
      if (!resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.generalSubagents")) {
        return yield* new GeneralSubagentError({
          reason: "operation-failed",
          detail: "General subagents are disabled in Better T3 settings.",
        });
      }
    },
  );

  const listModelsEffect = Effect.fn("GeneralSubagentCoordinator.listModels")(function* (
    input: GeneralSubagentCaller,
  ) {
    const parent = yield* resolveParent(input.parentThreadId);
    const providers = yield* providerRegistry.getProviders;
    return {
      providers: listGeneralSubagentModels({
        providers,
        callerProviderInstanceId: input.callerProviderInstanceId,
        parentModelSelection: parentModelSelection(parent),
      }),
    };
  });
  const listModels: GeneralSubagentCoordinatorShape["listModels"] = (input) =>
    listModelsEffect(input).pipe(Effect.mapError(publicError("Listing subagent models")));

  const spawnWorkerEffect = Effect.fn("GeneralSubagentCoordinator.spawnWorker")(function* (
    input: GeneralSubagentCaller & GeneralSubagentSpawnInput,
    retainSession: boolean,
  ) {
    if (state.getByThread(input.parentThreadId)) {
      return yield* new GeneralSubagentError({
        reason: "nested-spawn-disabled",
        detail: "Direct T3-managed children cannot spawn nested agents in this release.",
      });
    }
    const parent = yield* resolveParent(input.parentThreadId);
    const providers = yield* providerRegistry.getProviders;
    const resolution = resolveGeneralSubagentSelection({
      providers,
      callerProviderInstanceId: input.callerProviderInstanceId,
      parentModelSelection: parentModelSelection(parent),
      request: {
        ...(input.providerInstanceId !== undefined
          ? { providerInstanceId: input.providerInstanceId }
          : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
      },
    });
    if (resolution.status === "unavailable") {
      return yield* new GeneralSubagentError({
        reason: resolution.reason,
        detail: resolution.detail,
      });
    }

    const uuid = yield* crypto.randomUUIDv4;
    const startedAt = yield* nowIso;
    const { worker, summary, reasoningEffort } = yield* makeActiveGeneralSubagent({
      uuid,
      parentThreadId: input.parentThreadId,
      parentTurnId: parent.parentTurnId,
      parentRuntimeSessionId: parent.parentRuntimeSessionId,
      parentProviderInstanceId: parent.parentProviderInstanceId,
      selection: resolution.selection,
      providerDriver: resolution.provider.driver,
      cwd: parent.cwd,
      runtimeMode: parent.thread.runtimeMode,
      retainSession,
      task: input.task,
      ...(input.name !== undefined ? { name: input.name } : {}),
      startedAt,
    });
    const { subagentId } = worker;
    const admission = yield* Effect.sync(() =>
      state.admit(worker, GENERAL_SUBAGENT_MAX_DIRECT_CHILDREN),
    );
    if (admission === "nested") {
      return yield* new GeneralSubagentError({
        reason: "nested-spawn-disabled",
        detail: "Direct T3-managed children cannot spawn nested agents in this release.",
      });
    }
    if (admission === "limit") {
      return yield* new GeneralSubagentError({
        reason: "direct-child-limit",
        detail: `Parent thread '${input.parentThreadId}' already owns ${GENERAL_SUBAGENT_MAX_DIRECT_CHILDREN} live direct children.`,
      });
    }
    threadBackgroundLiveness.recordTaskLiveness({
      threadId: input.parentThreadId,
      taskId: subagentId,
      taskType: "subagent",
      status: "starting",
      kind: "started",
    });
    const initialized = yield* Effect.exit(
      Effect.gen(function* () {
        yield* dispatchSummary(worker, summary);
        const prompt = buildGeneralSubagentPrompt({
          task: input.task,
          parentThreadId: input.parentThreadId,
          agentId: subagentId,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.message.import",
          commandId: yield* commandId(worker, "user-message"),
          threadId: input.parentThreadId,
          subagentId,
          message: {
            id: MessageId.make(`${subagentId}:user`),
            role: "user",
            text: prompt,
            turnId: null,
            streaming: false,
            createdAt: startedAt,
            updatedAt: startedAt,
          },
        });
      }),
    );
    if (Exit.isFailure(initialized)) {
      const detail = `General subagent initialization failed: ${Cause.pretty(initialized.cause)}`;
      yield* finalizeWorker(worker, { status: "error", detail }, true).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent initialization cleanup failed", {
            subagentId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      state.forget(worker);
      return yield* new GeneralSubagentError({ reason: "spawn-failed", detail });
    }
    const lifecycle = retainSession ? runRetainedWorker(worker) : runWorker(worker);
    yield* lifecycle.pipe(
      Effect.catchCause((cause) =>
        worker.finalized
          ? Effect.void
          : finalizeWorker(
              worker,
              {
                status: Cause.hasInterruptsOnly(cause) ? "interrupted" : "error",
                detail: Cause.pretty(cause),
              },
              true,
            ),
      ),
      Effect.forkIn(coordinatorScope),
    );
    return {
      agentId: subagentId,
      status: "starting" as const,
      providerInstanceId: resolution.selection.instanceId,
      providerDriver: resolution.provider.driver,
      model: resolution.selection.model,
      reasoningEffort,
    };
  });
  const spawn: GeneralSubagentCoordinatorShape["spawn"] = (input) =>
    ensureFeatureEnabled().pipe(
      Effect.andThen(spawnWorkerEffect(input, false)),
      Effect.mapError(publicError("Spawning the general subagent")),
    );
  const spawnAgent: GeneralSubagentCoordinatorShape["spawnAgent"] = (input) =>
    ensureFeatureEnabled().pipe(
      Effect.andThen(spawnWorkerEffect(input, true)),
      Effect.mapError(publicError("Spawning the direct agent")),
    );

  const resolveOwnedWorkers = Effect.fn("GeneralSubagentCoordinator.resolveOwnedWorkers")(
    function* (parentThreadId: ThreadId, agentIds: ReadonlyArray<SubagentId>) {
      const workers: ActiveGeneralSubagent[] = [];
      for (const agentId of agentIds) {
        const worker = state.getById(agentId);
        if (!worker || worker.parentThreadId !== parentThreadId) {
          return yield* new GeneralSubagentError({
            reason: "agent-unavailable",
            detail: `General subagent '${agentId}' is not owned by parent thread '${parentThreadId}'.`,
          });
        }
        workers.push(worker);
      }
      return workers;
    },
  );

  const wait: GeneralSubagentCoordinatorShape["wait"] = Effect.fn(
    "GeneralSubagentCoordinator.wait",
  )(function* (input) {
    const workers = yield* resolveOwnedWorkers(input.parentThreadId, input.agentIds);
    const active = workers.filter(workerIsBusy);
    const timeoutSeconds = input.timeoutSeconds ?? 30;
    const waited =
      active.length === 0
        ? Option.some<void>(undefined)
        : yield* Effect.all(
            active.map((worker) => Deferred.await(worker.completed)),
            {
              concurrency: "unbounded",
              discard: true,
            },
          ).pipe(Effect.timeoutOption(Duration.seconds(timeoutSeconds)));
    return {
      agents: workers.map(snapshot),
      allTerminal: workers.every((worker) => !workerIsBusy(worker)),
      timedOut: Option.isNone(waited),
    };
  });

  const cancelEffect = Effect.fn("GeneralSubagentCoordinator.cancel")(function* (
    input: GeneralSubagentCaller & GeneralSubagentCancelInput,
  ) {
    const [worker] = yield* resolveOwnedWorkers(input.parentThreadId, [input.agentId]);
    if (!worker) {
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: `General subagent '${input.agentId}' is not available.`,
      });
    }
    const cancelled = yield* cancelWorker(worker, "Cancelled by the parent agent.");
    return { agent: actionSnapshot(worker), cancelled };
  });
  const cancel: GeneralSubagentCoordinatorShape["cancel"] = (input) =>
    cancelEffect(input).pipe(Effect.mapError(publicError("Cancelling the general subagent")));

  const listAgents: GeneralSubagentCoordinatorShape["listAgents"] = (input) =>
    Effect.succeed({
      agents: state
        .all()
        .filter((worker) => worker.parentThreadId === input.parentThreadId)
        .map(identity),
    });

  const sendMessageEffect = Effect.fn("GeneralSubagentCoordinator.sendMessage")(function* (
    input: GeneralSubagentCaller & GeneralSubagentSendMessageInput,
  ) {
    const [worker] = yield* resolveOwnedWorkers(input.parentThreadId, [input.agentId]);
    if (!worker || worker.finalized || !worker.retainSession) {
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: `Direct agent '${input.agentId}' has no reusable session.`,
      });
    }
    worker.mailbox.push(input.message);
    return { agent: actionSnapshot(worker), queued: true };
  });
  const sendMessage: GeneralSubagentCoordinatorShape["sendMessage"] = (input) =>
    ensureFeatureEnabled().pipe(
      Effect.andThen(sendMessageEffect(input)),
      Effect.mapError(publicError("Messaging the direct agent")),
    );

  const followUpEffect = Effect.fn("GeneralSubagentCoordinator.followUp")(function* (
    input: GeneralSubagentCaller & GeneralSubagentFollowUpInput,
  ) {
    const [worker] = yield* resolveOwnedWorkers(input.parentThreadId, [input.agentId]);
    if (!worker || worker.finalized || !worker.retainSession) {
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: `Direct agent '${input.agentId}' has no reusable session.`,
      });
    }
    if (!workerIsBusy(worker) && worker.followUps.length === 0) {
      worker.completed = yield* Deferred.make<void>();
    }
    worker.followUps.push({ task: input.task });
    yield* Deferred.succeed(worker.wake, undefined).pipe(Effect.ignore);
    return { agent: actionSnapshot(worker), queued: true };
  });
  const followUp: GeneralSubagentCoordinatorShape["followUp"] = (input) =>
    ensureFeatureEnabled().pipe(
      Effect.andThen(followUpEffect(input)),
      Effect.mapError(publicError("Following up with the direct agent")),
    );

  const interruptAgentEffect = Effect.fn("GeneralSubagentCoordinator.interruptAgent")(function* (
    input: GeneralSubagentCaller & GeneralSubagentInterruptInput,
  ) {
    const [worker] = yield* resolveOwnedWorkers(input.parentThreadId, [input.agentId]);
    if (!worker || worker.finalized || !worker.retainSession) {
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: `Direct agent '${input.agentId}' has no reusable session.`,
      });
    }
    if (!workerIsBusy(worker)) return { agent: actionSnapshot(worker), interrupted: false };
    worker.cancelled = true;
    yield* transport
      .interrupt(worker)
      .pipe(Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY), Effect.asVoid);
    yield* settleWorker(worker, "interrupted", "Interrupted by the parent agent.");
    yield* Deferred.await(worker.completed).pipe(
      Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
      Effect.asVoid,
    );
    return { agent: actionSnapshot(worker), interrupted: true };
  });
  const interruptAgent: GeneralSubagentCoordinatorShape["interruptAgent"] = (input) =>
    interruptAgentEffect(input).pipe(Effect.mapError(publicError("Interrupting the direct agent")));

  const waitAgent: GeneralSubagentCoordinatorShape["waitAgent"] = wait;

  yield* settings.streamChanges.pipe(
    Stream.map((next) =>
      resolveBetterT3FeatureFlag(next.betterT3Environment, "agent.generalSubagents"),
    ),
    Stream.changes,
    Stream.filter((enabled) => !enabled),
    Stream.runForEach(() =>
      Effect.forEach(
        state.all().filter((worker) => !worker.finalized),
        (worker) => cancelWorker(worker, "General subagents were disabled in Better T3 settings."),
        { concurrency: "unbounded", discard: true },
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("General subagent feature reconciliation failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.forkIn(coordinatorScope),
  );

  return GeneralSubagentCoordinator.of({
    listModels,
    spawn,
    wait,
    cancel,
    listAgents,
    spawnAgent,
    sendMessage,
    followUp,
    waitAgent,
    interruptAgent,
  });
});

export const GeneralSubagentCoordinatorLive = Layer.effect(GeneralSubagentCoordinator, make);
