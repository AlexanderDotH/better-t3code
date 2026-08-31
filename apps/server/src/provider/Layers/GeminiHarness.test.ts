import { describe, expect, it } from "vite-plus/test";

import {
  GEMINI_EXEC_COMMAND_TOOL,
  GEMINI_WORKSPACE_CONTEXT_TOOL,
  GEMINI_WORKSPACE_EDIT_TOOL,
  geminiHarnessCommandEnvironment,
  geminiToolDeclarations,
  geminiToolIsAvailable,
  geminiToolRequiresApproval,
} from "./GeminiHarness.ts";

describe("GeminiHarness", () => {
  it("keeps plan and read-only turns non-mutating", () => {
    expect(
      geminiToolDeclarations({ interactionMode: "plan", sandboxMode: "workspace-write" }).map(
        (tool) => tool.name,
      ),
    ).toEqual([GEMINI_WORKSPACE_CONTEXT_TOOL]);
    expect(
      geminiToolDeclarations({ interactionMode: "default", sandboxMode: "read-only" }).map(
        (tool) => tool.name,
      ),
    ).toEqual([GEMINI_WORKSPACE_CONTEXT_TOOL]);
    expect(
      geminiToolDeclarations({ interactionMode: "default", sandboxMode: "workspace-write" }).map(
        (tool) => tool.name,
      ),
    ).toEqual([GEMINI_WORKSPACE_CONTEXT_TOOL, GEMINI_WORKSPACE_EDIT_TOOL]);
    expect(
      geminiToolIsAvailable({
        toolName: "write_file",
        interactionMode: "default",
        sandboxMode: "workspace-write",
      }),
    ).toBe(false);
    expect(
      geminiToolIsAvailable({
        toolName: GEMINI_EXEC_COMMAND_TOOL,
        interactionMode: "plan",
        sandboxMode: "danger-full-access",
      }),
    ).toBe(false);
    expect(
      geminiToolIsAvailable({
        toolName: GEMINI_EXEC_COMMAND_TOOL,
        interactionMode: "default",
        sandboxMode: "danger-full-access",
      }),
    ).toBe(true);
  });

  it("maps T3 runtime modes to edit and command approvals", () => {
    expect(geminiToolRequiresApproval(GEMINI_WORKSPACE_CONTEXT_TOOL, "approval-required")).toBe(
      false,
    );
    expect(geminiToolRequiresApproval(GEMINI_WORKSPACE_EDIT_TOOL, "approval-required")).toBe(true);
    expect(geminiToolRequiresApproval(GEMINI_WORKSPACE_EDIT_TOOL, "auto-accept-edits")).toBe(false);
    expect(geminiToolRequiresApproval(GEMINI_EXEC_COMMAND_TOOL, "auto-accept-edits")).toBe(true);
    expect(geminiToolRequiresApproval(GEMINI_EXEC_COMMAND_TOOL, "auto")).toBe(true);
    expect(geminiToolRequiresApproval(GEMINI_EXEC_COMMAND_TOOL, "full-access")).toBe(false);
  });

  it("keeps Gemini credentials out of T3 command subprocesses", () => {
    expect(
      geminiHarnessCommandEnvironment({
        PATH: "/usr/bin",
        GOOGLE_API_KEY: "google-secret",
        GEMINI_API_KEY: "gemini-secret",
        PROJECT_TOKEN: "project-token",
      }),
    ).toEqual({ PATH: "/usr/bin", PROJECT_TOKEN: "project-token" });
  });
});
