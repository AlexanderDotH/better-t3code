import {
  WorkspaceContextError,
  WorkspaceContextInput,
  WorkspaceContextResult,
  WorkspaceEditError,
  WorkspaceFindInput,
  WorkspaceReadInput,
  WorkspaceEditInput,
  WorkspaceEditResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../../workspace/WorkspaceFileSystem.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  WorkspaceContext.WorkspaceContext,
];

export const WorkspaceFindTool = Tool.make("workspace_find", {
  description:
    "Batch independent workspace path or literal text searches. Supports auto, path, and content modes with bounded context. Prefer this over shell find, rg, or grep. The server selects the trusted workspace root; callers cannot override it.",
  parameters: WorkspaceFindInput,
  success: WorkspaceContextResult,
  failure: WorkspaceContextError,
  dependencies,
})
  .annotate(Tool.Title, "Find workspace files and text")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceReadTool = Tool.make("workspace_read", {
  description:
    "Batch bounded one-indexed inclusive line reads from regular UTF-8 workspace files. Successful reads include a revision for guarded edits. Prefer this over shell cat or sed. The server selects the trusted workspace root; callers cannot override it.",
  parameters: WorkspaceReadInput,
  success: WorkspaceContextResult,
  failure: WorkspaceContextError,
  dependencies,
})
  .annotate(Tool.Title, "Read workspace files")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceContextTool = Tool.make("workspace_context", {
  description:
    "Batch mixed workspace searches and bounded line reads in one authenticated call. Prefer workspace_find for search-only work and workspace_read for read-only work. The server selects the trusted workspace root; callers cannot override it.",
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

export const WorkspaceToolkit = Toolkit.make(
  WorkspaceFindTool,
  WorkspaceReadTool,
  WorkspaceContextTool,
);

export const WorkspaceEditTool = Tool.make("workspace_edit", {
  description:
    "Apply one authenticated batch of ordered UTF-8 text edits across one or more workspace files. Supports whole-file writes, exact replacements, line or Unicode code-point splices, prepend, append, and file deletion. The server selects the trusted workspace root; callers cannot override it.",
  parameters: WorkspaceEditInput,
  success: WorkspaceEditResult,
  failure: WorkspaceEditError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    WorkspaceFileSystem.WorkspaceFileSystem,
  ],
})
  .annotate(Tool.Title, "Edit workspace files")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorkspaceEditToolkit = Toolkit.make(WorkspaceEditTool);
