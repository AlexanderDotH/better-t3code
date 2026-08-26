import {
  WorkspaceContextInput,
  type CanonicalItemType,
  type CanonicalRequestType,
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProcessRunner } from "../../processRunner.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";

export const NATIVE_HARNESS_MAX_TOOL_DEFINITIONS = 90;
export const NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
export const NATIVE_HARNESS_MAX_TOOL_ROUNDS = 64;

export const NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL = "workspace_context";
export const NATIVE_HARNESS_WRITE_FILE_TOOL = "write_file";
export const NATIVE_HARNESS_REPLACE_TEXT_TOOL = "replace_text";
export const NATIVE_HARNESS_APPLY_PATCH_TOOL = "apply_patch";
export const NATIVE_HARNESS_EXEC_COMMAND_TOOL = "exec_command";

export type NativeHarnessToolAvailability =
  | "read-only"
  | "workspace-write"
  | "full-access"
  | "default-only";

export interface NativeHarnessToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly availability: NativeHarnessToolAvailability;
  readonly requiresApproval?: boolean | undefined;
}

export interface NativeHarnessToolResult {
  readonly ok: boolean;
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly detail: string;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface NativeHarnessToolExecutionInput {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}

export interface NativeHarnessToolExtension {
  readonly declarations: ReadonlyArray<NativeHarnessToolDeclaration>;
  readonly execute: (
    input: NativeHarnessToolExecutionInput,
  ) => Effect.Effect<NativeHarnessToolResult | undefined>;
}

export interface NativeHarnessToolExecutor {
  readonly execute: (
    input: NativeHarnessToolExecutionInput,
  ) => Effect.Effect<NativeHarnessToolResult>;
}

export class NativeHarnessToolPolicyError extends Schema.TaggedErrorClass<NativeHarnessToolPolicyError>()(
  "NativeHarnessToolPolicyError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

class NativeHarnessToolError extends Schema.TaggedErrorClass<NativeHarnessToolError>()(
  "NativeHarnessToolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
} as const;

const WORKSPACE_CONTEXT_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  description:
    "Search paths or text and read bounded line ranges inside the current workspace. Batch independent queries and reads in one call.",
  inputSchema: Schema.toJsonSchemaDocument(WorkspaceContextInput).schema,
  availability: "read-only",
};

const WRITE_FILE_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_WRITE_FILE_TOOL,
  description:
    "Create or replace one UTF-8 text file inside the current workspace. Parent directories are created and paths outside the workspace are rejected.",
  inputSchema: {
    ...OBJECT_SCHEMA,
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
  availability: "workspace-write",
};

const REPLACE_TEXT_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_REPLACE_TEXT_TOOL,
  description:
    "Replace exact text in one UTF-8 workspace file. By default the old text must occur exactly once, preventing ambiguous edits.",
  inputSchema: {
    ...OBJECT_SCHEMA,
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
  availability: "workspace-write",
};

const APPLY_PATCH_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_APPLY_PATCH_TOOL,
  description:
    "Apply an ordered set of exact text hunks to one UTF-8 workspace file with revision safety. Every hunk must match exactly once unless replace_all is true.",
  inputSchema: {
    ...OBJECT_SCHEMA,
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      hunks: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: {
          ...OBJECT_SCHEMA,
          properties: {
            old_text: { type: "string", description: "Exact text removed by this hunk." },
            new_text: { type: "string", description: "Replacement text inserted by this hunk." },
            replace_all: {
              type: "boolean",
              description: "Replace every non-overlapping occurrence for this hunk.",
            },
          },
          required: ["old_text", "new_text"],
        },
      },
    },
    required: ["path", "hunks"],
  },
  availability: "workspace-write",
};

const EXEC_COMMAND_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  description:
    "Run one shell command in the current workspace through T3's bounded process runner. Combined output is capped at 1 MiB and long-running commands time out.",
  inputSchema: {
    ...OBJECT_SCHEMA,
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
  availability: "full-access",
};

const BUILTIN_DECLARATIONS = [
  WORKSPACE_CONTEXT_DECLARATION,
  WRITE_FILE_DECLARATION,
  REPLACE_TEXT_DECLARATION,
  APPLY_PATCH_DECLARATION,
  EXEC_COMMAND_DECLARATION,
] as const;

function declarationIsAvailable(
  declaration: NativeHarnessToolDeclaration,
  input: {
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
  },
): boolean {
  if (declaration.availability === "read-only") return true;
  if (input.interactionMode === "plan" || input.sandboxMode === "read-only") return false;
  if (declaration.availability === "default-only") return true;
  if (declaration.availability === "workspace-write") return true;
  return input.sandboxMode !== "workspace-write";
}

