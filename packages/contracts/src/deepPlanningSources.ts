import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  IsoDateTime,
} from "./baseSchemas.ts";
import {
  DEEP_PLAN_MAX_ATTACHMENT_CHUNK_CHARS,
  DEEP_PLAN_MAX_CONTENT_CHUNK_CHARS,
  DEEP_PLAN_MAX_CHUNK_RECORDS,
  DEEP_PLAN_MAX_PAGE_SIZE,
  DEEP_PLAN_MAX_RECORD_BYTES,
  DeepPlanContentHash,
  DeepPlanExportId,
  DeepPlanRunId,
  DeepPlanSourceCoverage,
  DeepPlanSourceCatalogEntry,
  DeepPlanSourceId,
  DeepPlanSourceRef,
  DeepPlanSourceSnapshot,
  DeepPlanSourceSummary,
} from "./deepPlanning.ts";
import { OrchestrationMessage, OrchestrationThreadActivity } from "./orchestration.ts";

export const DEEP_PLAN_WS_METHODS = {
  getRun: "deepPlan.getRun",
  catalogSources: "deepPlan.catalogSources",
  exportSources: "deepPlan.exportSources",
  readExportChunk: "deepPlan.readExportChunk",
  initializeSources: "deepPlan.initializeSources",
  importSourceChunk: "deepPlan.importSourceChunk",
  listSources: "deepPlan.listSources",
  readSourceChunk: "deepPlan.readSourceChunk",
  summarizeSource: "deepPlan.summarizeSource",
} as const;

const DeepPlanCursor = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));

export const DeepPlanSourceRecordOrigin = Schema.Struct({
  ...DeepPlanSourceRef.fields,
  recordId: TrimmedNonEmptyString,
});
export type DeepPlanSourceRecordOrigin = typeof DeepPlanSourceRecordOrigin.Type;

const DeepPlanSourceRecordFields = {
  recordId: TrimmedNonEmptyString,
  origin: DeepPlanSourceRecordOrigin,
  contentHash: DeepPlanContentHash,
};

export const DeepPlanSourceMessageRecord = Schema.Struct({
  kind: Schema.Literal("message"),
  ...DeepPlanSourceRecordFields,
  message: OrchestrationMessage,
  detailsContentId: Schema.optional(TrimmedNonEmptyString),
  textContentId: Schema.optional(TrimmedNonEmptyString),
});
export type DeepPlanSourceMessageRecord = typeof DeepPlanSourceMessageRecord.Type;

export const DeepPlanSourceActivityRecord = Schema.Struct({
  kind: Schema.Literal("activity"),
  ...DeepPlanSourceRecordFields,
  activity: OrchestrationThreadActivity,
  detailsContentId: Schema.optional(TrimmedNonEmptyString),
});
export type DeepPlanSourceActivityRecord = typeof DeepPlanSourceActivityRecord.Type;

const validChunkIndex = Schema.makeFilter(
  (record: { readonly chunkIndex: number; readonly totalChunks: number }) =>
    record.chunkIndex < record.totalChunks || "Source chunkIndex must be less than totalChunks.",
);

export const DeepPlanSourceAttachmentRecord = Schema.Struct({
  kind: Schema.Literal("attachment"),
  ...DeepPlanSourceRecordFields,
  attachmentId: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  chunkIndex: NonNegativeInt,
  totalChunks: PositiveInt,
  dataBase64: Schema.String.check(
    Schema.isMaxLength(DEEP_PLAN_MAX_ATTACHMENT_CHUNK_CHARS),
    Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/),
  ),
}).check(validChunkIndex);
export type DeepPlanSourceAttachmentRecord = typeof DeepPlanSourceAttachmentRecord.Type;

export const DeepPlanSourceContentRecord = Schema.Struct({
  kind: Schema.Literal("content"),
  ...DeepPlanSourceRecordFields,
  contentId: TrimmedNonEmptyString,
  mediaType: TrimmedNonEmptyString,
  chunkIndex: NonNegativeInt,
  totalChunks: PositiveInt,
  data: Schema.String.check(Schema.isMaxLength(DEEP_PLAN_MAX_CONTENT_CHUNK_CHARS)),
  requiredForAnalysis: Schema.Boolean,
}).check(validChunkIndex);
export type DeepPlanSourceContentRecord = typeof DeepPlanSourceContentRecord.Type;

