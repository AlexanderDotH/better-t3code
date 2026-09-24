import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ProjectId, ThreadId } from "../baseSchemas.ts";
import { ProviderOptionSelections } from "../model.ts";
import { ProviderInstanceId } from "../providerInstance.ts";

export const PROJECT_KNOWLEDGE_VERSION = 1 as const;
export const PROJECT_INDEX_DEFAULT_QUERY_TOKENS = 6_000;
export const PROJECT_INDEX_MAX_QUERY_TOKENS = 24_000;
export const PROJECT_INDEX_MAX_QUERY_RECORDS = 200;
export const PROJECT_INDEX_MAX_QUERY_CALLSITES = 600;
export const PROJECT_INDEX_MAX_QUERY_EVIDENCE = 200;
export const PROJECT_INDEX_MAX_VISIBLE_ENTITIES = 150;
export const PROJECT_INDEX_MAX_VISIBLE_CALLSITES = 400;
export const PROJECT_INDEX_MAX_ANALYSIS_ATTEMPTS = 3;
export const PROJECT_INDEX_MAX_EVIDENCE_EXCERPT_LENGTH = 2_000;
export const PROJECT_INDEX_MAX_WIRE_BYTES = 1_048_576;

export const ProjectIndexId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(512),
  Schema.makeFilter((value) => value.trim() === value, {
    message: "Expected a trimmed identifier",
  }),
);
export type ProjectIndexId = typeof ProjectIndexId.Type;

export const ProjectIndexText = Schema.String.check(Schema.isMaxLength(16_000));
export const ProjectIndexLabel = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(1_024),
  Schema.makeFilter((value) => value.trim().length > 0, { message: "Expected a nonblank label" }),
);
export const ProjectIndexHash = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256));

// Paths are workspace-relative, normalized POSIX paths. Filesystem containment
// still has to be checked against the server-resolved workspace before reading.
export const ProjectIndexPath = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(4_096),
  Schema.makeFilter(
    (path) =>
      !path.startsWith("/") &&
      !/^[a-z]:/i.test(path) &&
      !/[\\\p{Cc}]/u.test(path) &&
      path.split("/").every((part) => part !== ".." && part !== "." && part.length > 0),
    { message: "Expected a normalized workspace-relative path" },
  ),
);
export type ProjectIndexPath = typeof ProjectIndexPath.Type;

export const ProjectIndexScopeInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexScopeInput = typeof ProjectIndexScopeInput.Type;

export const ProjectIndexScopeV1 = Schema.Struct({
  scopeId: ProjectIndexId,
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
  workspaceFingerprint: ProjectIndexHash,
});
export type ProjectIndexScopeV1 = typeof ProjectIndexScopeV1.Type;

// New indexing writes require the explicit provider-instance routing key.
// Existing ModelSelection's legacy decoder remains unchanged for old settings.
export const ProjectIndexModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: ProjectIndexLabel,
  options: Schema.optionalKey(ProviderOptionSelections),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexModelSelection = typeof ProjectIndexModelSelection.Type;

const SourceRange = Schema.Struct({
  startLine: PositiveInt,
  startColumn: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
  startOffset: Schema.optionalKey(NonNegativeInt),
  endOffset: Schema.optionalKey(NonNegativeInt),
});

/** Lines/columns are one-based; UTF-16 offsets are zero-based and end-exclusive. */
export const ProjectSourceRangeV1 = SourceRange.check(
  Schema.makeFilter(
    (range) =>
      (range.endLine > range.startLine ||
        (range.endLine === range.startLine && range.endColumn >= range.startColumn)) &&
      ((range.startOffset === undefined && range.endOffset === undefined) ||
        (range.startOffset !== undefined &&
          range.endOffset !== undefined &&
          range.endOffset >= range.startOffset)),
    { message: "Expected an ordered source range with paired offsets" },
  ),
);
export type ProjectSourceRangeV1 = typeof ProjectSourceRangeV1.Type;

export const ProjectIndexProvenance = Schema.Literals(["parser", "compiler", "llm", "manual"]);
export type ProjectIndexProvenance = typeof ProjectIndexProvenance.Type;

export const ProjectIndexFreshness = Schema.Literals(["current", "stale", "missing", "unknown"]);
export type ProjectIndexFreshness = typeof ProjectIndexFreshness.Type;

export const ProjectIndexResolution = Schema.Literals(["resolved", "candidate", "unresolved"]);
export type ProjectIndexResolution = typeof ProjectIndexResolution.Type;

export const ProjectIndexEvidenceIds = Schema.Array(ProjectIndexId).check(Schema.isMaxLength(64));
