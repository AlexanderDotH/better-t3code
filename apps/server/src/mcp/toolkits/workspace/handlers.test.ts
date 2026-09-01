import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  WorkspaceContextUnavailableError,
  WorkspaceEditError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
  type WorkspaceEditInput,
  type WorkspaceEditResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../../workspace/WorkspaceFileSystem.ts";
import { invokeWorkspaceContext, invokeWorkspaceEdit } from "./handlers.ts";

const threadId = ThreadId.make("thread-workspace-context");
const invocation = (capabilities: ReadonlySet<McpInvocationContext.McpCapability>) => ({
  environmentId: EnvironmentId.make("environment-workspace-context"),
  threadId,
  providerSessionId: "provider-session-workspace-context",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

const result: WorkspaceContextResult = {
  queries: [],
  reads: [
    {
      status: "ok",
      path: "README.md",
      lineStart: 1,
      lineEnd: 1,
      text: "T3 Code",
      truncated: false,
    },
  ],
  truncated: false,
  warnings: [],
};

const input: WorkspaceContextInput = { reads: [{ path: "README.md" }] };

const makeLayer = (options?: {
  readonly contextMissing?: boolean;
  readonly worktreePath?: string | null;
}) => {
  const roots: Array<string> = [];
  const projection = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getThreadCheckpointContext: (requestedThreadId) => {
      expect(requestedThreadId).toBe(threadId);
      return Effect.succeed(
        options?.contextMissing === true
          ? Option.none()
          : Option.some({
              threadId,
              projectId: ProjectId.make("project-workspace-context"),
              workspaceRoot: "/workspace/project",
              worktreePath:
                options?.worktreePath === undefined
                  ? "/workspace/project/.t3/worktrees/feature"
                  : options.worktreePath,
              checkpointsEnabled: true,
              checkpoints: [],
            }),
      );
    },
  } as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);
  const workspace = Layer.succeed(WorkspaceContext.WorkspaceContext, {
    execute: ({ workspaceRoot }) => {
      roots.push(workspaceRoot);
      return Effect.succeed(result);
    },
  });
  return { roots, layer: Layer.mergeAll(projection, workspace) };
};

