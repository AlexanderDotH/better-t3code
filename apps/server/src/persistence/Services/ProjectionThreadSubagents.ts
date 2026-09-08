import { OrchestrationSubagentSummary, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagent = Schema.Struct({
  threadId: ThreadId,
  ...OrchestrationSubagentSummary.fields,
});
export type ProjectionThreadSubagent = typeof ProjectionThreadSubagent.Type;

export const GetProjectionThreadSubagentInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
});
export type GetProjectionThreadSubagentInput = typeof GetProjectionThreadSubagentInput.Type;

export const ListProjectionThreadSubagentsInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadSubagentsInput = typeof ListProjectionThreadSubagentsInput.Type;

export const DeleteProjectionThreadSubagentInput = GetProjectionThreadSubagentInput;
export type DeleteProjectionThreadSubagentInput = typeof DeleteProjectionThreadSubagentInput.Type;

export const DeleteProjectionThreadSubagentsInput = ListProjectionThreadSubagentsInput;
export type DeleteProjectionThreadSubagentsInput = typeof DeleteProjectionThreadSubagentsInput.Type;

export interface ProjectionThreadSubagentRepositoryShape {
  readonly upsert: (
    subagent: ProjectionThreadSubagent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionThreadSubagentInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSubagent>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadSubagentsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagent>, ProjectionRepositoryError>;
  readonly deleteBySubagentId: (
    input: DeleteProjectionThreadSubagentInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSubagentsInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentRepository extends Context.Service<
  ProjectionThreadSubagentRepository,
  ProjectionThreadSubagentRepositoryShape
>()("t3/persistence/Services/ProjectionThreadSubagents/ProjectionThreadSubagentRepository") {}
