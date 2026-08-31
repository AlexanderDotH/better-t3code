import { EnvironmentId, MessageId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMobileThreadRetryCommand,
  mobileInterruptedTurnRetrySupported,
  mobileThreadRetryMessageKey,
  resolveMobileThreadRetryActionState,
} from "./thread-retry";

const target = {
  messageId: MessageId.make("message-user"),
  turnId: TurnId.make("turn-interrupted"),
};

describe("mobile interrupted-turn retry", () => {
  it("treats only the explicit server capability as supported", () => {
    expect(mobileInterruptedTurnRetrySupported({})).toBe(false);
    expect(mobileInterruptedTurnRetrySupported({ interruptedTurnRetry: false })).toBe(false);
    expect(mobileInterruptedTurnRetrySupported({ interruptedTurnRetry: true })).toBe(true);
  });

  it("gates presentation on capability, target, connectivity, and busy state", () => {
    expect(
      resolveMobileThreadRetryActionState({
        supported: false,
        connected: true,
        busy: false,
        target,
      }),
    ).toEqual({ visible: false, available: false });
    expect(
      resolveMobileThreadRetryActionState({
        supported: true,
        connected: true,
        busy: false,
        target,
      }),
    ).toEqual({ visible: true, available: true });
    expect(
      resolveMobileThreadRetryActionState({
        supported: true,
        connected: true,
        busy: true,
        target,
      }),
    ).toEqual({ visible: true, available: false });
    expect(mobileThreadRetryMessageKey(false)).toBe("mobile.thread.retryResponse");
    expect(mobileThreadRetryMessageKey(true)).toBe("mobile.thread.retryingResponse");
  });

  it("builds the exact result-only command with the current model and optional Fetch mode", () => {
    const thread = {
      environmentId: EnvironmentId.make("environment-a"),
      id: ThreadId.make("thread-a"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
      },
    };
    expect(buildMobileThreadRetryCommand({ thread, target, fetchEnabled: true })).toEqual({
      environmentId: "environment-a",
      input: {
        threadId: "thread-a",
        turnId: "turn-interrupted",
        messageId: "message-user",
        fetchMode: "repository-exploration",
        modelSelection: { instanceId: "codex", model: "gpt-5.6" },
      },
    });
    expect(
      buildMobileThreadRetryCommand({
        thread,
        target: { ...target, turnId: null },
        fetchEnabled: false,
      }),
    ).toEqual({
      environmentId: "environment-a",
      input: {
        threadId: "thread-a",
        turnId: null,
        messageId: "message-user",
        modelSelection: { instanceId: "codex", model: "gpt-5.6" },
      },
    });
  });
});
