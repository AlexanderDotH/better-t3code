import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  WorkspaceEditError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
  type WorkspaceEditInput,
  type WorkspaceEditResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { resolveWorkspaceMcpScope } from "../../WorkspaceMcpScope.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../../../orchestration-v2/ProjectStore.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../../workspace/WorkspaceFileSystem.ts";
import { WorkspaceEditToolkit, WorkspaceToolkit } from "./tools.ts";

export const invokeWorkspaceContext = Effect.fn("WorkspaceToolkit.invoke")(function* (
  input: WorkspaceContextInput,
): Effect.fn.Return<
  WorkspaceContextResult,
  import("@t3tools/contracts").WorkspaceContextError,
  | McpInvocationContext.McpInvocationContext
  | OrchestratorV2
  | ProjectStoreV2
  | WorkspaceContext.WorkspaceContext
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const { workspaceRoot } = yield* resolveWorkspaceMcpScope(invocation.threadId);
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

export const WorkspaceToolkitHandlersLive = McpToolAccess.toLayer(WorkspaceToolkit, {
  workspace_find: McpToolAccess.readsAsCaller(invokeWorkspaceContext),
  workspace_read: McpToolAccess.readsAsCaller(invokeWorkspaceContext),
  workspace_context: McpToolAccess.readsAsCaller(invokeWorkspaceContext),
});

const projectionUnavailable = () => new WorkspaceEditError({ reason: "projection_unavailable" });

export const invokeWorkspaceEdit = Effect.fn("WorkspaceToolkit.invokeEdit")(function* (
  input: WorkspaceEditInput,
): Effect.fn.Return<
  WorkspaceEditResult,
  WorkspaceEditError,
  | McpInvocationContext.McpInvocationContext
  | OrchestratorV2
  | ProjectStoreV2
  | WorkspaceFileSystem.WorkspaceFileSystem
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceWriteMcpCapability();
  const { thread, workspaceRoot } = yield* resolveWorkspaceMcpScope(invocation.threadId).pipe(
    Effect.mapError(projectionUnavailable),
  );
  const caller = yield* (yield* OrchestratorV2)
    .getThreadShell(invocation.thread.threadId)
    .pipe(Effect.mapError(projectionUnavailable));
  if (
    caller === null ||
    caller.projectId !== thread.projectId ||
    caller.archivedAt !== null ||
    caller.activeRunId === null ||
    caller.providerInstanceId !== invocation.providerInstanceId
  ) {
    return yield* new WorkspaceEditError({ reason: "inactive_turn" });
  }
  if (caller.runtimeMode === "approval-required") {
    return yield* new WorkspaceEditError({ reason: "runtime_mode_not_authorized" });
  }
  if (caller.interactionMode === "chat")
    return yield* new WorkspaceEditError({ reason: "chat_mode" });
  if (caller.interactionMode === "plan") {
    return yield* new WorkspaceEditError({ reason: "plan_mode" });
  }

  const workspace = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  return yield* workspace.editFiles({ workspaceRoot, input }).pipe(
    Effect.withSpan("WorkspaceToolkit.edit", {
      attributes: {
        "workspace.change.count": input.changes.length,
        "workspace.edit.count": input.changes.reduce(
          (count, change) => count + change.edits.length,
          0,
        ),
      },
    }),
  );
});

export const WorkspaceEditToolkitHandlersLive = McpToolAccess.toLayer(WorkspaceEditToolkit, {
  workspace_edit: McpToolAccess.actsAsCaller(invokeWorkspaceEdit),
});
