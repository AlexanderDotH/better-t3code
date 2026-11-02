import { WorkspaceContextUnavailableError, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";

export const resolveWorkspaceMcpScope = Effect.fn("mcp.resolveWorkspaceScope")(function* (
  threadId: ThreadId,
) {
  const threads = yield* OrchestratorV2;
  const projects = yield* ProjectStoreV2;
  const thread = yield* threads
    .getThreadShell(threadId)
    .pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({ reason: "projection_unavailable", cause }),
      ),
    );
  if (thread === null || thread.deletedAt !== null) {
    return yield* new WorkspaceContextUnavailableError({ reason: "thread_not_found" });
  }
  const project = yield* projects
    .get(thread.projectId)
    .pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({ reason: "projection_unavailable", cause }),
      ),
    );
  if (Option.isNone(project)) {
    return yield* new WorkspaceContextUnavailableError({ reason: "thread_not_found" });
  }
  return {
    thread,
    project: project.value,
    workspaceRoot: thread.worktreePath ?? project.value.workspaceRoot,
  };
});
