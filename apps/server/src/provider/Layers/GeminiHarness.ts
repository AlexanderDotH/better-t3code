import {
  WorkspaceContextInput,
  type CanonicalItemType,
  type CanonicalRequestType,
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { FunctionDeclaration } from "@google/genai";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProcessRunner } from "../../processRunner.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";

export const GEMINI_WORKSPACE_CONTEXT_TOOL = "workspace_context";
export const GEMINI_WRITE_FILE_TOOL = "write_file";
export const GEMINI_REPLACE_TEXT_TOOL = "replace_text";
export const GEMINI_EXEC_COMMAND_TOOL = "exec_command";

const WORKSPACE_CONTEXT_DECLARATION: FunctionDeclaration = {
  name: GEMINI_WORKSPACE_CONTEXT_TOOL,
  description:
    "Search paths or text and read bounded line ranges inside the current workspace. Batch independent queries and reads in one call.",
  parametersJsonSchema: Schema.toJsonSchemaDocument(WorkspaceContextInput).schema,
};

const WRITE_FILE_DECLARATION: FunctionDeclaration = {
  name: GEMINI_WRITE_FILE_TOOL,
  description:
    "Create or replace a UTF-8 text file inside the current workspace. Parent directories are created and paths outside the workspace are rejected.",
  parametersJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      contents: { type: "string", description: "Complete UTF-8 file contents." },
      expected_revision: {
        type: "string",
        description: "Optional revision returned by workspace_context for compare-and-swap safety.",
      },
    },
    required: ["path", "contents"],
  },
};

const REPLACE_TEXT_DECLARATION: FunctionDeclaration = {
  name: GEMINI_REPLACE_TEXT_TOOL,
  description:
    "Replace exact text in one UTF-8 workspace file. By default the old text must occur exactly once, preventing ambiguous edits.",
  parametersJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      old_text: { type: "string", description: "Exact text to replace." },
      new_text: { type: "string", description: "Replacement text." },
      replace_all: {
        type: "boolean",
        description: "Replace every non-overlapping match instead of requiring exactly one.",
      },
    },
    required: ["path", "old_text", "new_text"],
  },
};

const EXEC_COMMAND_DECLARATION: FunctionDeclaration = {
  name: GEMINI_EXEC_COMMAND_TOOL,
  description:
    "Run one shell command in the current workspace through T3's bounded process runner. Output is capped and long-running commands time out.",
  parametersJsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string", description: "Shell command to run." },
      timeout_ms: {
        type: "integer",
        minimum: 1_000,
        maximum: 600_000,
        description: "Optional timeout in milliseconds; defaults to 60000.",
      },
    },
    required: ["command"],
  },
};

export function geminiToolDeclarations(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}): ReadonlyArray<FunctionDeclaration> {
  if (input.interactionMode === "plan" || input.sandboxMode === "read-only") {
    return [WORKSPACE_CONTEXT_DECLARATION];
  }
  const declarations = [
    WORKSPACE_CONTEXT_DECLARATION,
    WRITE_FILE_DECLARATION,
    REPLACE_TEXT_DECLARATION,
  ];
  return input.sandboxMode === "workspace-write"
    ? declarations
    : [...declarations, EXEC_COMMAND_DECLARATION];
}

export function geminiToolIsAvailable(input: {
  readonly toolName: string;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}): boolean {
  return geminiToolDeclarations(input).some((declaration) => declaration.name === input.toolName);
}

export function geminiToolRequiresApproval(toolName: string, runtimeMode: RuntimeMode): boolean {
  if (toolName === GEMINI_WORKSPACE_CONTEXT_TOOL) return false;
  if (toolName === GEMINI_WRITE_FILE_TOOL || toolName === GEMINI_REPLACE_TEXT_TOOL) {
    return runtimeMode === "approval-required";
  }
  return runtimeMode !== "full-access";
}

export function geminiToolRequestType(toolName: string): CanonicalRequestType {
  if (toolName === GEMINI_WRITE_FILE_TOOL || toolName === GEMINI_REPLACE_TEXT_TOOL) {
    return "file_change_approval";
  }
  if (toolName === GEMINI_EXEC_COMMAND_TOOL) return "command_execution_approval";
  return "dynamic_tool_call";
}

export function geminiToolApprovalDetail(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): string {
  if (toolName === GEMINI_EXEC_COMMAND_TOOL && typeof args.command === "string") {
    return args.command;
  }
  if (
    (toolName === GEMINI_WRITE_FILE_TOOL || toolName === GEMINI_REPLACE_TEXT_TOOL) &&
    typeof args.path === "string"
  ) {
    return args.path;
  }
  return toolName;
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

class GeminiHarnessToolError extends Schema.TaggedErrorClass<GeminiHarnessToolError>()(
  "GeminiHarnessToolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const WriteFileArgs = Schema.Struct({
  path: Schema.String,
  contents: Schema.String,
  expected_revision: Schema.optionalKey(Schema.String),
});
const ReplaceTextArgs = Schema.Struct({
  path: Schema.String,
  old_text: Schema.String,
  new_text: Schema.String,
  replace_all: Schema.optionalKey(Schema.Boolean),
});
const ExecCommandArgs = Schema.Struct({
  command: Schema.String,
  timeout_ms: Schema.optionalKey(Schema.Number),
});
const decodeWorkspaceContextArgs = Schema.decodeUnknownEffect(WorkspaceContextInput);
const decodeWriteFileArgs = Schema.decodeUnknownEffect(WriteFileArgs);
const decodeReplaceTextArgs = Schema.decodeUnknownEffect(ReplaceTextArgs);
const decodeExecCommandArgs = Schema.decodeUnknownEffect(ExecCommandArgs);

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Tool execution failed.";
}

