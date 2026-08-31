import type {
  McpServerDefinition,
  ProviderInstanceId,
  ProviderInteractionMode,
  ProviderSandboxMode,
  ThreadId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { NativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import type { NativeProviderTurnAdmission } from "../nativeHarness/NativeProviderTypes.ts";
import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import type { OpenAiReasoningEffort } from "./OpenAiProtocol.ts";
import type { OpenAiTransport } from "./OpenAiTransport.ts";

export interface OpenAiAdapterSettings {
  readonly enabled: boolean;
}

export interface OpenAiAdapterDependencyError {
  readonly detail?: string;
  readonly message?: string;
}

export interface OpenAiAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly transport: OpenAiTransport;
  readonly harness: NativeProviderHarness;
  readonly admission?: NativeProviderTurnAdmission;
  readonly onWorkingSetEvicted?: (threadId: ThreadId) => void;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, OpenAiAdapterDependencyError>;
}

export interface OpenAiSessionState {
  readonly initialCatalog: ReadonlyArray<OpenAiCatalogModel>;
}

export interface OpenAiProtocolState {
  readonly instructions: string;
  readonly reasoningEffort?: OpenAiReasoningEffort;
}

export interface OpenAiSystemInstructionInput {
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly fetchWorker: boolean;
}
