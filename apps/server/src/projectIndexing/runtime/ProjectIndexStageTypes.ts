import type { ProjectIndexState } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type {
  KnowledgeBatch,
  KnowledgeJob,
  KnowledgeJobKind,
} from "../persistence/KnowledgeStoreTypes.ts";
import type { ProjectIndexGenerationMetadata } from "./ProjectIndexingMetadata.ts";
import type { ProjectIndexPipelineInput } from "./ProjectIndexingPipeline.ts";

export interface ProjectIndexStageContext extends Omit<ProjectIndexPipelineInput, "metadata"> {
  readonly getMetadata: () => ProjectIndexGenerationMetadata;
  readonly setMetadata: (metadata: ProjectIndexGenerationMetadata) => void;
  readonly checkpoint: (
    patch: Partial<ProjectIndexGenerationMetadata>,
    state: ProjectIndexState,
  ) => Effect.Effect<void, Error>;
  readonly runJobs: (
    kind: KnowledgeJobKind,
    perform: (job: KnowledgeJob) => Effect.Effect<KnowledgeBatch, Error>,
  ) => Effect.Effect<void, Error>;
}
