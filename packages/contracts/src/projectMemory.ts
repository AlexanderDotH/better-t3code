import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CheckpointRef,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS = 128_000;

export const ProjectMemoryMode = Schema.Literals(["project", "provider", "off"]);
export type ProjectMemoryMode = typeof ProjectMemoryMode.Type;

export const ProjectMemorySettings = Schema.Struct({
  memoryMode: ProjectMemoryMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("project" as const)),
  ),
  allowAgentWrites: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ProjectMemorySettings = typeof ProjectMemorySettings.Type;

export const ProjectMemorySettingsReadRequest = Schema.Struct({ projectId: ProjectId });
export type ProjectMemorySettingsReadRequest = typeof ProjectMemorySettingsReadRequest.Type;

export const ProjectMemorySettingsUpdateRequest = Schema.Struct({
  projectId: ProjectId,
  ...ProjectMemorySettings.fields,
});
export type ProjectMemorySettingsUpdateRequest = typeof ProjectMemorySettingsUpdateRequest.Type;

export const ProjectMemorySettingsResponse = Schema.Struct({
  projectId: ProjectId,
  settings: ProjectMemorySettings,
});
export type ProjectMemorySettingsResponse = typeof ProjectMemorySettingsResponse.Type;

export const ProjectMemoryStorage = Schema.Literals(["workspace", "fallback"]);
export type ProjectMemoryStorage = typeof ProjectMemoryStorage.Type;

export const ProjectMemoryDocumentStatus = Schema.Literals(["active", "provider", "off"]);
export type ProjectMemoryDocumentStatus = typeof ProjectMemoryDocumentStatus.Type;

export const ProjectMemoryDocumentViewRequest = Schema.Struct({ projectId: ProjectId });
export type ProjectMemoryDocumentViewRequest = typeof ProjectMemoryDocumentViewRequest.Type;

export const ProjectMemoryDocumentViewResponse = Schema.Struct({
  projectId: ProjectId,
  settings: ProjectMemorySettings,
  status: ProjectMemoryDocumentStatus,
  storage: Schema.NullOr(ProjectMemoryStorage),
  effectivePath: Schema.NullOr(Schema.String),
  rawMarkdown: Schema.String,
});
export type ProjectMemoryDocumentViewResponse = typeof ProjectMemoryDocumentViewResponse.Type;

export const ProjectMemoryDocumentReplaceRequest = Schema.Struct({
  projectId: ProjectId,
  markdown: Schema.String,
});
export type ProjectMemoryDocumentReplaceRequest = typeof ProjectMemoryDocumentReplaceRequest.Type;

export const ProjectMemoryDocumentClearRequest = Schema.Struct({ projectId: ProjectId });
export type ProjectMemoryDocumentClearRequest = typeof ProjectMemoryDocumentClearRequest.Type;

export const ProjectMemoryDocumentMutationResponse = Schema.Struct({
  applied: Schema.Boolean,
  view: ProjectMemoryDocumentViewResponse,
});
export type ProjectMemoryDocumentMutationResponse =
  typeof ProjectMemoryDocumentMutationResponse.Type;

export const ProjectMemorySection = Schema.Literals([
  "project-profile",
  "active-decisions",
  "verified-workflows",
  "known-pitfalls",
  "recent-outcomes",
]);
export type ProjectMemorySection = typeof ProjectMemorySection.Type;

export const ProjectMemoryStableKey = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
);
export type ProjectMemoryStableKey = typeof ProjectMemoryStableKey.Type;

export const ProjectMemoryEntry = Schema.Struct({
  section: ProjectMemorySection,
  key: ProjectMemoryStableKey,
  content: TrimmedNonEmptyString,
  verified: Schema.Boolean,
  sourceThreadId: ThreadId,
  checkpointRef: Schema.optionalKey(CheckpointRef),
});
export type ProjectMemoryEntry = typeof ProjectMemoryEntry.Type;

export const ProjectMemoryReadRequest = Schema.Struct({
  projectId: ProjectId,
  query: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  contextWindowTokens: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS)),
  ),
});
export type ProjectMemoryReadRequest = typeof ProjectMemoryReadRequest.Type;

