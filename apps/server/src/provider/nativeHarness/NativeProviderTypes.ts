import type {
  CanonicalItemType,
  CanonicalRequestType,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderInteractionMode,
  ProviderSandboxMode,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ProviderAdapterRequestError, ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterCapabilities } from "../Services/ProviderAdapter.ts";

export interface NativeProviderTurnRecord {
  readonly id: TurnId;
  readonly historyStart: number;
  readonly historyEnd: number;
  readonly items: Array<unknown>;
}

export interface NativeProviderPersistedHistory<HistoryItem> {
  readonly history: Array<HistoryItem>;
  readonly turns: Array<NativeProviderTurnRecord>;
  readonly totalProcessedTokens: number;
}

export interface NativeProviderHistoryStrategy<HistoryItem> {
  readonly directoryName: string;
  readonly resumeVersion: number;
  readonly encode: (
    input: NativeProviderPersistedHistory<HistoryItem> & { readonly sessionId: string },
  ) => string;
  readonly decode: (
    encoded: string,
    sessionId: string,
  ) => Effect.Effect<NativeProviderPersistedHistory<HistoryItem>, ProviderAdapterRequestError>;
  readonly isSessionId?: ((sessionId: string) => boolean) | undefined;
  readonly estimateBytes?: ((history: ReadonlyArray<HistoryItem>) => number) | undefined;
}

export interface NativeProviderUsage {
  readonly usedTokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly raw?: unknown;
  readonly modelUsage?: Readonly<Record<string, unknown>>;
  readonly totalCostUsd?: number;
}

export interface NativeProviderToolCall<Metadata = unknown> {
  readonly sourceId?: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly metadata: Metadata;
}

export interface NativeProviderToolResult {
  readonly ok: boolean;
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly detail: string;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface NativeProviderExecutedToolCall<ToolCall extends NativeProviderToolCall> {
  readonly call: ToolCall;
  readonly result: NativeProviderToolResult;
}

export interface NativeProviderToolHarness<ToolCall extends NativeProviderToolCall> {
  readonly isAvailable: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly toolName: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<boolean, ProviderAdapterRequestError>;
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
    readonly fetchWorker: boolean;
  }) => Effect.Effect<NativeProviderToolResult, ProviderAdapterRequestError>;
  readonly eventData?: ((call: ToolCall) => Readonly<Record<string, unknown>>) | undefined;
  readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
}

export type NativeProviderRoundEvent<HistoryItem, ToolCall extends NativeProviderToolCall> =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly sourceId?: string;
      readonly delta: string;
    }
  | {
      readonly type: "completed";
      readonly historyItems: ReadonlyArray<HistoryItem>;
      readonly toolCalls: ReadonlyArray<ToolCall>;
      readonly assistantText?: string;
      readonly reasoningText?: string;
      readonly usage?: NativeProviderUsage;
      readonly stopReason?: string | null;
    }
  | { readonly type: "failed"; readonly message: string };

export interface NativeProviderSessionView<HistoryItem, SessionState> {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
  readonly session: ProviderSession;
  readonly history: ReadonlyArray<HistoryItem>;
  readonly state: SessionState;
}

export interface NativeProviderStartResult<SessionState> {
  readonly model: string;
  readonly state: SessionState;
  readonly configured: Readonly<Record<string, unknown>>;
}

export type NativeProviderAttachment = NonNullable<ProviderSendTurnInput["attachments"]>[number];

export interface NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState> {
  readonly model: string;
  readonly userHistoryItems: ReadonlyArray<HistoryItem>;
  readonly persistedUserHistoryItems?: ReadonlyArray<HistoryItem>;
  readonly attachmentBytes: number;
  readonly toolDeclarations: ReadonlyArray<ToolDefinition>;
  readonly protocol: ProtocolState;
}

export interface NativeProviderBeforeRoundResult<HistoryItem> {
  readonly replacementHistory?: ReadonlyArray<HistoryItem>;
  readonly resetTurnHistoryStart?: boolean;
}

export interface NativeProviderTurnAdmission {
  readonly withLease: <A, R>(
    input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly providerInstanceId: ProviderInstanceId;
      readonly serializedHistoryBytes: number;
      readonly attachmentBytes: number;
      readonly toolBufferBytes: number;
    },
    effect: Effect.Effect<A, ProviderAdapterRequestError, R>,
  ) => Effect.Effect<A, ProviderAdapterRequestError, R>;
}

export interface NativeProviderMcpSessionConfig {
  readonly resolveServers?:
    | ((input: {
        readonly cwd: string;
      }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, ProviderAdapterRequestError>)
    | undefined;
  readonly includeT3BuiltIn?: boolean | undefined;
}

export interface NativeProviderAdapterDefinition<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
> {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly messages: {
    readonly sessionStarted: string;
    readonly sessionReady: string;
    readonly turnRunning: string;
    readonly turnSettled: string;
  };
  readonly limits: {
    readonly maxSessions?: number;
    readonly maxIdleWorkingSets?: number;
    readonly maxToolDefinitions: number;
    readonly maxToolOutputBytes: number;
    readonly maxToolRounds: number;
    readonly maxParallelToolCalls: number;
  };
  readonly history: NativeProviderHistoryStrategy<HistoryItem>;
  readonly start: (input: {
    readonly input: ProviderSessionStartInput;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<NativeProviderStartResult<SessionState>, ProviderAdapterError>;
  readonly prepareTurn: (input: {
    readonly input: ProviderSendTurnInput;
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly readAttachment: (
      attachment: NativeProviderAttachment,
    ) => Effect.Effect<Uint8Array, ProviderAdapterRequestError>;
  }) => Effect.Effect<
    NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>,
    ProviderAdapterError
  >;
  readonly beforeRound?:
    | ((input: {
        readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
        readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
      }) => Effect.Effect<
        NativeProviderBeforeRoundResult<HistoryItem> | void,
        ProviderAdapterRequestError
      >)
    | undefined;
  readonly streamRound: (input: {
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
    readonly turnId: TurnId;
    readonly signal: AbortSignal;
  }) => Stream.Stream<NativeProviderRoundEvent<HistoryItem, ToolCall>, ProviderAdapterRequestError>;
  readonly toolHarness: NativeProviderToolHarness<ToolCall>;
  readonly toolResultsToHistoryItems: (input: {
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
    readonly results: ReadonlyArray<NativeProviderExecutedToolCall<ToolCall>>;
  }) => ReadonlyArray<HistoryItem>;
  readonly admission?: NativeProviderTurnAdmission | undefined;
  readonly onWorkingSetEvicted?: ((threadId: ThreadId) => void) | undefined;
  readonly mcp?: NativeProviderMcpSessionConfig | undefined;
}
