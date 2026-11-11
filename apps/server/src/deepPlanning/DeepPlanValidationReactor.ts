import {
  CommandId,
  type DeepPlanRun,
  type OrchestrationV2StoredEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { isRuntimeReconcileCommandId } from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import {
  canContinueDeepPlan,
  isDeepPlanContinuationPending,
  deepPlanContinuationCommand,
} from "./DeepPlanContinuation.ts";
import { DeepPlanWorkflow } from "./DeepPlanWorkflow.ts";
import { forkParked, ServerActivation } from "../serverActivation.ts";

export class DeepPlanValidationDispatchError extends Schema.TaggedError<DeepPlanValidationDispatchError>()(
  "DeepPlanValidationDispatchError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class DeepPlanValidationDispatcher extends Context.Service<
  DeepPlanValidationDispatcher,
  {
    readonly dispatch: (
      run: DeepPlanRun,
      requestId: string,
    ) => Effect.Effect<"dispatched" | "deferred", DeepPlanValidationDispatchError>;
  }
>()("t3/deepPlanning/DeepPlanValidationReactor/DeepPlanValidationDispatcher") {}

export type DeepPlanValidationReceipt = {
  readonly type:
    | "deep-plan.validation.dispatched"
    | "deep-plan.validation.deferred"
    | "deep-plan.validation.failed";
  readonly threadId: ThreadId;
  readonly runId: DeepPlanRun["id"];
  readonly requestId: string;
};

export class DeepPlanValidationReactor extends Context.Service<
  DeepPlanValidationReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drainThrough: (sequence: number) => Effect.Effect<void>;
    readonly streamReceiptsForTest: Stream.Stream<DeepPlanValidationReceipt>;
  }
>()("t3/deepPlanning/DeepPlanValidationReactor") {}

export function finalValidationRequestId(run: DeepPlanRun): string {
  return `deep-plan:${run.id}:validation:${run.plan?.version ?? 0}:${run.finalValidation.attempt}`;
}

function awaitsFinalValidation(run: DeepPlanRun): boolean {
  return (
    run.phase === "validating" &&
    run.approval !== null &&
    run.stepStates.length > 0 &&
    run.stepStates.every((step) => step.status === "verified") &&
    (run.finalValidation.status === "pending" || run.finalValidation.status === "inProgress")
  );
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestratorV2;
  const eventSink = yield* EventSinkV2;
  const workflow = yield* DeepPlanWorkflow;
  const dispatcher = yield* DeepPlanValidationDispatcher;
  const activation = yield* ServerActivation;
  const receipts = yield* SubscriptionRef.make<DeepPlanValidationReceipt | null>(null);
  const seenSequence = yield* SubscriptionRef.make(0);
  const pendingRuns = new Map<ThreadId, DeepPlanRun>();
  const dispatched = new Set<string>();
  let started = false;

  const process = Effect.fn("DeepPlanValidationReactor.process")(function* (threadId: ThreadId) {
    if (activation !== undefined) yield* activation;
    const run = yield* workflow.getRun({ threadId });
    if (
      run == null ||
      run.threadId !== threadId ||
      (!awaitsFinalValidation(run) && !isDeepPlanContinuationPending(run))
    ) {
      pendingRuns.delete(threadId);
      return;
    }
    if (!awaitsFinalValidation(run)) {
      pendingRuns.set(threadId, run);
      const target = yield* engine.getThreadShell(run.approval?.implementationThreadId ?? threadId);
      if (
        target === null ||
        target.deletedAt !== null ||
        target.archivedAt !== null ||
        target.activeRunId !== null ||
        target.pendingRuntimeRequest !== null ||
        !canContinueDeepPlan(run, target.interactionMode)
      )
        return;
      // A new plan's first turn is the user's request, which arrives after its sources are set.
      if (run.approval === null) {
        const records = yield* engine.getThreadRecords(target.id, ["runs"]);
        if (!records.runs.some((candidate) => candidate.deepPlanRunId === run.id)) return;
      }
      const commandId = CommandId.make(
        `deep-plan:${run.id}:continue:${target.latestRunId ?? "initial"}:${run.revision}`,
      );
      yield* engine.dispatch(
        deepPlanContinuationCommand({ run, target, commandId, createdAt: run.updatedAt }),
      );
      return;
    }
    pendingRuns.set(threadId, run);
    const requestId = finalValidationRequestId(run);
    if (dispatched.has(requestId)) return;
    const result = yield* dispatcher.dispatch(run, requestId).pipe(
      Effect.catchTags({
        DeepPlanValidationDispatchError: (error) =>
          Effect.logWarning("Deep Plan final validation dispatch failed", {
            threadId,
            runId: run.id,
            message: error.message,
          }).pipe(Effect.as("failed" as const)),
      }),
    );
    if (result === "dispatched") dispatched.add(requestId);
    const receipt: DeepPlanValidationReceipt = {
      type:
        result === "dispatched"
          ? "deep-plan.validation.dispatched"
          : result === "deferred"
            ? "deep-plan.validation.deferred"
            : "deep-plan.validation.failed",
      threadId,
      runId: run.id,
      requestId,
    };
    yield* SubscriptionRef.set(receipts, receipt);
  });

  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    process(threadId).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("Deep Plan validation recovery failed", { cause: Cause.pretty(cause) }),
      ),
    ),
  );
  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const consume = Effect.fn("DeepPlanValidationReactor.consume")(function* (
    stored: OrchestrationV2StoredEvent,
  ) {
    const event = stored.event;
    if (event.type === "thread.deep-plan-updated") {
      const run = event.payload.deepPlan;
      if (
        run?.threadId === event.threadId &&
        (awaitsFinalValidation(run) || isDeepPlanContinuationPending(run))
      )
        pendingRuns.set(event.threadId, run);
      else pendingRuns.delete(event.threadId);
      yield* worker.enqueue(event.threadId);
    } else if (event.type === "run.updated") {
      for (const [threadId, run] of pendingRuns) {
        if ((run.approval?.implementationThreadId ?? threadId) !== event.threadId) continue;
        if (event.payload.status === "completed") yield* worker.enqueue(threadId);
        // Startup continues the plan; a restart is not a reason to pause it.
        else if (
          ["failed", "cancelled", "interrupted"].includes(event.payload.status) &&
          !isRuntimeReconcileCommandId(stored.commandId)
        ) {
          yield* workflow.withRunLock(
            run.id,
            Effect.gen(function* () {
              const current = yield* workflow.getRun({ threadId, runId: run.id });
              if (!current || !isDeepPlanContinuationPending(current)) return;
              yield* workflow.update({
                threadId,
                runId: current.id,
                expectedRevision: current.revision,
                operationId: `terminal:${event.payload.id}`,
                mutation: {
                  type: "pause",
                  reason: `The provider run ${event.payload.status}. Resume the Deep Plan when ready.`,
                },
              });
            }),
          );
        }
      }
    } else if (
      event.type === "thread.interaction-mode-updated" ||
      event.type === "thread.deleted" ||
      event.type === "thread.archived"
    ) {
      for (const [threadId, run] of pendingRuns)
        if ((run.approval?.implementationThreadId ?? threadId) === event.threadId)
          yield* worker.enqueue(threadId);
    }
    yield* noteSeen(stored.sequence);
  });

  return DeepPlanValidationReactor.of({
    start: Effect.fn("DeepPlanValidationReactor.start")(function* () {
      if (started) return;
      started = true;
      const snapshot = yield* engine.getShellSnapshot().pipe(Effect.orDie);
      yield* forkParked(
        Stream.runForEach(eventSink.stream({ afterSequence: snapshot.snapshotSequence }), consume),
      );
      const runs = snapshot.threads.flatMap((thread) =>
        thread.deepPlan?.threadId === thread.id ? [thread.deepPlan] : [],
      );
      for (const run of runs) {
        if (!awaitsFinalValidation(run) && !isDeepPlanContinuationPending(run)) continue;
        pendingRuns.set(run.threadId, run);
        yield* worker.enqueue(run.threadId);
      }
      yield* noteSeen(snapshot.snapshotSequence);
    }),
    drainThrough: Effect.fn("DeepPlanValidationReactor.drainThrough")(function* (sequence) {
      yield* SubscriptionRef.changes(seenSequence).pipe(
        Stream.filter((seen) => seen >= sequence),
        Stream.runHead,
      );
      yield* worker.drain;
    }),
    streamReceiptsForTest: SubscriptionRef.changes(receipts).pipe(
      Stream.filter((receipt) => receipt !== null),
    ),
  });
});

export const DeepPlanValidationReactorLive = Layer.effect(DeepPlanValidationReactor, make);
