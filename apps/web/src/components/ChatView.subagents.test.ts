import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView subagent integration", () => {
  it("mounts the pill stack in a named chat-column container", () => {
    expect(chatViewSource).toContain("@container/chat-column");
    expect(chatViewSource).toContain("data-chat-agent-floating-layer");
    expect(chatViewSource).toContain("chat-agent-floating-layer");
  });

  it("keeps an empty stack mounted so the first spawned agent can animate in", () => {
    expect(chatViewSource).toContain('className="chat-agent-floating-layer"');
    expect(chatViewSource).toContain("{isServerThread ? (");
    expect(chatViewSource).not.toContain("isServerThread && activeThread.subagents.length > 0");
  });

  it("opens transcripts through the centered dialog instead of the right panel", () => {
    expect(chatViewSource).toContain("<SubagentTranscriptDialog");
    expect(chatViewSource).toContain("useEnvironmentSubagent(");
    expect(chatViewSource).not.toContain('open(activeThreadRef, "subagent")');
  });
});
