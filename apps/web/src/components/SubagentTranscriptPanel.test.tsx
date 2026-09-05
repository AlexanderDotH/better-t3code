import {
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  type OrchestrationSubagentDetail,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  collectSubagentStreamingAssistantMessageIds,
  resolveSubagentInitialStreamAnimation,
  shouldVirtualizeSubagentTranscript,
  SUBAGENT_TRANSCRIPT_VIRTUALIZATION_THRESHOLD,
  SubagentTranscriptPanel,
} from "./SubagentTranscriptPanel";
import { deriveSubagentTranscriptEntries } from "./subagents/subagentPresentation";

function makeDetail(): OrchestrationSubagentDetail {
  return {
    id: SubagentId.make("agent-review"),
    origin: "t3-fetch",
    providerInstanceId: ProviderInstanceId.make("claude-work"),
    providerDriver: ProviderDriverKind.make("claudeAgent"),
    providerThreadId: "provider-agent-review",
    parentId: null,
    path: "/root/review",
    name: "Review worker",
    nickname: "Bernoulli",
    role: "Reviewer",
    task: "Review the transport boundary",
    model: "gpt-5.6",
    reasoningEffort: "ultra",
    serviceTier: "priority",
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
  it("animates only a newly inserted live assistant message after transcript hydration", () => {
    const committedMessageIds = new Set(["message-existing"]);

    expect(
      resolveSubagentInitialStreamAnimation({
        committedScopeId: null,
        committedMessageIds,
        currentScopeId: "agent-review",
        messageId: "message-new",
        isAssistant: true,
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      resolveSubagentInitialStreamAnimation({
        committedScopeId: "agent-review",
        committedMessageIds,
        currentScopeId: "agent-review",
        messageId: "message-existing",
        isAssistant: true,
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      resolveSubagentInitialStreamAnimation({
        committedScopeId: "agent-review",
        committedMessageIds,
        currentScopeId: "agent-review",
        messageId: "message-new",
        isAssistant: false,
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      resolveSubagentInitialStreamAnimation({
        committedScopeId: "agent-review",
        committedMessageIds,
        currentScopeId: "agent-review",
        messageId: "message-new",
        isAssistant: true,
        isStreaming: true,
      }),
    ).toBe(true);
  });

  it("treats selecting another agent as hydration", () => {
    expect(
      resolveSubagentInitialStreamAnimation({
        committedScopeId: "agent-review",
        committedMessageIds: new Set(),
        currentScopeId: "agent-implementation",
        messageId: "message-new",
        isAssistant: true,
        isStreaming: true,
      }),
    ).toBe(false);
  });

  it("tracks only live assistant ids and virtualizes large transcripts", () => {
    const detail = makeDetail();
    const completed = detail.messages[0]!;
    const entries = deriveSubagentTranscriptEntries({
      messages: [
        completed,
        {
          ...completed,
          id: MessageId.make("message-live"),
          text: "Still working",
          streaming: true,
        },
        {
          ...completed,
          id: MessageId.make("message-user"),
          role: "user",
          streaming: true,
        },
      ],
      proposedPlans: [],
      activities: [],
    });

    expect([...collectSubagentStreamingAssistantMessageIds(entries)]).toEqual(["message-live"]);
    expect(shouldVirtualizeSubagentTranscript(SUBAGENT_TRANSCRIPT_VIRTUALIZATION_THRESHOLD)).toBe(
      false,
    );
    expect(
      shouldVirtualizeSubagentTranscript(SUBAGENT_TRANSCRIPT_VIRTUALIZATION_THRESHOLD + 1),
    ).toBe(true);
  });

  it("renders loading and unselected states without control actions", () => {
    expect(renderToStaticMarkup(<SubagentTranscriptPanel subagent={null} isLoading />)).toContain(
      "Loading agent transcript",
    );
    expect(renderToStaticMarkup(<SubagentTranscriptPanel subagent={null} />)).toContain(
      "Select an agent to inspect its transcript",
    );
  });

  it("renders the selected agent status and complete read-only event stream", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptPanel subagent={makeDetail()} timestampFormat="24-hour" />,
    );

    expect(html).toContain('aria-label="Bernoulli transcript"');
    expect(html).toContain("Fetch · claude-work · gpt-5.6 · Reasoning ultra · Fast");
    expect(html).toContain("Checking reconnect behavior");
    expect(html).toContain("Comparing cursor frames");
    expect(html).toContain("The reconnect path keeps the cursor monotonic.");
    expect(html).toContain("Verification");
    expect(html).toContain("Replay buffered events");
    expect(html).toContain("Inspected WebSocket transport");
    expect(html).toContain("Read ws.ts");
    expect(html).toContain("bg-sky-500");
    expect(html).not.toContain("bg-info/8");
    expect(html).not.toContain("Interrupt");
    expect(html).not.toContain("Resume");
  });

  it("shows transport errors without dropping the selected-panel context", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptPanel
        subagent={null}
        errorMessage="The agent transcript could not be loaded."
      />,
    );

    expect(html).toContain("Agent transcript unavailable");
    expect(html).toContain("The agent transcript could not be loaded.");
  });

  it("renders a bounded-history control when older activity is available", () => {
    const html = renderToStaticMarkup(
      <SubagentTranscriptPanel
        subagent={makeDetail()}
        hasOlderActivities
        isLoadingOlderActivities
        onLoadOlderActivities={() => undefined}
      />,
    );

    expect(html).toContain("Loading earlier activity");
    expect(html).toContain("disabled");
  });
});
