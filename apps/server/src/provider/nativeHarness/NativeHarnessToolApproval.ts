import type { CanonicalRequestType, RuntimeMode } from "@t3tools/contracts";

import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
} from "./NativeHarnessToolTypes.ts";

const isFileMutationTool = (toolName: string): boolean =>
  toolName === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL;

export function nativeHarnessToolRequiresApproval(
  toolName: string,
  runtimeMode: RuntimeMode,
): boolean {
  if (toolName === NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL) return false;
  if (isFileMutationTool(toolName)) return runtimeMode === "approval-required";
  return runtimeMode !== "full-access";
}

export function nativeHarnessToolRequestType(toolName: string): CanonicalRequestType {
  if (isFileMutationTool(toolName)) return "file_change_approval";
  if (toolName === NATIVE_HARNESS_EXEC_COMMAND_TOOL) return "command_execution_approval";
  return "dynamic_tool_call";
}

export function nativeHarnessToolApprovalDetail(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): string {
  if (toolName === NATIVE_HARNESS_EXEC_COMMAND_TOOL && typeof args.command === "string") {
    return args.command;
  }
  if (toolName === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL && Array.isArray(args.changes)) {
    const paths = args.changes.flatMap((change) => {
      if (typeof change !== "object" || change === null || !Object.hasOwn(change, "path"))
        return [];
      const path = Reflect.get(change, "path");
      return typeof path === "string" ? [path] : [];
    });
    if (paths.length > 0) return paths.slice(0, 8).join(", ");
  }
  return toolName;
}
