import {
  DeepPlanError,
  DeepPlanSourceError,
  DeepPlanSourceCoverage,
  type DeepPlanRunId,
  type ThreadId,
  type ThreadDeepPlanStartCommand,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { DeepPlanSources, type DeepPlanSourcesShape } from "./DeepPlanSources.ts";
import { DeepPlanWorkflow } from "./DeepPlanWorkflow.ts";

type SourceRunInput = { readonly threadId: ThreadId; readonly runId: DeepPlanRunId };
type SourceError = DeepPlanSourceError | DeepPlanError;
type ApplicationSources = Pick<
  DeepPlanSourcesShape,
  "catalogSources" | "exportSources" | "readExportChunk" | "listSources"
> & {
  readonly initializeSources: DeepPlanSourcesShape["initializeSources"];
  readonly importSourceChunk: DeepPlanSourcesShape["importSourceChunk"];
  readonly readSourceChunk: DeepPlanSourcesShape["readSourceChunk"];
  readonly summarizeSource: DeepPlanSourcesShape["summarizeSource"];
};

export class DeepPlanApplication extends Context.Service<
  DeepPlanApplication,
  ApplicationSources & {
    readonly getRun: DeepPlanWorkflow["Service"]["getRun"];
    readonly pauseForInterrupt: (threadId: ThreadId) => Effect.Effect<void, DeepPlanError>;
    readonly dispatch: (
      command: ThreadDeepPlanStartCommand | ThreadDeepPlanUpdateCommand,
    ) => Effect.Effect<{ readonly sequence: number }, SourceError>;
  }
>()("t3/deepPlanning/DeepPlanApplication") {}

const sameCoverage = Schema.toEquivalence(Schema.Array(DeepPlanSourceCoverage));

const make = Effect.gen(function* () {
  const sources = yield* DeepPlanSources;
  const workflow = yield* DeepPlanWorkflow;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const requireRun = Effect.fn("DeepPlanApplication.requireRun")(function* (input: SourceRunInput) {
    const run = yield* workflow
      .getRun(input)
      .pipe(
        Effect.mapError(
          (error) => new DeepPlanSourceError({ code: "run-not-found", message: error.message }),
        ),
      );
    if (run === null || run.threadId !== input.threadId) {
      return yield* new DeepPlanSourceError({
        code: "run-not-found",
        message: "This source operation is not bound to the owning Deep Plan.",
      });
    }
    return run;
  });

  const syncCoverage = Effect.fn("DeepPlanApplication.syncCoverage")(function* (
    input: SourceRunInput,
    initialize = false,
  ) {
    let run = yield* requireRun(input);
    const actual = yield* sources.listSources(input);
    if (initialize && run.phase === "collecting") {
      run = yield* workflow
        .update({
          ...input,
          expectedRevision: run.revision,
          operationId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
          mutation: { type: "sources-set", sources: actual.sources },
        })
        .pipe(
          Effect.mapError(
            (error) => new DeepPlanSourceError({ code: "storage-failed", message: error.message }),
          ),
        );
    }
    if (run.plan === null && !sameCoverage(run.sourceCoverage, actual.coverage)) {
      yield* workflow
        .update({
          ...input,
          expectedRevision: run.revision,
          operationId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
          mutation: { type: "source-coverage", coverage: actual.coverage },
        })
        .pipe(
          Effect.mapError(
            (error) => new DeepPlanSourceError({ code: "storage-failed", message: error.message }),
          ),
        );
    }
  });

  const withSources = <A>(
    input: SourceRunInput,
    operation: Effect.Effect<A, DeepPlanSourceError>,
    initialize = false,
    readOnly = false,
  ) =>
    workflow.withRunLock(
      input.runId,
      Effect.gen(function* () {
        const run = yield* requireRun(input);
        const planning =
          run.phase === "collecting" ||
          run.phase === "planning" ||
          run.phase === "awaitingApproval";
        if (!readOnly && (!planning || run.plan !== null)) {
          return yield* new DeepPlanSourceError({
            code: "source-unavailable",
            message: "The frozen Deep Plan sources cannot change during implementation.",
          });
        }
        const result = yield* operation;
        if (planning) yield* syncCoverage(input, initialize);
        return result;
      }),
    );

  const dispatch: DeepPlanApplication["Service"]["dispatch"] = (command) =>
    workflow.withRunLock(
      command.runId,
      Effect.gen(function* () {
        if (command.type === "thread.deep-plan.start") {
          if ((command.sources?.length ?? 0) > 0) {
            return yield* new DeepPlanError({
              code: "sources-incomplete",
              message:
                "Source manifests must be collected through the authenticated source transfer.",
            });
          }
          yield* workflow.start({ threadId: command.threadId, runId: command.runId });
        } else {
          if (
            command.mutation.type === "sources-set" ||
            command.mutation.type === "source-coverage"
          ) {
            return yield* new DeepPlanError({
              code: "invalid-transition",
              message: "Source coverage is maintained by the source reader.",
            });
          }
          yield* workflow.update(command);
        }
        return { sequence: yield* engine.latestSequence };
      }),
    );

  return DeepPlanApplication.of({
    getRun: workflow.getRun,
    pauseForInterrupt: (threadId) =>
      Effect.gen(function* () {
        const run = yield* workflow.getRun({ threadId });
        if (run === null || run.phase === "completed" || run.phase === "paused") return;
        yield* workflow.withRunLock(
          run.id,
          Effect.gen(function* () {
            const current = yield* workflow.getRun({ threadId: run.threadId, runId: run.id });
            if (current === null || current.phase === "completed" || current.phase === "paused")
              return;
            yield* workflow.update({
              threadId: current.threadId,
              runId: current.id,
              expectedRevision: current.revision,
              operationId: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
              mutation: { type: "pause", reason: "Stopped by the user." },
            });
          }),
        );
      }),
    dispatch,
    catalogSources: sources.catalogSources,
    exportSources: sources.exportSources,
    readExportChunk: sources.readExportChunk,
    listSources: (input) => Effect.andThen(requireRun(input), sources.listSources(input)),
    initializeSources: (input) => withSources(input, sources.initializeSources(input), true),
    importSourceChunk: (input) => withSources(input, sources.importSourceChunk(input)),
    readSourceChunk: (input) => withSources(input, sources.readSourceChunk(input), false, true),
    summarizeSource: () =>
      Effect.fail(
        new DeepPlanSourceError({
          code: "source-unavailable",
          message: "Source summaries are recorded by the run-bound agent tools.",
        }),
      ),
  });
});

export const DeepPlanApplicationLive = Layer.effect(DeepPlanApplication, make);