export function nativeHarnessToolDeclarations(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}): ReadonlyArray<NativeHarnessToolDeclaration> {
  return BUILTIN_DECLARATIONS.filter((declaration) => declarationIsAvailable(declaration, input));
}

export const buildNativeHarnessToolCatalog = Effect.fn("buildNativeHarnessToolCatalog")(
  function* (input: {
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
    readonly extensions?: ReadonlyArray<NativeHarnessToolExtension>;
  }) {
    const declarations = [
      ...nativeHarnessToolDeclarations(input),
      ...(input.extensions ?? []).flatMap((extension) =>
        extension.declarations.filter((declaration) => declarationIsAvailable(declaration, input)),
      ),
    ];
    const seen = new Set<string>();
    for (const declaration of declarations) {
      if (!declaration.name.trim()) {
        return yield* new NativeHarnessToolPolicyError({
          detail: "Native harness tool names must not be empty.",
        });
      }
      if (seen.has(declaration.name)) {
        return yield* new NativeHarnessToolPolicyError({
          detail: `Native harness tool catalog contains duplicate name '${declaration.name}'.`,
        });
      }
      seen.add(declaration.name);
    }
    if (declarations.length > NATIVE_HARNESS_MAX_TOOL_DEFINITIONS) {
      return yield* new NativeHarnessToolPolicyError({
        detail: `Native harness tool catalog contains ${declarations.length} definitions; the maximum is ${NATIVE_HARNESS_MAX_TOOL_DEFINITIONS}.`,
      });
    }
    return declarations;
  },
);

export function nativeHarnessToolIsAvailable(input: {
  readonly toolName: string;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly extensions?: ReadonlyArray<NativeHarnessToolExtension>;
}): boolean {
  return [
    ...nativeHarnessToolDeclarations(input),
    ...(input.extensions ?? []).flatMap((extension) =>
      extension.declarations.filter((declaration) => declarationIsAvailable(declaration, input)),
    ),
  ].some((declaration) => declaration.name === input.toolName);
}

export function nativeHarnessToolRequiresApproval(
  toolName: string,
  runtimeMode: RuntimeMode,
): boolean {
  if (toolName === NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL) return false;
  if (
    toolName === NATIVE_HARNESS_WRITE_FILE_TOOL ||
    toolName === NATIVE_HARNESS_REPLACE_TEXT_TOOL ||
    toolName === NATIVE_HARNESS_APPLY_PATCH_TOOL
  ) {
    return runtimeMode === "approval-required";
  }
  if (toolName === NATIVE_HARNESS_EXEC_COMMAND_TOOL) return runtimeMode !== "full-access";
  return runtimeMode !== "full-access";
}

