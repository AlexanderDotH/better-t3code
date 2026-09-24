import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { asProjectIndexRuntimeError, encodeProjectIndexJson } from "./ProjectIndexingErrors.ts";
import type { ProjectIndexStageContext } from "./ProjectIndexStageTypes.ts";

const PAGE_SIZE = 128;
const InvalidationJob = Schema.Struct({ filePath: Schema.String, deleted: Schema.Boolean });
const decodeJob = Schema.decodeEffect(Schema.fromJsonString(InvalidationJob));

export const runProjectIndexInvalidation = Effect.fn("runProjectIndexInvalidation")(function* (
  context: ProjectIndexStageContext,
) {
  if (context.getMetadata().invalidationComplete) return;
  const { store, revision } = context;
  const guard = { lease: context.lease, revision };
  const previousRevision = (yield* store.getState()).publishedRevision ?? 0;
  const invalidateAll = context.getMetadata().invalidateAll;
  if (!context.getMetadata().invalidationQueued) {
    let afterPath = context.getMetadata().invalidationSeedCursor ?? undefined;
    while (true) {
      const page = invalidateAll
        ? yield* store
            .listRecords({
              kind: "files",
              revision,
              limit: PAGE_SIZE,
              ...(afterPath === undefined ? {} : { afterId: afterPath }),
            })
            .pipe(Effect.map((page) => ({ ...page, items: page.items.map((file) => file.path) })))
        : yield* store.getChangedFilePaths({
            revision: previousRevision,
            currentRevision: revision,
            limit: PAGE_SIZE,
            ...(afterPath === undefined ? {} : { afterPath }),
          });
      for (const filePath of page.items) {
        const file = yield* store.getRecord("files", filePath, revision);
        if (
          !invalidateAll &&
          previousRevision !== 0 &&
          context.getMetadata().invalidationGlobalPath === null
        ) {
          const previous = yield* store.getRecord("files", filePath, previousRevision);
          if (
            [file?.classification, previous?.classification].some(
              (kind) => kind !== undefined && ["configuration", "manifest", "rule"].includes(kind),
            )
          )
            context.setMetadata({ ...context.getMetadata(), invalidationGlobalPath: filePath });
        }
        yield* store.enqueueJobs({
          ...guard,
          jobs: [
            {
              id: `invalidate:${filePath}`,
              idempotencyKey: `invalidate:${filePath}`,
              kind: "resolve",
              filePath: "",
              contentHash: "",
              inputJson: encodeProjectIndexJson({
                filePath,
                deleted: file === null || file.status === "stale" || file.status === "deleted",
              }),
            },
          ],
        });
      }
      if (page.nextCursor === null) break;
      afterPath = page.nextCursor;
      yield* context.checkpoint({ invalidationSeedCursor: afterPath }, "extracting");
    }
    yield* context.checkpoint({ invalidationQueued: true }, "extracting");
  }
  yield* context.runJobs(
    "resolve",
    Effect.fn("ProjectIndexInvalidation.apply")(function* (job) {
      const change = yield* decodeJob(job.inputJson).pipe(
        Effect.mapError(asProjectIndexRuntimeError),
      );
      const globalPath = context.getMetadata().invalidationGlobalPath;
      if (!invalidateAll && globalPath !== null && globalPath !== change.filePath) {
        if (change.deleted)
          yield* store.applyBatch({ ...guard, batch: {}, removeFilePaths: [change.filePath] });
        return {};
      }
      let afterPath: string | undefined;
      do {
        const page =
          previousRevision === 0 || invalidateAll
            ? { items: [change.filePath], nextCursor: null }
            : yield* store.getAffectedFilePaths({
                revision: previousRevision,
                currentRevision: revision,
                changedPaths: [change.filePath],
                limit: PAGE_SIZE,
                ...(afterPath === undefined ? {} : { afterPath }),
              });
        for (const filePath of page.items) {
          const file = yield* store.getRecord("files", filePath, revision);
          yield* store.invalidateFiles({ ...guard, filePaths: [filePath] });
          if (filePath === change.filePath && change.deleted) {
            yield* store.applyBatch({ ...guard, batch: {}, removeFilePaths: [filePath] });
          } else if (
            file !== null &&
            (file.skipReason !== undefined ||
              file.contentHash === "unread" ||
              file.status === "skipped" ||
              file.status === "failed")
          ) {
            const previous =
              previousRevision === 0
                ? null
                : yield* store.getRecord("files", filePath, previousRevision);
            if (
              file.status !== "failed" &&
              previous !== null &&
              previous.skipReason === undefined &&
              previous.contentHash !== "unread"
            )
              yield* store.applyBatch({ ...guard, batch: {}, removeFilePaths: [filePath] });
            yield* store.applyBatch({
              ...guard,
              batch: {
                files: [{ ...file, status: file.status === "failed" ? "failed" : "skipped" }],
              },
            });
          } else if (file !== null) {
            const pending = { ...file, status: "pending" as const };
            yield* store.applyBatch({
              ...guard,
              resetStructuralFilePaths: [filePath],
              batch: { files: [pending] },
            });
            yield* store.enqueueJobs({
              ...guard,
              jobs: [
                {
                  id: `extract:${filePath}`,
                  idempotencyKey: `extract:${filePath}:${file.contentHash}`,
                  kind: "extract",
                  filePath,
                  contentHash: file.contentHash,
                  inputJson: encodeProjectIndexJson(pending),
                },
              ],
            });
          }
        }
        afterPath = page.nextCursor ?? undefined;
      } while (afterPath !== undefined);
      return {};
    }),
  );
  yield* context.checkpoint({ invalidationComplete: true, phase: "extraction" }, "extracting");
});
