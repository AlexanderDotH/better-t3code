import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  NATIVE_HARNESS_APPLY_PATCH_TOOL,
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_HARNESS_REPLACE_TEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WRITE_FILE_TOOL,
  applyNativeHarnessExactPatch,
  buildNativeHarnessToolCatalog,
  enforceNativeHarnessToolResultLimit,
  nativeHarnessCommandEnvironment,
  nativeHarnessToolDeclarations,
  nativeHarnessToolRequiresApproval,
  type NativeHarnessToolDeclaration,
} from "./NativeHarnessTools.ts";

function extensionTool(name: string): NativeHarnessToolDeclaration {
  return {
    name,
    description: `Run ${name}.`,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    availability: "read-only",
  };
}

describe("NativeHarnessTools", () => {
  it("keeps plan and read-only turns non-mutating while exposing the complete write harness", () => {
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "plan",
        sandboxMode: "danger-full-access",
      }).map(({ name }) => name),
    ).toEqual([NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL]);
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "default",
        sandboxMode: "read-only",
      }).map(({ name }) => name),
    ).toEqual([NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL]);
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "default",
        sandboxMode: "workspace-write",
      }).map(({ name }) => name),
    ).toEqual([
      NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
      NATIVE_HARNESS_WRITE_FILE_TOOL,
      NATIVE_HARNESS_REPLACE_TEXT_TOOL,
      NATIVE_HARNESS_APPLY_PATCH_TOOL,
    ]);
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "default",
        sandboxMode: "danger-full-access",
      }).map(({ name }) => name),
    ).toEqual([
      NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
      NATIVE_HARNESS_WRITE_FILE_TOOL,
      NATIVE_HARNESS_REPLACE_TEXT_TOOL,
      NATIVE_HARNESS_APPLY_PATCH_TOOL,
      NATIVE_HARNESS_EXEC_COMMAND_TOOL,
    ]);
  });

  it.effect("rejects duplicate names and catalogs above ninety definitions", () =>
    Effect.gen(function* () {
      const duplicate = yield* Effect.exit(
        buildNativeHarnessToolCatalog({
          interactionMode: "default",
          sandboxMode: "danger-full-access",
          extensions: [
            {
              declarations: [extensionTool(NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL)],
              execute: () => Effect.succeed(undefined),
            },
          ],
        }),
      );
      expect(duplicate._tag).toBe("Failure");
      if (duplicate._tag === "Failure") {
        expect(String(duplicate.cause)).toContain("duplicate");
      }

      const overflow = yield* Effect.exit(
        buildNativeHarnessToolCatalog({
          interactionMode: "default",
          sandboxMode: "danger-full-access",
          extensions: [
            {
              declarations: Array.from(
                { length: NATIVE_HARNESS_MAX_TOOL_DEFINITIONS },
                (_, index) => extensionTool(`external_${index}`),
              ),
              execute: () => Effect.succeed(undefined),
            },
          ],
        }),
      );
      expect(overflow._tag).toBe("Failure");
      if (overflow._tag === "Failure") {
        expect(String(overflow.cause)).toContain("90");
      }
    }),
  );

  it("applies an ordered exact patch without accepting ambiguous hunks", () => {
    expect(
      applyNativeHarnessExactPatch("alpha\nbeta\ngamma\n", [
        { oldText: "alpha", newText: "one", replaceAll: false },
        { oldText: "gamma", newText: "three", replaceAll: false },
      ]),
    ).toEqual({ ok: true, contents: "one\nbeta\nthree\n", replacements: 2 });
    expect(
      applyNativeHarnessExactPatch("same same", [
        { oldText: "same", newText: "changed", replaceAll: false },
      ]),
    ).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("reports oversized tool output instead of passing more than one MiB to the model", () => {
    const result = enforceNativeHarnessToolResultLimit({
      ok: true,
      itemType: "mcp_tool_call",
      title: "large-result",
      detail: "large-result",
      output: { value: "x".repeat(NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES) },
    });
    expect(result).toMatchObject({
      ok: false,
      title: "large-result",
      output: { error: expect.stringContaining("1 MiB") },
    });
    expect(Buffer.byteLength(JSON.stringify(result.output))).toBeLessThanOrEqual(
      NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
    );
  });

  it("maps approvals and strips provider credentials from bounded shell commands", () => {
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL, "approval-required"),
    ).toBe(false);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WRITE_FILE_TOOL, "approval-required"),
    ).toBe(true);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_APPLY_PATCH_TOOL, "auto-accept-edits"),
    ).toBe(false);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_EXEC_COMMAND_TOOL, "auto-accept-edits"),
    ).toBe(true);
    expect(nativeHarnessToolRequiresApproval(NATIVE_HARNESS_EXEC_COMMAND_TOOL, "full-access")).toBe(
      false,
    );
    expect(
      nativeHarnessCommandEnvironment({
        PATH: "/usr/bin",
        OPENAI_API_KEY: "openai-secret",
        CODEX_API_KEY: "codex-secret",
        GOOGLE_API_KEY: "google-secret",
        GEMINI_API_KEY: "gemini-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
        OPENROUTER_API_KEY: "openrouter-secret",
        PROJECT_TOKEN: "project-token",
      }),
    ).toEqual({ PATH: "/usr/bin", PROJECT_TOKEN: "project-token" });
  });
});
