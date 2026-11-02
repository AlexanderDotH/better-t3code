import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../../../orchestration-v2/ProjectStore.ts";
import { WorkspaceContext } from "../../../workspace/WorkspaceContext.ts";
import { WorkspaceFileSystem } from "../../../workspace/WorkspaceFileSystem.ts";
import { McpInvocationContext, type McpCapability } from "../../McpInvocationContext.ts";
import { invokeWorkspaceContext, invokeWorkspaceEdit } from "./handlers.ts";

const threadId = ThreadId.make("workspace-tool-thread");
const projectId = ProjectId.make("workspace-tool-project");
const instanceId = ProviderInstanceId.make("codex");
const input = {
  changes: [
    {
      path: "src/example.ts",
      edits: [{ type: "write" as const, mode: "upsert" as const, content: "changed" }],
    },
  ],
};
function setup(
  options: {
    runtimeMode?: "auto" | "approval-required";
    interactionMode?: "default" | "plan";
    active?: boolean;
    capabilities?: ReadonlyArray<McpCapability>;
    readOnly?: boolean;
  } = {},
) {
  const edits: string[] = [];
  const shell = {
    id: threadId,
    projectId,
    worktreePath: "/trusted/worktree",
    deletedAt: null,
    archivedAt: null,
    providerInstanceId: instanceId,
    runtimeMode: options.runtimeMode ?? "auto",
    interactionMode: options.interactionMode ?? "default",
    activeRunId: options.active === false ? null : RunId.make("active"),
  } as OrchestrationV2ThreadShell;
  const layer = Layer.mergeAll(
    Layer.succeed(McpInvocationContext, {
      environmentId: EnvironmentId.make("test"),
      thread: { threadId, providerInstanceId: instanceId, providerSessionId: "session" },
      client: undefined,
      ownerThreadId: threadId,
      requestNamespace: "session",
      issuedAt: 0,
      capabilities: new Set<McpCapability>(
        options.capabilities ?? ["workspace", "workspace-write"],
      ),
    }),
    Layer.mock(OrchestratorV2)({ getThreadShell: () => Effect.succeed(shell) }),
    Layer.mock(ProjectStoreV2)({
      get: () => Effect.succeedSome({ projectId, workspaceRoot: "/trusted/project" } as never),
    }),
    Layer.mock(WorkspaceFileSystem)({
      editFiles: ({ workspaceRoot }) => {
        edits.push(workspaceRoot);
        return Effect.succeed({ changes: [] });
      },
    }),
    Layer.mock(WorkspaceContext)({
      execute: ({ workspaceRoot }) => {
        edits.push(workspaceRoot);
        return Effect.succeed({ queries: [], reads: [], truncated: false, warnings: [] } as never);
      },
    }),
  );
  return { layer, edits };
}

it.effect("selects the authenticated worktree for reads and edits", () => {
  const test = setup();
  return Effect.gen(function* () {
    yield* invokeWorkspaceContext({});
    yield* invokeWorkspaceEdit(input);
    expect(test.edits).toEqual(["/trusted/worktree", "/trusted/worktree"]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("refuses edits without a live writable execution", () =>
  Effect.gen(function* () {
    for (const [options, reason] of [
      [{ active: false }, "inactive_turn"],
      [{ runtimeMode: "approval-required" as const }, "runtime_mode_not_authorized"],
      [{ interactionMode: "plan" as const }, "plan_mode"],
      [{ capabilities: ["workspace"] as const }, "credential_not_authorized"],
    ] as const) {
      const test = setup(options);
      const error = yield* invokeWorkspaceEdit(input).pipe(Effect.provide(test.layer), Effect.flip);
      expect(error.reason).toBe(reason);
      expect(test.edits).toEqual([]);
    }
  }),
);
