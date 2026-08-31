import { WorkspaceContextInput, WorkspaceEditInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  NATIVE_HARNESS_EXEC_COMMAND_TOOL,
  NATIVE_HARNESS_MAX_TOOL_DEFINITIONS,
  NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  NativeHarnessToolPolicyError,
  type NativeHarnessToolAvailabilityInput,
  type NativeHarnessToolDeclaration,
  type NativeHarnessToolExtension,
} from "./NativeHarnessToolTypes.ts";

const OBJECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
} as const;

const WORKSPACE_CONTEXT_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL,
  description:
    "Search paths or text and read bounded line ranges inside the current workspace. Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers.",
  inputSchema: Schema.toJsonSchemaDocument(WorkspaceContextInput).schema,
  availability: "read-only",
};

const WORKSPACE_EDIT_DECLARATION: NativeHarnessToolDeclaration = {
  name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  description:
    "Create, replace, splice, or delete one or more regular UTF-8 workspace files in one revision-safe batch.",
  inputSchema: Schema.toJsonSchemaDocument(WorkspaceEditInput).schema,
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
  WORKSPACE_EDIT_DECLARATION,
  EXEC_COMMAND_DECLARATION,
] as const;

const declarationIsAvailable = (
  declaration: NativeHarnessToolDeclaration,
  input: NativeHarnessToolAvailabilityInput,
): boolean => {
  if (declaration.availability === "read-only") return true;
  if (input.interactionMode === "plan" || input.sandboxMode === "read-only") return false;
  if (declaration.availability === "default-only") return true;
  if (declaration.availability === "workspace-write") return true;
  return input.sandboxMode !== "workspace-write";
};

export function nativeHarnessToolDeclarations(
  input: NativeHarnessToolAvailabilityInput,
): ReadonlyArray<NativeHarnessToolDeclaration> {
  return BUILTIN_DECLARATIONS.filter((declaration) => declarationIsAvailable(declaration, input));
}

export const buildNativeHarnessToolCatalog = Effect.fn("buildNativeHarnessToolCatalog")(function* (
  input: NativeHarnessToolAvailabilityInput & {
    readonly extensions?: ReadonlyArray<NativeHarnessToolExtension>;
  },
) {
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
});

export function nativeHarnessToolIsAvailable(
  input: NativeHarnessToolAvailabilityInput & {
    readonly toolName: string;
    readonly extensions?: ReadonlyArray<NativeHarnessToolExtension>;
  },
): boolean {
  return [
    ...nativeHarnessToolDeclarations(input),
    ...(input.extensions ?? []).flatMap((extension) =>
      extension.declarations.filter((declaration) => declarationIsAvailable(declaration, input)),
    ),
  ].some((declaration) => declaration.name === input.toolName);
}

const ExecCommandArgs = Schema.Struct({
  command: Schema.String,
  timeout_ms: Schema.optionalKey(Schema.Number),
});

export const decodeWorkspaceContextArgs = Schema.decodeUnknownEffect(WorkspaceContextInput);
export const decodeWorkspaceEditArgs = Schema.decodeUnknownEffect(WorkspaceEditInput);
export const decodeExecCommandArgs = Schema.decodeUnknownEffect(ExecCommandArgs);
