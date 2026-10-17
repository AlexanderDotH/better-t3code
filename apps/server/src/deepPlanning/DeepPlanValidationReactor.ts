import type { DeepPlanRun, OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
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
  const engine = yield* OrchestrationEngineService;
  const threads = yield* ProjectionThreadRepository;
  const dispatcher = yield* DeepPlanValidationDispatcher;
  const activation = yield* ServerActivation;
  const receipts = yield* SubscriptionRef.make<DeepPlanValidationReceipt | null>(null);
  const seenSequence = yield* SubscriptionRef.make(0);
  const pendingRuns = new Map<ThreadId, DeepPlanRun>();
  const dispatched = new Set<string>();
  let started = false;

  const process = Effect.fn("DeepPlanValidationReactor.process")(function* (threadId: ThreadId) {
    if (activation !== undefined) yield* activation;
    const thread = yield* threads.getById({ threadId });
    const run =
      Option.isSome(thread) && thread.value.deletedAt === null && thread.value.archivedAt === null
        ? thread.value.deepPlan
        : null;
    if (run == null || !awaitsFinalValidation(run)) {
      pendingRuns.delete(threadId);
      return;
    }
    pendingRuns.set(threadId, run);
    const requestId = finalValidationRequestId(run);
    if (dispatched.has(requestId)) return;
    const result = yield* dispatcher.dispatch(run, requestId).pipe(
      Effect.catchTag("DeepPlanValidationDispatchError", (error) =>
        Effect.logWarning("Deep Plan final validation dispatch failed", {
          threadId,
          runId: run.id,
          message: error.message,
        }).pipe(Effect.as("failed" as const)),
      ),
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
    event: OrchestrationEvent,
  ) {
    if (event.type === "thread.deep-plan-updated") {
      if (awaitsFinalValidation(event.payload.run)) {
        pendingRuns.set(event.payload.threadId, event.payload.run);
      } else {
        pendingRuns.delete(event.payload.threadId);
      }
      yield* worker.enqueue(event.payload.threadId);
    } else if (
      event.type === "thread.session-set" ||
      event.type === "thread.turn-diff-completed" ||
      event.type === "thread.turn-abort-settled"
    ) {
      for (const [threadId, run] of pendingRuns) {
        if (run.approval?.implementationThreadId === event.payload.threadId) {
          yield* worker.enqueue(threadId);
        }
      }
    }
    yield* noteSeen(event.sequence);
  });

  return DeepPlanValidationReactor.of({
    start: Effect.fn("DeepPlanValidationReactor.start")(function* () {
      if (started) return;
      started = true;
      const events = yield* engine.subscribeDomainEvents;
      yield* forkParked(Stream.runForEach(events, consume));
      const runs = yield* threads
        .listDeepPlans()
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Deep Plan validation startup recovery failed", { error }).pipe(
              Effect.as([]),
            ),
          ),
        );
      for (const run of runs) {
        if (!awaitsFinalValidation(run)) continue;
        pendingRuns.set(run.threadId, run);
        yield* worker.enqueue(run.threadId);
      }
      yield* engine.latestSequence.pipe(Effect.flatMap(noteSeen));
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
