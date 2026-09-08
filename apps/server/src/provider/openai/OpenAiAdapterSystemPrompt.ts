import type { OpenAiSystemInstructionInput } from "./OpenAiAdapterTypes.ts";
import { nativeHarnessWorkspaceInstructions } from "../nativeHarness/NativeHarnessPrompt.ts";

export function buildOpenAiSystemInstructions(input: OpenAiSystemInstructionInput): string {
  const access =
    input.interactionMode === "plan" || input.sandboxMode === "read-only" || input.fetchWorker
      ? "Read-only: inspect the workspace but do not modify files or run commands."
      : input.sandboxMode === "workspace-write"
        ? "Workspace-write: inspect and edit workspace files through T3 tools."
        : "Use only tools exposed by T3 and respect every approval boundary.";
  return [
    "You are an OpenAI Responses model running inside T3 Code. T3 Code owns the transcript, tool loop, approvals, MCP bridge, and filesystem boundary.",
    `The trusted workspace root is ${input.cwd}.`,
    access,
    nativeHarnessWorkspaceInstructions(input),
    input.interactionMode === "plan"
      ? "Plan mode is active: return a decision-complete plan and make no changes."
      : "Carry the request through focused verification and preserve unrelated work.",
  ].join("\n");
}
