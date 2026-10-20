import {
  DeepPlanExportId,
  DeepPlanExportSourcesInput,
  DeepPlanSourceError,
  DeepPlanSourceId,
  DeepPlanSourceRecord,
  DeepPlanSourceSnapshot,
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  ThreadForkState,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { captureSourceRecords } from "./DeepPlanSourceCapture.ts";
import {
  canonicalSourceJson,
  sourceContentHash,
  sourceManifestHasher,
} from "./DeepPlanSourceContent.ts";

export const SOURCE_EXPORT_BATCH_BYTES = 256 * 1024;
export const SourceExportJob = Schema.Struct({
  dbPath: Schema.String,
  outputPath: Schema.String,
  attachmentsDir: Schema.String,
  exportId: DeepPlanExportId,
  capturedAt: IsoDateTime,
  environmentId: EnvironmentId,
  environmentLabel: Schema.String,
  input: DeepPlanExportSourcesInput,
});
export type SourceExportJob = typeof SourceExportJob.Type;

export const SourceExportEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("record"),
    sourceId: DeepPlanSourceId,
    record: DeepPlanSourceRecord,
  }),
  Schema.Struct({ type: Schema.Literal("snapshot"), snapshot: DeepPlanSourceSnapshot }),
]);
export type SourceExportEntry = typeof SourceExportEntry.Type;

export const SourceExportResult = Schema.Struct({ completeProject: Schema.Boolean });
export const SourceExportResponse = Schema.Union([
  Schema.Struct({ type: Schema.Literal("done"), result: SourceExportResult }),
  Schema.Struct({ type: Schema.Literal("failed"), error: DeepPlanSourceError }),
]);

const decodeThreads = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      title: Schema.String,
      archivedAt: Schema.NullOr(IsoDateTime),
      fork: Schema.NullOr(Schema.fromJsonString(ThreadForkState)),
      forkProjectId: Schema.NullOr(ProjectId),
    }),
  ),
);
const THREAD_PAGE_SIZE = 128;

/** Freeze all selected histories in one read snapshot without holding the server's connection. */
export const writeSourceExport = Effect.fn("DeepPlanSources.writeSourceExport")(function* (
  job: SourceExportJob,
) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.open(job.outputPath, { flag: "w" });
  let lines: string[] = [];
  let bytes = 0;
  const flush = Effect.fnUntraced(function* () {
    if (lines.length === 0) return;
    yield* output.writeAll(Buffer.from(lines.join("")));
    lines = [];
    bytes = 0;
  });
  const append = Effect.fnUntraced(function* (entry: SourceExportEntry) {
    const line = canonicalSourceJson(entry) + "\n";
    const size = Buffer.byteLength(line);
    if (bytes + size > SOURCE_EXPORT_BATCH_BYTES) yield* flush();
    lines.push(line);
    bytes += size;
  });
  const project = yield* sql<{ readonly title: string }>`
    SELECT title FROM projection_projects WHERE project_id = ${job.input.projectId} AND deleted_at IS NULL
  `;
  if (!project[0])
    return yield* new DeepPlanSourceError({
      code: "source-not-found",
      message: "The source project was not found.",
    });
  const selection = new Set(job.input.threadIds);
  const found = new Set<string>();
  let afterThreadId = "";
  while (true) {
    const rows = yield* sql`
      SELECT t.thread_id AS "threadId", t.title, t.archived_at AS "archivedAt", t.fork_json AS fork,
        (SELECT project_id FROM projection_threads WHERE thread_id = json_extract(t.fork_json, '$.provenance.sourceThreadId')) AS "forkProjectId"
      FROM projection_threads t WHERE t.project_id = ${job.input.projectId} AND t.deleted_at IS NULL
        AND t.thread_id > ${afterThreadId} AND (${job.input.includeArchived !== false ? 1 : 0} = 1 OR t.archived_at IS NULL)
      ORDER BY t.thread_id LIMIT ${THREAD_PAGE_SIZE}
    `;
    const threads = yield* decodeThreads(rows);
    if (threads.length === 0) break;
    for (const thread of threads) {
      afterThreadId = thread.threadId;
      if (job.input.threadIds !== undefined && !selection.has(thread.threadId)) continue;
      found.add(thread.threadId);
      const origin = {
        environmentId: job.environmentId,
        projectId: job.input.projectId,
        threadId: thread.threadId,
      };
      const sourceId = DeepPlanSourceId.make(sourceContentHash([job.exportId, origin]));
      const manifest = sourceManifestHasher();
      const counts = yield* captureSourceRecords({
        origin,
        attachmentsDir: job.attachmentsDir,
        onRecord: Effect.fnUntraced(function* (record) {
          manifest.add(record);
          yield* append({ type: "record", sourceId, record });
        }),
      });
      const contentHash = manifest.finish();
      yield* append({
        type: "snapshot",
        snapshot: {
          sourceId,
          origin,
          environmentLabel: job.environmentLabel,
          projectTitle: project[0].title,
          threadTitle: thread.title,
          archived: thread.archivedAt !== null,
          capturedAt: job.capturedAt,
          contentVersion: contentHash,
          contentHash,
          ...counts,
          forkOrigin:
            thread.fork === null
              ? null
              : {
                  ...origin,
                  projectId: thread.forkProjectId ?? job.input.projectId,
                  threadId: thread.fork.provenance.sourceThreadId,
                },
        },
      });
    }
  }
  if (job.input.threadIds?.some((threadId) => !found.has(threadId)))
    return yield* new DeepPlanSourceError({
      code: "source-not-found",
      message: "A selected chat is deleted, unavailable, or outside the source project.",
    });
  const counts = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count FROM projection_threads WHERE project_id = ${job.input.projectId} AND deleted_at IS NULL
  `;
  yield* flush();
  return { completeProject: found.size === counts[0]?.count };
});
