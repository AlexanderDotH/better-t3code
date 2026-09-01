import type {
  CanonicalItemType,
  ProviderInteractionMode,
  ProviderSandboxMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const NATIVE_HARNESS_MAX_TOOL_DEFINITIONS = 90;
export const NATIVE_HARNESS_MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;
export const NATIVE_HARNESS_MAX_TOOL_ROUNDS = 64;

export const NATIVE_HARNESS_WORKSPACE_FIND_TOOL = "workspace_find";
export const NATIVE_HARNESS_WORKSPACE_READ_TOOL = "workspace_read";
export const NATIVE_HARNESS_WORKSPACE_CONTEXT_TOOL = "workspace_context";
export const NATIVE_HARNESS_WORKSPACE_EDIT_TOOL = "workspace_edit";
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

export interface NativeHarnessToolAvailabilityInput {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
}

export class NativeHarnessToolPolicyError extends Schema.TaggedErrorClass<NativeHarnessToolPolicyError>()(
  "NativeHarnessToolPolicyError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class NativeHarnessToolError extends Schema.TaggedErrorClass<NativeHarnessToolError>()(
  "NativeHarnessToolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
