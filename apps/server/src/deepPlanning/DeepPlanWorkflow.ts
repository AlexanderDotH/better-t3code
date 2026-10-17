import {
  CommandId,
  DeepPlanError,
  DeepPlanSourceCoverage,
  DeepPlanSourceSnapshot,
  type DeepPlanGetRunInput,
  type DeepPlanRun,
  type DeepPlanRunId,
  type ThreadDeepPlanStartCommand,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { DeepPlanSources } from "./DeepPlanSources.ts";

export type DeepPlanStartInput = Omit<
  ThreadDeepPlanStartCommand,
  "type" | "commandId" | "createdAt"
>;
export type DeepPlanUpdateInput = Omit<
  ThreadDeepPlanUpdateCommand,
  "type" | "commandId" | "createdAt"
>;

export class DeepPlanWorkflow extends Context.Service<
  DeepPlanWorkflow,
  {
    readonly getRun: (
      input: DeepPlanGetRunInput,
    ) => Effect.Effect<DeepPlanRun | null, DeepPlanError>;
    readonly start: (input: DeepPlanStartInput) => Effect.Effect<DeepPlanRun, DeepPlanError>;
    readonly update: (input: DeepPlanUpdateInput) => Effect.Effect<DeepPlanRun, DeepPlanError>;
    readonly withRunLock: <A, E, R>(
      runId: DeepPlanRunId,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
  }
>()("t3/deepPlanning/DeepPlanWorkflow") {}

const sourceSnapshotsEqual = Schema.toEquivalence(Schema.Array(DeepPlanSourceSnapshot));
const coverageEntryEqual = Schema.toEquivalence(DeepPlanSourceCoverage);
const decodeErrorCode = Schema.decodeUnknownOption(DeepPlanError.fields.code);

function coverageEqual(
  left: ReadonlyArray<DeepPlanSourceCoverage>,
  right: ReadonlyArray<DeepPlanSourceCoverage>,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry) => {
      const candidate = right.find((value) => value.sourceId === entry.sourceId);
      return (
        candidate !== undefined &&
        coverageEntryEqual(entry, { ...candidate, updatedAt: entry.updatedAt })
      );
    })
  );
}

