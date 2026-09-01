import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import { executeNativeHarnessCommand } from "./NativeHarnessToolProcess.ts";
import {
  enforceNativeHarnessToolResultLimit,
  failedNativeHarnessToolResult,
} from "./NativeHarnessToolResults.ts";
import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NativeHarnessToolError,
  type NativeHarnessToolExecutionInput,
  type NativeHarnessToolExecutor,
  type NativeHarnessToolExtension,
} from "./NativeHarnessToolTypes.ts";
import { makeNativeHarnessWorkspaceToolExecutor } from "./NativeHarnessWorkspaceTools.ts";

export {
  buildNativeHarnessToolCatalog,
  nativeHarnessToolDeclarations,
  nativeHarnessToolIsAvailable,
} from "./NativeHarnessToolCatalog.ts";
export {
  nativeHarnessToolApprovalDetail,
  nativeHarnessToolRequestType,
  nativeHarnessToolRequiresApproval,
} from "./NativeHarnessToolApproval.ts";
export { nativeHarnessCommandEnvironment } from "./NativeHarnessToolCredentials.ts";
export { enforceNativeHarnessToolResultLimit } from "./NativeHarnessToolResults.ts";
export {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_HARNESS_MAX_TOOL_ROUNDS,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  NATIVE_HARNESS_WORKSPACE_FIND_TOOL,
  NATIVE_HARNESS_WORKSPACE_READ_TOOL,
  NativeHarnessToolPolicyError,
  type NativeHarnessToolAvailability,
  type NativeHarnessToolDeclaration,
  type NativeHarnessToolExecutionInput,
  type NativeHarnessToolExecutor,
  type NativeHarnessToolExtension,
  type NativeHarnessToolResult,
} from "./NativeHarnessToolTypes.ts";

export const makeNativeHarnessToolExecutor = Effect.fn("makeNativeHarnessToolExecutor")(function* (
  processRunner: ProcessRunner["Service"],
  options?: { readonly extensions?: ReadonlyArray<NativeHarnessToolExtension> },
) {
  const workspaceContext = yield* WorkspaceContext.WorkspaceContext;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const platform = yield* HostProcessPlatform;
  const extensions = options?.extensions ?? [];
  const executeWorkspaceTool = makeNativeHarnessWorkspaceToolExecutor(
    workspaceContext,
    workspaceFileSystem,
  );

  const executeBuiltin = (input: NativeHarnessToolExecutionInput) =>
    input.name === NATIVE_HARNESS_EXEC_COMMAND_TOOL
      ? executeNativeHarnessCommand({ processRunner, platform, input })
      : executeWorkspaceTool(input);

  const execute: NativeHarnessToolExecutor["execute"] = (input) =>
    Effect.gen(function* () {
      const builtin = yield* executeBuiltin(input);
      if (builtin !== undefined) return builtin;

      for (const extension of extensions) {
        const result = yield* extension.execute(input);
        if (result !== undefined) return result;
      }

      return failedNativeHarnessToolResult(
        input.name,
        new NativeHarnessToolError({ detail: `Unknown T3 harness tool '${input.name}'.` }),
      );
    }).pipe(
      Effect.catch((cause) => Effect.succeed(failedNativeHarnessToolResult(input.name, cause))),
      Effect.map(enforceNativeHarnessToolResultLimit),
    );

  return { execute } satisfies NativeHarnessToolExecutor;
});
