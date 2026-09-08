import {
  ProjectMemoryError,
  ProjectMemoryToolInput,
  ProjectMemoryToolResult,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectMemoryPolicy from "../../../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../../../projectMemory/ProjectMemoryStore.ts";

export const ProjectMemoryTool = Tool.make("project_memory", {
  description:
    "Search, remember, or forget durable project-owned memory. The server binds the authenticated project and canonical workspace path. Root agents may remember or forget when agent writes are enabled; child agents may only search. Search is deterministic and bounded to 2% of the supplied context window, between 1000 and 4000 estimated tokens.",
  parameters: ProjectMemoryToolInput,
  success: ProjectMemoryToolResult,
  failure: Schema.Union([ProjectMemoryError, WorkspaceContextUnavailableError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
    ProjectMemoryPolicy.ProjectMemoryPolicy,
    ProjectMemoryStore.ProjectMemoryStore,
  ],
})
  .annotate(Tool.Title, "Use project memory")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ProjectMemoryToolkit = Toolkit.make(ProjectMemoryTool);