it.effect("resolves the authenticated thread worktree and never accepts a caller root", () => {
  const test = makeLayer();
  return Effect.gen(function* () {
    expect("workspaceRoot" in input).toBe(false);
    expect(yield* invokeWorkspaceContext(input)).toEqual(result);
    expect(test.roots).toEqual(["/workspace/project/.t3/worktrees/feature"]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("falls back to the authenticated project's workspace root", () => {
  const test = makeLayer({ worktreePath: null });
  return Effect.gen(function* () {
    expect(yield* invokeWorkspaceContext(input)).toEqual(result);
    expect(test.roots).toEqual(["/workspace/project"]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("fails closed when the authenticated thread is unavailable", () => {
  const test = makeLayer({ contextMissing: true });
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceContext(input).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error.reason).toBe("thread_not_found");
    expect(test.roots).toEqual([]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("rejects direct workspace invocation with a preview-only credential", () => {
  const test = makeLayer();
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceContext(input).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error.reason).toBe("credential_not_authorized");
    expect(test.roots).toEqual([]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview"])),
    ),
    Effect.provide(test.layer),
  );
});

const editInput: WorkspaceEditInput = {
  changes: [
    {
      path: "src/example.ts",
      edits: [{ type: "write", mode: "upsert", content: "export {};\n" }],
    },
  ],
};

const editResult: WorkspaceEditResult = {
  changes: [{ path: "src/example.ts", action: "created", edit_count: 1 }],
};

const activeShell = (overrides?: {
  readonly runtimeMode?: OrchestrationThreadShell["runtimeMode"];
  readonly interactionMode?: OrchestrationThreadShell["interactionMode"];
  readonly activeTurn?: boolean;
  readonly providerInstanceId?: OrchestrationThreadShell["session"] extends infer Session
    ? Session extends { readonly providerInstanceId?: infer Instance }
      ? Instance
      : never
    : never;
}): OrchestrationThreadShell =>
  ({
    id: threadId,
    projectId: ProjectId.make("project-workspace-context"),
    title: "Workspace thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: overrides?.runtimeMode ?? "full-access",
    interactionMode: overrides?.interactionMode ?? "default",
    branch: null,
    worktreePath: "/workspace/project/.t3/worktrees/feature",
    latestTurn: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: overrides?.providerInstanceId ?? ProviderInstanceId.make("codex"),
      runtimeSessionId: RuntimeSessionId.make("runtime-workspace-context"),
      runtimeMode: overrides?.runtimeMode ?? "full-access",
      activeTurnId: overrides?.activeTurn === false ? null : TurnId.make("turn-workspace-context"),
      abortState: null,
      lastError: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }) as OrchestrationThreadShell;

const makeEditLayer = (options?: {
  readonly shell?: OrchestrationThreadShell | null;
  readonly contextMissing?: boolean;
  readonly editError?: WorkspaceEditError;
}) => {
  const requests: Array<{ readonly workspaceRoot: string; readonly input: WorkspaceEditInput }> =
    [];
  const projection = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getThreadCheckpointContext: () =>
      Effect.succeed(
        options?.contextMissing === true
          ? Option.none()
          : Option.some({
              threadId,
              projectId: ProjectId.make("project-workspace-context"),
              workspaceRoot: "/workspace/project",
              worktreePath: "/workspace/project/.t3/worktrees/feature",
              checkpointsEnabled: true,
              checkpoints: [],
            }),
      ),
    getThreadShellById: () =>
      Effect.succeed(
        Option.fromNullishOr(options?.shell === undefined ? activeShell() : options.shell),
      ),
  } as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);
  const fileSystem = Layer.succeed(WorkspaceFileSystem.WorkspaceFileSystem, {
    editFiles: (request) => {
      requests.push(request);
      return options?.editError ? Effect.fail(options.editError) : Effect.succeed(editResult);
    },
  } as WorkspaceFileSystem.WorkspaceFileSystem["Service"]);
  return { requests, layer: Layer.mergeAll(projection, fileSystem) };
};

const writableInvocation = invocation(new Set(["workspace", "workspace-write"]));

it.effect("edits only the authenticated thread worktree during its active writable turn", () => {
  const test = makeEditLayer();
  return Effect.gen(function* () {
    const result = yield* invokeWorkspaceEdit(editInput);
    expect(result).toEqual(editResult);
    expect(JSON.stringify(result)).not.toContain("export {};");
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4_096);
    expect(test.requests).toEqual([
      { workspaceRoot: "/workspace/project/.t3/worktrees/feature", input: editInput },
    ]);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, writableInvocation),
    Effect.provide(test.layer),
  );
});

it.effect("returns a bounded structural failure without submitted file contents", () => {
  const secret = "SENSITIVE_EDIT_BODY";
  const input: WorkspaceEditInput = {
    changes: [
      {
        path: "src/example.ts",
        edits: [{ type: "write", mode: "upsert", content: secret }],
      },
    ],
  };
  const test = makeEditLayer({
    editError: new WorkspaceEditError({ reason: "ambiguous_match", path: "src/example.ts" }),
  });
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceEdit(input).pipe(Effect.flip);
    const encoded = JSON.stringify(error);
    expect(error.reason).toBe("ambiguous_match");
    expect(encoded).not.toContain(secret);
    expect(Buffer.byteLength(encoded)).toBeLessThan(4_096);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, writableInvocation),
    Effect.provide(test.layer),
  );
});

it.effect(
  "rejects missing, ended, stale-provider, read-only, and Plan-mode write invocations",
  () =>
    Effect.gen(function* () {
      const cases = [
        [makeEditLayer({ contextMissing: true }), writableInvocation, "thread_not_found"],
        [
          makeEditLayer({ shell: activeShell({ activeTurn: false }) }),
          writableInvocation,
          "inactive_turn",
        ],
        [
          makeEditLayer({
            shell: activeShell({ providerInstanceId: ProviderInstanceId.make("claude") }),
          }),
          writableInvocation,
          "inactive_turn",
        ],
        [
          makeEditLayer({ shell: activeShell({ runtimeMode: "approval-required" }) }),
          writableInvocation,
          "runtime_mode_not_authorized",
        ],
        [
          makeEditLayer({ shell: activeShell({ interactionMode: "plan" }) }),
          writableInvocation,
          "plan_mode",
        ],
        [makeEditLayer(), invocation(new Set(["workspace"])), "credential_not_authorized"],
      ] as const;

      for (const [test, scopedInvocation, reason] of cases) {
        const error = yield* invokeWorkspaceEdit(editInput).pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scopedInvocation),
          Effect.provide(test.layer),
          Effect.flip,
        );
        expect(error.reason).toBe(reason);
        expect(test.requests).toEqual([]);
      }
    }),
);
