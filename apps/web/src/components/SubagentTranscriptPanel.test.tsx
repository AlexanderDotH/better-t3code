import {
  EventId,
  MessageId,
  SubagentId,
  type OrchestrationSubagentDetail,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SubagentTranscriptPanel } from "./SubagentTranscriptPanel";

function makeDetail(): OrchestrationSubagentDetail {
  return {
    id: SubagentId.make("agent-review"),
    providerThreadId: "provider-agent-review",
    parentId: null,
    path: "/root/review",
    name: "Review worker",
    nickname: "Bernoulli",
    role: "Reviewer",
    task: "Review the transport boundary",
    model: "gpt-5.6",
    reasoningEffort: "ultra",
    depth: 0,
    status: "running",
    statusMessage: "Reviewing",
    latestProgress: {
      kind: "analysis",
      summary: "Checking reconnect behavior",
      detail: "Comparing cursor frames",
      createdAt: "2026-07-30T09:01:00.000Z",
    },
    latestTurn: null,
    startedAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T09:01:00.000Z",
    completedAt: null,
    messages: [
      {
        id: MessageId.make("message-1"),
        role: "assistant",
        text: "The reconnect path keeps the cursor monotonic.",
        turnId: null,
        streaming: false,
        createdAt: "2026-07-30T09:02:00.000Z",
        updatedAt: "2026-07-30T09:02:00.000Z",
      },
    ],
    proposedPlans: [
      {
        id: "plan-1",
        turnId: null,
        planMarkdown: "## Verification\n\n- Replay buffered events",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-07-30T09:03:00.000Z",
        updatedAt: "2026-07-30T09:03:00.000Z",
      },
    ],
    activities: [
      {
        id: EventId.make("activity-1"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Inspected WebSocket transport",
        payload: { detail: "Read ws.ts" },
        turnId: null,
        createdAt: "2026-07-30T09:04:00.000Z",
      },
    ],
  };
}

describe("SubagentTranscriptPanel", () => {
  it("renders loading, unavailable, and unselected states", () => {
    expect(renderToStaticMarkup(<SubagentTranscriptPanel subagent={null} isLoading />)).toContain(
      "Loading agent transcript",
    );
    expect(renderToStaticMarkup(<SubagentTranscriptPanel subagent={null} />)).toContain(
      "Select an agent to inspect its transcript",
    );
    expect(
      renderToStaticMarkup(
        <SubagentTranscriptPanel subagent={null} errorMessage="Connection lost" />,
      ),
    ).toContain("Agent transcript unavailable");
  });

  it("renders a complete read-only transcript stream", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptPanel subagent={makeDetail()} timestampFormat="24-hour" />,
    );

    expect(html).toContain('aria-label="Bernoulli transcript"');
    expect(html).toContain("Checking reconnect behavior");
    expect(html).toContain("Comparing cursor frames");
    expect(html).toContain("The reconnect path keeps the cursor monotonic.");
    expect(html).toContain("Verification");
    expect(html).toContain("Replay buffered events");
    expect(html).toContain("Inspected WebSocket transport");
    expect(html).toContain("Read ws.ts");
    expect(html).not.toContain("Interrupt");
    expect(html).not.toContain("Resume");
  });
});
