import {
  SubagentId,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChatAgentStack } from "./ChatAgentStack";
import { ASTERIX_AGENT_NAMES } from "./subagents/subagentPresentation";

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  const now = Date.now();
  const terminal = new Date(now - 10_000).toISOString();
  return {
    id: SubagentId.make(id),
    origin: "provider-native",
    providerInstanceId: null,
    providerDriver: null,
    providerThreadId: `provider-${id}`,
    parentId: null,
    path: null,
    name: id,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: new Date(now).toISOString(),
    updatedAt: terminal,
    completedAt:
      status === "running" || status === "starting" || status === "waiting" ? null : terminal,
    ...overrides,
  };
}

describe("ChatAgentStack", () => {
  it("renders individual pills in a newest-first stack instead of a popover trigger", () => {
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("runtime", "running", { nickname: "Carson" }),
          makeSubagent("contracts", "completed", { nickname: "Kuhn" }),
        ]}
        selectedSubagentId={null}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('data-chat-agent-stack="true"');
    expect(html).toContain('aria-label="Active and recent agents"');
    expect(html).toContain('data-subagent-id="runtime"');
    expect(html).toContain('data-subagent-id="contracts"');
    expect(html).not.toContain('data-slot="popover-trigger"');
  });

  it("uses sky blue for working agents and opens selected archived agents in History", () => {
    const oldTerminal = new Date(Date.now() - 31_000).toISOString();
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("runtime", "waiting", { nickname: "Carson" }),
          makeSubagent("archive", "error", {
            nickname: "Archived agent",
            completedAt: oldTerminal,
            updatedAt: oldTerminal,
          }),
        ]}
        selectedSubagentId={SubagentId.make("archive")}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('data-subagent-tone="working"');
    expect(html).toContain("bg-sky-500");
    expect(html).toContain(">History<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-subagent-tone="archived"');
  });

  it("keeps active and archived agent pills flush-left regardless of depth", () => {
    const oldTerminal = new Date(Date.now() - 31_000).toISOString();
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("nested-active", "running", { depth: 1 }),
          makeSubagent("deep-archive", "completed", {
            depth: 3,
            completedAt: oldTerminal,
            updatedAt: oldTerminal,
          }),
        ]}
        selectedSubagentId={SubagentId.make("deep-archive")}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('data-subagent-id="nested-active"');
    expect(html).toContain('data-subagent-id="deep-archive"');
    expect(html).not.toContain("padding-inline-start");
  });

  it("replaces technical task ids with Asterix character names", () => {
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("stream_routing_retry", "running", {
            path: "/root/stream_routing_retry",
          }),
        ]}
        selectedSubagentId={null}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).not.toContain(">stream_routing_retry<");
    expect(ASTERIX_AGENT_NAMES.some((name) => html.includes(`>${name}<`))).toBe(true);
  });
});
