import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView MCP workspace integration", () => {
  it("binds the card to the exact live provider runtime instead of composer selection", () => {
    expect(chatViewSource).toContain("activeThread.session?.providerInstanceId");
    expect(chatViewSource).toContain("activeThread.session?.runtimeSessionId");
    expect(chatViewSource).toContain("mcpProviderInstanceId={");
    expect(chatViewSource).toContain("mcpRuntimeSessionId={activeThread.session?.runtimeSessionId");
    expect(chatViewSource).toContain("environmentId={activeThread.environmentId}");
  });

  it("removes the separate floating pill in favor of the deck card", () => {
    expect(chatViewSource).toContain("<ChatWorkspaceDeckController");
    expect(chatViewSource).not.toContain("data-chat-mcp-floating-layer");
    expect(chatViewSource).not.toContain("<ChatMcpStatusPopover");
  });

  it("keeps the existing agent layer independent", () => {
    expect(chatViewSource).toContain("data-chat-agent-floating-layer");
    expect(chatViewSource).toContain("<ChatAgentStack");
  });
});
