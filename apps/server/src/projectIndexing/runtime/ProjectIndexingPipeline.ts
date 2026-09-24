import {
  ProjectSourceFileV1,
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectIndexGapV1,
  type ProjectIndexState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import type { KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import type {
  KnowledgeBatch,
  KnowledgeJob,
  KnowledgeJobKind,
  KnowledgeRecordMap,
  KnowledgePage,
  WriterLease,
} from "../persistence/KnowledgeStoreTypes.ts";
import type { ResolvedProjectIndexScope } from "./ProjectIndexingBridge.ts";
import { asProjectIndexRuntimeError, encodeProjectIndexJson } from "./ProjectIndexingErrors.ts";
import type { ProjectIndexGenerationMetadata } from "./ProjectIndexingMetadata.ts";
import { runProjectIndexInvalidation } from "./ProjectIndexInvalidationStage.ts";
import { runProjectIndexResolution } from "./ProjectIndexResolutionStage.ts";
import { sameProjectIndexSource } from "./ProjectIndexSourceChanges.ts";
const BATCH_SIZE = 128;
const MAX_ATTEMPTS = 3;
const LEASE_DURATION_MS = 45_000;
const decodeSourceFile = Schema.decodeEffect(Schema.fromJsonString(ProjectSourceFileV1));

export interface ProjectIndexExtractionBridge {
  readonly scan: (
    root: string,
    cursor: unknown | null,
  ) => Effect.Effect<
    {
      readonly files: ReadonlyArray<ProjectSourceFileV1>;
      readonly gaps: ReadonlyArray<ProjectIndexGapV1>;
      readonly nextCursor: unknown | null;
      readonly done: boolean;
    },
    Error
  >;
  readonly extract: (
    root: string,
    file: ProjectSourceFileV1,
  ) => Effect.Effect<KnowledgeBatch, Error>;
  readonly resolve: (input: {
    readonly root: string;
    readonly files: ReadonlyArray<ProjectSourceFileV1>;
    readonly entities: ReadonlyArray<ProjectEntityV1>;
    readonly callsites: ReadonlyArray<ProjectCallsiteV1>;
  }) => Effect.Effect<KnowledgeBatch, Error>;
  readonly resolveBatches?: (input: {
    readonly root: string;
    readonly store: KnowledgeStore;
    readonly revision: number;
  }) => Stream.Stream<KnowledgeBatch, Error>;
  readonly readSource: (
    root: string,
    filePath: string,
    expectedHash: string,
  ) => Effect.Effect<string, Error>;
}

export interface ProjectIndexPipelineInput {
  readonly resolved: ResolvedProjectIndexScope;
  readonly store: KnowledgeStore;
  readonly lease: WriterLease;
  readonly revision: number;
  readonly metadata: ProjectIndexGenerationMetadata;
  readonly extraction: ProjectIndexExtractionBridge;
  readonly assertCurrent: Effect.Effect<void, Error>;
  readonly progress: (
    state: ProjectIndexState,
    metadata: ProjectIndexGenerationMetadata,
  ) => Effect.Effect<void, Error>;
}

function generationGap(
  kind: ProjectIndexGapV1["kind"],
  detail: string,
  filePath?: string,
): ProjectIndexGapV1 {
  return {
    id: `runtime:${kind}:${filePath ?? "generation"}`,
    kind,
    message: detail.slice(0, 16_000),
    retryable: true,
    ...(filePath === undefined ? {} : { filePath }),
  };
}

export const runProjectIndexingPipeline = Effect.fn("runProjectIndexingPipeline")(function* (
  input: ProjectIndexPipelineInput,
) {
  const { store, revision, extraction, resolved } = input;
  const guard = { lease: input.lease, revision };
  let metadata = input.metadata;
  const checkpoint = Effect.fn("ProjectIndexPipeline.checkpoint")(function* (
    patch: Partial<ProjectIndexGenerationMetadata>,
    state: ProjectIndexState,
  ) {
    yield* input.assertCurrent;
    metadata = { ...metadata, ...patch };
    yield* store.renewLease(input.lease, LEASE_DURATION_MS);
    yield* store.setGenerationMetadata({
      ...guard,
      metadataJson: encodeProjectIndexJson(metadata),
      coverage: metadata.coverage,
    });
    yield* input.progress(state, metadata);
  });

  if (!metadata.resetComplete) {
    let cursor = metadata.resetCursor;
    do {
      yield* input.assertCurrent;
      const page = yield* store.listRecords({
        kind: "files",
        revision,
        limit: BATCH_SIZE,
        ...(cursor === null ? {} : { afterId: cursor }),
      });
      yield* store.applyBatch({
        ...guard,
        batch: { files: page.items.map((file) => ({ ...file, status: "stale" as const })) },
      });
      cursor = page.nextCursor;
      yield* checkpoint({ resetCursor: cursor, resetComplete: cursor === null }, "discovering");
    } while (cursor !== null);
  }

  if (!metadata.inventoryComplete) {
    yield* checkpoint({ phase: "discovery" }, "discovering");
    const previousRevision = (yield* store.getState()).publishedRevision;
    while (!metadata.inventoryComplete) {
      yield* input.assertCurrent;
      const page = yield* extraction.scan(resolved.workspaceRoot, metadata.inventoryCursor);
      const files: ProjectSourceFileV1[] = [];
      for (const file of page.files) {
        const previous =
          previousRevision === null
            ? null
            : yield* store.getRecord("files", file.path, previousRevision);
        const unchanged =
          metadata.kind === "refresh" &&
          previous !== null &&
          sameProjectIndexSource(previous, file);
        files.push(
          unchanged
            ? { ...file, status: previous.status === "indexed" ? "indexed" : file.status }
            : file,
        );
      }
      yield* store.applyBatch({ ...guard, batch: { files, gaps: page.gaps } });
      yield* checkpoint(
        {
          inventoryCursor: page.nextCursor,
          inventoryComplete: page.done,
          coverage: {
            ...metadata.coverage,
            discoveredFiles: metadata.coverage.discoveredFiles + files.length,
            eligibleFiles:
              metadata.coverage.eligibleFiles +
              files.filter((file) => file.status !== "skipped").length,
            indexedFiles:
              metadata.coverage.indexedFiles +
              files.filter((file) => file.status === "indexed").length,
            skippedFiles:
              metadata.coverage.skippedFiles +
              files.filter((file) => file.status === "skipped").length,
            failedFiles:
              metadata.coverage.failedFiles +
              files.filter((file) => file.status === "failed").length,
          },
        },
        "discovering",
      );
    }
  }

  const settleJob = Effect.fn("ProjectIndexPipeline.settleJob")(function* (
    kind: KnowledgeJobKind,
    job: KnowledgeJob,
    perform: Effect.Effect<KnowledgeBatch, Error>,
  ) {
    const outcome = yield* perform.pipe(Effect.result);
    yield* input.assertCurrent;
    if (Result.isSuccess(outcome)) {
      const completed = yield* store
        .completeJob({
          ...guard,
          jobId: job.id,
          claimToken: job.claimToken!,
          batch: outcome.success,
        })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            error.code === "stale-source" ? Effect.succeed(false) : Effect.fail(error),
          ),
        );
      if (!completed) {
        yield* store.invalidateFiles({ ...guard, filePaths: [job.filePath] });
        yield* store.applyBatch({
          ...guard,
          batch: {
            gaps: [
              generationGap(
                "stale-source",
                "This file changed during indexing. Its outdated results were discarded; refresh to index the latest source.",
                job.filePath,
              ),
            ],
          },
        });
        yield* checkpoint({ sourceChangesPending: true }, "extracting");
        return;
      }
      if (kind === "extract")
        metadata = {
          ...metadata,
          coverage: {
            ...metadata.coverage,
            indexedFiles: Math.min(
              metadata.coverage.eligibleFiles,
              metadata.coverage.indexedFiles +
                (outcome.success.files?.filter((file) => file.status === "indexed").length ?? 0),
            ),
            totalEntities:
              metadata.coverage.totalEntities + (outcome.success.entities?.length ?? 0),
            totalCallsites:
              metadata.coverage.totalCallsites + (outcome.success.callsites?.length ?? 0),
            totalImports:
              (metadata.coverage.totalImports ?? 0) + (outcome.success.imports?.length ?? 0),
            resolvedImports:
              (metadata.coverage.resolvedImports ?? 0) +
              (outcome.success.imports?.filter((item) => item.resolution === "workspace").length ??
                0),
          },
        };
    } else {
      yield* store.failJob({
        ...guard,
        jobId: job.id,
        claimToken: job.claimToken!,
        retryable: true,
        maxAttempts: MAX_ATTEMPTS,
        detail: outcome.failure.message,
      });
      if (job.attempts >= MAX_ATTEMPTS)
        yield* store.applyBatch({
          ...guard,
          batch: {
            gaps: [generationGap("parse-error", outcome.failure.message, job.filePath)],
          },
        });
      metadata = { ...metadata, lastError: outcome.failure.message.slice(0, 16_000) };
    }
    yield* checkpoint({}, "extracting");
  });

  const runJobs = Effect.fn("ProjectIndexPipeline.runJobs")(function* (
    kind: KnowledgeJobKind,
    perform: (job: KnowledgeJob) => Effect.Effect<KnowledgeBatch, Error>,
  ) {
    while (true) {
      yield* input.assertCurrent;
      const jobs = yield* store.claimJobs({ ...guard, kind, limit: 1 });
      const job = jobs[0];
      if (job === undefined) break;
      yield* settleJob(kind, job, perform(job));
    }
  });

  const stageContext = {
    ...input,
    getMetadata: () => metadata,
    setMetadata: (next: ProjectIndexGenerationMetadata) => {
      metadata = next;
    },
    checkpoint,
    runJobs,
  };
  yield* runProjectIndexInvalidation(stageContext);

  yield* runJobs(
    "extract",
    Effect.fn("ProjectIndexPipeline.extract")(function* (job) {
      const file = yield* decodeSourceFile(job.inputJson).pipe(
        Effect.mapError(asProjectIndexRuntimeError),
      );
      return yield* extraction.extract(resolved.workspaceRoot, file);
    }),
  );

  yield* runProjectIndexResolution(stageContext);
  yield* input.assertCurrent;
  yield* store.refreshModuleDependencies(guard);

  const coverage = yield* store.aggregateCoverage(revision);
  let gapCursor: string | null = null;
  let incomplete =
    coverage.failedFiles > 0 ||
    (yield* store.listRecords({
      kind: "files",
      revision,
      fileStatuses: ["stale", "pending"],
      limit: 1,
    })).items.length > 0;
  do {
    const page: KnowledgePage<KnowledgeRecordMap["gaps"]> = yield* store.listRecords({
      kind: "gaps",
      revision,
      limit: BATCH_SIZE,
      ...(gapCursor === null ? {} : { afterId: gapCursor }),
    });
    incomplete ||= page.items.some((gap) =>
      ["stale-source", "parse-error", "unsupported-language"].includes(gap.kind),
    );
    gapCursor = page.nextCursor;
  } while (gapCursor !== null && !incomplete);
  const jobs = yield* store.getJobsSummary(revision);
  if (!incomplete && jobs.every((job) => !["failed", "pending", "running"].includes(job.state))) {
    const { lastError: _lastError, ...completedMetadata } = metadata;
    metadata = completedMetadata;
  }
  yield* checkpoint({ phase: "complete", coverage, incomplete }, "updating");
  yield* input.assertCurrent;
  yield* store.publishGeneration(guard);
  return metadata;
});
