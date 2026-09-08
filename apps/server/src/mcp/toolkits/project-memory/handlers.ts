import {
  WorkspaceContextUnavailableError,
  type ProjectMemoryError,
  type ProjectMemoryToolInput,
  type ProjectMemoryToolResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectMemoryPolicy from "../../../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../../../projectMemory/ProjectMemoryStore.ts";
import { ProjectMemoryToolkit } from "./tools.ts";

export const invokeProjectMemory = Effect.fn("ProjectMemoryToolkit.invoke")(function* (
  input: ProjectMemoryToolInput,
): Effect.fn.Return<
  ProjectMemoryToolResult,
  ProjectMemoryError | WorkspaceContextUnavailableError,
  | McpInvocationContext.McpInvocationContext
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | ProjectMemoryPolicy.ProjectMemoryPolicy
  | ProjectMemoryStore.ProjectMemoryStore
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

  const policy = yield* ProjectMemoryPolicy.ProjectMemoryPolicy;
  const access = yield* policy.resolve({
    threadId: invocation.threadId,
    ...(invocation.ownerThreadId === undefined ? {} : { ownerThreadId: invocation.ownerThreadId }),
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  });
  const latestCheckpoint = context.value.checkpoints.findLast(
    (checkpoint) => checkpoint.status === "ready",
  )?.checkpointRef;
  const scope: ProjectMemoryStore.ProjectMemoryScope = {
    projectId: context.value.projectId,
    workspaceRoot: context.value.workspaceRoot,
    threadId: invocation.threadId,
    actor: access.actor,
    ...(latestCheckpoint === undefined ? {} : { checkpointRef: latestCheckpoint }),
  };
  const store = yield* ProjectMemoryStore.ProjectMemoryStore;

  switch (input.action) {
    case "search":
      return {
        action: input.action,
        result: yield* store.read(scope, {
          projectId: scope.projectId,
          query: input.query,
          contextWindowTokens: input.contextWindowTokens,
        }),
      };
    case "remember": {
      const checkpointRef = input.checkpointRef ?? latestCheckpoint;
      return {
        action: input.action,
        result: yield* store.save(scope, {
          projectId: scope.projectId,
          section: input.section,
          key: input.key,
          content: input.content,
          verified: input.verified,
          sourceThreadId: invocation.threadId,
          ...(checkpointRef === undefined ? {} : { checkpointRef }),
        }),
      };
    }
    case "forget":
      return {
        action: input.action,
        result: yield* store.delete(scope, {
          projectId: scope.projectId,
          key: input.key,
        }),
      };
  }
});

export const ProjectMemoryToolkitHandlersLive = ProjectMemoryToolkit.toLayer({
  project_memory: invokeProjectMemory,
});
