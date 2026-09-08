import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ProcessRunInput, ProcessRunner } from "../../processRunner.ts";
import {
  nativeHarnessToolDeclarations,
  nativeHarnessToolIsAvailable,
} from "./NativeHarnessToolCatalog.ts";
import {
  nativeHarnessToolApprovalDetail,
  nativeHarnessToolRequestType,
  nativeHarnessToolRequiresApproval,
} from "./NativeHarnessToolApproval.ts";
import { nativeHarnessCommandEnvironment } from "./NativeHarnessToolCredentials.ts";
import {
  executeNativeHarnessCommand,
  nativeHarnessShellInvocation,
} from "./NativeHarnessToolProcess.ts";
import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  NATIVE_HARNESS_WORKSPACE_FIND_TOOL,
  NATIVE_HARNESS_WORKSPACE_READ_TOOL,
} from "./NativeHarnessToolTypes.ts";

describe("NativeHarnessTool boundaries", () => {
  it("keeps catalog availability independent from approval policy", () => {
    expect(
      nativeHarnessToolDeclarations({
        interactionMode: "plan",
        sandboxMode: "danger-full-access",
      }).map((declaration) => declaration.name),
    ).toEqual([
      NATIVE_HARNESS_WORKSPACE_FIND_TOOL,
      NATIVE_HARNESS_WORKSPACE_READ_TOOL,
      NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
    ]);
    expect(
      nativeHarnessToolIsAvailable({
        toolName: NATIVE_HARNESS_EXEC_COMMAND_TOOL,
        interactionMode: "default",
        sandboxMode: "workspace-write",
      }),
    ).toBe(false);

    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_FIND_TOOL, "approval-required"),
    ).toBe(false);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_READ_TOOL, "approval-required"),
    ).toBe(false);
    expect(
      nativeHarnessToolRequiresApproval(NATIVE_HARNESS_WORKSPACE_EDIT_TOOL, "approval-required"),
    ).toBe(true);
    expect(nativeHarnessToolRequestType(NATIVE_HARNESS_WORKSPACE_EDIT_TOOL)).toBe(
      "file_change_approval",
    );
    expect(
      nativeHarnessToolApprovalDetail(NATIVE_HARNESS_WORKSPACE_EDIT_TOOL, {
        changes: [{ path: "src/app.ts", edits: [{ type: "delete" }] }],
      }),
    ).toBe("src/app.ts");
  });

  it("filters provider credentials without removing workspace variables", () => {
    expect(
      nativeHarnessCommandEnvironment({
        PATH: "/usr/bin",
        OPENAI_API_KEY: "secret",
        ANTHROPIC_API_KEY: "secret",
        PROJECT_TOKEN: "workspace-owned",
      }),
    ).toEqual({ PATH: "/usr/bin", PROJECT_TOKEN: "workspace-owned" });
  });

  it.effect("runs commands through the bounded process boundary", () => {
    const calls: ProcessRunInput[] = [];
    const processRunner: ProcessRunner["Service"] = {
      run: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return {
            stdout: "ok\n",
            stderr: "",
            code: 0,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          };
        }),
    };

    return Effect.gen(function* () {
      const result = yield* executeNativeHarnessCommand({
        processRunner,
        platform: "linux",
        input: {
          name: NATIVE_HARNESS_EXEC_COMMAND_TOOL,
          args: { command: "printf ok", timeout_ms: 999_999 },
          cwd: "/workspace",
          environment: {
            PATH: "/usr/bin",
            OPENAI_API_KEY: "secret",
            PROJECT_TOKEN: "workspace-owned",
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        itemType: "command_execution",
        title: "printf ok",
        output: { stdout: "ok\n", exitCode: 0, timedOut: false },
      });
      expect(calls).toEqual([
        expect.objectContaining({
          command: "/bin/sh",
          args: ["-lc", "printf ok"],
          cwd: "/workspace",
          env: { PATH: "/usr/bin", PROJECT_TOKEN: "workspace-owned" },
          timeout: 600_000,
        }),
      ]);
    });
  });

  it("selects the platform shell without owning process execution", () => {
    expect(
      nativeHarnessShellInvocation("echo ok", { ComSpec: " C:\\Windows\\cmd.exe " }, "win32"),
    ).toEqual({
      command: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", "echo ok"],
    });
  });
});
