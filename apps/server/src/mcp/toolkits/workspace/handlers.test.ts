import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorkspaceContextUnavailableError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import { invokeWorkspaceContext } from "./handlers.ts";

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
