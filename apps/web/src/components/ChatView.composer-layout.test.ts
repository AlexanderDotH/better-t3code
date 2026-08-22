import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView composer overlay layout", () => {
  it("allows the draft composer card stack to shrink with a narrow chat column", () => {
    expect(chatViewSource).toContain(
      'className="chat-composer-horizontal-inset min-w-0 w-full ps-[calc(env(safe-area-inset-left)+0.75rem)]',
    );
  });

  it("hosts detached composer drawers before the three-card workspace deck", () => {
    const hostIndex = chatViewSource.indexOf('data-chat-composer-floating-drawer-host="true"');
    const deckIndex = chatViewSource.indexOf("<ChatWorkspaceDeckController");

    expect(chatViewSource).toContain(
      "const [composerFloatingDrawerHost, setComposerFloatingDrawerHost] =",
    );
    expect(hostIndex).toBeGreaterThanOrEqual(0);
    expect(deckIndex).toBeGreaterThan(hostIndex);
    expect(chatViewSource).toContain("floatingDrawerHost={composerFloatingDrawerHost}");
  });
});
