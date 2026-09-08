import type { CanonicalItemType } from "@t3tools/contracts";

import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  type NativeHarnessToolResult,
} from "./NativeHarnessToolTypes.ts";

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Tool execution failed.";
};

const itemTypeForTool = (name: string): CanonicalItemType => {
  if (name === NATIVE_HARNESS_EXEC_COMMAND_TOOL) return "command_execution";
  if (name === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL) {
    return "file_change";
  }
  return "mcp_tool_call";
};

export function failedNativeHarnessToolResult(
  name: string,
  cause: unknown,
): NativeHarnessToolResult {
  const message = errorMessage(cause);
  return {
    ok: false,
    itemType: itemTypeForTool(name),
    title: name,
    detail: message,
    output: { error: message },
  };
}

export function enforceNativeHarnessToolResultLimit(
  result: NativeHarnessToolResult,
): NativeHarnessToolResult {
  return result;
}
