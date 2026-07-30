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
  it("renders individual w-52 pills in a stacked list", () => {
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
    expect(html).toContain(">Carson<");
    expect(html).toContain(">Kuhn<");
    expect(html).toContain("w-52");
    expect(html).not.toContain(">Agents<");
    expect(html).not.toContain('data-slot="popover-trigger"');
  });

  it("uses the normal sky-blue Working palette for the dot and bot icon", () => {
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
    expect(html).toContain("bg-sky-500");
    expect(html).toContain("text-sky-600");
    expect(html).not.toContain("teal");
  });

  it("keeps agents past the 30-second exit threshold in collapsed gray History", () => {
    const oldTerminal = new Date(Date.now() - 31_000).toISOString();
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

  it("opens History when its selected gray agent is archived", () => {
    const oldTerminal = new Date(Date.now() - 31_000).toISOString();
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
