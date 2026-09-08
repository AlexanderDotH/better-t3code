import type {
  SkillEngineError,
  SkillCreateInput,
  SkillDeleteInput,
  SkillDiscoverImportSourcesResult,
  SkillImportSourcesInput,
  SkillImportSourcesResult,
  SkillListInput,
  SkillListResult,
  SkillMutationResult,
  SkillRenameInput,
  SkillSetEnabledInput,
  SkillUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface SkillEngineShape {
  readonly list: (input: SkillListInput) => Effect.Effect<SkillListResult, SkillEngineError>;
  readonly discoverImportSources: Effect.Effect<SkillDiscoverImportSourcesResult, SkillEngineError>;
  readonly importSources: (
    input: SkillImportSourcesInput,
  ) => Effect.Effect<SkillImportSourcesResult, SkillEngineError>;
  readonly create: (
    input: SkillCreateInput,
  ) => Effect.Effect<SkillMutationResult, SkillEngineError>;
  readonly update: (
    input: SkillUpdateInput,
  ) => Effect.Effect<SkillMutationResult, SkillEngineError>;
  readonly rename: (
    input: SkillRenameInput,
  ) => Effect.Effect<SkillMutationResult, SkillEngineError>;
  readonly delete: (input: SkillDeleteInput) => Effect.Effect<SkillListResult, SkillEngineError>;
  readonly setEnabled: (
    input: SkillSetEnabledInput,
  ) => Effect.Effect<SkillMutationResult, SkillEngineError>;
  readonly rewritePromptForProvider: (input: {
    readonly providerInstanceId: string;
    readonly projectCwd?: string | undefined;
    readonly prompt: string;
  }) => Effect.Effect<string, SkillEngineError>;
}

export class SkillEngine extends Context.Service<SkillEngine, SkillEngineShape>()(
  "t3/skills/Services/SkillEngine",
) {}
