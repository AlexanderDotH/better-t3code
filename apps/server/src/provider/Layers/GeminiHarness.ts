import type { FunctionDeclaration } from "@google/genai";
import type {
  CanonicalItemType,
  CanonicalRequestType,
  ProviderInteractionMode,
  ProviderSandboxMode,
  RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import {
  makeNativeHarnessToolExecutor,
  nativeHarnessCommandEnvironment,
  nativeHarnessToolApprovalDetail,
  nativeHarnessToolDeclarations,
  nativeHarnessToolRequestType,
  nativeHarnessToolRequiresApproval,
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_REPLACE_TEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WRITE_FILE_TOOL,
} from "../nativeHarness/NativeHarnessTools.ts";

export const GEMINI_WORKSPACE_CONTEXT_TOOL = NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL;
export const GEMINI_WRITE_FILE_TOOL = NATIVE_HARNESS_WRITE_FILE_TOOL;
export const GEMINI_REPLACE_TEXT_TOOL = NATIVE_HARNESS_REPLACE_TEXT_TOOL;
export const GEMINI_EXEC_COMMAND_TOOL = NATIVE_HARNESS_EXEC_COMMAND_TOOL;

const GEMINI_TOOL_NAMES = new Set([
  GEMINI_WORKSPACE_CONTEXT_TOOL,
  GEMINI_WRITE_FILE_TOOL,
  GEMINI_REPLACE_TEXT_TOOL,
  GEMINI_EXEC_COMMAND_TOOL,
]);

export function geminiToolDeclarations(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}): ReadonlyArray<FunctionDeclaration> {
  return nativeHarnessToolDeclarations(input)
    .filter((declaration) => GEMINI_TOOL_NAMES.has(declaration.name))
    .map((declaration) => ({
      name: declaration.name,
      description: declaration.description,
      parametersJsonSchema: declaration.inputSchema,
    }));
}

export function geminiToolIsAvailable(input: {
  readonly toolName: string;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}): boolean {
  return geminiToolDeclarations(input).some((declaration) => declaration.name === input.toolName);
}

export function geminiToolRequiresApproval(toolName: string, runtimeMode: RuntimeMode): boolean {
  return nativeHarnessToolRequiresApproval(toolName, runtimeMode);
}

export function geminiToolRequestType(toolName: string): CanonicalRequestType {
  return nativeHarnessToolRequestType(toolName);
}

export function geminiToolApprovalDetail(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): string {
  return nativeHarnessToolApprovalDetail(toolName, args);
}

export interface GeminiHarnessToolResult {
  readonly ok: boolean;
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly detail: string;
  readonly output: Record<string, unknown>;
}

export interface GeminiHarnessToolExecutor {
  readonly execute: (input: {
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
  }) => Effect.Effect<GeminiHarnessToolResult>;
}

export function geminiHarnessCommandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return nativeHarnessCommandEnvironment(environment);
}

export const makeGeminiHarnessToolExecutor = Effect.fn("makeGeminiHarnessToolExecutor")(function* (
  processRunner: ProcessRunner["Service"],
) {
  const executor = yield* makeNativeHarnessToolExecutor(processRunner);
  return {
    execute: (input) =>
      executor
        .execute(input)
        .pipe(Effect.map((result) => ({ ...result, output: { ...result.output } }))),
  } satisfies GeminiHarnessToolExecutor;
});
