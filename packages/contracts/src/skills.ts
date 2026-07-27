import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  AgentImportSourceId,
  AgentImportSourcesInput,
  AgentImportSourcesResult,
} from "./agentImport.ts";
import { ProjectId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const SkillScope = Schema.Literals(["global", "project", "system"]);
export type SkillScope = typeof SkillScope.Type;

export const SkillMutationScope = Schema.Literals(["global", "project"]);
export type SkillMutationScope = typeof SkillMutationScope.Type;

export const SkillProviderSupportState = Schema.Literals(["ready", "limited", "unsupported"]);
export type SkillProviderSupportState = typeof SkillProviderSupportState.Type;

export const SkillProviderSupport = Schema.Struct({
  provider: ProviderDriverKind,
  instanceId: ProviderInstanceId,
  state: SkillProviderSupportState,
  message: Schema.optional(TrimmedString),
});
export type SkillProviderSupport = typeof SkillProviderSupport.Type;

export const SkillDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  scope: SkillScope,
  enabled: Schema.Boolean,
  readOnly: Schema.Boolean,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  providerDriver: Schema.optional(ProviderDriverKind),
  providerSupport: Schema.Array(SkillProviderSupport).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  description: Schema.optional(TrimmedString),
  displayName: Schema.optional(TrimmedString),
  shortDescription: Schema.optional(TrimmedString),
  body: Schema.optional(Schema.String),
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type SkillDescriptor = typeof SkillDescriptor.Type;

export const SkillListInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
  includeBody: Schema.optional(Schema.Boolean),
  forceReload: Schema.optional(Schema.Boolean),
});
export type SkillListInput = typeof SkillListInput.Type;

export const SkillListResult = Schema.Struct({
  skills: Schema.Array(SkillDescriptor),
});
export type SkillListResult = typeof SkillListResult.Type;

export const SkillDiscoverImportSourcesInput = AgentImportSourcesInput;
export type SkillDiscoverImportSourcesInput = typeof SkillDiscoverImportSourcesInput.Type;

export const SkillDiscoverImportSourcesResult = AgentImportSourcesResult;
export type SkillDiscoverImportSourcesResult = typeof SkillDiscoverImportSourcesResult.Type;

export const SkillTarget = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  scope: SkillScope,
  name: Schema.optional(TrimmedNonEmptyString),
  path: Schema.optional(TrimmedNonEmptyString),
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type SkillTarget = typeof SkillTarget.Type;

export const SkillCreateInput = Schema.Struct({
  providerInstanceId: Schema.optional(ProviderInstanceId),
  scope: SkillMutationScope,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  body: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  displayName: Schema.optional(TrimmedString),
  shortDescription: Schema.optional(TrimmedString),
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
});
export type SkillCreateInput = typeof SkillCreateInput.Type;

export const SkillUpdateInput = Schema.Struct({
  target: SkillTarget,
  description: Schema.optional(TrimmedNonEmptyString),
  body: Schema.optional(Schema.String),
  displayName: Schema.optional(TrimmedString),
  shortDescription: Schema.optional(TrimmedString),
});
export type SkillUpdateInput = typeof SkillUpdateInput.Type;

export const SkillRenameInput = Schema.Struct({
  target: SkillTarget,
  newName: TrimmedNonEmptyString,
});
export type SkillRenameInput = typeof SkillRenameInput.Type;

export const SkillDeleteInput = Schema.Struct({
  target: SkillTarget,
});
export type SkillDeleteInput = typeof SkillDeleteInput.Type;

export const SkillSetEnabledInput = Schema.Struct({
  target: SkillTarget,
  enabled: Schema.Boolean,
});
export type SkillSetEnabledInput = typeof SkillSetEnabledInput.Type;

export const SkillImportSourcesInput = Schema.Struct({
  sourceIds: Schema.Array(AgentImportSourceId),
  scope: SkillMutationScope,
  projectId: Schema.optional(ProjectId),
  projectCwd: Schema.optional(TrimmedNonEmptyString),
  deduplicate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type SkillImportSourcesInput = typeof SkillImportSourcesInput.Type;

export const SkillMutationResult = Schema.Struct({
  skill: SkillDescriptor,
});
export type SkillMutationResult = typeof SkillMutationResult.Type;

export const SkillImportSourcesResult = SkillListResult;
export type SkillImportSourcesResult = SkillListResult;

export const SkillSettings = Schema.Struct({
  disabledSkillIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type SkillSettings = typeof SkillSettings.Type;

export class SkillEngineError extends Schema.TaggedErrorClass<SkillEngineError>()(
  "SkillEngineError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