export function nativeHarnessToolRequestType(toolName: string): CanonicalRequestType {
  if (
    toolName === NATIVE_HARNESS_WRITE_FILE_TOOL ||
    toolName === NATIVE_HARNESS_REPLACE_TEXT_TOOL ||
    toolName === NATIVE_HARNESS_APPLY_PATCH_TOOL
  ) {
    return "file_change_approval";
  }
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
  if (
    (toolName === NATIVE_HARNESS_WRITE_FILE_TOOL ||
      toolName === NATIVE_HARNESS_REPLACE_TEXT_TOOL ||
      toolName === NATIVE_HARNESS_APPLY_PATCH_TOOL) &&
    typeof args.path === "string"
  ) {
    return args.path;
  }
  return toolName;
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
const PatchHunk = Schema.Struct({
  old_text: Schema.String,
  new_text: Schema.String,
  replace_all: Schema.optionalKey(Schema.Boolean),
});
const ApplyPatchArgs = Schema.Struct({
  path: Schema.String,
  hunks: Schema.Array(PatchHunk).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
const ExecCommandArgs = Schema.Struct({
  command: Schema.String,
  timeout_ms: Schema.optionalKey(Schema.Number),
});
const decodeWorkspaceContextArgs = Schema.decodeUnknownEffect(WorkspaceContextInput);
const decodeWriteFileArgs = Schema.decodeUnknownEffect(WriteFileArgs);
const decodeReplaceTextArgs = Schema.decodeUnknownEffect(ReplaceTextArgs);
const decodeApplyPatchArgs = Schema.decodeUnknownEffect(ApplyPatchArgs);
const decodeExecCommandArgs = Schema.decodeUnknownEffect(ExecCommandArgs);

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "Tool execution failed.";
}

function itemTypeForTool(name: string): CanonicalItemType {
  if (name === NATIVE_HARNESS_EXEC_COMMAND_TOOL) return "command_execution";
  if (
    name === NATIVE_HARNESS_WRITE_FILE_TOOL ||
    name === NATIVE_HARNESS_REPLACE_TEXT_TOOL ||
    name === NATIVE_HARNESS_APPLY_PATCH_TOOL
  ) {
    return "file_change";
  }
  return "mcp_tool_call";
}

function failedToolResult(name: string, cause: unknown): NativeHarnessToolResult {
  const message = errorMessage(cause);
  return {
    ok: false,
    itemType: itemTypeForTool(name),
    title: name,
    detail: message,
    output: { error: message },
  };
}

function countOccurrences(contents: string, search: string): number {
  if (search.length === 0) return 0;
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

export type NativeHarnessExactPatchResult =
  | { readonly ok: true; readonly contents: string; readonly replacements: number }
  | {
      readonly ok: false;
      readonly reason: "empty-old-text" | "not-found" | "ambiguous";
      readonly hunkIndex: number;
      readonly occurrences: number;
    };

export function applyNativeHarnessExactPatch(
  initialContents: string,
  hunks: ReadonlyArray<{
    readonly oldText: string;
    readonly newText: string;
    readonly replaceAll: boolean;
  }>,
): NativeHarnessExactPatchResult {
  let contents = initialContents;
  let replacements = 0;
  for (const [hunkIndex, hunk] of hunks.entries()) {
    if (hunk.oldText.length === 0) {
      return { ok: false, reason: "empty-old-text", hunkIndex, occurrences: 0 };
    }
    const occurrences = countOccurrences(contents, hunk.oldText);
    if (occurrences === 0) {
      return { ok: false, reason: "not-found", hunkIndex, occurrences };
    }
    if (!hunk.replaceAll && occurrences !== 1) {
      return { ok: false, reason: "ambiguous", hunkIndex, occurrences };
    }
    contents = hunk.replaceAll
      ? contents.replaceAll(hunk.oldText, hunk.newText)
      : contents.replace(hunk.oldText, hunk.newText);
    replacements += hunk.replaceAll ? occurrences : 1;
  }
  return { ok: true, contents, replacements };
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

const PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export function nativeHarnessCommandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const commandEnvironment = { ...environment };
  for (const key of PROVIDER_CREDENTIAL_ENVIRONMENT_KEYS) delete commandEnvironment[key];
  return commandEnvironment;
}

export function enforceNativeHarnessToolResultLimit(
  result: NativeHarnessToolResult,
): NativeHarnessToolResult {
  const bytes = Buffer.byteLength(JSON.stringify(result.output));
  if (bytes <= NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES) return result;
  const detail = `Tool result exceeded T3's 1 MiB per-call limit (${bytes} bytes). Narrow the request and retry.`;
  return {
    ok: false,
    itemType: result.itemType,
    title: result.title,
    detail,
    output: { error: detail, observedBytes: bytes, maxBytes: NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES },
  };
}

export const makeNativeHarnessToolExecutor = Effect.fn("makeNativeHarnessToolExecutor")(function* (
  processRunner: ProcessRunner["Service"],
  options?: { readonly extensions?: ReadonlyArray<NativeHarnessToolExtension> },
) {
  const workspaceContext = yield* WorkspaceContext.WorkspaceContext;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const hostPlatform = yield* HostProcessPlatform;
  const extensions = options?.extensions ?? [];

  const executeBuiltin = (input: NativeHarnessToolExecutionInput) =>
    Effect.gen(function* () {
      switch (input.name) {
        case NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL: {
          const args = yield* decodeWorkspaceContextArgs(input.args);
          const output = yield* workspaceContext.execute({ workspaceRoot: input.cwd, input: args });
          return {
            ok: true,
            itemType: "mcp_tool_call",
            title: "Workspace context",
            detail: `${output.queries.length} quer${output.queries.length === 1 ? "y" : "ies"}, ${output.reads.length} read${output.reads.length === 1 ? "" : "s"}`,
            output: output as unknown as Record<string, unknown>,
          } satisfies NativeHarnessToolResult;
        }
        case NATIVE_HARNESS_WRITE_FILE_TOOL: {
          const args = yield* decodeWriteFileArgs(input.args);
          if (!args.path.trim()) {
            return yield* new NativeHarnessToolError({ detail: "path must not be empty" });
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
            output: { path: result.relativePath, bytesWritten: Buffer.byteLength(args.contents) },
          } satisfies NativeHarnessToolResult;
        }
        case NATIVE_HARNESS_REPLACE_TEXT_TOOL: {
          const args = yield* decodeReplaceTextArgs(input.args);
          if (!args.path.trim()) {
            return yield* new NativeHarnessToolError({ detail: "path must not be empty" });
          }
          const current = yield* workspaceFileSystem.readFile({
            cwd: input.cwd,
            relativePath: args.path,
          });
          if (current.truncated) {
            return yield* new NativeHarnessToolError({
              detail: "The file exceeds T3's safe edit read limit; use a targeted command.",
            });
          }
          const patch = applyNativeHarnessExactPatch(current.contents, [
            {
              oldText: args.old_text,
              newText: args.new_text,
              replaceAll: args.replace_all === true,
            },
          ]);
          if (!patch.ok) {
            return yield* new NativeHarnessToolError({
              detail:
                patch.reason === "not-found"
                  ? "old_text was not found in the file"
                  : patch.reason === "empty-old-text"
                    ? "old_text must not be empty"
                    : `old_text occurs ${patch.occurrences} times; set replace_all or provide more context`,
            });
          }
          const result = yield* workspaceFileSystem.writeFile({
            cwd: input.cwd,
            relativePath: args.path,
            contents: patch.contents,
            ...(current.revision ? { expectedRevision: current.revision } : {}),
          });
          return {
            ok: true,
            itemType: "file_change",
            title: `Edit ${result.relativePath}`,
            detail: `${patch.replacements} replacement${patch.replacements === 1 ? "" : "s"}`,
            output: { path: result.relativePath, replacements: patch.replacements },
          } satisfies NativeHarnessToolResult;
        }
        case NATIVE_HARNESS_APPLY_PATCH_TOOL: {
          const args = yield* decodeApplyPatchArgs(input.args);
          if (!args.path.trim()) {
            return yield* new NativeHarnessToolError({ detail: "path must not be empty" });
          }
          const current = yield* workspaceFileSystem.readFile({
            cwd: input.cwd,
            relativePath: args.path,
          });
          if (current.truncated) {
            return yield* new NativeHarnessToolError({
              detail: "The file exceeds T3's safe patch read limit; use a targeted command.",
            });
          }
          const patch = applyNativeHarnessExactPatch(
            current.contents,
            args.hunks.map((hunk) => ({
              oldText: hunk.old_text,
              newText: hunk.new_text,
              replaceAll: hunk.replace_all === true,
            })),
          );
          if (!patch.ok) {
            return yield* new NativeHarnessToolError({
              detail: `Patch hunk ${patch.hunkIndex + 1} failed (${patch.reason}, ${patch.occurrences} matches). No changes were written.`,
            });
          }
          const result = yield* workspaceFileSystem.writeFile({
            cwd: input.cwd,
            relativePath: args.path,
            contents: patch.contents,
            ...(current.revision ? { expectedRevision: current.revision } : {}),
          });
          return {
            ok: true,
            itemType: "file_change",
            title: `Patch ${result.relativePath}`,
            detail: `${patch.replacements} replacement${patch.replacements === 1 ? "" : "s"}`,
            output: { path: result.relativePath, replacements: patch.replacements },
          } satisfies NativeHarnessToolResult;
        }
        case NATIVE_HARNESS_EXEC_COMMAND_TOOL: {
          const args = yield* decodeExecCommandArgs(input.args);
          const command = args.command.trim();
          if (!command) {
            return yield* new NativeHarnessToolError({ detail: "command must not be empty" });
          }
          const timeoutMs = Math.min(600_000, Math.max(1_000, args.timeout_ms ?? 60_000));
          const shell = shellInvocation(command, input.environment, hostPlatform);
          const result = yield* processRunner.run({
            command: shell.command,
            args: shell.args,
            cwd: input.cwd,
            env: nativeHarnessCommandEnvironment(input.environment),
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
        }
        default:
          return undefined;
      }
    });

  const execute: NativeHarnessToolExecutor["execute"] = (input) =>
    Effect.gen(function* () {
      const builtin = yield* executeBuiltin(input);
      if (builtin !== undefined) return enforceNativeHarnessToolResultLimit(builtin);
      for (const extension of extensions) {
        const result = yield* extension.execute(input);
        if (result !== undefined) return enforceNativeHarnessToolResultLimit(result);
      }
      return failedToolResult(
        input.name,
        new NativeHarnessToolError({ detail: `Unknown T3 harness tool '${input.name}'.` }),
      );
    }).pipe(
      Effect.catch((cause) => Effect.succeed(failedToolResult(input.name, cause))),
      Effect.map(enforceNativeHarnessToolResultLimit),
    );

  return { execute } satisfies NativeHarnessToolExecutor;
});
