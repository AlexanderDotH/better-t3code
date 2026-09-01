import { expect, it } from "@effect/vitest";
import {
  CheckpointRef,
  EnvironmentId,
  ProjectId,
  ProjectMemoryError,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorkspaceContextUnavailableError,
  type ProjectMemoryReadResponse,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProjectMemoryPolicy from "../../../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../../../projectMemory/ProjectMemoryStore.ts";
import { invokeProjectMemory } from "./handlers.ts";

const threadId = ThreadId.make("thread-project-memory");
const projectId = ProjectId.make("project-memory");
const checkpointRef = CheckpointRef.make("refs/checkpoints/latest");
const invocation = McpInvocationContext.McpInvocationContext.of({
  environmentId: EnvironmentId.make("environment-project-memory"),
  threadId,
  providerSessionId: "provider-session-project-memory",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["workspace"]),
  issuedAt: 1,
});

const projection = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
  getThreadCheckpointContext: () =>
    Effect.succeed(
      Option.some({
        threadId,
        projectId,
        workspaceRoot: "/workspace/canonical-project",
        worktreePath: "/workspace/canonical-project/.t3/worktrees/feature",
        checkpointsEnabled: true,
        checkpoints: [
          {
            turnId: TurnId.make("turn-project-memory"),
            checkpointTurnCount: 1,
            checkpointRef,
            status: "ready" as const,
            files: [],
            assistantMessageId: null,
            completedAt: "2026-08-31T00:00:00.000Z",
          },
        ],
      }),
    ),
} as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);

const readResult: ProjectMemoryReadResponse = {
  mode: "project",
  storage: "workspace",
  entries: [],
  markdown: "# Project memory\n",
  tokenBudget: 2_000,
  estimatedTokens: 5,
  truncated: false,
};

const unusedDocumentMethods = {
  getSettings: () => Effect.die("unused"),
  updateSettings: () => Effect.die("unused"),
  resolveEffectiveState: () => Effect.die("unused"),
  view: () => Effect.die("unused"),
  replaceDocument: () => Effect.die("unused"),
  clearDocument: () => Effect.die("unused"),
};

it.effect(
  "binds the canonical project, source thread, and latest checkpoint on root actions",
  () => {
    const calls: Array<{
      readonly method: string;
      readonly scope: ProjectMemoryStore.ProjectMemoryScope;
      readonly request: unknown;
    }> = [];
    const store = ProjectMemoryStore.ProjectMemoryStore.of({
      ...unusedDocumentMethods,
      read: (scope, request) => {
        calls.push({ method: "read", scope, request });
        return Effect.succeed(readResult);
      },
      save: (scope, request) => {
        calls.push({ method: "save", scope, request });
        return Effect.succeed({
          mode: "project",
          storage: "workspace",
          applied: true,
          replaced: false,
          entry: {
            section: request.section,
            key: request.key,
            content: request.content,
            verified: request.verified,
            sourceThreadId: scope.threadId,
            ...(scope.checkpointRef === undefined ? {} : { checkpointRef: scope.checkpointRef }),
          },
        });
      },
      import: () => Effect.die("unused"),
      delete: () => Effect.die("unused"),
    });
    const policy = ProjectMemoryPolicy.ProjectMemoryPolicy.of({
      resolve: () => Effect.succeed({ actor: "root" }),
    });

    return Effect.gen(function* () {
      yield* invokeProjectMemory({
        action: "remember",
        section: "active-decisions",
        key: "decision.canonical-root",
        content: "Share memory across worktrees.",
        verified: true,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.scope).toMatchObject({
        projectId,
        workspaceRoot: "/workspace/canonical-project",
        threadId,
        checkpointRef,
        actor: "root",
      });
      expect(calls[0]?.scope.workspaceRoot).not.toContain("worktrees/feature");
      expect(calls[0]?.request).toMatchObject({
        projectId,
        sourceThreadId: threadId,
        checkpointRef,
      });
    }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.provideService(ProjectMemoryStore.ProjectMemoryStore, store),
      Effect.provideService(ProjectMemoryPolicy.ProjectMemoryPolicy, policy),
      Effect.provide(projection),
    );
  },
);

it.effect(
  "passes child policy through so the store denies remember and forget while search remains readable",
  () => {
    const policy = ProjectMemoryPolicy.ProjectMemoryPolicy.of({
      resolve: () => Effect.succeed({ actor: "child" }),
    });
    const store = ProjectMemoryStore.ProjectMemoryStore.of({
      ...unusedDocumentMethods,
      read: () => Effect.succeed(readResult),
      save: (scope) =>
        Effect.fail(
          new ProjectMemoryError({
            operation: "save",
            reason: scope.actor === "child" ? "write_forbidden" : "operation_failed",
          }),
        ),
      import: () => Effect.die("unused"),
      delete: (scope) =>
        Effect.fail(
          new ProjectMemoryError({
            operation: "delete",
            reason: scope.actor === "child" ? "write_forbidden" : "operation_failed",
          }),
        ),
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(ProjectMemoryStore.ProjectMemoryStore, store),
        Effect.provideService(ProjectMemoryPolicy.ProjectMemoryPolicy, policy),
        Effect.provide(projection),
      );

    return Effect.gen(function* () {
      expect(
        (yield* provide(
          invokeProjectMemory({
            action: "remember",
            section: "known-pitfalls",
            key: "child.denied",
            content: "Must not persist.",
            verified: true,
          }),
        ).pipe(Effect.flip)).reason,
      ).toBe("write_forbidden");
      expect(
        (yield* provide(invokeProjectMemory({ action: "forget", key: "child.denied" })).pipe(
          Effect.flip,
        )).reason,
      ).toBe("write_forbidden");
      expect(
        yield* provide(
          invokeProjectMemory({
            action: "search",
            query: "pitfall",
            contextWindowTokens: 100_000,
          }),
        ),
      ).toEqual({ action: "search", result: readResult });
    });
  },
);

it.effect("fails closed when the authenticated thread has no project context", () => {
  const missing = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  } as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);
  const policy = ProjectMemoryPolicy.ProjectMemoryPolicy.of({
    resolve: () => Effect.succeed({ actor: "root" }),
  });
  const store = ProjectMemoryStore.ProjectMemoryStore.of({
    ...unusedDocumentMethods,
    read: () => Effect.die("must not read"),
    save: () => Effect.die("must not save"),
    import: () => Effect.die("must not import"),
    delete: () => Effect.die("must not delete"),
  });

  return Effect.gen(function* () {
    const error = yield* invokeProjectMemory({
      action: "search",
      query: "",
      contextWindowTokens: 100_000,
    }).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error.reason).toBe("thread_not_found");
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
    Effect.provideService(ProjectMemoryStore.ProjectMemoryStore, store),
    Effect.provideService(ProjectMemoryPolicy.ProjectMemoryPolicy, policy),
    Effect.provide(missing),
  );
});
