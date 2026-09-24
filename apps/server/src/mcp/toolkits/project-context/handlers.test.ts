import { expect, it } from "@effect/vitest";
import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  EnvironmentId,
  ProjectContextInput,
  ProjectId,
  ProjectIndexOperationError,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadShell,
  type ProjectIndexQueryInput,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectContextQuery from "../../../projectIndexing/query/ProjectContextQuery.ts";
import { invokeProjectContext } from "./handlers.ts";

const threadId = ThreadId.make("context-thread");
const projectId = ProjectId.make("context-project");
const result: ProjectIndexQueryResultV1 = {
  version: 1,
  scope: { projectId, threadId, scopeId: "scope", workspaceFingerprint: "worktree" },
  revision: 1,
  operation: "overview",
  summary: "Read original sources.",
  entities: [],
  callsites: [],
  modules: [],
  behaviors: [],
  flows: [],
  rules: [],
  evidence: [],
  gaps: [],
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  nextCursor: null,
  truncated: false,
  estimatedTokens: 100,
};

function testLayer(options?: {
  readonly authorized?: boolean;
  readonly missing?: boolean;
  readonly queryError?: ProjectIndexOperationError;
}) {
  const queries: ProjectIndexQueryInput[] = [];
  let projected = 0;
  const layer = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("context-environment"),
      threadId,
      providerSessionId: "session",
      providerInstanceId: ProviderInstanceId.make("codex"),
      issuedAt: 0,
      capabilities: new Set<McpInvocationContext.McpCapability>(
        options?.authorized === false ? [] : ["workspace"],
      ),
    }),
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getThreadShellById: (requested) => {
        projected += 1;
        expect(requested).toBe(threadId);
        return Effect.succeed(
          options?.missing
            ? Option.none()
            : Option.some({
                id: threadId,
                projectId,
                worktreePath: "/trusted/worktree",
              } as OrchestrationThreadShell),
        );
      },
    }),
    Layer.succeed(ProjectContextQuery.ProjectContextQuery, {
      query: (input) => {
        queries.push(input);
        return options?.queryError ? Effect.fail(options.queryError) : Effect.succeed(result);
      },
    }),
  );
  return { layer, queries, projected: () => projected };
}

it.effect("binds scope to the authenticated thread and overwrites injected selectors", () => {
  const test = testLayer();
  return Effect.gen(function* () {
    const untrusted = {
      operation: "overview" as const,
      projectId: ProjectId.make("foreign"),
      threadId: ThreadId.make("foreign-thread"),
    };
    expect(yield* invokeProjectContext(untrusted)).toEqual(result);
    expect(test.queries).toEqual([{ operation: "overview", projectId, threadId }]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects an unauthorized credential before projection or query access", () => {
  const test = testLayer({ authorized: false });
  return Effect.gen(function* () {
    expect(yield* invokeProjectContext({ operation: "overview" }).pipe(Effect.flip)).toMatchObject({
      reason: "credential_not_authorized",
    });
    expect(test.projected()).toBe(0);
    expect(test.queries).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("fails closed for a missing authenticated thread", () => {
  const test = testLayer({ missing: true });
  return Effect.gen(function* () {
    expect(yield* invokeProjectContext({ operation: "overview" }).pipe(Effect.flip)).toMatchObject({
      reason: "thread_not_found",
    });
    expect(test.queries).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("preserves typed query failures for callers to fall back to source tools", () => {
  const failure = new ProjectIndexOperationError({
    code: "store-unavailable",
    message: "Use workspace_read.",
    retryable: true,
  });
  const test = testLayer({ queryError: failure });
  return Effect.gen(function* () {
    expect(yield* invokeProjectContext({ operation: "overview" }).pipe(Effect.flip)).toBe(failure);
  }).pipe(Effect.provide(test.layer));
});

it("rejects external scope, absolute roots and undersized budgets at the public boundary", () => {
  const decode = Schema.decodeUnknownSync(ProjectContextInput);
  for (const extra of [
    { projectId },
    { threadId },
    { workspaceRoot: "/foreign" },
    { maxTokens: 1 },
    { scopes: ["../foreign"] },
  ]) {
    expect(() => decode({ operation: "overview", ...extra })).toThrow();
  }
});