export const ProjectMemorySaveRequest = Schema.Struct({
  projectId: ProjectId,
  ...ProjectMemoryEntry.fields,
});
export type ProjectMemorySaveRequest = typeof ProjectMemorySaveRequest.Type;

export const ProjectMemoryImportRequest = Schema.Struct({ projectId: ProjectId });
export type ProjectMemoryImportRequest = typeof ProjectMemoryImportRequest.Type;

export const ProjectMemoryDeleteRequest = Schema.Struct({
  projectId: ProjectId,
  key: ProjectMemoryStableKey,
});
export type ProjectMemoryDeleteRequest = typeof ProjectMemoryDeleteRequest.Type;

export const ProjectMemoryReadResponse = Schema.Struct({
  mode: ProjectMemoryMode,
  storage: Schema.NullOr(ProjectMemoryStorage),
  entries: Schema.Array(ProjectMemoryEntry),
  markdown: Schema.String,
  tokenBudget: NonNegativeInt,
  estimatedTokens: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ProjectMemoryReadResponse = typeof ProjectMemoryReadResponse.Type;

export const ProjectMemorySaveResponse = Schema.Struct({
  mode: ProjectMemoryMode,
  storage: Schema.NullOr(ProjectMemoryStorage),
  applied: Schema.Boolean,
  replaced: Schema.Boolean,
  entry: Schema.NullOr(ProjectMemoryEntry),
});
export type ProjectMemorySaveResponse = typeof ProjectMemorySaveResponse.Type;

export const ProjectMemoryImportResponse = Schema.Struct({
  mode: ProjectMemoryMode,
  storage: Schema.NullOr(ProjectMemoryStorage),
  applied: Schema.Boolean,
  imported: NonNegativeInt,
});
export type ProjectMemoryImportResponse = typeof ProjectMemoryImportResponse.Type;

export const ProjectMemoryDeleteResponse = Schema.Struct({
  mode: ProjectMemoryMode,
  storage: Schema.NullOr(ProjectMemoryStorage),
  applied: Schema.Boolean,
  deleted: Schema.Boolean,
});
export type ProjectMemoryDeleteResponse = typeof ProjectMemoryDeleteResponse.Type;

export const ProjectMemoryToolInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("search"),
    query: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
    contextWindowTokens: PositiveInt.pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS)),
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("remember"),
    section: ProjectMemorySection,
    key: ProjectMemoryStableKey,
    content: TrimmedNonEmptyString,
    verified: Schema.Boolean,
    checkpointRef: Schema.optionalKey(CheckpointRef),
  }),
  Schema.Struct({
    action: Schema.Literal("forget"),
    key: ProjectMemoryStableKey,
  }),
]);
export type ProjectMemoryToolInput = typeof ProjectMemoryToolInput.Type;

export const ProjectMemoryToolResult = Schema.Union([
  Schema.Struct({ action: Schema.Literal("search"), result: ProjectMemoryReadResponse }),
  Schema.Struct({ action: Schema.Literal("remember"), result: ProjectMemorySaveResponse }),
  Schema.Struct({ action: Schema.Literal("forget"), result: ProjectMemoryDeleteResponse }),
]);
export type ProjectMemoryToolResult = typeof ProjectMemoryToolResult.Type;

export const ProjectMemoryOperation = Schema.Literals([
  "read",
  "save",
  "import",
  "delete",
  "settings-read",
  "settings-update",
  "document-view",
  "document-replace",
  "document-clear",
]);
export type ProjectMemoryOperation = typeof ProjectMemoryOperation.Type;

export const ProjectMemoryFailureReason = Schema.Literals([
  "project_mismatch",
  "write_forbidden",
  "workspace_unavailable",
  "operation_failed",
]);
export type ProjectMemoryFailureReason = typeof ProjectMemoryFailureReason.Type;

export class ProjectMemoryError extends Schema.TaggedErrorClass<ProjectMemoryError>()(
  "ProjectMemoryError",
  {
    operation: ProjectMemoryOperation,
    reason: ProjectMemoryFailureReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Project memory operation failed.";
  }
}
