import type { RetryThreadTurnInput } from "@t3tools/client-runtime/operations";
import type { InterruptedTurnRetryTarget } from "@t3tools/client-runtime/state/thread-retry";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { resolveFetchMode } from "@t3tools/shared/fetchMode";

type RetryThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "modelSelection">;

export function mobileInterruptedTurnRetrySupported(capabilities: {
  readonly interruptedTurnRetry?: boolean;
}): boolean {
  return capabilities.interruptedTurnRetry === true;
}

export function resolveMobileThreadRetryActionState(input: {
  readonly supported: boolean;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly target: InterruptedTurnRetryTarget | null;
}): { readonly visible: boolean; readonly available: boolean } {
  const visible = input.supported && input.target !== null;
  return { visible, available: visible && input.connected && !input.busy };
}

export function buildMobileThreadRetryCommand(input: {
  readonly thread: RetryThread;
  readonly target: InterruptedTurnRetryTarget;
  readonly fetchEnabled: boolean;
}): { readonly environmentId: EnvironmentId; readonly input: RetryThreadTurnInput } {
  const fetchMode = resolveFetchMode({ featureEnabled: input.fetchEnabled });
  return {
    environmentId: input.thread.environmentId,
    input: {
      threadId: input.thread.id,
      turnId: input.target.turnId,
      messageId: input.target.messageId,
      ...(fetchMode === undefined ? {} : { fetchMode }),
      modelSelection: input.thread.modelSelection,
    },
  };
}

export function mobileThreadRetryMessageKey(busy: boolean): InterfaceMessageKey {
  return busy ? "mobile.thread.retryingResponse" : "mobile.thread.retryResponse";
}
