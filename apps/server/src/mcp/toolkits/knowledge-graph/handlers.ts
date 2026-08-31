import type {
  KnowledgeGraphOperationError,
  KnowledgeGraphQueryBatchInput,
  KnowledgeGraphQueryResultV1,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as KnowledgeGraphRuntime from "../../../knowledge-graph/runtime/KnowledgeGraphRuntime.ts";
import { KnowledgeGraphToolkit } from "./tools.ts";

export const invokeKnowledgeGraphQuery = Effect.fn("KnowledgeGraphToolkit.query")(function* (
  input: KnowledgeGraphQueryBatchInput,
): Effect.fn.Return<
  KnowledgeGraphQueryResultV1,
  KnowledgeGraphOperationError | WorkspaceContextUnavailableError,
  McpInvocationContext.McpInvocationContext | KnowledgeGraphRuntime.KnowledgeGraphRuntime
> {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability();
  const knowledgeGraph = yield* KnowledgeGraphRuntime.KnowledgeGraphRuntime;
  return yield* knowledgeGraph.queryForThread({
    threadId: invocation.threadId,
    query: input,
  });
});

export const KnowledgeGraphToolkitHandlersLive = KnowledgeGraphToolkit.toLayer({
  knowledge_graph_query: invokeKnowledgeGraphQuery,
});
