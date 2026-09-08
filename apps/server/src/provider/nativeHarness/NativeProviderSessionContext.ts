import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSandboxMode,
  type ProviderSession,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Semaphore from "effect/Semaphore";

import type { ProviderAdapterRequestError } from "../Errors.ts";
import type { NativeProviderSessionView, NativeProviderTurnRecord } from "./NativeProviderTypes.ts";

export interface NativeProviderPendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly toolName: string;
}

export interface NativeProviderSessionContext<HistoryItem, SessionState> {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
  readonly emitRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly pendingApprovals: Map<ApprovalRequestId, NativeProviderPendingApproval>;
  readonly approvedForSession: Set<string>;
  readonly turnSemaphore: Semaphore.Semaphore;
  readonly history: Array<HistoryItem>;
  readonly turns: Array<NativeProviderTurnRecord>;
  readonly state: SessionState;
  session: ProviderSession;
  activeAbortController: AbortController | undefined;
  activeInterrupt: Deferred.Deferred<void> | undefined;
  activeTerminal:
    | ((
        state: "completed" | "failed" | "interrupted",
        message?: string,
      ) => Effect.Effect<void, ProviderAdapterRequestError>)
    | undefined;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
  workingSetLoaded: boolean;
  lastWorkingSetUse: number;
  totalProcessedTokens: number;
}

export function toNativeProviderSessionView<HistoryItem, SessionState>(
  context: NativeProviderSessionContext<HistoryItem, SessionState>,
): NativeProviderSessionView<HistoryItem, SessionState> {
  return {
    threadId: context.threadId,
    sessionId: context.sessionId,
    cwd: context.cwd,
    sandboxMode: context.sandboxMode,
    fetchWorker: context.fetchWorker,
    session: context.session,
    history: context.history,
    state: context.state,
  };
}

export const settleNativeProviderApprovalsAsCancelled = <HistoryItem, SessionState>(
  context: NativeProviderSessionContext<HistoryItem, SessionState>,
) =>
  Effect.forEach(
    context.pendingApprovals.values(),
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    { discard: true },
  );
