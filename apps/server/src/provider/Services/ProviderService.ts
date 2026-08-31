/**
 * ProviderService - Service interface for provider sessions, turns, and checkpoints.
 *
 * Acts as the cross-provider facade used by transports (WebSocket/RPC). It
 * resolves provider adapters through `ProviderAdapterRegistry`, routes
 * session-scoped calls via `ProviderSessionDirectory`, and exposes one unified
 * provider event stream to callers.
 *
 * Uses Effect `Context.Service` for dependency injection and returns typed
 * domain errors for validation, session, codex, and checkpoint workflows.
 *
 * @module ProviderService
 */
import type {
  ProviderInterruptTurnInput,
  ProviderInstanceId,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  RuntimeSessionId,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
  ThreadId,
  TurnId,
  ProviderTurnStartResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { ProviderServiceError } from "../Errors.ts";
import type { ProviderAdapterCapabilities, ProviderForceStopResult } from "./ProviderAdapter.ts";
import type { ProviderNativeThreadForkInput } from "./ProviderAdapter.ts";
import type { ProviderInstanceRoutingInfo } from "./ProviderAdapterRegistry.ts";

export interface ProviderAbortTarget {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly turnId: TurnId | null;
  readonly providerInstanceId: ProviderInstanceId;
}

/** Exact in-memory provider runtime owned by a transient T3 workflow. */
export interface ProviderTransientSessionTarget {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly providerInstanceId: ProviderInstanceId;
}

export interface ProviderTransientSessionOptions {
  /**
   * Durable parent thread whose authenticated workspace may be exposed to the
   * transient worker. The provider runtime itself remains keyed by the
   * synthetic transient thread id.
   */
  readonly workspaceContextThreadId?: ThreadId;
  /**
   * MCP surface mounted into the transient runtime. Existing callers that
   * provide workspaceContextThreadId without this option retain the constrained
   * workspace-only Fetch profile.
   */
  readonly mcpMode?: "none" | "workspace-only" | "full";
}

/**
 * ProviderServiceShape - Service API for provider session and turn orchestration.
 */
export interface ProviderServiceShape {
  /**
   * Start a provider session.
   */
  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /** Fork a provider-native conversation into a new durable T3 session. */
  readonly forkSession: (
    input: ProviderNativeThreadForkInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /**
   * Start a fresh provider runtime without creating a durable session binding.
   * Callers reserve the runtime id before startup so early events can be
   * generation-fenced by the transient workflow that owns them.
   */
  readonly startTransientSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
    options?: ProviderTransientSessionOptions,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /**
   * Send a provider turn.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  /** Request provider-native compaction for an active thread. */
  readonly compactThread: (
    threadId: ThreadId,
    expectedRuntimeSessionId?: RuntimeSessionId,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Interrupt a running provider turn.
   */
  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly resolveAbortTarget: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<ProviderAbortTarget, ProviderServiceError>;

  readonly interruptAbortTarget: (
    target: ProviderAbortTarget,
  ) => Effect.Effect<void, ProviderServiceError>;

  readonly forceStopAbortTarget: (
    target: ProviderAbortTarget,
  ) => Effect.Effect<ProviderForceStopResult, ProviderServiceError>;

  readonly isAbortTargetCurrent: (target: ProviderAbortTarget) => Effect.Effect<boolean>;

  /**
   * Respond to a provider approval request.
   */
  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider structured user-input request.
   */
  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop a provider session.
   */
  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /** Gracefully stop one exact transient runtime and remove its in-memory binding. */
  readonly stopTransientSession: (
    target: ProviderTransientSessionTarget,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * List active provider sessions.
   *
   * Aggregates runtime session lists from all registered adapters.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Read capabilities for the adapter bound to a configured provider instance.
   */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly getInstanceInfo: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRoutingInfo, ProviderServiceError>;

  /**
   * Roll back provider conversation state by a number of turns.
   */
  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Upload a thread and return the provider's shareable feedback identifier.
   */
  readonly uploadFeedback: (
    input: ProviderUploadFeedbackInput,
  ) => Effect.Effect<ProviderUploadFeedbackResult, ProviderServiceError>;

  /**
   * Canonical provider runtime event stream.
   *
   * Fan-out is owned by ProviderService (not by a standalone event-bus service).
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/**
 * ProviderService - Service tag for provider orchestration.
 */
export class ProviderService extends Context.Service<ProviderService, ProviderServiceShape>()(
  "t3/provider/Services/ProviderService",
) {}
