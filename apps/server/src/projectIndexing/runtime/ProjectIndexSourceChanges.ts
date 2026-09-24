import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import type { ProjectIndexExtractionBridge } from "./ProjectIndexingPipeline.ts";

export function sameProjectIndexSource(
  previous: ProjectSourceFileV1,
  current: ProjectSourceFileV1,
) {
  return (
    previous.contentHash === current.contentHash &&
    previous.classification === current.classification &&
    previous.skipReason === current.skipReason &&
    JSON.stringify(previous.configDependencies) === JSON.stringify(current.configDependencies)
  );
}

/** Watch notifications include metadata-only writes; they must not create a new index revision. */
export const hasProjectIndexSourceChanges = Effect.fn("hasProjectIndexSourceChanges")(function* (
  store: KnowledgeStore,
  extraction: ProjectIndexExtractionBridge,
  root: string,
) {
  const revision = (yield* store.getState()).publishedRevision;
  if (revision === null) return true;
  const previousCount = yield* store.countFiles(revision);
  let count = 0;
  let cursor: unknown | null = null;
  while (true) {
    const page = yield* extraction.scan(root, cursor);
    for (const file of page.files) {
      const previous = yield* store.getRecord("files", file.path, revision);
      if (
        previous === null ||
        previous.status === "stale" ||
        !sameProjectIndexSource(previous, file)
      )
        return true;
      count++;
    }
    if (page.done) return count !== previousCount;
    cursor = page.nextCursor;
  }
});
