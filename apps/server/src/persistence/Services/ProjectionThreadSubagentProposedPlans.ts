import {
  IsoDateTime,
  OrchestrationProposedPlanId,
  SubagentId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagentProposedPlan = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  planId: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime),
  implementationThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadSubagentProposedPlan = typeof ProjectionThreadSubagentProposedPlan.Type;

export const ListProjectionThreadSubagentProposedPlansInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
});
export type ListProjectionThreadSubagentProposedPlansInput =
  typeof ListProjectionThreadSubagentProposedPlansInput.Type;

export const DeleteProjectionThreadSubagentProposedPlansInput =
  ListProjectionThreadSubagentProposedPlansInput;
export type DeleteProjectionThreadSubagentProposedPlansInput =
  typeof DeleteProjectionThreadSubagentProposedPlansInput.Type;

export const DeleteProjectionThreadSubagentProposedPlansByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadSubagentProposedPlansByThreadInput =
  typeof DeleteProjectionThreadSubagentProposedPlansByThreadInput.Type;

export interface ProjectionThreadSubagentProposedPlanRepositoryShape {
  readonly upsert: (
    plan: ProjectionThreadSubagentProposedPlan,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBySubagentId: (
    input: ListProjectionThreadSubagentProposedPlansInput,
  ) => Effect.Effect<
    ReadonlyArray<ProjectionThreadSubagentProposedPlan>,
    ProjectionRepositoryError
  >;
  readonly deleteBySubagentId: (
    input: DeleteProjectionThreadSubagentProposedPlansInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSubagentProposedPlansByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentProposedPlanRepository extends Context.Service<
  ProjectionThreadSubagentProposedPlanRepository,
  ProjectionThreadSubagentProposedPlanRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadSubagentProposedPlans/ProjectionThreadSubagentProposedPlanRepository",
) {}
