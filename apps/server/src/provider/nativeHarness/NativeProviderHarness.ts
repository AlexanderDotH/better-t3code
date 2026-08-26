import type {
  CanonicalRequestType,
  ProviderInteractionMode,
  ProviderSandboxMode,
  ProviderSession,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import type { NativeProviderToolResult } from "./NativeProviderAdapter.ts";
import {
  buildNativeHarnessToolCatalog,
  makeNativeHarnessToolExecutor,
  nativeHarnessToolApprovalDetail,
  nativeHarnessToolIsAvailable,
  nativeHarnessToolRequestType,
  nativeHarnessToolRequiresApproval,
  NativeHarnessToolPolicyError,
  type NativeHarnessToolExtension,
} from "./NativeHarnessTools.ts";

export interface NativeProviderHarnessToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface NativeProviderHarness {
  readonly declarations: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
  }) => Effect.Effect<
    ReadonlyArray<NativeProviderHarnessToolDefinition>,
    NativeHarnessToolPolicyError
  >;
  readonly isAvailable: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly toolName: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
  }) => Effect.Effect<boolean, NativeHarnessToolPolicyError>;
  readonly requiresApproval: (
    toolName: string,
    runtimeMode: ProviderSession["runtimeMode"],
  ) => boolean;
  readonly requestType: (toolName: string) => CanonicalRequestType;
  readonly approvalDetail: (toolName: string, args: Readonly<Record<string, unknown>>) => string;
  readonly execute: (input: {
    readonly threadId: ThreadId;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
  }) => Effect.Effect<NativeProviderToolResult, NativeHarnessToolPolicyError>;
  readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
}

/**
 * Builds the provider-neutral direct-tool surface used by native API
 * providers. Drivers can attach scoped extensions such as T3's internal MCP
 * coordination tools and configured user MCP servers.
 */
export const makeNativeProviderHarness = Effect.fn("makeNativeProviderHarness")(function* (
  processRunner: ProcessRunner["Service"],
  options?: {
    readonly extensionForThread?:
      | ((input: {
          readonly threadId: ThreadId;
          readonly cwd: string;
        }) => Effect.Effect<NativeHarnessToolExtension, NativeHarnessToolPolicyError>)
      | undefined;
    readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
  },
) {
  const executor = yield* makeNativeHarnessToolExecutor(processRunner);
  const extensionApprovalByToolName = new Map<string, boolean>();
  const extensionsForThread = (threadId: ThreadId, cwd: string) =>
    options?.extensionForThread
      ? options.extensionForThread({ threadId, cwd }).pipe(
          Effect.tap((extension) =>
            Effect.sync(() => {
              for (const declaration of extension.declarations) {
                if (declaration.requiresApproval !== undefined) {
                  extensionApprovalByToolName.set(declaration.name, declaration.requiresApproval);
                }
              }
            }),
          ),
          Effect.map((extension): ReadonlyArray<NativeHarnessToolExtension> => [extension]),
        )
      : Effect.succeed<ReadonlyArray<NativeHarnessToolExtension>>([]);

  return {
    declarations: (input) =>
      Effect.gen(function* () {
        const extensions = yield* extensionsForThread(input.threadId, input.cwd);
        const declarations = yield* buildNativeHarnessToolCatalog({ ...input, extensions });
        return declarations.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        }));
      }),
    isAvailable: (input) =>
      extensionsForThread(input.threadId, input.cwd).pipe(
        Effect.map((extensions) => nativeHarnessToolIsAvailable({ ...input, extensions })),
      ),
    requiresApproval: (toolName, runtimeMode) => {
      const extensionRequiresApproval = extensionApprovalByToolName.get(toolName);
      return extensionRequiresApproval === undefined
        ? nativeHarnessToolRequiresApproval(toolName, runtimeMode)
        : extensionRequiresApproval && runtimeMode !== "full-access";
    },
    requestType: nativeHarnessToolRequestType,
    approvalDetail: nativeHarnessToolApprovalDetail,
    execute: ({ threadId, ...input }) =>
      Effect.gen(function* () {
        const extensions = yield* extensionsForThread(threadId, input.cwd);
        const extension = extensions.find((candidate) =>
          candidate.declarations.some((declaration) => declaration.name === input.name),
        );
        if (!extension) return yield* executor.execute(input);
        const result = yield* extension.execute(input);
        return result ?? (yield* executor.execute(input));
      }),
    ...(options?.releaseThread ? { releaseThread: options.releaseThread } : {}),
  } satisfies NativeProviderHarness;
});
