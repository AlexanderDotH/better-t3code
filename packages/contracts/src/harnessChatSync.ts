import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const HarnessChatSyncSourceId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessChatSyncSourceId"),
);
export type HarnessChatSyncSourceId = typeof HarnessChatSyncSourceId.Type;

export const HarnessChatSessionId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessChatSessionId"),
);
export type HarnessChatSessionId = typeof HarnessChatSessionId.Type;

export const HarnessChatContinuationKey = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessChatContinuationKey"),
);
export type HarnessChatContinuationKey = typeof HarnessChatContinuationKey.Type;

export const HarnessChatActivity = Schema.Literals(["active", "idle", "unknown"]);
export type HarnessChatActivity = typeof HarnessChatActivity.Type;

export const HarnessChatSyncSourceStatus = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("supported"),
    supportsActivityStatus: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("unsupported"),
    reason: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("already-local"),
    reason: TrimmedNonEmptyString,
  }),
]);
export type HarnessChatSyncSourceStatus = typeof HarnessChatSyncSourceStatus.Type;

export const HarnessChatSyncSource = Schema.Struct({
  id: HarnessChatSyncSourceId,
  continuationKey: HarnessChatContinuationKey,
  label: TrimmedNonEmptyString,
  driver: ProviderDriverKind,
  instanceIds: Schema.Array(ProviderInstanceId),
  preferredInstanceId: Schema.NullOr(ProviderInstanceId),
  status: HarnessChatSyncSourceStatus,
  chatCount: NonNegativeInt,
  changedCount: NonNegativeInt,
  latestUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type HarnessChatSyncSource = typeof HarnessChatSyncSource.Type;

export const HarnessChatTargetProject = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("existing"),
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("create"),
    rootPath: TrimmedNonEmptyString,
    suggestedName: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("unresolved"),
    sourceCwd: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);
export type HarnessChatTargetProject = typeof HarnessChatTargetProject.Type;

/** Compact public linkage metadata. Native resume cursors remain server-only. */
export const HarnessChatLink = Schema.Struct({
  sourceId: HarnessChatSyncSourceId,
  nativeSessionId: HarnessChatSessionId,
  threadId: ThreadId,
  projectId: ProjectId,
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  lastSyncedAt: IsoDateTime,
});
export type HarnessChatLink = typeof HarnessChatLink.Type;

export const HarnessChatSummary = Schema.Struct({
  sessionId: HarnessChatSessionId,
  title: TrimmedNonEmptyString,
  preview: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  model: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
  archived: Schema.Boolean,
  messageCount: NonNegativeInt,
  hasChanges: Schema.Boolean,
  activity: HarnessChatActivity,
  targetProject: HarnessChatTargetProject,
  link: Schema.NullOr(HarnessChatLink),
});
export type HarnessChatSummary = typeof HarnessChatSummary.Type;

export const HarnessChatSelection = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("allMatching"),
    query: Schema.String,
    includeArchived: Schema.Boolean,
    excludedSessionIds: Schema.Array(HarnessChatSessionId),
  }),
  Schema.Struct({
    mode: Schema.Literal("only"),
    sessionIds: Schema.Array(HarnessChatSessionId),
  }),
]);
export type HarnessChatSelection = typeof HarnessChatSelection.Type;

export const HarnessChatSyncSourcesInput = Schema.Struct({});
export type HarnessChatSyncSourcesInput = typeof HarnessChatSyncSourcesInput.Type;

export const HarnessChatSyncSourcesResult = Schema.Struct({
  sources: Schema.Array(HarnessChatSyncSource),
});
export type HarnessChatSyncSourcesResult = typeof HarnessChatSyncSourcesResult.Type;

export const HarnessChatSyncListInput = Schema.Struct({
  sourceId: HarnessChatSyncSourceId,
  query: Schema.String,
  includeArchived: Schema.Boolean,
  cursor: Schema.optionalKey(TrimmedNonEmptyString),
  limit: PositiveInt,
});
export type HarnessChatSyncListInput = typeof HarnessChatSyncListInput.Type;

