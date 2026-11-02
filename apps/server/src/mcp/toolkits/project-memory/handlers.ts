import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  WorkspaceContextUnavailableError,
  type ProjectMemoryError,
  type ProjectMemoryToolInput,
  type ProjectMemoryToolResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../../../orchestration-v2/ProjectStore.ts";
import { resolveWorkspaceMcpScope } from "../../WorkspaceMcpScope.ts";
import * as ProjectMemoryPolicy from "../../../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../../../projectMemory/ProjectMemoryStore.ts";
import { ProjectMemoryToolkit } from "./tools.ts";

export const invokeProjectMemory = Effect.fn("ProjectMemoryToolkit.invoke")(function* (
  input: ProjectMemoryToolInput,
): Effect.fn.Return<
  ProjectMemoryToolResult,
  ProjectMemoryError | WorkspaceContextUnavailableError,
  | McpInvocationContext.McpInvocationContext
  | OrchestratorV2
  | ProjectStoreV2
  | ProjectMemoryPolicy.ProjectMemoryPolicy
  | ProjectMemoryStore.ProjectMemoryStore
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  if (invocation.projectMemoryEnabled === false)
    return yield* new WorkspaceContextUnavailableError({ reason: "credential_not_authorized" });
  const context = yield* resolveWorkspaceMcpScope(invocation.threadId);
  const checkpoints = yield* (yield* OrchestratorV2)
    .getThreadRecords(invocation.threadId, ["checkpoints"])
    .pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({ reason: "projection_unavailable", cause }),
      ),
    );

  const policy = yield* ProjectMemoryPolicy.ProjectMemoryPolicy;
  const access = yield* policy.resolve({
    threadId: invocation.threadId,
    ...(invocation.ownerThreadId === undefined ? {} : { ownerThreadId: invocation.ownerThreadId }),
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  });
  const latestCheckpoint = checkpoints.checkpoints.findLast(
    (checkpoint) => checkpoint.status === "ready",
  )?.ref;
  const scope: ProjectMemoryStore.ProjectMemoryScope = {
    projectId: context.thread.projectId,
    workspaceRoot: context.project.workspaceRoot,
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

export const ProjectMemoryToolkitHandlersLive = McpToolAccess.toLayer(ProjectMemoryToolkit, {
  project_memory: McpToolAccess.actsAsCaller(invokeProjectMemory),
});
