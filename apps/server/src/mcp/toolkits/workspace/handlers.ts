import {
  WorkspaceContextUnavailableError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import { WorkspaceToolkit } from "./tools.ts";

export const invokeWorkspaceContext = Effect.fn("WorkspaceToolkit.invoke")(function* (
  input: WorkspaceContextInput,
): Effect.fn.Return<
  WorkspaceContextResult,
  import("@t3tools/contracts").WorkspaceContextError,
  | McpInvocationContext.McpInvocationContext
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | WorkspaceContext.WorkspaceContext
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const context = yield* projections.getThreadCheckpointContext(invocation.threadId).pipe(
    Effect.mapError(
      (cause) =>
        new WorkspaceContextUnavailableError({
          reason: "projection_unavailable",
          cause,
        }),
    ),
  );
  if (Option.isNone(context)) {
    return yield* new WorkspaceContextUnavailableError({ reason: "thread_not_found" });
  }

  const workspaceRoot = context.value.worktreePath ?? context.value.workspaceRoot;
  const workspace = yield* WorkspaceContext.WorkspaceContext;
  return yield* workspace.execute({ workspaceRoot, input }).pipe(
    Effect.withSpan("WorkspaceToolkit.execute", {
      attributes: {
        "workspace.query.count": input.queries?.length ?? 0,
        "workspace.read.count": input.reads?.length ?? 0,
      },
    }),
  );
});

export const WorkspaceToolkitHandlersLive = WorkspaceToolkit.toLayer({
  workspace_context: invokeWorkspaceContext,
});
