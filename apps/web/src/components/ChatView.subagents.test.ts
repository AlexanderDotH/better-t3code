import { describe, expect, it } from "vite-plus/test";

import chatAgentStackSource from "./ChatAgentStack.tsx?raw";
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

  it("offers a compact accessible agent disclosure when the side gutter is unavailable", () => {
    expect(chatAgentStackSource).toContain("data-subagent-compact-trigger");
    expect(chatAgentStackSource).toContain("aria-expanded={compactOpen}");
    expect(chatAgentStackSource).toContain("data-compact-open={compactOpen");
    expect(chatAgentStackSource).toContain("Agents");
  });
});
