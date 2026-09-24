import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { KnowledgeBatch } from "../persistence/KnowledgeStoreTypes.ts";
import { collectProjectIndexRecords, listExtractedProjectFiles } from "./ProjectIndexingRecords.ts";
import type { ProjectIndexStageContext } from "./ProjectIndexStageTypes.ts";

export const runProjectIndexResolution = Effect.fn("runProjectIndexResolution")(function* (
  context: ProjectIndexStageContext,
) {
  if (context.getMetadata().resolutionComplete) return;
  const { store, revision, extraction, resolved } = context;
  const guard = { lease: context.lease, revision };
  yield* context.checkpoint({ phase: "validation" }, "updating");
  const apply = Effect.fn("ProjectIndexResolution.apply")(function* (batch: KnowledgeBatch) {
    yield* context.assertCurrent;
    yield* store.applyBatch({ ...guard, batch });
    yield* context.checkpoint({ coverage: yield* store.aggregateCoverage(revision) }, "updating");
  });
  if (extraction.resolveBatches !== undefined) {
    yield* Stream.runForEach(
      extraction.resolveBatches({ root: resolved.workspaceRoot, store, revision }),
      apply,
    );
  } else {
    let cursor: string | undefined;
    while (true) {
      const page = yield* listExtractedProjectFiles(store, revision, cursor);
      for (const file of page.items)
        yield* apply(
          yield* extraction.resolve({
            root: resolved.workspaceRoot,
            files: [file],
            entities: yield* collectProjectIndexRecords(store, revision, "entities", file.path),
            callsites: yield* collectProjectIndexRecords(store, revision, "callsites", file.path),
          }),
        );
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
  }
  yield* context.checkpoint({ resolutionComplete: true }, "updating");
});
