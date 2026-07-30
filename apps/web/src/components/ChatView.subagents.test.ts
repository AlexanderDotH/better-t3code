import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "./ChatView.tsx?raw";

describe("ChatView subagent integration", () => {
  it("mounts an empty pill stack in a named chat-column container", () => {
    expect(chatViewSource).toContain("@container/chat-column");
    expect(chatViewSource).toContain("data-chat-agent-floating-layer");
    expect(chatViewSource).toContain('className="chat-agent-floating-layer"');
    expect(chatViewSource).toContain("{isServerThread ? (");
    expect(chatViewSource).not.toContain("isServerThread && activeThread.subagents.length > 0");
  });

  it("opens transcripts through a centered dialog instead of a right-panel pane", () => {
    expect(chatViewSource).toContain("<SubagentTranscriptDialog");
    expect(chatViewSource).toContain("useEnvironmentSubagent(");
    expect(chatViewSource).not.toContain("SUBAGENT_DEDICATED_PANE_MEDIA_QUERY");
    expect(chatViewSource).not.toContain("openSubagent(");
  });
});
