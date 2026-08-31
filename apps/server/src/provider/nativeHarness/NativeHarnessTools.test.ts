import { describe, expect, it } from "@effect/vitest";
import { WorkspaceEditError, WorkspaceEditInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";

import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  buildNativeHarnessToolCatalog,
  enforceNativeHarnessToolResultLimit,
  nativeHarnessCommandEnvironment,
  nativeHarnessToolDeclarations,
  nativeHarnessToolIsAvailable,
  nativeHarnessToolRequiresApproval,
  type NativeHarnessToolDeclaration,
} from "./NativeHarnessTools.ts";
import { makeNativeHarnessWorkspaceToolExecutor } from "./NativeHarnessWorkspaceTools.ts";

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
    ).toEqual([NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL, NATIVE_HARNESS_WORKSPACE_EDIT_TOOL]);
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "default",
        sandboxMode: "danger-full-access",
      }).map(({ name }) => name),
    ).toEqual([
      NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
      NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
      NATIVE_HARNESS_EXEC_COMMAND_TOOL,
    ]);
  });

  it("advertises only the shared workspace_edit mutation contract", () => {
    const declarations = nativeHarnessToolDeclarations({
      interactionMode: "default",
      sandboxMode: "workspace-write",
    });
    const workspaceEdit = declarations.find(
      (declaration) => declaration.name === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
    );

    expect(workspaceEdit?.inputSchema).toEqual(
      Schema.toJsonSchemaDocument(WorkspaceEditInput).schema,
    );
    expect(declarations.map(({ name }) => name)).not.toContain("write_file");
    expect(declarations.map(({ name }) => name)).not.toContain("replace_text");
    expect(declarations.map(({ name }) => name)).not.toContain("apply_patch");
    expect(
      nativeHarnessToolIsAvailable({
        toolName: "write_file",
        interactionMode: "default",
        sandboxMode: "workspace-write",
      }),
    ).toBe(false);
  });

  it.effect("delegates one mixed workspace_edit batch and returns only compact summaries", () =>
    Effect.gen(function* () {
      const requests: Array<unknown> = [];
      const execute = makeNativeHarnessWorkspaceToolExecutor(
        {
          execute: () => Effect.die("workspace_context should not run"),
        } as WorkspaceContext.WorkspaceContext["Service"],
        {
          readFile: () => Effect.die("legacy read should not run"),
          writeFile: () => Effect.die("legacy write should not run"),
          editFiles: (request) =>
            Effect.sync(() => {
              requests.push(request);
              return {
                changes: [
                  { path: "src/a.ts", action: "updated", edit_count: 1 },
                  { path: "src/b.ts", action: "deleted", edit_count: 1 },
                ],
              } as const;
            }),
        } as WorkspaceFileSystem.WorkspaceFileSystem["Service"],
      );
      const args = {
        changes: [
          {
            path: "src/a.ts",
            edits: [{ type: "replace", old_text: "old", new_text: "new" }],
          },
          { path: "src/b.ts", edits: [{ type: "delete" }] },
        ],
      } as const;

      const result = yield* execute({
        name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
        args,
        cwd: "/workspace",
        environment: {},
      });

      expect(requests).toEqual([{ workspaceRoot: "/workspace", input: args }]);
      expect(result).toMatchObject({
        ok: true,
        itemType: "file_change",
        output: {
          changes: [
            { path: "src/a.ts", action: "updated", edit_count: 1 },
            { path: "src/b.ts", action: "deleted", edit_count: 1 },
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain("old");
      expect(JSON.stringify(result)).not.toContain("new");
    }),
  );

  it.effect("returns structured workspace_edit failures without submitted contents", () =>
    Effect.gen(function* () {
      const execute = makeNativeHarnessWorkspaceToolExecutor(
        {
          execute: () => Effect.die("workspace_context should not run"),
        } as WorkspaceContext.WorkspaceContext["Service"],
        {
          readFile: () => Effect.die("legacy read should not run"),
          writeFile: () => Effect.die("legacy write should not run"),
          editFiles: () =>
            Effect.fail(
              new WorkspaceEditError({
                reason: "revision_conflict",
                path: "src/a.ts",
                change_index: 0,
                expected_revision: `sha256:${"a".repeat(64)}`,
                actual_revision: `sha256:${"b".repeat(64)}`,
              }),
            ),
        } as WorkspaceFileSystem.WorkspaceFileSystem["Service"],
      );

      const result = yield* execute({
        name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
        args: {
          changes: [
            {
              path: "src/a.ts",
              edits: [{ type: "write", mode: "overwrite", content: "secret contents" }],
            },
          ],
        },
        cwd: "/workspace",
        environment: {},
      });

      expect(result).toMatchObject({
        ok: false,
        itemType: "file_change",
        output: {
          reason: "revision_conflict",
          path: "src/a.ts",
          change_index: 0,
        },
      });
      expect(JSON.stringify(result)).not.toContain("secret contents");
    }),
  );

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

  it("preserves oversized tool output for terminal persistence", () => {
    const full = {
      ok: true,
      itemType: "mcp_tool_call",
      title: "large-result",
      detail: "large-result",
      output: { value: "x".repeat(NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES) },
    } as const;

    expect(enforceNativeHarnessToolResultLimit(full)).toBe(full);
  });

  it("maps approvals and strips provider credentials from bounded shell commands", () => {
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL, "approval-required"),
    ).toBe(false);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_EDIT_TOOL, "approval-required"),
    ).toBe(true);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_EDIT_TOOL, "auto-accept-edits"),
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
