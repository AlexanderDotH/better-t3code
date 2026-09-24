import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, ProjectId, ThreadId } from "../baseSchemas.ts";
import {
  PROJECT_INDEX_MAX_ANALYSIS_ATTEMPTS,
  PROJECT_INDEX_MAX_QUERY_RECORDS,
  PROJECT_KNOWLEDGE_VERSION,
  ProjectIndexHash,
  ProjectIndexId,
  ProjectIndexModelSelection,
  ProjectIndexPath,
  ProjectIndexScopeInput,
  ProjectIndexScopeV1,
  ProjectIndexText,
  ProjectSourceRangeV1,
} from "./common.ts";
import { ProjectIndexCoverageV1, ProjectIndexGapV1 } from "./knowledge.ts";

export const ProjectIndexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  autoRefresh: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  reviewEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  modelSelection: Schema.NullOr(ProjectIndexModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type ProjectIndexSettings = typeof ProjectIndexSettings.Type;

export const ProjectIndexDefaults = Schema.Struct({
  enabled: Schema.Boolean,
  modelSelection: Schema.NullOr(ProjectIndexModelSelection),
});
export type ProjectIndexDefaults = typeof ProjectIndexDefaults.Type;

export function resolveProjectIndexSettings(
  raw: ProjectIndexSettings,
  defaults?: ProjectIndexDefaults,
): ProjectIndexSettings {
  return {
    ...raw,
    enabled: raw.enabled && (defaults?.enabled ?? true),
    modelSelection: raw.modelSelection ?? defaults?.modelSelection ?? null,
  };
}

export const DEFAULT_PROJECT_INDEX_SETTINGS: ProjectIndexSettings = {
  enabled: false,
  autoRefresh: true,
  reviewEnabled: false,
  modelSelection: null,
};

export const ProjectIndexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  autoRefresh: Schema.optionalKey(Schema.Boolean),
  reviewEnabled: Schema.optionalKey(Schema.Boolean),
  modelSelection: Schema.optionalKey(Schema.NullOr(ProjectIndexModelSelection)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexSettingsPatch = typeof ProjectIndexSettingsPatch.Type;

export const ProjectIndexState = Schema.Literals([
  "disabled",
  "idle",
  "queued",
  "discovering",
  "extracting",
  "analyzing",
  "updating",
  "partial",
  "waiting-for-provider",
  "waiting-for-resources",
  "ready",
  "paused",
  "cancelled",
  "failed",
]);
export type ProjectIndexState = typeof ProjectIndexState.Type;

export const ProjectIndexJobState = Schema.Literals([
  "queued",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);
export type ProjectIndexJobState = typeof ProjectIndexJobState.Type;

export const ProjectIndexPhase = Schema.Literals([
  "discovery",
  "extraction",
  "analysis",
  "validation",
  "review",
  "complete",
]);
export type ProjectIndexPhase = typeof ProjectIndexPhase.Type;

export const ProjectIndexUnitState = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "stale",
  "cancelled",
]);
export type ProjectIndexUnitState = typeof ProjectIndexUnitState.Type;

export const ProjectIndexUsageV1 = Schema.Struct({
  usageStatus: Schema.Literals(["complete", "partial", "unavailable"]),
  inputTokens: Schema.optionalKey(NonNegativeInt),
  outputTokens: Schema.optionalKey(NonNegativeInt),
  cachedInputTokens: Schema.optionalKey(NonNegativeInt),
  requests: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (usage) => {
      if (usage.usageStatus === "complete")
        return usage.inputTokens !== undefined && usage.outputTokens !== undefined;
      if (usage.usageStatus === "unavailable")
        return (
          usage.inputTokens === undefined &&
          usage.outputTokens === undefined &&
          usage.cachedInputTokens === undefined
        );
      return (
        usage.inputTokens !== undefined ||
        usage.outputTokens !== undefined ||
        usage.cachedInputTokens !== undefined
      );
    },
    { message: "Usage availability must agree with the measured token counters" },
  ),
);
export type ProjectIndexUsageV1 = typeof ProjectIndexUsageV1.Type;

export const EMPTY_PROJECT_INDEX_USAGE: ProjectIndexUsageV1 = {
  usageStatus: "unavailable",
  requests: 0,
};

export const ProjectIndexUnitCountsV1 = Schema.Struct({
  pending: NonNegativeInt,
  running: NonNegativeInt,
  completed: NonNegativeInt,
  failed: NonNegativeInt,
  stale: NonNegativeInt,
  cancelled: NonNegativeInt,
});
export type ProjectIndexUnitCountsV1 = typeof ProjectIndexUnitCountsV1.Type;

export const ProjectIndexJobV1 = Schema.Struct({
  id: ProjectIndexId,
  generationId: ProjectIndexId,
  idempotencyKey: Schema.optionalKey(ProjectIndexId),
  kind: Schema.Literals(["initial", "refresh", "rebuild", "review"]),
  state: ProjectIndexJobState,
  phase: ProjectIndexPhase,
  revision: NonNegativeInt,
  units: ProjectIndexUnitCountsV1,
  modelSelection: Schema.NullOr(ProjectIndexModelSelection),
  usage: ProjectIndexUsageV1,
  startedAt: Schema.optionalKey(IsoDateTime),
  updatedAt: IsoDateTime,
  completedAt: Schema.optionalKey(IsoDateTime),
  lastError: Schema.optionalKey(ProjectIndexText),
});
export type ProjectIndexJobV1 = typeof ProjectIndexJobV1.Type;

export const ProjectIndexUnitV1 = Schema.Struct({
  id: ProjectIndexId,
  jobId: ProjectIndexId,
  entityId: Schema.optionalKey(ProjectIndexId),
  filePath: ProjectIndexPath,
  sourceHash: ProjectIndexHash,
  sourceRevision: NonNegativeInt,
  range: Schema.optionalKey(ProjectSourceRangeV1),
  state: ProjectIndexUnitState,
  attempts: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROJECT_INDEX_MAX_ANALYSIS_ATTEMPTS)),
  modelSelection: ProjectIndexModelSelection,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optionalKey(ProjectIndexText),
});
export type ProjectIndexUnitV1 = typeof ProjectIndexUnitV1.Type;

