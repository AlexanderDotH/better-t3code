import {
  SubagentId,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChatAgentStack } from "./ChatAgentStack";

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  const now = Date.now();
  const terminal = new Date(now - 10_000).toISOString();
  return {
    id: SubagentId.make(id),
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
      status === "completed" ||
      status === "error" ||
      status === "interrupted" ||
      status === "unavailable"
        ? terminal
        : null,
    ...overrides,
  };
}

describe("ChatAgentStack", () => {
  it("renders individual compact agent pills instead of an aggregate disclosure", () => {
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
    expect(html).toContain('data-subagent-id="runtime"');
    expect(html).toContain('data-subagent-id="contracts"');
    expect(html).toContain(">Carson<");
    expect(html).toContain(">Kuhn<");
    expect(html).not.toContain(">Agents<");
    expect(html).not.toContain('data-slot="popover-trigger"');
  });

  it("colors both the status dot and bot icon and preserves accessible progress", () => {
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("runtime", "waiting", {
            nickname: "Carson",
            latestProgress: {
              kind: "analysis",
              summary: "Checking reconnect behavior",
              detail: null,
              createdAt: new Date().toISOString(),
            },
          }),
        ]}
        selectedSubagentId={SubagentId.make("runtime")}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain("Carson, Waiting: Checking reconnect behavior");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-subagent-tone="working"');
    expect(html.match(/data-subagent-tone-target="working"/g)).toHaveLength(2);
  });

  it("keeps aged agents in a collapsed grey History section", () => {
    const oldTerminal = new Date(Date.now() - 151_000).toISOString();
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
          makeSubagent("archive", "completed", {
            nickname: "Archived agent",
            completedAt: oldTerminal,
            updatedAt: oldTerminal,
          }),
        ]}
        selectedSubagentId={null}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain(">History<");
    expect(html).toContain('aria-label="1 archived agent"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Archived agent<");
  });

  it("opens History when the selected agent has already aged out", () => {
    const oldTerminal = new Date(Date.now() - 151_000).toISOString();
    const html = renderToStaticMarkup(
      <ChatAgentStack
        subagents={[
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

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(">Archived agent<");
    expect(html).toContain('data-subagent-tone="archived"');
  });
});
