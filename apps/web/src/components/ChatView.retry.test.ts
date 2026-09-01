import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView interrupted turn retry", () => {
  it("gates the action on server capability and the exact interrupted turn target", () => {
    expect(chatViewSource).toContain(
      "serverConfig?.environment.capabilities.interruptedTurnRetry === true",
    );
    expect(chatViewSource).toContain("resolveInterruptedTurnRetryTarget");
    expect(chatViewSource).toContain("session: activeThread.session");
    expect(chatViewSource).toContain("retryAction={timelineRetryAction}");
  });

  it("dispatches a retry against the existing message without creating an optimistic duplicate", () => {
    const dispatchIndex = chatViewSource.indexOf("const result = await retryThreadTurn({");
    const dispatchEnd = chatViewSource.indexOf("if (result._tag", dispatchIndex);
    const dispatchSource = chatViewSource.slice(dispatchIndex, dispatchEnd);

    expect(dispatchIndex).toBeGreaterThanOrEqual(0);
    expect(dispatchSource).toContain("messageId: target.messageId");
    expect(dispatchSource).toContain("turnId: target.turnId");
    expect(dispatchSource).not.toContain("setOptimisticUserMessages");
    expect(chatViewSource).toContain("beginLocalDispatch({ preparingWorktree: false })");
  });

  it("guards duplicate retry clicks and reports command failures on the same thread", () => {
    expect(chatViewSource).toContain("retryDispatchInFlightRef.current");
    expect(chatViewSource).toContain("setRetryingMessageId(target.messageId)");
    expect(chatViewSource).toContain("setThreadError(targetThreadId");
  });
});
