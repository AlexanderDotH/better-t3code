import {
  ProjectContextInput,
  ProjectIndexOperationError,
  ProjectIndexQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectContextQuery from "../../../projectIndexing/query/ProjectContextQuery.ts";

const ProjectContextTool = Tool.make("project_context", {
  description:
    "Read static indexed source facts for the authenticated project's effective worktree: overview, search, entity, callers, callees, impact, or task. Results include symbols, signatures, resolved imports, confirmed static calls, manifest packages, applicable original rules, source locations, freshness, gaps, and a continuation cursor. A static relationship does not prove a runtime path. Task scopes narrow initial matches; related verified sources can come from elsewhere in the same worktree. The default answer budget is 6000 tokens, maximum 24000, including JSON metadata. Read original code and AGENTS.md with workspace_read before relying on the index. Missing indexes require scoped workspace_find and workspace_read. This tool never invokes a provider or changes files.",
  parameters: ProjectContextInput,
  success: ProjectIndexQueryResultV1,
  failure: Schema.Union([ProjectIndexOperationError, WorkspaceContextUnavailableError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    ProjectContextQuery.ProjectContextQuery,
  ],
})
  .annotate(Tool.Title, "Read indexed project context")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ProjectContextToolkit = Toolkit.make(ProjectContextTool);
