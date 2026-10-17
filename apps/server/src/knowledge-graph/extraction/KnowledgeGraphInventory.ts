import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import {
  isKnowledgeGraphInventoryError,
  KnowledgeGraphInventoryError,
  type ExtractKnowledgeGraphInventoryInput,
} from "./KnowledgeGraphInventoryTypes.ts";
import { KnowledgeGraphWorkerClient } from "./KnowledgeGraphWorkerClient.ts";

export {
  KnowledgeGraphInventoryError,
  resolveKnowledgeGraphInventoryBounds,
  type ExtractKnowledgeGraphInventoryInput,
} from "./KnowledgeGraphInventoryTypes.ts";

/** Acquire once in the indexer's scope so successive jobs reuse the worker and its analysis cache. */
export const makeKnowledgeGraphInventory = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => new KnowledgeGraphWorkerClient()),
    (worker) => Effect.promise(() => worker.close()),
  );
  const semaphore = yield* Semaphore.make(1);
  const extract = Effect.fn("KnowledgeGraphInventory.extract")(
    (input: ExtractKnowledgeGraphInventoryInput) =>
      semaphore.withPermits(1)(
        Effect.tryPromise({
          try: (signal) => client.extract(input, signal),
          catch: (cause) =>
            isKnowledgeGraphInventoryError(cause)
              ? cause
              : new KnowledgeGraphInventoryError({
                  operation: "worker",
                  workspaceRoot: input.workspaceRoot,
                  relativePath: "",
                  cause,
                }),
        }),
      ),
  );
  return { extract };
});

export const extractKnowledgeGraphInventory = Effect.fn("extractKnowledgeGraphInventory")(
  (input: ExtractKnowledgeGraphInventoryInput) =>
    Effect.scoped(
      makeKnowledgeGraphInventory.pipe(Effect.flatMap((inventory) => inventory.extract(input))),
    ),
);
