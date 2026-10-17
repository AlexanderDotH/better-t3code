import { describe, expect, it } from "@effect/vitest";
import { ThreadId, DeepPlanRunId, EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  NATIVE_HARNESS_WORKSPACE_FIND_TOOL,
  NATIVE_HARNESS_WORKSPACE_READ_TOOL,
} from "./NativeHarnessTools.ts";
import { makeNativeProviderHarness } from "./NativeProviderHarness.ts";

const WORKSPACE_READ_TOOL_NAMES = [
  NATIVE_HARNESS_WORKSPACE_FIND_TOOL,
  NATIVE_HARNESS_WORKSPACE_READ_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
] as const;

const unusedProcessRunner: ProcessRunner["Service"] = {
  run: () => Effect.die("process runner is not used while listing tools"),
};

const unusedWorkspaceContext = WorkspaceContext.WorkspaceContext.of({
  execute: () =>
    Effect.succeed({
      queries: [],
      reads: [],
      truncated: false,
      warnings: [],
    }),
});

const unusedWorkspaceFileSystem = WorkspaceFileSystem.WorkspaceFileSystem.of({
  readFile: () => Effect.die("workspace files are not read while listing tools"),
  writeFile: () => Effect.die("workspace files are not written while listing tools"),
  editFiles: () => Effect.die("workspace files are not edited while listing tools"),
});

describe("NativeProviderHarness", () => {
  it.effect(
    "honors Full Access for Deep Plan research commands while retaining plan and source boundaries",
    () =>
      Effect.gen(function* () {
        const threadId = ThreadId.make("deep-plan-command-permissions");
        const config = {
          threadId,
          environmentId: EnvironmentId.make("local"),
          providerSessionId: "deep-session",
          providerInstanceId: ProviderInstanceId.make("openai"),
          endpoint: "http://127.0.0.1:43123/mcp",
          authorizationHeader: "Bearer test",
          capabilities: new Set(["deep-plan"]),
          deepPlan: {
            runId: DeepPlanRunId.make("run"),
            runThreadId: threadId,
            phase: "planning" as const,
            approvedPlanVersion: null,
            readOnly: true,
            modelSelection: { instanceId: ProviderInstanceId.make("openai"), model: "test-model" },
          },
        };
        const harness = yield* makeNativeProviderHarness(unusedProcessRunner);
        const input = {
          threadId,
          cwd: process.cwd(),
          interactionMode: "plan" as const,
          sandboxMode: "danger-full-access" as const,
          fetchWorker: false,
        };
        McpProviderSession.setMcpProviderSession(config);
        try {
          expect((yield* harness.declarations(input)).map((tool) => tool.name)).toEqual([
            ...WORKSPACE_READ_TOOL_NAMES,
            NATIVE_HARNESS_EXEC_COMMAND_TOOL,
          ]);
          expect(
            yield* harness.isAvailable({ ...input, toolName: NATIVE_HARNESS_EXEC_COMMAND_TOOL }),
          ).toBe(true);
          expect(harness.requiresApproval(NATIVE_HARNESS_EXEC_COMMAND_TOOL, "full-access")).toBe(
            false,
          );
          expect(
            harness.requiresApproval(NATIVE_HARNESS_EXEC_COMMAND_TOOL, "approval-required"),
          ).toBe(true);
          expect(
            yield* harness.isAvailable({ ...input, toolName: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL }),
          ).toBe(false);
          expect(
            yield* harness.isAvailable({
              ...input,
              sandboxMode: "read-only",
              toolName: NATIVE_HARNESS_EXEC_COMMAND_TOOL,
            }),
          ).toBe(false);
          expect(
            yield* harness.isAvailable({
              ...input,
              fetchWorker: true,
              toolName: NATIVE_HARNESS_EXEC_COMMAND_TOOL,
            }),
          ).toBe(false);
          McpProviderSession.setMcpProviderSession({
            ...config,
            deepPlan: {
              ...config.deepPlan,
              sourceAnalysis: { workerThreadId: threadId, sourceIds: [] },
            },
          });
          expect(
            yield* harness.isAvailable({ ...input, toolName: NATIVE_HARNESS_EXEC_COMMAND_TOOL }),
          ).toBe(false);
        } finally {
          McpProviderSession.clearMcpProviderSession(threadId);
        }
      }).pipe(
        Effect.provideService(WorkspaceContext.WorkspaceContext, unusedWorkspaceContext),
        Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, unusedWorkspaceFileSystem),
      ),
  );

  it.effect(
    "omits configured MCP extensions from Fetch while retaining them for normal turns",
    () =>
      Effect.gen(function* () {
        const resolvedThreads: Array<ThreadId> = [];
        const harness = yield* makeNativeProviderHarness(unusedProcessRunner, {
          extensionForThread: ({ threadId }) =>
            Effect.sync(() => {
              resolvedThreads.push(threadId);
              return {
                declarations: [
                  {
                    name: "configured_read",
                    description: "Read from a configured MCP server.",
                    inputSchema: {
                      type: "object",
                      additionalProperties: false,
                      properties: {},
                    },
                    availability: "read-only" as const,
                  },
                ],
                execute: () => Effect.succeed(undefined),
              };
            }),
        });
        const normalThread = ThreadId.make("native-harness-normal-thread");
        const fetchThread = ThreadId.make("native-harness-fetch-thread");

        const normal = yield* harness.declarations({
          threadId: normalThread,
          cwd: process.cwd(),
          interactionMode: "default",
          sandboxMode: "read-only",
          fetchWorker: false,
        });
        const fetch = yield* harness.declarations({
          threadId: fetchThread,
          cwd: process.cwd(),
          interactionMode: "plan",
          sandboxMode: "read-only",
          fetchWorker: true,
        });
        const writable = yield* harness.declarations({
          threadId: normalThread,
          cwd: process.cwd(),
          interactionMode: "default",
          sandboxMode: "workspace-write",
          fetchWorker: false,
        });
        const hallucinatedConfiguredToolAvailable = yield* harness.isAvailable({
          threadId: fetchThread,
          cwd: process.cwd(),
          toolName: "configured_read",
          interactionMode: "plan",
          sandboxMode: "read-only",
          fetchWorker: true,
        });
        const fetchWorkspaceContext = yield* harness.execute({
          threadId: fetchThread,
          name: NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
          args: { queries: [{ text: "provider", mode: "content" }] },
          cwd: process.cwd(),
          environment: {},
          fetchWorker: true,
        });

        expect(normal.map(({ name }) => name)).toEqual([
          ...WORKSPACE_READ_TOOL_NAMES,
          "configured_read",
        ]);
        expect(fetch.map(({ name }) => name)).toEqual([...WORKSPACE_READ_TOOL_NAMES]);
        expect(writable.map(({ name }) => name)).toEqual([
          ...WORKSPACE_READ_TOOL_NAMES,
          NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
          "configured_read",
        ]);
        expect(writable.map(({ name }) => name)).not.toEqual(
          expect.arrayContaining(["write_file", "replace_text", "apply_patch"]),
        );
        expect(hallucinatedConfiguredToolAvailable).toBe(false);
        expect(fetchWorkspaceContext.ok).toBe(true);
        expect(resolvedThreads).toEqual([normalThread, normalThread]);
      }).pipe(
        Effect.provideService(WorkspaceContext.WorkspaceContext, unusedWorkspaceContext),
        Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, unusedWorkspaceFileSystem),
      ),
  );
});
