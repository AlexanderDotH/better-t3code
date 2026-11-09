import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  type EnvironmentId,
  type MessageId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import type { ChatComposerHandle } from "./ChatComposer";
import { getClientSettings } from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "../../lib/utils";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { draftSendState } from "./chatViewSend";
import { composerFetchMode } from "./composerSendPreparation";

type RetrySendContext = Pick<
  ReturnType<ChatComposerHandle["getSendContext"]>,
  "providerAvailable" | "selectedModelSelection" | "composerMode"
>;

export function useRetryUserMessage(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly target: { readonly messageId: MessageId; readonly runId: RunId | null } | null;
  readonly originalText: string;
  readonly supported: boolean;
  readonly supportsAgentWorkflow: boolean;
  readonly blocked: boolean;
  readonly composerRef: { readonly current: { getSendContext: () => RetrySendContext } | null };
  readonly setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  readonly scrollToEnd: (immediate?: boolean) => void;
}) {
  const retryTurn = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const permitted = useAtomValue(threadEnvironment.retryTurn.permissionAtom(input.environmentId));
  const [pendingThreads, setPendingThreads] = useState<ReadonlySet<string>>(() => new Set());
  const pending = pendingThreads.has(input.routeThreadKey);
  const available = input.supported && permitted && !input.blocked && !pending;

  const onRetry = useStableCallback(async (messageId: MessageId) => {
    const target = input.target;
    const sendLock = draftSendState(input.routeThreadKey).sendInFlight;
    if (!available || target?.messageId !== messageId || sendLock.current) return;
    const context = input.composerRef.current?.getSendContext();
    if (!context?.providerAvailable) {
      input.setThreadError(input.threadId, "Choose an available provider before retrying.");
      return;
    }
    const { environmentId, threadId, routeThreadKey } = input;
    sendLock.current = true;
    setPendingThreads((current) => new Set(current).add(routeThreadKey));
    input.setThreadError(threadId, null);
    const result = await retryTurn({
      environmentId,
      input: {
        type: "message.retry",
        commandId: CommandId.make(randomUUID()),
        threadId,
        messageId,
        runId: target.runId,
        modelSelection: context.selectedModelSelection,
        fetchMode:
          composerFetchMode({
            prompt: input.originalText,
            composerMode: context.composerMode,
            preferences: getClientSettings(),
            supportsAgentWorkflow: input.supportsAgentWorkflow,
          }) ?? null,
      },
    });
    sendLock.current = false;
    setPendingThreads((current) => {
      const remaining = new Set(current);
      remaining.delete(routeThreadKey);
      return remaining;
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      input.setThreadError(
        threadId,
        error instanceof Error ? error.message : "Could not retry response.",
      );
    } else if (input.currentRouteThreadKeyRef.current === routeThreadKey) {
      input.scrollToEnd(true);
    }
  });

  return input.supported && input.target
    ? { messageId: input.target.messageId, available, pending, onRetry }
    : null;
}