export const HarnessChatSyncListResult = Schema.Struct({
  chats: Schema.Array(HarnessChatSummary),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  totalMatching: NonNegativeInt,
  changedMatching: NonNegativeInt,
});
export type HarnessChatSyncListResult = typeof HarnessChatSyncListResult.Type;

export const HarnessChatTargetResolution = Schema.Struct({
  sessionId: HarnessChatSessionId,
  projectId: ProjectId,
});
export type HarnessChatTargetResolution = typeof HarnessChatTargetResolution.Type;

export const HarnessChatSyncRunInput = Schema.Struct({
  sourceId: HarnessChatSyncSourceId,
  selection: HarnessChatSelection,
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  targetResolutions: Schema.Array(HarnessChatTargetResolution),
  unresolvedTargetProjectId: Schema.optionalKey(ProjectId),
});
export type HarnessChatSyncRunInput = typeof HarnessChatSyncRunInput.Type;

export const HarnessChatSyncRunItem = Schema.Struct({
  sessionId: HarnessChatSessionId,
  threadId: ThreadId,
  projectId: ProjectId,
  created: Schema.Boolean,
  messagesImported: NonNegativeInt,
  attachmentsImported: NonNegativeInt,
  attachmentsSkipped: NonNegativeInt,
  link: HarnessChatLink,
});
export type HarnessChatSyncRunItem = typeof HarnessChatSyncRunItem.Type;

export const HarnessChatSyncFailureCode = Schema.Literals([
  "source-unavailable",
  "session-unavailable",
  "target-unresolved",
  "history-read-failed",
  "project-create-failed",
  "sync-failed",
  "resume-bind-failed",
]);
export type HarnessChatSyncFailureCode = typeof HarnessChatSyncFailureCode.Type;

export const HarnessChatSyncFailure = Schema.Struct({
  sessionId: HarnessChatSessionId,
  code: HarnessChatSyncFailureCode,
  message: TrimmedNonEmptyString,
  retryable: Schema.Boolean,
});
export type HarnessChatSyncFailure = typeof HarnessChatSyncFailure.Type;

export const HarnessChatSyncRunResult = Schema.Struct({
  selectedCount: NonNegativeInt,
  syncedCount: NonNegativeInt,
  failedCount: NonNegativeInt,
  threadsCreated: NonNegativeInt,
  threadsUpdated: NonNegativeInt,
  messagesImported: NonNegativeInt,
  attachmentsImported: NonNegativeInt,
  attachmentsSkipped: NonNegativeInt,
  items: Schema.Array(HarnessChatSyncRunItem),
  failures: Schema.Array(HarnessChatSyncFailure),
});
export type HarnessChatSyncRunResult = typeof HarnessChatSyncRunResult.Type;

export const HarnessChatSyncStatusInput = Schema.Union([
  Schema.Struct({
    sourceId: HarnessChatSyncSourceId,
    sessionIds: Schema.Array(HarnessChatSessionId),
  }),
  Schema.Struct({ threadId: ThreadId }),
]);
export type HarnessChatSyncStatusInput = typeof HarnessChatSyncStatusInput.Type;

export const HarnessChatSyncStatus = Schema.Struct({
  sessionId: HarnessChatSessionId,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  hasChanges: Schema.Boolean,
  link: Schema.NullOr(HarnessChatLink),
});
export type HarnessChatSyncStatus = typeof HarnessChatSyncStatus.Type;

export const HarnessChatSyncStatusResult = Schema.Struct({
  statuses: Schema.Array(HarnessChatSyncStatus),
});
export type HarnessChatSyncStatusResult = typeof HarnessChatSyncStatusResult.Type;

export const HarnessChatSyncErrorCode = Schema.Literals([
  "invalid-source",
  "source-unavailable",
  "invalid-selection",
  "operation-failed",
]);
export type HarnessChatSyncErrorCode = typeof HarnessChatSyncErrorCode.Type;

export class HarnessChatSyncError extends Schema.TaggedErrorClass<HarnessChatSyncError>()(
  "HarnessChatSyncError",
  {
    code: HarnessChatSyncErrorCode,
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
