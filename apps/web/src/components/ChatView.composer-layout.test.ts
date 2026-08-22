import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView composer overlay layout", () => {
  it("allows the draft composer card stack to shrink with a narrow chat column", () => {
    expect(chatViewSource).toContain(
      'className="chat-composer-horizontal-inset min-w-0 w-full ps-[calc(env(safe-area-inset-left)+0.75rem)]',
    );
  });

  it("composes every above-deck status source into one floating island", () => {
    const islandIndex = chatViewSource.indexOf("<ComposerFloatingIsland");
    const islandEndIndex = chatViewSource.indexOf("</ComposerFloatingIsland>", islandIndex);
    const bannerIndex = chatViewSource.indexOf("<ComposerBannerStack", islandIndex);
    const syncIndex = chatViewSource.indexOf("<ThreadSyncStatusPill", islandIndex);
    const deckIndex = chatViewSource.indexOf("<ChatWorkspaceDeckController");

    expect(chatViewSource).toContain(
      "const [composerFloatingDrawerHost, setComposerFloatingDrawerHost] =",
    );
    expect(islandIndex).toBeGreaterThanOrEqual(0);
    expect(bannerIndex).toBeGreaterThan(islandIndex);
    expect(syncIndex).toBeGreaterThan(bannerIndex);
    expect(islandEndIndex).toBeGreaterThan(syncIndex);
    expect(deckIndex).toBeGreaterThan(islandEndIndex);
    expect(chatViewSource).toContain("portalHostRef={setComposerFloatingDrawerHost}");
    expect(chatViewSource).toContain("floatingDrawerHost={composerFloatingDrawerHost}");
  });
});
