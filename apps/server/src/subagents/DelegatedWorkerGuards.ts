import {
  CommandId,
  isOrchestrationV2WorkActive,
  resolveBetterT3FeatureFlag,
  type NodeId,
  type OrchestrationV2RunStatus,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2StoredEvent,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { isRuntimeReconcileCommandId } from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { delegatedWorkerRequestAction, GENERAL_SUBAGENT_TIMEOUT } from "./GeneralSubagentPolicy.ts";

const TURN_ENDED_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export class DelegatedWorkerGuards extends Context.Service<
  DelegatedWorkerGuards,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (stored: OrchestrationV2StoredEvent) => Effect.Effect<void>;
    readonly stopDisabledGeneralSubagents: Effect.Effect<void>;
  }
>()("t3/subagents/DelegatedWorkerGuards") {}

export const stopExpiredGeneralSubagent = Effect.fn(
  "DelegatedWorkerGuards.stopExpiredGeneralSubagent",
)(function* (input: {
  readonly threadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly taskId: NodeId;
}) {
  const threads = yield* ThreadManagementService;
  const { subagents } = yield* threads.getThreadRecords(input.parentThreadId, ["subagents"], {
    subagentIds: [input.taskId],
  });
  const task = subagents.find((candidate) => candidate.id === input.taskId);
  if (task === undefined || task.result !== null || !isOrchestrationV2WorkActive(task.status))
    return;
  yield* threads.dispatch({
    type: "thread.stop",
    commandId: CommandId.make(`general-subagent-deadline:${input.taskId}`),
    threadId: input.threadId,
    reason: `The subagent reached its ${Duration.format(GENERAL_SUBAGENT_TIMEOUT)} limit.`,
  });
});

const make = Effect.gen(function* () {
  const engine = yield* OrchestratorV2;
  const eventSink = yield* EventSinkV2;
  const projections = yield* ProjectionStoreV2;
  const settings = yield* ServerSettingsService;

  const stopWorker = (threadId: ThreadId, commandId: string, reason: string) =>
    engine.dispatch({
      type: "thread.stop",
      commandId: CommandId.make(commandId),
      threadId,
      reason,
    });

  const applyRequestPolicy = Effect.fn("DelegatedWorkerGuards.applyRequestPolicy")(function* (
    threadId: ThreadId,
    request: OrchestrationV2RuntimeRequest,
  ) {
    if (request.status !== "pending") return;
    const action = delegatedWorkerRequestAction(request.kind);
    if (action === "ignore") return;
    const thread = yield* projections.getThread(threadId);
    if (thread.fetchWorker === undefined && thread.generalSubagent !== true) return;
    const commandId = `delegated-worker-policy:${request.id}`;
    if (action === "fail-agent") {
      yield* stopWorker(threadId, commandId, "Delegated workers cannot ask the user questions.");
      return;
    }
    if (request.responseCapability.type !== "live") return;
    yield* engine.dispatch({
      type: "runtime-request.respond",
      commandId: CommandId.make(commandId),
      threadId,
      requestId: request.id,
      decision: action,
    });
  });

  // The parent already moved on, so the stopped agent's result must not start another turn.
  const stopWorkersOfEndedRun = Effect.fn("DelegatedWorkerGuards.stopWorkersOfEndedRun")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    const { subagents } = yield* projections.getThreadRecords(threadId, ["subagents"]);
    for (const task of subagents) {
      if (
        task.origin !== "app_owned" ||
        task.runId !== runId ||
        task.childThreadId === null ||
        !isOrchestrationV2WorkActive(task.status)
      )
        continue;
      const child = yield* projections.getThread(task.childThreadId);
      if (child.generalSubagent !== true) continue;
      yield* engine.dispatch({
        type: "delegated_task.completion-delivery.dispose",
        commandId: CommandId.make(`delegated-worker-turn-ended:${task.id}:dispose`),
        parentThreadId: threadId,
        taskId: task.id,
      });
      yield* stopWorker(
        child.id,
        `delegated-worker-turn-ended:${task.id}`,
        "The parent turn ended before the subagent.",
      );
    }
  });

  const logFailure =
    (message: string) =>
    <E, R>(self: Effect.Effect<unknown, E, R>): Effect.Effect<void, never, R> =>
      self.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning(message, { cause: Cause.pretty(cause) }),
        ),
      );

  const handle: DelegatedWorkerGuards["Service"]["handle"] = Effect.fn(
    "DelegatedWorkerGuards.handle",
  )(function* (stored) {
    const { event } = stored;
    if (event.type === "runtime-request.updated") {
      yield* applyRequestPolicy(event.threadId, event.payload).pipe(
        logFailure("Applying a delegated worker's request policy failed"),
      );
      return;
    }
    if (
      event.type === "run.updated" &&
      TURN_ENDED_STATUSES.has(event.payload.status) &&
      !isRuntimeReconcileCommandId(stored.commandId)
    ) {
      yield* stopWorkersOfEndedRun(event.threadId, event.payload.id).pipe(
        logFailure("Stopping general agents with their parent turn failed"),
      );
    }
  });

  const stopDisabledGeneralSubagents: DelegatedWorkerGuards["Service"]["stopDisabledGeneralSubagents"] =
    Effect.gen(function* () {
      const snapshot = yield* engine.getShellSnapshot();
      for (const shell of snapshot.threads) {
        if (shell.activeRunId === null || shell.lineage.relationshipToParent !== "subagent")
          continue;
        const thread = yield* projections.getThread(shell.id);
        if (thread.generalSubagent !== true || thread.deepPlanExecution?.sourceAnalysis) continue;
        yield* stopWorker(
          thread.id,
          `general-subagents-disabled:${shell.activeRunId}`,
          "General subagents were disabled in Better T3 settings.",
        );
      }
    }).pipe(
      Effect.withSpan("DelegatedWorkerGuards.stopDisabledGeneralSubagents"),
      logFailure("Stopping disabled general agents failed"),
    );

  const start: DelegatedWorkerGuards["Service"]["start"] = Effect.fn("DelegatedWorkerGuards.start")(
    function* () {
      const afterSequence = yield* eventSink.latestSequence().pipe(Effect.orDie);
      yield* forkParked(
        Stream.merge(
          eventSink.stream({ afterSequence, eventType: "run.updated" }),
          eventSink.stream({ afterSequence, eventType: "runtime-request.updated" }),
        ).pipe(Stream.runForEach(handle), logFailure("Delegated worker event stream failed")),
      );
      yield* forkParked(
        settings.streamChanges.pipe(
          Stream.map((next) =>
            resolveBetterT3FeatureFlag(next.betterT3Environment, "agent.generalSubagents"),
          ),
          Stream.changes,
          Stream.filter((enabled) => !enabled),
          Stream.runForEach(() => stopDisabledGeneralSubagents),
          logFailure("General agent settings stream failed"),
        ),
      );
    },
  );

  return DelegatedWorkerGuards.of({ start, handle, stopDisabledGeneralSubagents });
});

export const layer = Layer.effect(DelegatedWorkerGuards, make);
