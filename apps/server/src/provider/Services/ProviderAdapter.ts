/**
 * ProviderAdapter - Provider-specific runtime adapter contract.
 *
 * Defines the provider-native session/protocol operations that `ProviderService`
 * routes to after resolving the target provider. Implementations should focus
 * on provider behavior only and avoid cross-provider orchestration concerns.
 *
 * @module ProviderAdapter
 */
import type {
  ApprovalRequestId,
  McpLiveApplyOutcome,
  McpRuntimeAction,
  McpRuntimeActionResult,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  McpRuntimeServerKey,
  ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderUserInputAnswers,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  RuntimeSessionId,
  ThreadId,
  ProviderTurnStartResult,
  TurnId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export type ProviderSessionModelSwitchMode = "in-session" | "unsupported";
export type ProviderMcpSupportMode = "unsupported" | "sessionConfig" | "nativeConfig";

export type ProviderForceStopMechanism =
  | "process-tree"
  | "runtime-close"
  | "remote-cancel"
  | "local-detach"
  | "already-stopped";

export type ProviderForceStopResult =
  | {
      readonly outcome: "terminated";
      readonly mechanism: Exclude<ProviderForceStopMechanism, "local-detach">;
      readonly detail?: string;
    }
  | {
      readonly outcome: "detached";
      readonly mechanism: "local-detach";
      readonly detail: string;
    };

export interface ProviderAdapterCapabilities {
  /**
   * Declares whether changing the model on an existing session is supported.
   */
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  /**
   * Declares how this adapter consumes T3-owned MCP server settings.
   */
  readonly mcp: ProviderMcpSupportMode;
}

/** Exact provider runtime selected for an MCP inspection or mutation. */
export interface ProviderMcpRuntimeTarget {
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
}

export interface ProviderMcpRuntimeServerTarget extends ProviderMcpRuntimeTarget {
  readonly providerKey: McpRuntimeServerKey;
}

export interface ProviderMcpRuntimeActionInput extends ProviderMcpRuntimeServerTarget {
  readonly action: McpRuntimeAction;
}

export type ProviderMcpRuntimeApplyOutcome = Exclude<McpLiveApplyOutcome, "failed">;

/**
 * Optional provider-native MCP inspection boundary.
 *
 * Adapters resolve credentials and native configuration internally. Keeping
 * those values out of this interface prevents runtime status responses from
 * accidentally carrying secrets across the WebSocket boundary.
 */
export interface ProviderMcpRuntimeAdapter<TError> {
  readonly getSnapshot: (
    input: ProviderMcpRuntimeTarget,
  ) => Effect.Effect<ReadonlyArray<McpRuntimeServer>, TError>;
  readonly getServerDetails?: (
    input: ProviderMcpRuntimeServerTarget,
  ) => Effect.Effect<McpRuntimeServerDetailsResult, TError>;
  readonly runAction?: (
    input: ProviderMcpRuntimeActionInput,
  ) => Effect.Effect<McpRuntimeActionResult, TError>;
  /** Re-resolve T3-owned MCP settings inside the adapter's active session. */
  readonly applyConfiguration?: (
    input: ProviderMcpRuntimeTarget,
  ) => Effect.Effect<void | ProviderMcpRuntimeApplyOutcome, TError>;
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
}

export interface ProviderAdapterShape<TError> {
  /**
   * Provider kind implemented by this adapter.
   */
  readonly provider: ProviderDriverKind;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly mcpRuntime?: ProviderMcpRuntimeAdapter<TError>;

  /**
   * Start a provider-backed session.
   */
  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  /**
   * Send a turn to an active provider session.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /**
   * Interrupt an active turn.
   */
  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
    expectedRuntimeSessionId?: RuntimeSessionId,
  ) => Effect.Effect<void, TError>;

  /**
   * Immediately tear down the exact provider runtime owned by this adapter.
   * Implementations must fence the operation by runtime session id so a stale
   * watchdog cannot stop a replacement session for the same thread.
   */
  readonly forceStopSession: (
    threadId: ThreadId,
    expectedRuntimeSessionId: RuntimeSessionId,
  ) => Effect.Effect<ProviderForceStopResult, TError>;

  /**
   * Respond to an interactive approval request.
   */
  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  /**
   * Respond to a structured user-input request.
   */
  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  /**
   * Stop one provider session.
   */
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /**
   * List currently active provider sessions for this adapter.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Check whether this adapter owns an active session id.
   */
  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  /**
   * Read a provider thread snapshot.
   */
  readonly readThread: (threadId: ThreadId) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Roll back a provider thread by N turns.
   */
  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Stop all sessions owned by this adapter.
   */
  readonly stopAll: () => Effect.Effect<void, TError>;

  /**
   * Canonical runtime event stream emitted by this adapter.
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}
