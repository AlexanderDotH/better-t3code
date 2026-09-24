import {
  type ProjectContextInput,
  type ProjectIndexOperationError,
  type ProjectIndexQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectContextQuery from "../../../projectIndexing/query/ProjectContextQuery.ts";
import { ProjectContextToolkit } from "./tools.ts";

export const invokeProjectContext = Effect.fn("ProjectContextToolkit.invoke")(function* (
  input: ProjectContextInput,
): Effect.fn.Return<
  ProjectIndexQueryResultV1,
  ProjectIndexOperationError | WorkspaceContextUnavailableError,
  | McpInvocationContext.McpInvocationContext
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | ProjectContextQuery.ProjectContextQuery
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const thread = yield* projections
    .getThreadShellById(invocation.threadId)
    .pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({ reason: "projection_unavailable", cause }),
      ),
    );
  if (Option.isNone(thread)) {
    return yield* new WorkspaceContextUnavailableError({ reason: "thread_not_found" });
  }
  const query = yield* ProjectContextQuery.ProjectContextQuery;
  return yield* query.query({
    ...input,
    projectId: thread.value.projectId,
    threadId: invocation.threadId,
  });
});

export const ProjectContextToolkitHandlersLive = ProjectContextToolkit.toLayer({
  project_context: invokeProjectContext,
});
