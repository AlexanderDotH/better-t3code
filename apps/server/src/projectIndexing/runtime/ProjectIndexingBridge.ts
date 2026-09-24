import type {
  ModelSelection,
  ProjectIndexScopeInput,
  ProjectIndexScopeV1,
  ProjectSourceRangeV1,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ResolvedProjectIndexScope {
  readonly scope: ProjectIndexScopeV1;
  readonly workspaceRoot: string;
}

export interface ProjectIndexModelCapabilities {
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly promptOverheadTokens?: number;
  readonly supportedContextWindows?: ReadonlyArray<number>;
}

export interface ProjectIndexGenerationInput extends ProjectIndexModelCapabilities {
  readonly workspaceRoot: string;
  readonly scope: ProjectIndexScopeV1;
  readonly modelSelection: ModelSelection;
  readonly prompt: string;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly purpose: "review";
}

export interface ProjectIndexGenerationResult {
  readonly text: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ProjectIndexAdmissionInput {
  readonly scope: ProjectIndexScopeV1;
  readonly modelSelection: ModelSelection;
  readonly estimatedInputTokens: number;
  readonly purpose: "review";
}

export interface ProjectIndexReviewDiff {
  readonly diff: string;
  readonly files: ReadonlyArray<{
    readonly filePath: string;
    readonly changedRanges: ReadonlyArray<ProjectSourceRangeV1>;
    readonly sourceHash: string;
    readonly sourceSide?: "before" | "after";
    readonly patch?: string;
    readonly rangePatches?: ReadonlyArray<string>;
  }>;
  readonly revision?: string;
}

export interface ProjectIndexingBridgeShape {
  readonly resolveScope: (
    input: ProjectIndexScopeInput,
  ) => Effect.Effect<ResolvedProjectIndexScope, Error>;
  readonly listScopes: () => Effect.Effect<ReadonlyArray<ResolvedProjectIndexScope>, Error>;
  readonly capabilities: (
    selection: ModelSelection,
  ) => Effect.Effect<ProjectIndexModelCapabilities, Error>;
  readonly generate: (
    input: ProjectIndexGenerationInput,
  ) => Effect.Effect<ProjectIndexGenerationResult, Error>;
  readonly admit: (
    input: ProjectIndexAdmissionInput,
  ) => Effect.Effect<{ readonly release: Effect.Effect<void> }, Error>;
  readonly readDiff: (input: {
    readonly resolvedScope: ResolvedProjectIndexScope;
    readonly selection: "workingtree" | "staged";
  }) => Effect.Effect<ProjectIndexReviewDiff, Error>;
  readonly reconcileWatchers: (
    scopes: ReadonlyArray<ResolvedProjectIndexScope>,
    onChange: (scopes: ReadonlyArray<ResolvedProjectIndexScope>) => Effect.Effect<void, Error>,
  ) => Effect.Effect<void, Error>;
}

export class ProjectIndexingBridge extends Context.Service<
  ProjectIndexingBridge,
  ProjectIndexingBridgeShape
>()("t3/projectIndexing/runtime/ProjectIndexingBridge") {}