function dispatchError(error: OrchestrationDispatchError): DeepPlanError {
  if (error._tag === "OrchestrationCommandInvariantError") {
    const code =
      Predicate.isObject(error.context) && "deepPlanCode" in error.context
        ? Option.getOrElse(
            decodeErrorCode(error.context.deepPlanCode),
            () => "invalid-transition" as const,
          )
        : "invalid-transition";
    return new DeepPlanError({ code, message: error.detail });
  }
  return new DeepPlanError({ code: "storage-failed", message: error.message });
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const threads = yield* ProjectionThreadRepository;
  const sources = yield* DeepPlanSources;
  const runLocks = new Map<DeepPlanRunId, Semaphore.Semaphore>();
  const crypto = yield* Crypto.Crypto;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextCommandId = crypto.randomUUIDv4.pipe(
    Effect.map(CommandId.make),
    Effect.mapError(
      () =>
        new DeepPlanError({
          code: "storage-failed",
          message: "Could not create a Deep Plan command identifier.",
        }),
    ),
  );

  const getRun: DeepPlanWorkflow["Service"]["getRun"] = Effect.fn("DeepPlanWorkflow.getRun")(
    function* (input) {
      const row = yield* threads.getById({ threadId: input.threadId }).pipe(
        Effect.mapError(
          () =>
            new DeepPlanError({
              code: "storage-failed",
              message: "Could not read Deep Plan state.",
            }),
        ),
      );
      if (Option.isNone(row) || row.value.deletedAt !== null) return null;
      if (input.runId !== undefined && row.value.deepPlan?.id === input.runId)
        return row.value.deepPlan;
      const run =
        Option.getOrNull(
          yield* threads.getDeepPlanByImplementationThreadId(input.threadId).pipe(
            Effect.mapError(
              () =>
                new DeepPlanError({
                  code: "storage-failed",
                  message: "Could not read the implementing Deep Plan.",
                }),
            ),
          ),
        ) ?? row.value.deepPlan;
      return run != null && (input.runId === undefined || input.runId === run.id) ? run : null;
    },
  );

  const requireRun = Effect.fn("DeepPlanWorkflow.requireRun")(function* (
    input: DeepPlanGetRunInput,
  ) {
    const run = yield* getRun(input);
    if (run === null)
      return yield* new DeepPlanError({
        code: "run-not-found",
        message: "The Deep Plan run was not found in this thread.",
      });
    return run;
  });

  const start: DeepPlanWorkflow["Service"]["start"] = Effect.fn("DeepPlanWorkflow.start")(
    function* (input) {
      yield* engine
        .dispatch({
          ...input,
          type: "thread.deep-plan.start",
          commandId: yield* nextCommandId,
          createdAt: yield* nowIso,
        })
        .pipe(Effect.mapError(dispatchError));
      return yield* requireRun({ threadId: input.threadId, runId: input.runId });
    },
  );

  const update: DeepPlanWorkflow["Service"]["update"] = Effect.fn("DeepPlanWorkflow.update")(
    function* (input) {
      const run = yield* requireRun({ threadId: input.threadId, runId: input.runId });
      if (input.mutation.type === "publish-plan" || input.mutation.type === "approve") {
        const actual = yield* sources
          .assertCompleteCoverage(run.id)
          .pipe(
            Effect.mapError(
              (error) => new DeepPlanError({ code: "sources-incomplete", message: error.message }),
            ),
          );
        if (
          !sourceSnapshotsEqual(actual.sources, run.sources) ||
          !coverageEqual(actual.coverage, run.sourceCoverage)
        ) {
          return yield* new DeepPlanError({
            code: "sources-incomplete",
            message:
              "Deep Plan source coverage changed. Refresh it before publishing or approving.",
          });
        }
        if (input.mutation.type === "publish-plan") {
          yield* sources
            .validatePlanCitations(run.id, input.mutation.plan)
            .pipe(
              Effect.mapError(
                (error) =>
                  new DeepPlanError({ code: "sources-incomplete", message: error.message }),
              ),
            );
        }
      } else if (
        input.mutation.type === "sources-set" ||
        input.mutation.type === "source-coverage"
      ) {
        const actual = yield* sources
          .listSources({ threadId: run.threadId, runId: run.id })
          .pipe(
            Effect.mapError(
              (error) => new DeepPlanError({ code: "sources-incomplete", message: error.message }),
            ),
          );
        if (
          input.mutation.type === "sources-set"
            ? !sourceSnapshotsEqual(actual.sources, input.mutation.sources)
            : !coverageEqual(actual.coverage, input.mutation.coverage)
        ) {
          return yield* new DeepPlanError({
            code: "sources-incomplete",
            message: "Deep Plan sources and coverage must match the frozen server snapshot.",
          });
        }
      }
      yield* engine
        .dispatch({
          ...input,
          type: "thread.deep-plan.update",
          commandId: yield* nextCommandId,
          createdAt: yield* nowIso,
        })
        .pipe(Effect.mapError(dispatchError));
      return yield* requireRun({ threadId: input.threadId, runId: input.runId });
    },
  );

  const withRunLock: DeepPlanWorkflow["Service"]["withRunLock"] = (runId, effect) =>
    Effect.suspend(() => {
      let lock = runLocks.get(runId);
      if (lock === undefined) {
        lock = Semaphore.makeUnsafe(1);
        runLocks.set(runId, lock);
      }
      return lock.withPermit(effect);
    });

  return DeepPlanWorkflow.of({ getRun, start, update, withRunLock });
});

export const DeepPlanWorkflowLive = Layer.effect(DeepPlanWorkflow, make);
