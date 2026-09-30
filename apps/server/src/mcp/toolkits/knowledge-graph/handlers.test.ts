import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkspaceContextUnavailableError,
  type KnowledgeGraphQueryResultV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as KnowledgeGraphRuntime from "../../../knowledge-graph/runtime/KnowledgeGraphRuntime.ts";
import { invokeKnowledgeGraphQuery, KnowledgeGraphToolkitHandlersLive } from "./handlers.ts";
import { KnowledgeGraphToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread-knowledge-graph");
const query = { queries: [{ id: "overview", type: "overview" as const }] };
const result: KnowledgeGraphQueryResultV1 = {
  version: 1,
  scope: {
    version: 1,
    scopeId: "scope-knowledge-graph" as KnowledgeGraphQueryResultV1["scope"]["scopeId"],
    environmentId: EnvironmentId.make("environment-knowledge-graph"),
    projectId: ProjectId.make("project-knowledge-graph"),
    effectiveWorkspaceRoot: "/workspace/project",
    isWorktree: false,
  },
  revision: 1,
  results: [],
};

function invocation(capabilities: ReadonlySet<McpInvocationContext.McpCapability>) {
  return McpInvocationContext.McpInvocationContext.of({
    environmentId: EnvironmentId.make("environment-knowledge-graph"),
    threadId,
    providerSessionId: "provider-session-knowledge-graph",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities,
    issuedAt: 1,
  });
}

const runtime = KnowledgeGraphRuntime.KnowledgeGraphRuntime.of({
  subscribe: () => Effect.die("unused"),
  query: () => Effect.die("unused"),
  queryForThread: (input) => {
    expect(input).toEqual({ threadId, query });
    return Effect.succeed(result);
  },
  nodeContent: () => Effect.die("unused"),
  rebuild: () => Effect.die("unused"),
  cancel: () => Effect.die("unused"),
  pause: () => Effect.die("unused"),
  clear: () => Effect.die("unused"),
});

it.effect("derives the Knowledge Graph scope from the authenticated workspace thread", () =>
  invokeKnowledgeGraphQuery(query).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["workspace"])),
    ),
    Effect.provideService(KnowledgeGraphRuntime.KnowledgeGraphRuntime, runtime),
    Effect.tap((actual) => Effect.sync(() => expect(actual).toEqual(result))),
  ),
);

it.effect("rejects a provider credential without workspace capability", () =>
  Effect.gen(function* () {
    const error = yield* invokeKnowledgeGraphQuery(query).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error).toMatchObject({ reason: "credential_not_authorized" });
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview"])),
    ),
    Effect.provideService(KnowledgeGraphRuntime.KnowledgeGraphRuntime, runtime),
  ),
);

it.effect("rejects scope overrides and oversized traversal before reading graph data", () =>
  Effect.gen(function* () {
    const toolkit = yield* KnowledgeGraphToolkit;
    const invalidInputs = [
      { ...query, workspaceRoot: "/outside/workspace" },
      { ...query, scope: { projectId: "another-project" } },
      { ...query, mutation: "clear" },
      { queries: [{ ...query.queries[0]!, workspaceRoot: "/outside/workspace" }] },
      {
        queries: Array.from({ length: KNOWLEDGE_GRAPH_MAX_QUERY_OPERATIONS + 1 }, (_, index) => ({
          id: `overview-${index}`,
          type: "overview" as const,
        })),
      },
      { queries: [{ id: "neighbors", type: "neighbors", nodeId: "node-1", depth: 3 }] },
    ] as const;

    for (const input of invalidInputs) {
      const error = yield* toolkit
        .handle("knowledge_graph_query", input)
        .pipe(Effect.flatMap(Stream.runCollect), Effect.flip);
      expect(error).toMatchObject({ reason: { _tag: "ToolParameterValidationError" } });
    }
  }).pipe(
    Effect.provide(KnowledgeGraphToolkitHandlersLive),
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["workspace"])),
    ),
    Effect.provideService(
      KnowledgeGraphRuntime.KnowledgeGraphRuntime,
      KnowledgeGraphRuntime.KnowledgeGraphRuntime.of({
        ...runtime,
        queryForThread: () => Effect.die("Invalid query parameters must not read graph data."),
      }),
    ),
  ),
);