export const ProjectIndexStatusV1 = Schema.Struct({
  version: Schema.Literal(PROJECT_KNOWLEDGE_VERSION),
  scope: ProjectIndexScopeV1,
  revision: NonNegativeInt,
  state: ProjectIndexState,
  settings: ProjectIndexSettings,
  defaults: Schema.optionalKey(ProjectIndexDefaults),
  job: Schema.NullOr(ProjectIndexJobV1),
  coverage: ProjectIndexCoverageV1,
  gaps: Schema.Array(ProjectIndexGapV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  updatedAt: IsoDateTime,
  lastError: Schema.optionalKey(ProjectIndexText),
});
export type ProjectIndexStatusV1 = typeof ProjectIndexStatusV1.Type;

export const ProjectIndexActivityV1 = Schema.Struct({
  scope: ProjectIndexScopeV1,
  state: ProjectIndexState,
  settings: Schema.Struct({ enabled: Schema.Boolean }),
  defaults: Schema.optionalKey(Schema.Struct({ enabled: Schema.Boolean })),
  coverage: Schema.Struct({ indexedFiles: NonNegativeInt, eligibleFiles: NonNegativeInt }),
  job: Schema.NullOr(Schema.Struct({ phase: ProjectIndexPhase, units: ProjectIndexUnitCountsV1 })),
  updatedAt: IsoDateTime,
});
export type ProjectIndexActivityV1 = typeof ProjectIndexActivityV1.Type;

export const ProjectIndexActivityEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    activities: Schema.Array(ProjectIndexActivityV1),
  }),
  Schema.Struct({ type: Schema.Literal("status"), activity: ProjectIndexActivityV1 }),
]);
export type ProjectIndexActivityEvent = typeof ProjectIndexActivityEvent.Type;

export const ProjectIndexGetSettingsInput = ProjectIndexScopeInput;
export type ProjectIndexGetSettingsInput = typeof ProjectIndexGetSettingsInput.Type;
export const ProjectIndexGetStatusInput = ProjectIndexScopeInput;
export type ProjectIndexGetStatusInput = typeof ProjectIndexGetStatusInput.Type;

export const ProjectIndexUpdateSettingsInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  patch: ProjectIndexSettingsPatch,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexUpdateSettingsInput = typeof ProjectIndexUpdateSettingsInput.Type;

export const ProjectIndexStartInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  rebuild: Schema.optionalKey(Schema.Boolean),
  idempotencyKey: Schema.optionalKey(ProjectIndexId),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexStartInput = typeof ProjectIndexStartInput.Type;

export const ProjectIndexControlAction = Schema.Literals(["pause", "resume", "cancel", "clear"]);
export type ProjectIndexControlAction = typeof ProjectIndexControlAction.Type;

export const ProjectIndexControlInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  action: ProjectIndexControlAction,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexControlInput = typeof ProjectIndexControlInput.Type;

export const ProjectIndexSubscribeInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  afterRevision: Schema.optionalKey(NonNegativeInt),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexSubscribeInput = typeof ProjectIndexSubscribeInput.Type;

export const ProjectIndexModelCheckInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
  threadId: Schema.optionalKey(ThreadId),
  modelSelection: ProjectIndexModelSelection,
})
  .check(
    Schema.makeFilter((input) => input.threadId === undefined || input.projectId !== undefined, {
      message: "Checking a thread model requires its projectId",
    }),
  )
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexModelCheckInput = typeof ProjectIndexModelCheckInput.Type;

export const ProjectIndexModelCheckResult = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.optionalKey(ProjectIndexText),
  contextWindowTokens: Schema.optionalKey(PositiveInt),
  maxOutputTokens: Schema.optionalKey(PositiveInt),
});
export type ProjectIndexModelCheckResult = typeof ProjectIndexModelCheckResult.Type;

export const ProjectIndexStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status"), status: ProjectIndexStatusV1 }),
  Schema.Struct({
    type: Schema.Literal("invalidate"),
    scopeId: ProjectIndexId,
    revision: NonNegativeInt,
    reason: Schema.Literals(["revision-gap", "source-changed", "cleared", "scope-changed"]),
  }),
]);
export type ProjectIndexStreamEvent = typeof ProjectIndexStreamEvent.Type;

export const ProjectIndexErrorCode = Schema.Literals([
  "unsupported",
  "disabled",
  "model-required",
  "model-unsupported",
  "scope-mismatch",
  "invalid-request",
  "invalid-cursor",
  "stale-revision",
  "busy",
  "not-found",
  "store-unavailable",
  "provider-error",
  "cancelled",
]);
export type ProjectIndexErrorCode = typeof ProjectIndexErrorCode.Type;

export class ProjectIndexOperationError extends Schema.TaggedError<ProjectIndexOperationError>()(
  "ProjectIndexOperationError",
  { code: ProjectIndexErrorCode, message: ProjectIndexText, retryable: Schema.Boolean },
) {}
