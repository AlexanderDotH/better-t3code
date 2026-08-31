import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";
import chatComposerSource from "./chat/ChatComposer.tsx?raw";

describe("ChatView chat forking", () => {
  it("gates the action on the advertised server capability and live environment", () => {
    expect(chatViewSource).toContain(
      "serverConfig?.environment.capabilities.threadForking === true",
    );
    expect(chatViewSource).toContain("available: !activeEnvironmentUnavailable && !isConnecting");
    expect(chatViewSource).toContain("forkableMessageIds");
    expect(chatViewSource).toContain("forkableProposedPlanIds");
  });

  it("dispatches the exact boundary into a fresh destination and then navigates and focuses", () => {
    const dispatchIndex = chatViewSource.indexOf("const result = await forkThread({");
    const waitIndex = chatViewSource.indexOf("await waitForStartedServerThread(", dispatchIndex);
    const navigateIndex = chatViewSource.indexOf("await navigate({", waitIndex);
    const focusIndex = chatViewSource.indexOf("scheduleComposerFocus();", navigateIndex);

    expect(dispatchIndex).toBeGreaterThanOrEqual(0);
    expect(chatViewSource.slice(dispatchIndex, waitIndex)).toContain("sourceThreadId");
    expect(chatViewSource.slice(dispatchIndex, waitIndex)).toContain("boundary");
    expect(chatViewSource.slice(dispatchIndex, waitIndex)).toContain("modelSelection");
    expect(chatViewSource.slice(dispatchIndex, waitIndex)).toContain("workspace");
    expect(waitIndex).toBeGreaterThan(dispatchIndex);
    expect(navigateIndex).toBeGreaterThan(waitIndex);
    expect(focusIndex).toBeGreaterThan(navigateIndex);
  });

  it("guards duplicate dispatches and leaves failures on the source thread", () => {
    expect(chatViewSource).toContain("forkDispatchInFlightRef.current");
    expect(chatViewSource).toContain("setForkingBoundary(boundary)");
    expect(chatViewSource).toContain("setThreadError(sourceThreadId");
    expect(chatViewSource).not.toContain("Failed to clean up fork");
  });

  it("passes the pending one-time handoff budget into prompt and attachment validation", () => {
    expect(chatViewSource).toContain("resolveFirstTurnForkBudget(activeThread?.fork?.handoff)");
    expect(chatViewSource).toContain("firstTurnForkBudget={firstTurnForkBudget}");
    expect(chatComposerSource).toContain("maxInputChars: providerInputLimit");
    expect(chatComposerSource).toContain("attachmentLimit - composerImagesRef.current.length");
    expect(chatComposerSource).toContain("reservedCount >= attachmentLimit");
  });
});
