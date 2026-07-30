import {
  SubagentId,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChatAgentPopover, ChatAgentPopoverContent } from "./ChatAgentPopover";

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
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
    startedAt: "2026-07-30T09:00:00.000Z",
    updatedAt: "2026-07-30T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("ChatAgentPopover", () => {
  it("renders a compact floating disclosure without exposing the list while closed", () => {
    const html = renderToStaticMarkup(
      <ChatAgentPopover
        subagents={[makeSubagent("runtime", "running"), makeSubagent("contracts", "completed")]}
        selectedSubagentId={null}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('data-chat-agent-floating="true"');
    expect(html).toContain('aria-label="Show agents (1 active, 2 total)"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Agents<");
    expect(html).not.toContain('aria-label="Subagents"');
    expect(html).not.toContain("w-60");
  });
});

describe("ChatAgentPopoverContent", () => {
  it("renders live progress in Active and keeps Finished collapsed by default", () => {
    const html = renderToStaticMarkup(
      <ChatAgentPopoverContent
        subagents={[
          makeSubagent("runtime", "running", {
            nickname: "Carson",
            latestProgress: {
              kind: "implementation",
              summary: "Routing child messages",
              detail: null,
              createdAt: "2026-07-30T09:02:00.000Z",
            },
          }),
          makeSubagent("contracts", "completed", { nickname: "Kuhn" }),
        ]}
        selectedSubagentId={null}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Subagents"');
    expect(html).toContain("Active");
    expect(html).toContain("Carson");
    expect(html).toContain("Routing child messages");
    expect(html).toContain("Finished");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(">Kuhn<");
  });

  it("exposes native selection semantics and the selected finished agent", () => {
    const selectedId = SubagentId.make("contracts");
    const html = renderToStaticMarkup(
      <ChatAgentPopoverContent
        subagents={[
          makeSubagent("contracts", "completed", {
            nickname: "Kuhn",
            statusMessage: "Contracts verified",
          }),
        ]}
        selectedSubagentId={selectedId}
        onSelectSubagent={() => {}}
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Kuhn");
    expect(html).toContain("Contracts verified");
    expect(html).toContain("Kuhn, Completed: Contracts verified");
  });
});
