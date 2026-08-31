import {
  KnowledgeGraphOperationError,
  KnowledgeGraphQueryBatchInput,
  KnowledgeGraphQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as KnowledgeGraphRuntime from "../../../knowledge-graph/runtime/KnowledgeGraphRuntime.ts";

export const KnowledgeGraphQueryTool = Tool.make("knowledge_graph_query", {
  description:
    "Query the rebuildable project Knowledge Graph for the authenticated thread's canonical project or worktree. The server selects the scope; callers cannot provide a workspace root or mutate graph data.",
  parameters: KnowledgeGraphQueryBatchInput,
  success: KnowledgeGraphQueryResultV1,
  failure: Schema.Union([KnowledgeGraphOperationError, WorkspaceContextUnavailableError]),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    KnowledgeGraphRuntime.KnowledgeGraphRuntime,
  ],
})
  .annotate(Tool.Title, "Query project Knowledge Graph")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const KnowledgeGraphToolkit = Toolkit.make(KnowledgeGraphQueryTool);
