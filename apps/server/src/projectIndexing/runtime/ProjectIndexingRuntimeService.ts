import type {
  ProjectIndexActivityEvent,
  ProjectIndexControlInput,
  ProjectIndexGetSettingsInput,
  ProjectIndexGetStatusInput,
  ProjectIndexModelCheckInput,
  ProjectIndexModelCheckResult,
  ProjectIndexOperationError,
  ProjectIndexReviewInput,
  ProjectIndexReviewResultV1,
  ProjectIndexScopeInput,
  ProjectIndexSettings,
  ProjectIndexStartInput,
  ProjectIndexStatusV1,
  ProjectIndexStreamEvent,
  ProjectIndexSubscribeInput,
  ProjectIndexUpdateSettingsInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export interface ProjectIndexInvalidation {
  readonly scope: ProjectIndexScopeInput;
  readonly paths?: ReadonlyArray<string>;
  readonly reason: "source" | "configuration" | "rules" | "rename" | "delete" | "branch";
}

export interface ProjectIndexingRuntimeShape {
  readonly getSettings: (
    input: ProjectIndexGetSettingsInput,
  ) => Effect.Effect<ProjectIndexSettings, ProjectIndexOperationError>;
  readonly getStatus: (
    input: ProjectIndexGetStatusInput,
  ) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>;
  readonly checkModel: (
    input: ProjectIndexModelCheckInput,
  ) => Effect.Effect<ProjectIndexModelCheckResult, ProjectIndexOperationError>;
  readonly updateSettings: (
    input: ProjectIndexUpdateSettingsInput,
  ) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>;
  readonly start: (
    input: ProjectIndexStartInput,
  ) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>;
  readonly control: (
    input: ProjectIndexControlInput,
  ) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>;
  readonly review: (
    input: ProjectIndexReviewInput,
  ) => Effect.Effect<ProjectIndexReviewResultV1, ProjectIndexOperationError>;
  readonly subscribe: (
    input: ProjectIndexSubscribeInput,
  ) => Effect.Effect<
    Stream.Stream<ProjectIndexStreamEvent>,
    ProjectIndexOperationError,
    Scope.Scope
  >;
  readonly subscribeActivity: () => Effect.Effect<
    Stream.Stream<ProjectIndexActivityEvent>,
    ProjectIndexOperationError,
    Scope.Scope
  >;
  readonly invalidate: (
    input: ProjectIndexInvalidation,
  ) => Effect.Effect<void, ProjectIndexOperationError>;
  readonly drain: (
    input: ProjectIndexScopeInput,
  ) => Effect.Effect<ProjectIndexStatusV1, ProjectIndexOperationError>;
  readonly recover: Effect.Effect<void, ProjectIndexOperationError>;
}

export class ProjectIndexingRuntime extends Context.Service<
  ProjectIndexingRuntime,
  ProjectIndexingRuntimeShape
>()("t3/projectIndexing/runtime/ProjectIndexingRuntimeService/ProjectIndexingRuntime") {}
