import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import { decodeExecCommandArgs } from "./NativeHarnessToolCatalog.ts";
import { nativeHarnessCommandEnvironment } from "./NativeHarnessToolCredentials.ts";
import {
  NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
  NativeHarnessToolError,
  type NativeHarnessToolExecutionInput,
  type NativeHarnessToolResult,
} from "./NativeHarnessToolTypes.ts";

export function nativeHarnessShellInvocation(
  command: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  if (platform === "win32") {
    return {
      command: environment.ComSpec?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", command] as const,
    };
  }
  return { command: "/bin/sh", args: ["-lc", command] as const };
}

export const executeNativeHarnessCommand = Effect.fn("executeNativeHarnessCommand")(
  function* (input: {
    readonly processRunner: ProcessRunner["Service"];
    readonly platform: NodeJS.Platform;
    readonly input: NativeHarnessToolExecutionInput;
  }) {
    const args = yield* decodeExecCommandArgs(input.input.args);
    const command = args.command.trim();
    if (!command) return yield* new NativeHarnessToolError({ detail: "command must not be empty" });

    const timeoutMs = Math.min(600_000, Math.max(1_000, args.timeout_ms ?? 60_000));
    const shell = nativeHarnessShellInvocation(command, input.input.environment, input.platform);
    const result = yield* input.processRunner.run({
      command: shell.command,
      args: shell.args,
      cwd: input.input.cwd,
      env: nativeHarnessCommandEnvironment(input.input.environment),
      timeout: timeoutMs,
      maxOutputBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES,
      outputMode: "truncate",
      truncatedMarker: "\n[Output truncated by T3 Code at 1 MiB]",
    });
    return {
      ok: result.code === 0 && !result.timedOut,
      itemType: "command_execution",
      title: command,
      detail: result.timedOut
        ? `Timed out after ${timeoutMs}ms`
        : `Exited with code ${result.code ?? "unknown"}`,
      output: {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        timedOut: result.timedOut,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
      },
    } satisfies NativeHarnessToolResult;
  },
);
