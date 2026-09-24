import {
  ProjectIndexModelSelection,
  ProjectIndexUsageV1,
  EMPTY_PROJECT_INDEX_USAGE,
  EMPTY_PROJECT_INDEX_COVERAGE,
  ProjectIndexCoverageV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ProjectIndexGenerationMetadata = Schema.Struct({
  version: Schema.Literal(1),
  knowledgeFormat: Schema.Literals(["legacy-ai", "static-v1"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("legacy-ai" as const)),
  ),
  kind: Schema.Literals(["initial", "refresh", "rebuild"]),
  manual: Schema.Boolean,
  invalidateAll: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  modelSelection: Schema.NullOr(ProjectIndexModelSelection),
  phase: Schema.Literals(["discovery", "extraction", "validation", "analysis", "complete"]),
  resetComplete: Schema.Boolean,
  resetCursor: Schema.NullOr(Schema.String),
  inventoryCursor: Schema.NullOr(Schema.Unknown),
  inventoryComplete: Schema.Boolean,
  invalidationComplete: Schema.Boolean,
  invalidationQueued: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  invalidationGlobalPath: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  invalidationSeedCursor: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  resolutionComplete: Schema.Boolean,
  sourceChangesPending: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  incomplete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  startedAt: Schema.String,
  usage: ProjectIndexUsageV1,
  coverage: ProjectIndexCoverageV1.pipe(
    Schema.withDecodingDefault(Effect.succeed(EMPTY_PROJECT_INDEX_COVERAGE)),
  ),
  lastError: Schema.optionalKey(Schema.String),
});
export type ProjectIndexGenerationMetadata = typeof ProjectIndexGenerationMetadata.Type;

export const decodeProjectIndexGenerationMetadata = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProjectIndexGenerationMetadata),
);

export function initialProjectIndexGenerationMetadata(input: {
  readonly kind: ProjectIndexGenerationMetadata["kind"];
  readonly manual: boolean;
  readonly invalidateAll?: boolean;
  readonly startedAt: string;
}): ProjectIndexGenerationMetadata {
  return {
    version: 1,
    knowledgeFormat: "static-v1",
    ...input,
    modelSelection: null,
    invalidateAll: input.invalidateAll ?? false,
    phase: "discovery",
    resetComplete: input.kind !== "refresh",
    resetCursor: null,
    inventoryCursor: null,
    inventoryComplete: false,
    invalidationComplete: false,
    invalidationQueued: false,
    invalidationGlobalPath: null,
    invalidationSeedCursor: null,
    resolutionComplete: false,
    sourceChangesPending: false,
    incomplete: false,
    usage: { ...EMPTY_PROJECT_INDEX_USAGE },
    coverage: { ...EMPTY_PROJECT_INDEX_COVERAGE },
  };
}
