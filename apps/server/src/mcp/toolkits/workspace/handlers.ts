import {
  WorkspaceEditError,
  WorkspaceContextUnavailableError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
  type WorkspaceEditInput,
  type WorkspaceEditResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { resolveMessageReplyExecution } from "../../messageReplyExecution.ts";
import { ProviderService } from "../../../provider/Services/ProviderService.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../../workspace/WorkspaceFileSystem.ts";
import { WorkspaceEditToolkit, WorkspaceToolkit } from "./tools.ts";

export const invokeWorkspaceContext = Effect.fn("WorkspaceToolkit.invoke")(function* (
  input: WorkspaceContextInput,
): Effect.fn.Return<
  WorkspaceContextResult,
  import("@t3tools/contracts").WorkspaceContextError,
  | McpInvocationContext.McpInvocationContext
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | WorkspaceContext.WorkspaceContext
  | ProviderService
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const context = yield* projections.getThreadWorkspaceContext(invocation.threadId).pipe(
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

  let workspaceRoot = context.value.worktreePath ?? context.value.workspaceRoot;
  if (invocation.messageReply !== undefined) {
    const execution = yield* resolveMessageReplyExecution(invocation).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceContextUnavailableError({
            reason: "projection_unavailable",
            cause,
          }),
      ),
    );
    if (Option.isNone(execution)) {
      return yield* new WorkspaceContextUnavailableError({ reason: "credential_not_authorized" });
    }
    workspaceRoot = execution.value.workspacePath;
  }
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
  workspace_find: invokeWorkspaceContext,
  workspace_read: invokeWorkspaceContext,
  workspace_context: invokeWorkspaceContext,
});

const projectionUnavailable = () => new WorkspaceEditError({ reason: "projection_unavailable" });

export const invokeWorkspaceEdit = Effect.fn("WorkspaceToolkit.invokeEdit")(function* (
  input: WorkspaceEditInput,
): Effect.fn.Return<
  WorkspaceEditResult,
  WorkspaceEditError,
  | McpInvocationContext.McpInvocationContext
  | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  | WorkspaceFileSystem.WorkspaceFileSystem
  | ProviderService
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceWriteMcpCapability();
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const [context, thread] = yield* Effect.all([
    projections.getThreadWorkspaceContext(invocation.threadId),
    projections.getThreadShellById(invocation.threadId),
  ]).pipe(Effect.mapError(projectionUnavailable));
  if (Option.isNone(context) || Option.isNone(thread)) {
    return yield* new WorkspaceEditError({ reason: "thread_not_found" });
  }

  let workspaceRoot = context.value.worktreePath ?? context.value.workspaceRoot;
  let runtimeMode = thread.value.session?.runtimeMode;
  let interactionMode = thread.value.interactionMode;
  if (invocation.messageReply !== undefined) {
    const execution = yield* resolveMessageReplyExecution(invocation).pipe(
      Effect.mapError(projectionUnavailable),
    );
    if (Option.isNone(execution) || thread.value.archivedAt !== null) {
      return yield* new WorkspaceEditError({ reason: "inactive_turn" });
    }
    workspaceRoot = execution.value.workspacePath;
    runtimeMode = execution.value.runtimeMode;
    interactionMode = execution.value.interactionMode;
  } else {
    const session = thread.value.session;
    if (
      session?.status !== "running" ||
      session.activeTurnId === null ||
      session.providerInstanceId !== invocation.providerInstanceId
    ) {
      return yield* new WorkspaceEditError({ reason: "inactive_turn" });
    }
  }
  if (runtimeMode === "approval-required") {
    return yield* new WorkspaceEditError({ reason: "runtime_mode_not_authorized" });
  }
  if (interactionMode === "chat") {
    return yield* new WorkspaceEditError({ reason: "chat_mode" });
  }
  if (interactionMode === "plan") {
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

export const WorkspaceEditToolkitHandlersLive = WorkspaceEditToolkit.toLayer({
  workspace_edit: invokeWorkspaceEdit,
});
