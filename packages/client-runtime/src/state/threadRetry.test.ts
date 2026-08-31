import { MessageId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveInterruptedTurnRetryTarget } from "./threadRetry.ts";

const REQUESTED_AT = "2026-08-26T10:00:00.000Z";
const TURN_ID = TurnId.make("turn-interrupted");
const MESSAGE_ID = MessageId.make("message-user");

const interruptedTurn = {
  turnId: TURN_ID,
  state: "interrupted" as const,
  requestedAt: REQUESTED_AT,
  startedAt: REQUESTED_AT,
  completedAt: "2026-08-26T10:00:10.000Z",
  assistantMessageId: null,
};

const userMessage = {
  id: MESSAGE_ID,
  role: "user" as const,
  text: "Try this",
  turnId: null,
  streaming: false,
  createdAt: REQUESTED_AT,
  updatedAt: REQUESTED_AT,
};

const readySession = {
  threadId: ThreadId.make("thread-retry"),
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeSessionId: null,
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  abortState: null,
  lastError: null,
  updatedAt: "2026-08-26T10:00:10.000Z",
};

describe("resolveInterruptedTurnRetryTarget", () => {
  it("targets the last user message when its interrupted turn returned no assistant result", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: interruptedTurn,
        messages: [userMessage],
      }),
    ).toEqual({ messageId: MESSAGE_ID, turnId: TURN_ID });
  });

  it("targets a result-less user message aborted before the provider assigned a turn id", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: {
          ...interruptedTurn,
          requestedAt: "2026-08-26T09:55:00.000Z",
          startedAt: "2026-08-26T09:55:00.000Z",
          completedAt: "2026-08-26T09:56:00.000Z",
          assistantMessageId: MessageId.make("previous-assistant"),
        },
        messages: [userMessage],
        session: readySession,
      }),
    ).toEqual({ messageId: MESSAGE_ID, turnId: null });
  });

  it("does not expose an early retry while the provider start is still pending", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: null,
        messages: [userMessage],
        session: {
          ...readySession,
          status: "starting",
          updatedAt: REQUESTED_AT,
        },
      }),
    ).toBeNull();
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: null,
        messages: [userMessage],
        session: {
          ...readySession,
          updatedAt: "2026-08-26T09:59:59.000Z",
        },
      }),
    ).toBeNull();
  });

  it("does not target a turn that produced even a partial assistant message", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: interruptedTurn,
        messages: [
          userMessage,
          {
            ...userMessage,
            id: MessageId.make("message-assistant"),
            role: "assistant",
            turnId: TURN_ID,
            streaming: true,
          },
        ],
      }),
    ).toBeNull();
  });

  it("does not attach the retry to a newer queued user message", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: interruptedTurn,
        messages: [
          userMessage,
          {
            ...userMessage,
            id: MessageId.make("message-newer"),
            createdAt: "2026-08-26T10:01:00.000Z",
            updatedAt: "2026-08-26T10:01:00.000Z",
          },
        ],
      }),
    ).toBeNull();
  });

  it("allows another retry when a later result-only attempt is also interrupted", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: {
          ...interruptedTurn,
          turnId: TurnId.make("turn-retry-interrupted"),
          requestedAt: "2026-08-26T10:02:00.000Z",
          startedAt: "2026-08-26T10:02:00.000Z",
          completedAt: "2026-08-26T10:02:10.000Z",
        },
        messages: [userMessage],
      }),
    ).toEqual({
      messageId: MESSAGE_ID,
      turnId: TurnId.make("turn-retry-interrupted"),
    });
  });

  it("does not mutate inherited history or turns with an assistant result", () => {
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: { ...interruptedTurn, assistantMessageId: MessageId.make("assistant-result") },
        messages: [userMessage],
      }),
    ).toBeNull();
    expect(
      resolveInterruptedTurnRetryTarget({
        latestTurn: interruptedTurn,
        messages: [
          {
            ...userMessage,
            historyOrigin: {
              sourceThreadId: ThreadId.make("source-thread"),
              sourceId: "source-message",
              ordinal: 1,
            },
          },
        ],
      }),
    ).toBeNull();
  });
});
