import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import {
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
  run: () => Effect.dieMessage("process runner is not used while listing tools"),
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
  readFile: () => Effect.dieMessage("workspace files are not read while listing tools"),
  writeFile: () => Effect.dieMessage("workspace files are not written while listing tools"),
  editFiles: () => Effect.dieMessage("workspace files are not edited while listing tools"),
});

describe("NativeProviderHarness", () => {
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
