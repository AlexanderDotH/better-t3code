// @effect-diagnostics nodeBuiltinImport:off - A dedicated compiler worker owns synchronous TypeScript 6 analysis.
// @effect-diagnostics globalTimers:off - The worker is terminated at its hard analysis deadline.
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeURL from "node:url";

import { ProjectCallsiteV1, ProjectIndexGapV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { resolveFilesystemAsset, resolveIndexerPackage } from "./assets.ts";
import { type SemanticInput, type SemanticResult } from "./semantic.ts";

const Result = Schema.Struct({
  callsites: Schema.Array(ProjectCallsiteV1),
  gaps: Schema.Array(ProjectIndexGapV1),
});
const decodeResult = Schema.decodeUnknownSync(Result);

export function resolveCompatibleWorker(moduleUrl = import.meta.url) {
  const sourceMode = moduleUrl.endsWith(".ts");
  const relativeEntry = sourceMode
    ? "./typescriptCompatibleWorker.ts"
    : "./project-indexer-typescript-compatible.mjs";
  const entry = NodeURL.pathToFileURL(
    resolveFilesystemAsset(NodeURL.fileURLToPath(new URL(relativeEntry, moduleUrl))),
  );
  resolveIndexerPackage(entry.href, "@typescript/typescript6");
  return { entry, sourceMode };
}

export async function resolveTypeScriptCompatible(
  input: SemanticInput,
  moduleUrl = import.meta.url,
): Promise<SemanticResult> {
  input.signal?.throwIfAborted();
  const { entry, sourceMode } = resolveCompatibleWorker(moduleUrl);
  return new Promise((resolve, reject) => {
    const worker = new NodeWorkerThreads.Worker(entry, {
      workerData: {
        root: input.root,
        files: input.files,
        entities: input.entities,
        callsites: input.callsites,
      },
      execArgv: sourceMode ? ["--experimental-strip-types"] : [],
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error?: Error, result?: SemanticResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      void worker.terminate().then(() => {
        if (error) reject(error);
        else if (result) resolve(result);
      }, reject);
    };
    const abort = () => finish(new Error("TypeScript compatibility analysis cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "TypeScript compatibility analysis exceeded its time budget; syntax inventory is preserved.",
          ),
        ),
      120_000,
    );
    timer.unref();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled)
        finish(new Error(`TypeScript compatibility worker exited without a result (${code}).`));
    });
    worker.once("message", (message: unknown) => {
      try {
        const result = decodeResult(message);
        finish(undefined, { callsites: [...result.callsites], gaps: [...result.gaps] });
      } catch (error) {
        finish(new Error(`Invalid TypeScript compatibility worker response: ${String(error)}`));
      }
    });
  });
}
