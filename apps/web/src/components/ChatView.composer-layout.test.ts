import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";
import chatComposerSource from "./chat/ChatComposer.tsx?raw";

describe("ChatView composer overlay layout", () => {
  it("allows the draft composer card stack to shrink with a narrow chat column", () => {
    expect(chatViewSource).toContain(
      'className="chat-composer-horizontal-inset min-w-0 w-full ps-[calc(env(safe-area-inset-left)+0.75rem)]',
    );
  });

  it("keeps one composer surface while transient state floats outside the card deck", () => {
    const bubbleIndex = chatViewSource.indexOf("<ComposerFloatingBubble");
    const deckIndex = chatViewSource.indexOf("<ChatWorkspaceDeckController");
    const shellIndex = chatViewSource.indexOf("<ComposerSurface.Shell", deckIndex);
    const hostIndex = chatViewSource.indexOf("<ComposerSurface.Host", shellIndex);
    const composerIndex = chatViewSource.indexOf("<ChatComposer", hostIndex);
    const hostEndIndex = chatViewSource.indexOf("</ComposerSurface.Host>", composerIndex);
    const contextStripIndex = chatViewSource.indexOf(
      'renderComposerContextStrip("next")',
      hostEndIndex,
    );
    const shellEndIndex = chatViewSource.indexOf("</ComposerSurface.Shell>", contextStripIndex);
    const bannerIndex = chatComposerSource.indexOf("<ComposerBannerStack");
    const mainSurfaceIndex = chatComposerSource.indexOf("<ComposerSurface.Main", bannerIndex);

    expect(bubbleIndex).toBeGreaterThanOrEqual(0);
    expect(deckIndex).toBeGreaterThan(bubbleIndex);
    expect(shellIndex).toBeGreaterThan(deckIndex);
    expect(hostIndex).toBeGreaterThan(shellIndex);
    expect(composerIndex).toBeGreaterThan(hostIndex);
    expect(hostEndIndex).toBeGreaterThan(composerIndex);
    expect(contextStripIndex).toBeGreaterThan(hostEndIndex);
    expect(shellEndIndex).toBeGreaterThan(contextStripIndex);
    expect(chatViewSource.match(/<ComposerSurface\.Shell/g)).toHaveLength(1);
    expect(chatViewSource.match(/<ComposerSurface\.Host/g)).toHaveLength(1);
    expect(chatViewSource).toContain("bannerItems={composerBannerItems}");
    expect(chatViewSource).toContain("floatingBubbleHost={composerFloatingBubbleHost}");
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(mainSurfaceIndex).toBeGreaterThan(bannerIndex);
    expect(chatComposerSource.match(/<ComposerBannerStack/g)).toHaveLength(1);
    expect(chatComposerSource.match(/<ComposerSurface\.Main/g)).toHaveLength(1);
    expect(chatViewSource).not.toContain("ComposerFloatingIsland");
    expect(chatComposerSource).not.toContain("floatingDrawerHost");
  });

  it("keeps activity presentation single-owned while sharing the turn start timestamp", () => {
    expect(chatViewSource.match(/activeTurnStartedAt=\{activeWorkStartedAt\}/g)).toHaveLength(1);
    expect(chatViewSource.match(/activeWorkStartedAt=\{activeWorkStartedAt\}/g)).toHaveLength(1);
    expect(chatViewSource).not.toContain("<ComposerActivityRow");
    expect(chatViewSource).not.toContain("ComposerFloatingIsland");
    expect(chatViewSource).not.toContain("ComposerThreadSyncStatus");
  });

  it("cleans up the coalesced composer-overlay measurement frame", () => {
    const effectStart = chatViewSource.indexOf("if (!composerOverlayElement) return;");
    const effectEnd = chatViewSource.indexOf("if (!chatColumnElement) return;", effectStart);
    const effectSource = chatViewSource.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(effectSource).toContain("composerOverlayResizeFrameRef.current !== null");
    expect(effectSource).toContain("window.requestAnimationFrame");
    expect(effectSource).toContain("window.cancelAnimationFrame");
    expect(effectSource).toContain("composerOverlayResizeFrameRef.current = null");
  });

  it("keeps workspace-card ownership and Better T3 controls on the composed surface", () => {
    expect(chatViewSource).toContain("onNonChatActiveChange={setNonChatWorkspaceCardActive}");
    expect(chatViewSource).toContain("onExpandedChange={setWorkspaceCardExpanded}");
    expect(chatViewSource).toContain("isRecording={voiceRecordingActive}");
    expect(chatViewSource).toContain("voiceInputConfigured={voiceInputConfigured}");
    expect(chatViewSource).toContain("onImplementPlan={onImplementPlan}");
    expect(chatViewSource).toContain("onImplementPlanInNewThread={onImplementPlanInNewThread}");
    expect(chatViewSource).toContain("activeProposedPlan={activeProposedPlan}");
    expect(chatViewSource).toContain("activeTasksProgress={activeComposerTasksProgress}");
    expect(chatViewSource).toContain("mcpRuntimeSessionId={activeThread.session?.runtimeSessionId");
    expect(chatViewSource).toContain("!nonChatWorkspaceCardActive &&");
    expect(chatViewSource).toContain("!workspaceCardExpanded &&");
  });

  it("localizes merged composer-disabled states", () => {
    expect(chatViewSource).toContain(
      'feedbackUploading\n                                      ? translate("chat.composer.sendingProgress")',
    );
    expect(chatViewSource).toContain(
      'threadDetailLoading\n                                        ? translate("chat.composer.sync.loadingMessages")',
    );
    expect(chatViewSource).toContain(
      'isHarnessSessionActive\n                                          ? translate("chat.harness.sendingPaused")',
    );
    expect(chatViewSource).not.toContain(
      'feedbackUploading\n                                      ? "Sending feedback"',
    );
    expect(chatViewSource).not.toContain(
      'threadDetailLoading\n                                        ? "Messages loading"',
    );
  });
});
