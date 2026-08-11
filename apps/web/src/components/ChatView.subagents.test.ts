import { describe, expect, it } from "vite-plus/test";

import chatAgentStackSource from "./ChatAgentStack.tsx?raw";
import chatViewSource from "./ChatView.tsx?raw";
import rightPanelTabsSource from "./RightPanelTabs.tsx?raw";
import messagesTimelineSource from "./chat/MessagesTimeline.tsx?raw";
import panelLayoutControlsSource from "./chat/PanelLayoutControls.tsx?raw";
import rightPanelStoreSource from "../rightPanelStore.ts?raw";

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

  it("keeps the spawn notification without reintroducing an Agents sidebar", () => {
    expect(messagesTimelineSource).toContain("Kicked off ${agentCount}");
    expect(messagesTimelineSource).toContain("data-subagent-spawn-notification");
    expect(messagesTimelineSource).not.toContain("onOpenAgents");
    expect(messagesTimelineSource).not.toContain("Open Agents");

    expect(chatViewSource).not.toContain("<AgentsPanel");
    expect(chatViewSource).not.toContain("addAgentsSurface");
    expect(rightPanelTabsSource).not.toContain('label: "Agents"');
    expect(rightPanelTabsSource).not.toContain("onAddAgents");
    expect(panelLayoutControlsSource).not.toContain("liveAgentCount");
    expect(rightPanelStoreSource).not.toContain('| { id: "agents"; kind: "agents" }');
  });

  it("offers a compact accessible agent disclosure when the side gutter is unavailable", () => {
    expect(chatAgentStackSource).toContain("data-subagent-compact-trigger");
    expect(chatAgentStackSource).toContain("aria-expanded={compactOpen}");
    expect(chatAgentStackSource).toContain("data-compact-open={compactOpen");
    expect(chatAgentStackSource).toContain("Agents");
  });
});
