import * as Effect from "effect/Effect";

import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { decodeWorkspaceContextArgs, decodeWorkspaceEditArgs } from "./NativeHarnessToolCatalog.ts";
import {
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  type NativeHarnessToolExecutionInput,
  type NativeHarnessToolResult,
} from "./NativeHarnessToolTypes.ts";

export function makeNativeHarnessWorkspaceToolExecutor(
  workspaceContext: WorkspaceContext.WorkspaceContext["Service"],
  workspaceFileSystem: WorkspaceFileSystem.WorkspaceFileSystem["Service"],
) {
  return Effect.fn("executeNativeHarnessWorkspaceTool")(function* (
    input: NativeHarnessToolExecutionInput,
  ) {
    switch (input.name) {
      case NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL: {
        const args = yield* decodeWorkspaceContextArgs(input.args);
        const output = yield* workspaceContext.execute({ workspaceRoot: input.cwd, input: args });
        return {
          ok: true,
          itemType: "mcp_tool_call",
          title: "Workspace context",
          detail: `${output.queries.length} quer${output.queries.length === 1 ? "y" : "ies"}, ${output.reads.length} read${output.reads.length === 1 ? "" : "s"}`,
          output: output as unknown as Record<string, unknown>,
        } satisfies NativeHarnessToolResult;
      }
      case NATIVE_HARNESS_WORKSPACE_EDIT_TOOL: {
        const args = yield* decodeWorkspaceEditArgs(input.args);
        const outcome = yield* workspaceFileSystem
          .editFiles({ workspaceRoot: input.cwd, input: args })
          .pipe(
            Effect.map((output) => ({ ok: true as const, output })),
            Effect.catchTag("WorkspaceEditError", (error) =>
              Effect.succeed({ ok: false as const, error }),
            ),
          );
        if (!outcome.ok) {
          const { error } = outcome;
          return {
            ok: false,
            itemType: "file_change",
            title: "Workspace edit",
            detail: `Workspace edit failed (${error.reason})${error.path ? `: ${error.path}` : ""}`,
            output: {
              reason: error.reason,
              ...(error.path !== undefined ? { path: error.path } : {}),
              ...(error.change_index !== undefined ? { change_index: error.change_index } : {}),
              ...(error.edit_index !== undefined ? { edit_index: error.edit_index } : {}),
              ...(error.expected_revision !== undefined
                ? { expected_revision: error.expected_revision }
                : {}),
              ...(error.actual_revision !== undefined
                ? { actual_revision: error.actual_revision }
                : {}),
              ...(error.uncertain_paths !== undefined
                ? { uncertain_paths: error.uncertain_paths }
                : {}),
            },
          } satisfies NativeHarnessToolResult;
        }
        const { output } = outcome;
        return {
          ok: true,
          itemType: "file_change",
          title: "Workspace edit",
          detail: `${output.changes.length} file${output.changes.length === 1 ? "" : "s"} changed`,
          output: output as unknown as Record<string, unknown>,
        } satisfies NativeHarnessToolResult;
      }
      default:
        return undefined;
    }
  });
}
