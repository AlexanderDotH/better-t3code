import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  type ProjectContextInput,
  type ProjectIndexOperationError,
  type ProjectIndexQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import * as ProjectContextQuery from "../../../projectIndexing/query/ProjectContextQuery.ts";
import { ProjectContextToolkit } from "./tools.ts";

export const invokeProjectContext = Effect.fn("ProjectContextToolkit.invoke")(function* (
  input: ProjectContextInput,
): Effect.fn.Return<
  ProjectIndexQueryResultV1,
  ProjectIndexOperationError | WorkspaceContextUnavailableError,
  | McpInvocationContext.McpInvocationContext
  | OrchestratorV2
  | ProjectContextQuery.ProjectContextQuery
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const projections = yield* OrchestratorV2;
  const thread = yield* projections
    .getThreadShell(invocation.threadId)
    .pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({ reason: "projection_unavailable", cause }),
      ),
    );
  if (thread === null) {
    return yield* new WorkspaceContextUnavailableError({ reason: "thread_not_found" });
  }
  const query = yield* ProjectContextQuery.ProjectContextQuery;
  return yield* query.query({
    ...input,
    projectId: thread.projectId,
    threadId: invocation.threadId,
  });
});

export const ProjectContextToolkitHandlersLive = McpToolAccess.toLayer(ProjectContextToolkit, {
  project_context: McpToolAccess.readsAsCaller(invokeProjectContext),
});
