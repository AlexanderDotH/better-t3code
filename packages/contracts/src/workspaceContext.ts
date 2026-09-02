import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { WorkspaceRevision } from "./workspaceEdit.ts";

export const WORKSPACE_CONTEXT_MAX_QUERIES = 8;
export const WORKSPACE_CONTEXT_MAX_READS = 12;
export const WORKSPACE_CONTEXT_MAX_QUERY_LENGTH = 256;
export const WORKSPACE_CONTEXT_MAX_PATH_LENGTH = 512;
export const WORKSPACE_CONTEXT_MAX_CONTEXT_LINES = 8;
export const WORKSPACE_CONTEXT_MAX_RESULTS_PER_QUERY = 20;
export const WORKSPACE_CONTEXT_MAX_READ_LINES = 400;
export const WORKSPACE_CONTEXT_DEFAULT_CONTEXT_LINES = 2;
export const WORKSPACE_CONTEXT_DEFAULT_RESULTS_PER_QUERY = 10;

export const WorkspaceContextQueryMode = Schema.Literals(["auto", "path", "content"]);
export type WorkspaceContextQueryMode = typeof WorkspaceContextQueryMode.Type;

export const WorkspaceContextQuery = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(WORKSPACE_CONTEXT_MAX_QUERY_LENGTH)),
  mode: Schema.optional(WorkspaceContextQueryMode),
});
export type WorkspaceContextQuery = typeof WorkspaceContextQuery.Type;

const validReadRange = Schema.makeFilter(
  (input: { readonly startLine?: number | undefined; readonly endLine?: number | undefined }) =>
    input.startLine === undefined ||
    input.endLine === undefined ||
    input.endLine >= input.startLine ||
    "endLine must be greater than or equal to startLine.",
);

export const WorkspaceContextRead = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(WORKSPACE_CONTEXT_MAX_PATH_LENGTH)),
  startLine: Schema.optional(PositiveInt),
  endLine: Schema.optional(PositiveInt),
}).check(validReadRange);
export type WorkspaceContextRead = typeof WorkspaceContextRead.Type;

const WorkspaceContextQueries = Schema.Array(WorkspaceContextQuery).check(
  Schema.isMaxLength(WORKSPACE_CONTEXT_MAX_QUERIES),
);
const WorkspaceContextReads = Schema.Array(WorkspaceContextRead).check(
  Schema.isMaxLength(WORKSPACE_CONTEXT_MAX_READS),
);
const WorkspaceContextLines = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(WORKSPACE_CONTEXT_MAX_CONTEXT_LINES),
);
const WorkspaceContextResultsPerQuery = PositiveInt.check(
  Schema.isLessThanOrEqualTo(WORKSPACE_CONTEXT_MAX_RESULTS_PER_QUERY),
);

export const WorkspaceFindInput = Schema.Struct({
  queries: WorkspaceContextQueries.check(Schema.isMinLength(1)),
  contextLines: Schema.optional(WorkspaceContextLines),
  maxResultsPerQuery: Schema.optional(WorkspaceContextResultsPerQuery),
});
export type WorkspaceFindInput = typeof WorkspaceFindInput.Type;

export const WorkspaceReadInput = Schema.Struct({
  reads: WorkspaceContextReads.check(Schema.isMinLength(1)),
});
export type WorkspaceReadInput = typeof WorkspaceReadInput.Type;

const hasAtLeastOneOperation = Schema.makeFilter(
  (input: {
    readonly queries?: ReadonlyArray<WorkspaceContextQuery> | undefined;
    readonly reads?: ReadonlyArray<WorkspaceContextRead> | undefined;
  }) =>
    (input.queries?.length ?? 0) + (input.reads?.length ?? 0) > 0 ||
    "At least one workspace query or read is required.",
);

export const WorkspaceContextInput = Schema.Struct({
  queries: Schema.optional(WorkspaceContextQueries),
  reads: Schema.optional(WorkspaceContextReads),
  contextLines: Schema.optional(WorkspaceContextLines),
  maxResultsPerQuery: Schema.optional(WorkspaceContextResultsPerQuery),
}).check(hasAtLeastOneOperation);
export type WorkspaceContextInput = typeof WorkspaceContextInput.Type;

export const WorkspaceContextMatch = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: Schema.Literals(["path", "content"]),
  matchLine: Schema.optional(PositiveInt),
  lineStart: Schema.optional(PositiveInt),
  lineEnd: Schema.optional(PositiveInt),
  excerpt: Schema.optional(Schema.String),
});
export type WorkspaceContextMatch = typeof WorkspaceContextMatch.Type;

export const WorkspaceContextQueryResult = Schema.Struct({
  text: TrimmedNonEmptyString,
  mode: WorkspaceContextQueryMode,
  matches: Schema.Array(WorkspaceContextMatch),
  truncated: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});
export type WorkspaceContextQueryResult = typeof WorkspaceContextQueryResult.Type;

export const WorkspaceContextReadResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ok"),
    path: TrimmedNonEmptyString,
    lineStart: PositiveInt,
    lineEnd: PositiveInt,
    text: Schema.String,
    truncated: Schema.Boolean,
    revision: Schema.optional(WorkspaceRevision),
  }),
  Schema.Struct({
    status: Schema.Literal("error"),
    path: TrimmedNonEmptyString,
    error: Schema.Literals(["not_found", "binary", "unreadable"]),
    message: TrimmedNonEmptyString,
  }),
]);
export type WorkspaceContextReadResult = typeof WorkspaceContextReadResult.Type;

export const WorkspaceContextResult = Schema.Struct({
  queries: Schema.Array(WorkspaceContextQueryResult),
  reads: Schema.Array(WorkspaceContextReadResult),
  truncated: Schema.Boolean,
  warnings: Schema.Array(Schema.String),
});
export type WorkspaceContextResult = typeof WorkspaceContextResult.Type;

export const WorkspaceContextUnavailableReason = Schema.Literals([
  "credential_not_authorized",
  "projection_unavailable",
  "thread_not_found",
  "project_not_found",
  "workspace_root_not_found",
  "workspace_root_not_directory",
  "workspace_root_unreadable",
]);
export type WorkspaceContextUnavailableReason = typeof WorkspaceContextUnavailableReason.Type;

export class WorkspaceContextUnavailableError extends Schema.TaggedErrorClass<WorkspaceContextUnavailableError>()(
  "WorkspaceContextUnavailableError",
  {
    reason: WorkspaceContextUnavailableReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Workspace context is unavailable.";
  }
}

export class WorkspaceContextPathError extends Schema.TaggedErrorClass<WorkspaceContextPathError>()(
  "WorkspaceContextPathError",
  {
    relativePath: TrimmedNonEmptyString,
    reason: Schema.Literal("path_outside_root"),
  },
) {
  override get message(): string {
    return "Workspace context path is not readable.";
  }
}

export class WorkspaceContextSearchError extends Schema.TaggedErrorClass<WorkspaceContextSearchError>()(
  "WorkspaceContextSearchError",
  {
    backend: Schema.Literals(["git", "filesystem"]),
    operation: Schema.Literals(["inventory", "content-search", "read"]),
    reason: Schema.Literals(["command_failed", "deadline_exceeded", "operation_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Workspace context search failed.";
  }
}

export const WorkspaceContextError = Schema.Union([
  WorkspaceContextUnavailableError,
  WorkspaceContextPathError,
  WorkspaceContextSearchError,
]);
export type WorkspaceContextError = typeof WorkspaceContextError.Type;