export const DeepPlanSourceContentReference = Schema.Struct({
  kind: Schema.Literal("content-reference"),
  ...DeepPlanSourceRecordFields,
  contentKind: Schema.Literals(["attachment", "content"]),
  contentId: TrimmedNonEmptyString,
  chunkIndex: NonNegativeInt,
  totalChunks: PositiveInt,
  byteLength: NonNegativeInt,
  cursor: Schema.optional(DeepPlanCursor),
}).check(validChunkIndex);
export type DeepPlanSourceContentReference = typeof DeepPlanSourceContentReference.Type;

export const DeepPlanSourceRecord = Schema.Union([
  DeepPlanSourceMessageRecord,
  DeepPlanSourceActivityRecord,
  DeepPlanSourceAttachmentRecord,
  DeepPlanSourceContentRecord,
]).check(
  Schema.makeFilter((record) => {
    try {
      return (
        new TextEncoder().encode(JSON.stringify(record)).byteLength <= DEEP_PLAN_MAX_RECORD_BYTES ||
        "Deep Plan source records exceed the serialized byte limit."
      );
    } catch {
      return "Deep Plan source records must be JSON serializable.";
    }
  }),
);
export type DeepPlanSourceRecord = typeof DeepPlanSourceRecord.Type;

const DeepPlanPageSize = PositiveInt.check(Schema.isLessThanOrEqualTo(DEEP_PLAN_MAX_PAGE_SIZE));
const DeepPlanChunkSize = PositiveInt.check(
  Schema.isLessThanOrEqualTo(DEEP_PLAN_MAX_CHUNK_RECORDS),
);
const DeepPlanRunFields = { threadId: ThreadId, runId: DeepPlanRunId };
const DeepPlanSourceReadFields = {
  sourceId: DeepPlanSourceId,
  cursor: Schema.optional(DeepPlanCursor),
  limit: Schema.optional(DeepPlanChunkSize),
};

export const DeepPlanCatalogSourcesInput = Schema.Struct({
  projectId: ProjectId,
  threadIds: Schema.optional(Schema.Array(ThreadId)),
  includeArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  cursor: Schema.optional(DeepPlanCursor),
  limit: Schema.optional(DeepPlanPageSize),
});
export type DeepPlanCatalogSourcesInput = typeof DeepPlanCatalogSourcesInput.Type;

export const DeepPlanCatalogSourcesResult = Schema.Struct({
  sources: Schema.Array(DeepPlanSourceCatalogEntry),
  nextCursor: Schema.NullOr(DeepPlanCursor),
});
export type DeepPlanCatalogSourcesResult = typeof DeepPlanCatalogSourcesResult.Type;

export const DeepPlanExportSourcesInput = Schema.Struct({
  projectId: ProjectId,
  threadIds: Schema.optional(Schema.Array(ThreadId)),
  includeArchived: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  exportId: Schema.optional(DeepPlanExportId),
  cursor: Schema.optional(DeepPlanCursor),
  limit: Schema.optional(DeepPlanPageSize),
});
export type DeepPlanExportSourcesInput = typeof DeepPlanExportSourcesInput.Type;

export const DeepPlanExportSourcesResult = Schema.Struct({
  exportId: DeepPlanExportId,
  capturedAt: IsoDateTime,
  sources: Schema.Array(DeepPlanSourceSnapshot),
  nextCursor: Schema.NullOr(DeepPlanCursor),
});
export type DeepPlanExportSourcesResult = typeof DeepPlanExportSourcesResult.Type;

export const DeepPlanReadExportChunkInput = Schema.Struct({
  exportId: DeepPlanExportId,
  ...DeepPlanSourceReadFields,
});
export type DeepPlanReadExportChunkInput = typeof DeepPlanReadExportChunkInput.Type;

const DeepPlanSourceChunk = Schema.Struct({
  snapshot: DeepPlanSourceSnapshot,
  records: Schema.Array(DeepPlanSourceRecord).check(
    Schema.isMaxLength(DEEP_PLAN_MAX_CHUNK_RECORDS),
  ),
  chunkHash: DeepPlanContentHash,
  nextCursor: Schema.NullOr(DeepPlanCursor),
});
export const DeepPlanReadExportChunkResult = DeepPlanSourceChunk;
export type DeepPlanReadExportChunkResult = typeof DeepPlanReadExportChunkResult.Type;

