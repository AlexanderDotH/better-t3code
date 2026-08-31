import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveInterruptedTurnRetryTarget } from "@t3tools/client-runtime/state/thread-retry";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MessageId, OrchestrationMessage } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildMobileThreadRetryCommand, resolveMobileThreadRetryActionState } from "./thread-retry";

export function useThreadRetryAction(input: {
  readonly thread: EnvironmentThreadShell | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly supported: boolean;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly fetchEnabled: boolean;
}) {
  const retryThreadTurn = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const [pendingMessageId, setPendingMessageId] = useState<MessageId | null>(null);
  const dispatchInFlightRef = useRef(false);
  const target = useMemo(
    () =>
      input.thread === null
        ? null
        : resolveInterruptedTurnRetryTarget({
            latestTurn: input.thread.latestTurn,
            messages: input.messages,
            session: input.thread.session,
          }),
    [input.messages, input.thread],
  );
  const { visible, available } = resolveMobileThreadRetryActionState({
    supported: input.supported,
    connected: input.connected,
    busy: input.busy,
    target,
  });

  const onRetry = useCallback(
    async (messageId: MessageId) => {
      if (
        !available ||
        input.thread === null ||
        target === null ||
        target.messageId !== messageId ||
        dispatchInFlightRef.current
      ) {
        return;
      }

      dispatchInFlightRef.current = true;
      setPendingMessageId(target.messageId);
      try {
        const result = await retryThreadTurn(
          buildMobileThreadRetryCommand({
            thread: input.thread,
            target,
            fetchEnabled: input.fetchEnabled,
          }),
        );
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            Alert.alert(
              "Could not retry response",
              error instanceof Error ? error.message : "The response could not be retried.",
            );
          }
          return;
        }
        void Haptics.selectionAsync().catch(() => undefined);
      } finally {
        dispatchInFlightRef.current = false;
        setPendingMessageId(null);
      }
    },
    [available, input.fetchEnabled, input.thread, retryThreadTurn, target],
  );

  return {
    retryAction:
      !visible || target === null
        ? null
        : {
            available,
            messageId: target.messageId,
            pending: pendingMessageId === target.messageId,
            onRetry,
          },
  } as const;
}
