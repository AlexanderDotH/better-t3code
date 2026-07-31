import {
  WorkspaceContextError,
  WorkspaceContextInput,
  WorkspaceContextResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  WorkspaceContext.WorkspaceContext,
];

export const WorkspaceContextTool = Tool.make("workspace_context", {
  description:
    "Batch independent repository path/content searches and bounded line reads against this authenticated thread's trusted workspace. Use this read-only tool for discovery before issuing several sequential shell searches or file reads. The server selects the project or worktree root; callers cannot override it.",
  parameters: WorkspaceContextInput,
  success: WorkspaceContextResult,
  failure: WorkspaceContextError,
  dependencies,
})
  .annotate(Tool.Title, "Search and read workspace context")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceToolkit = Toolkit.make(WorkspaceContextTool);