function failedToolResult(name: string, cause: unknown): GeminiHarnessToolResult {
  const message = errorMessage(cause);
  return {
    ok: false,
    itemType:
      name === GEMINI_EXEC_COMMAND_TOOL
        ? "command_execution"
        : name === GEMINI_WRITE_FILE_TOOL || name === GEMINI_REPLACE_TEXT_TOOL
          ? "file_change"
          : "mcp_tool_call",
    title: name,
    detail: message,
    output: { error: message },
  };
}

function countOccurrences(contents: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= contents.length - search.length) {
    const index = contents.indexOf(search, offset);
    if (index < 0) break;
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function shellInvocation(
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

export function geminiHarnessCommandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const commandEnvironment = { ...environment };
  delete commandEnvironment.GOOGLE_API_KEY;
  delete commandEnvironment.GEMINI_API_KEY;
  return commandEnvironment;
}

export const makeGeminiHarnessToolExecutor = Effect.fn("makeGeminiHarnessToolExecutor")(function* (
  processRunner: ProcessRunner["Service"],
) {
  const workspaceContext = yield* WorkspaceContext.WorkspaceContext;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const hostPlatform = yield* HostProcessPlatform;

  const execute: GeminiHarnessToolExecutor["execute"] = (input) => {
    const execution = Effect.gen(function* () {
      switch (input.name) {
        case GEMINI_WORKSPACE_CONTEXT_TOOL: {
          const args = yield* decodeWorkspaceContextArgs(input.args);
          const output = yield* workspaceContext.execute({ workspaceRoot: input.cwd, input: args });
          return {
            ok: true,
            itemType: "mcp_tool_call",
            title: "Workspace context",
            detail: `${output.queries.length} quer${output.queries.length === 1 ? "y" : "ies"}, ${output.reads.length} read${output.reads.length === 1 ? "" : "s"}`,
            output: output as unknown as Record<string, unknown>,
          } satisfies GeminiHarnessToolResult;
        }
        case GEMINI_WRITE_FILE_TOOL: {
          const args = yield* decodeWriteFileArgs(input.args);
          if (!args.path.trim()) {
            return yield* new GeminiHarnessToolError({ detail: "path must not be empty" });
          }
          const result = yield* workspaceFileSystem.writeFile({
            cwd: input.cwd,
            relativePath: args.path,
            contents: args.contents,
            ...(args.expected_revision ? { expectedRevision: args.expected_revision } : {}),
          });
          return {
            ok: true,
            itemType: "file_change",
            title: `Write ${result.relativePath}`,
            detail: `${Buffer.byteLength(args.contents)} bytes written`,
            output: {
              path: result.relativePath,
              bytesWritten: Buffer.byteLength(args.contents),
            },
          } satisfies GeminiHarnessToolResult;
        }
        case GEMINI_REPLACE_TEXT_TOOL: {
          const args = yield* decodeReplaceTextArgs(input.args);
          if (!args.path.trim()) {
            return yield* new GeminiHarnessToolError({ detail: "path must not be empty" });
          }
          if (args.old_text.length === 0) {
            return yield* new GeminiHarnessToolError({ detail: "old_text must not be empty" });
          }
          const current = yield* workspaceFileSystem.readFile({
            cwd: input.cwd,
            relativePath: args.path,
          });
          if (current.truncated) {
            return yield* new GeminiHarnessToolError({
              detail: "The file exceeds T3's safe edit read limit; use a targeted command.",
            });
          }
          const occurrences = countOccurrences(current.contents, args.old_text);
          if (occurrences === 0) {
            return yield* new GeminiHarnessToolError({
              detail: "old_text was not found in the file",
            });
          }
          if (args.replace_all !== true && occurrences !== 1) {
            return yield* new GeminiHarnessToolError({
              detail: `old_text occurs ${occurrences} times; set replace_all or provide more context`,
            });
          }
          const contents =
            args.replace_all === true
              ? current.contents.replaceAll(args.old_text, args.new_text)
              : current.contents.replace(args.old_text, args.new_text);
          const result = yield* workspaceFileSystem.writeFile({
            cwd: input.cwd,
            relativePath: args.path,
            contents,
            ...(current.revision ? { expectedRevision: current.revision } : {}),
          });
          return {
            ok: true,
            itemType: "file_change",
            title: `Edit ${result.relativePath}`,
            detail: `${args.replace_all === true ? occurrences : 1} replacement${occurrences === 1 ? "" : "s"}`,
            output: {
              path: result.relativePath,
              replacements: args.replace_all === true ? occurrences : 1,
            },
          } satisfies GeminiHarnessToolResult;
        }
        case GEMINI_EXEC_COMMAND_TOOL: {
          const args = yield* decodeExecCommandArgs(input.args);
          const command = args.command.trim();
          if (!command) {
            return yield* new GeminiHarnessToolError({ detail: "command must not be empty" });
          }
          const timeoutMs = Math.min(600_000, Math.max(1_000, args.timeout_ms ?? 60_000));
          const shell = shellInvocation(command, input.environment, hostPlatform);
          const result = yield* processRunner.run({
            command: shell.command,
            args: shell.args,
            cwd: input.cwd,
            env: geminiHarnessCommandEnvironment(input.environment),
            timeout: timeoutMs,
            maxOutputBytes: 1024 * 1024,
            outputMode: "truncate",
            truncatedMarker: "\n[Output truncated by T3 Code]",
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
          } satisfies GeminiHarnessToolResult;
        }
        default:
          return yield* new GeminiHarnessToolError({
            detail: `Unknown T3 harness tool '${input.name}'.`,
          });
      }
    });

    return execution.pipe(
      Effect.catch((cause) => Effect.succeed(failedToolResult(input.name, cause))),
    );
  };

  return { execute } satisfies GeminiHarnessToolExecutor;
});
