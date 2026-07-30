import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationThreadActivityTone,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagentActivity = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  activityId: EventId,
  turnId: Schema.NullOr(TurnId),
  tone: OrchestrationThreadActivityTone,
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.Unknown,
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type ProjectionThreadSubagentActivity = typeof ProjectionThreadSubagentActivity.Type;

export const ListProjectionThreadSubagentActivitiesInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
});
export type ListProjectionThreadSubagentActivitiesInput =
  typeof ListProjectionThreadSubagentActivitiesInput.Type;

export const DeleteProjectionThreadSubagentActivitiesInput =
  ListProjectionThreadSubagentActivitiesInput;
export type DeleteProjectionThreadSubagentActivitiesInput =
  typeof DeleteProjectionThreadSubagentActivitiesInput.Type;

export const DeleteProjectionThreadSubagentActivitiesByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadSubagentActivitiesByThreadInput =
  typeof DeleteProjectionThreadSubagentActivitiesByThreadInput.Type;

export interface ProjectionThreadSubagentActivityRepositoryShape {
  readonly upsert: (
    activity: ProjectionThreadSubagentActivity,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listBySubagentId: (
    input: ListProjectionThreadSubagentActivitiesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagentActivity>, ProjectionRepositoryError>;
  readonly deleteBySubagentId: (
    input: DeleteProjectionThreadSubagentActivitiesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSubagentActivitiesByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentActivityRepository extends Context.Service<
  ProjectionThreadSubagentActivityRepository,
  ProjectionThreadSubagentActivityRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadSubagentActivities/ProjectionThreadSubagentActivityRepository",
) {}