export const DeepPlanInitializeSourcesInput = Schema.Struct({
  ...DeepPlanRunFields,
  localExportId: Schema.optional(DeepPlanExportId),
  snapshots: Schema.Array(DeepPlanSourceSnapshot),
});
export type DeepPlanInitializeSourcesInput = typeof DeepPlanInitializeSourcesInput.Type;

export const DeepPlanListSourcesResult = Schema.Struct({
  runId: DeepPlanRunId,
  sources: Schema.Array(DeepPlanSourceSnapshot),
  coverage: Schema.Array(DeepPlanSourceCoverage),
});
export type DeepPlanListSourcesResult = typeof DeepPlanListSourcesResult.Type;
export const DeepPlanInitializeSourcesResult = DeepPlanListSourcesResult;
export type DeepPlanInitializeSourcesResult = typeof DeepPlanInitializeSourcesResult.Type;

export const DeepPlanImportSourceChunkInput = Schema.Struct({
  ...DeepPlanRunFields,
  snapshot: DeepPlanSourceSnapshot,
  chunkIndex: NonNegativeInt,
  chunkHash: DeepPlanContentHash,
  records: Schema.Array(DeepPlanSourceRecord).check(
    Schema.isMaxLength(DEEP_PLAN_MAX_CHUNK_RECORDS),
  ),
  finalChunk: Schema.Boolean,
});
export type DeepPlanImportSourceChunkInput = typeof DeepPlanImportSourceChunkInput.Type;

export const DeepPlanImportSourceChunkResult = Schema.Struct({
  runId: DeepPlanRunId,
  sourceId: DeepPlanSourceId,
  importedRecordCount: NonNegativeInt,
  complete: Schema.Boolean,
  coverage: DeepPlanSourceCoverage,
});
export type DeepPlanImportSourceChunkResult = typeof DeepPlanImportSourceChunkResult.Type;

export const DeepPlanListSourcesInput = Schema.Struct(DeepPlanRunFields);
export type DeepPlanListSourcesInput = typeof DeepPlanListSourcesInput.Type;

export const DeepPlanReadSourceChunkInput = Schema.Struct({
  ...DeepPlanRunFields,
  ...DeepPlanSourceReadFields,
  includeBodies: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type DeepPlanReadSourceChunkInput = typeof DeepPlanReadSourceChunkInput.Type;
export const DeepPlanReadSourceChunkResult = Schema.Struct({
  snapshot: DeepPlanSourceSnapshot,
  records: Schema.Array(Schema.Union([DeepPlanSourceRecord, DeepPlanSourceContentReference])).check(
    Schema.isMaxLength(DEEP_PLAN_MAX_CHUNK_RECORDS),
  ),
  chunkHash: DeepPlanContentHash,
  nextCursor: Schema.NullOr(DeepPlanCursor),
});
export type DeepPlanReadSourceChunkResult = typeof DeepPlanReadSourceChunkResult.Type;

export const DeepPlanSummarizeSourceInput = Schema.Struct({
  ...DeepPlanRunFields,
  sourceId: DeepPlanSourceId,
  expectedContentHash: DeepPlanContentHash,
  summary: DeepPlanSourceSummary,
});
export type DeepPlanSummarizeSourceInput = typeof DeepPlanSummarizeSourceInput.Type;
export const DeepPlanSummarizeSourceResult = DeepPlanSourceCoverage;
export type DeepPlanSummarizeSourceResult = typeof DeepPlanSummarizeSourceResult.Type;

export class DeepPlanSourceError extends Schema.TaggedError<DeepPlanSourceError>()(
  "DeepPlanSourceError",
  {
    code: Schema.Literals([
      "source-not-found",
      "export-not-found",
      "run-not-found",
      "invalid-chunk",
      "content-mismatch",
      "incomplete-source",
      "source-unavailable",
      "storage-failed",
    ]),
    message: TrimmedNonEmptyString,
    sourceId: Schema.optional(DeepPlanSourceId),
  },
) {}
