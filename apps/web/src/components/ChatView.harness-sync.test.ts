import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView harness sync continuation guard", () => {
  it("blocks sending while the original harness session is active and offers a refresh", () => {
    expect(chatViewSource).toContain("agentSettingsEnvironment.harnessChatSync.status");
    expect(chatViewSource).toContain("id: `harness-active:${activeThread.id}`");
    expect(chatViewSource).toContain("isHarnessSessionActive");
    expect(chatViewSource).toContain("Native harness session active elsewhere");
    expect(chatViewSource).toContain("Check again");
  });
});
