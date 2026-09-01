import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WORKSPACE_EDIT_MAX_CHANGES = 64;
export const WORKSPACE_EDIT_MAX_EDITS = 256;
export const WORKSPACE_EDIT_MAX_PATH_LENGTH = 512;
export const WORKSPACE_EDIT_MAX_RESULTING_FILE_BYTES = 1024 * 1024;
export const WORKSPACE_EDIT_MAX_BATCH_WORKING_SET_BYTES = 8 * 1024 * 1024;

const WorkspaceEditPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(WORKSPACE_EDIT_MAX_PATH_LENGTH),
);

export const WorkspaceRevision = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
export type WorkspaceRevision = typeof WorkspaceRevision.Type;

export const WorkspaceEditWriteMode = Schema.Literals(["create", "overwrite", "upsert"]);
export type WorkspaceEditWriteMode = typeof WorkspaceEditWriteMode.Type;

export const WorkspaceEditWrite = Schema.Struct({
  type: Schema.Literal("write"),
  mode: WorkspaceEditWriteMode,
  content: Schema.String,
});
export type WorkspaceEditWrite = typeof WorkspaceEditWrite.Type;

export const WorkspaceEditReplaceOccurrence = Schema.Literals(["one", "all"]);
export type WorkspaceEditReplaceOccurrence = typeof WorkspaceEditReplaceOccurrence.Type;

const validExpectedReplacementCount = Schema.makeFilter(
  (input: {
    readonly occurrence?: WorkspaceEditReplaceOccurrence | undefined;
    readonly expected_count?: number | undefined;
  }) =>
    input.expected_count === undefined ||
    input.occurrence === "all" ||
    "expected_count requires occurrence to be 'all'.",
);

export const WorkspaceEditReplace = Schema.Struct({
  type: Schema.Literal("replace"),
  old_text: Schema.String.check(Schema.isNonEmpty()),
  new_text: Schema.String,
  occurrence: Schema.optional(WorkspaceEditReplaceOccurrence),
  expected_count: Schema.optional(PositiveInt),
}).check(validExpectedReplacementCount);
export type WorkspaceEditReplace = typeof WorkspaceEditReplace.Type;

const validRange = Schema.makeFilter(
  (input: { readonly start: number; readonly end: number }) =>
    input.end >= input.start || "end must be greater than or equal to start.",
);

export const WorkspaceEditLineRange = Schema.Struct({
  type: Schema.Literal("lines"),
  start: PositiveInt,
  end: PositiveInt,
}).check(validRange);
export type WorkspaceEditLineRange = typeof WorkspaceEditLineRange.Type;

export const WorkspaceEditCodePointRange = Schema.Struct({
  type: Schema.Literal("code_points"),
  start: NonNegativeInt,
  end: NonNegativeInt,
}).check(validRange);
export type WorkspaceEditCodePointRange = typeof WorkspaceEditCodePointRange.Type;

export const WorkspaceEditSpliceRange = Schema.Union([
  WorkspaceEditLineRange,
  WorkspaceEditCodePointRange,
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({ type: Schema.Literal("end") }),
]);
export type WorkspaceEditSpliceRange = typeof WorkspaceEditSpliceRange.Type;

export const WorkspaceEditSplice = Schema.Struct({
  type: Schema.Literal("splice"),
  range: WorkspaceEditSpliceRange,
  content: Schema.String,
});
export type WorkspaceEditSplice = typeof WorkspaceEditSplice.Type;

export const WorkspaceEditDelete = Schema.Struct({
  type: Schema.Literal("delete"),
  if_missing: Schema.optional(Schema.Literals(["error", "ignore"])),
});
export type WorkspaceEditDelete = typeof WorkspaceEditDelete.Type;

export const WorkspaceEdit = Schema.Union([
  WorkspaceEditWrite,
  WorkspaceEditReplace,
  WorkspaceEditSplice,
  WorkspaceEditDelete,
]);
export type WorkspaceEdit = typeof WorkspaceEdit.Type;

export const WorkspaceEditChange = Schema.Struct({
  path: WorkspaceEditPath,
  expected_revision: Schema.optional(WorkspaceRevision),
  edits: Schema.Array(WorkspaceEdit).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WORKSPACE_EDIT_MAX_EDITS),
  ),
});
export type WorkspaceEditChange = typeof WorkspaceEditChange.Type;

const validBatch = Schema.makeFilter(
  (input: { readonly changes: ReadonlyArray<WorkspaceEditChange> }) => {
    const paths = new Set(input.changes.map((change) => change.path));
    if (paths.size !== input.changes.length) return "Workspace edit paths must be unique.";
    const editCount = input.changes.reduce((count, change) => count + change.edits.length, 0);
    return editCount <= WORKSPACE_EDIT_MAX_EDITS || "Workspace edit batch contains too many edits.";
  },
);

export const WorkspaceEditInput = Schema.Struct({
  changes: Schema.Array(WorkspaceEditChange).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WORKSPACE_EDIT_MAX_CHANGES),
  ),
}).check(validBatch);
export type WorkspaceEditInput = typeof WorkspaceEditInput.Type;

export const WorkspaceEditAction = Schema.Literals(["created", "updated", "deleted", "unchanged"]);
export type WorkspaceEditAction = typeof WorkspaceEditAction.Type;

export const WorkspaceEditChangeResult = Schema.Struct({
  path: WorkspaceEditPath,
  action: WorkspaceEditAction,
  edit_count: PositiveInt,
  revision: Schema.optional(WorkspaceRevision),
});
export type WorkspaceEditChangeResult = typeof WorkspaceEditChangeResult.Type;

export const WorkspaceEditResult = Schema.Struct({
  changes: Schema.Array(WorkspaceEditChangeResult).check(
    Schema.isMaxLength(WORKSPACE_EDIT_MAX_CHANGES),
  ),
});
export type WorkspaceEditResult = typeof WorkspaceEditResult.Type;

export const WorkspaceEditFailureReason = Schema.Literals([
  "credential_not_authorized",
  "projection_unavailable",
  "thread_not_found",
  "inactive_turn",
  "runtime_mode_not_authorized",
  "plan_mode",
  "workspace_root_not_found",
  "workspace_root_not_directory",
  "workspace_root_unreadable",
  "path_outside_root",
  "not_found",
  "already_exists",
  "not_file",
  "symlink",
  "binary",
  "invalid_utf8",
  "file_too_large",
  "batch_too_large",
  "invalid_range",
  "text_not_found",
  "ambiguous_match",
  "expected_count_mismatch",
  "revision_conflict",
  "commit_failed",
  "rollback_incomplete",
]);
export type WorkspaceEditFailureReason = typeof WorkspaceEditFailureReason.Type;

export class WorkspaceEditError extends Schema.TaggedErrorClass<WorkspaceEditError>()(
  "WorkspaceEditError",
  {
    reason: WorkspaceEditFailureReason,
    path: Schema.optional(WorkspaceEditPath),
    change_index: Schema.optional(NonNegativeInt),
    edit_index: Schema.optional(NonNegativeInt),
    expected_revision: Schema.optional(WorkspaceRevision),
    actual_revision: Schema.optional(Schema.NullOr(WorkspaceRevision)),
    uncertain_paths: Schema.optional(
      Schema.Array(WorkspaceEditPath).check(Schema.isMaxLength(WORKSPACE_EDIT_MAX_CHANGES)),
    ),
  },
) {
  override get message(): string {
    return "Workspace edit failed.";
  }
}
