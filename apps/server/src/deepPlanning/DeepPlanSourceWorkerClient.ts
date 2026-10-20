// @effect-diagnostics nodeBuiltinImport:off - This scope owns and cancels the native source worker.
import * as NodeURL from "node:url";
import * as NodeWorkerThreads from "node:worker_threads";

import { DeepPlanSourceError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { runtimeModuleUrl } from "../process/fileBackedModules.ts";
import { resolveFilesystemAsset } from "../projectIndexing/extraction/assets.ts";
import {
  type SourceExportJob,
  SourceExportResponse,
  SourceExportResult,
} from "./DeepPlanSourceExport.ts";

const decodeResponse = Schema.decodeUnknownSync(SourceExportResponse);
const workerError = (cause: unknown) =>
  new DeepPlanSourceError({
    code: "source-unavailable",
    message:
      cause instanceof Error
        ? `Source export failed: ${cause.message}`
        : "The source export worker failed.",
  });

export const captureSourceExportInWorker = Effect.fn("DeepPlanSources.captureInWorker")(
  (job: SourceExportJob) =>
    Effect.scoped(
      Effect.gen(function* () {
        const worker = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const sourceMode = import.meta.url.endsWith(".ts");
              const entry = NodeURL.pathToFileURL(
                resolveFilesystemAsset(
                  NodeURL.fileURLToPath(
                    new URL(
                      sourceMode ? "./DeepPlanSourceWorker.ts" : "./deep-plan-source-worker.mjs",
                      runtimeModuleUrl(import.meta.url),
                    ),
                  ),
                ),
              );
              return new NodeWorkerThreads.Worker(entry, {
                workerData: job,
                execArgv: sourceMode ? ["--experimental-strip-types"] : [],
                resourceLimits: { maxOldGenerationSizeMb: 1_024 },
              });
            },
            catch: workerError,
          }),
          (worker) => Effect.promise(() => worker.terminate()).pipe(Effect.asVoid),
        );
        return yield* Effect.callback<typeof SourceExportResult.Type, DeepPlanSourceError>(
          (resume) => {
            const onMessage = (value: unknown) => {
              try {
                const response = decodeResponse(value);
                resume(
                  response.type === "done"
                    ? Effect.succeed(response.result)
                    : Effect.fail(response.error),
                );
              } catch (cause) {
                resume(Effect.fail(workerError(cause)));
              }
            };
            const onError = (cause: Error) => resume(Effect.fail(workerError(cause)));
            const onExit = (code: number) =>
              resume(
                Effect.fail(
                  workerError(new Error(`Source worker exited without a result (${code}).`)),
                ),
              );
            worker.on("message", onMessage);
            worker.on("error", onError);
            worker.on("exit", onExit);
            return Effect.sync(() => {
              worker.off("message", onMessage);
              worker.off("exit", onExit);
            });
          },
        );
      }),
    ),
);
