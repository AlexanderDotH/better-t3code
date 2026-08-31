import type {
  MessageId,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationSession,
  TurnId,
} from "@t3tools/contracts";

export interface InterruptedTurnRetryTarget {
  readonly messageId: MessageId;
  readonly turnId: TurnId | null;
}

export function resolveInterruptedTurnRetryTarget(input: {
  readonly latestTurn: OrchestrationLatestTurn | null;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly session?: OrchestrationSession | null;
}): InterruptedTurnRetryTarget | null {
  const latestTurn = input.latestTurn;
  const latestUserMessage = input.messages.findLast(
    (message) => message.role === "user" && message.historyOrigin === undefined,
  );
  if (latestUserMessage === undefined || latestUserMessage.streaming) {
    return null;
  }

  if (
    latestTurn !== null &&
    latestTurn.state === "interrupted" &&
    latestTurn.assistantMessageId === null &&
    latestTurn.historyOrigin === undefined &&
    Date.parse(latestUserMessage.createdAt) <= Date.parse(latestTurn.requestedAt)
  ) {
    const hasAssistantOutput = input.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.turnId === latestTurn.turnId &&
        message.historyOrigin === undefined,
    );
    if (!hasAssistantOutput) {
      return {
        messageId: latestUserMessage.id,
        turnId: latestTurn.turnId,
      };
    }
  }

  const session = input.session;
  const latestLocalMessage = input.messages.findLast(
    (message) => message.historyOrigin === undefined,
  );
  const sessionBusy =
    session?.status === "starting" || session?.status === "running" || session?.abortState != null;
  if (
    session === undefined ||
    session === null ||
    sessionBusy ||
    session.activeTurnId !== null ||
    latestLocalMessage?.id !== latestUserMessage.id ||
    Date.parse(session.updatedAt) < Date.parse(latestUserMessage.createdAt) ||
    (latestTurn !== null &&
      Date.parse(latestTurn.requestedAt) >= Date.parse(latestUserMessage.createdAt))
  ) {
    return null;
  }

  return {
    messageId: latestUserMessage.id,
    turnId: null,
  };
}
