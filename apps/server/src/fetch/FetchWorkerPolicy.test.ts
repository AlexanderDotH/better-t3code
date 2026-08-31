import { describe, expect, it } from "vite-plus/test";

import { isFetchMutationEvent, isNestedFetchAgentEvent } from "./FetchWorkerPolicy.ts";

const eventBase = {
  eventId: "event-policy",
  provider: "codex" as const,
  threadId: "thread-fetch",
  createdAt: "2026-08-29T12:00:00.000Z",
};

describe("Fetch worker event policy", () => {
  it("allows only authenticated workspace context and bounded native reads", () => {
    expect(
      isFetchMutationEvent({
        ...eventBase,
        type: "item.started",
        payload: {
          itemId: "workspace-context",
          itemType: "mcp_tool_call",
          data: { item: { server: "t3-code", tool: "workspace_context" } },
        },
      }),
    ).toBe(false);
    expect(
      isFetchMutationEvent({
        ...eventBase,
        type: "item.started",
        payload: {
          itemId: "native-read",
          itemType: "dynamic_tool_call",
          data: { toolName: "read" },
        },
      }),
    ).toBe(false);
    expect(
      isFetchMutationEvent({
        ...eventBase,
        type: "item.started",
        payload: {
          itemId: "native-shell",
          itemType: "dynamic_tool_call",
          data: { toolName: "exec_command" },
        },
      }),
    ).toBe(true);
  });

  it("rejects nested provider agents before their work is ingested", () => {
    expect(
      isNestedFetchAgentEvent({
        ...eventBase,
        type: "subagent.discovered",
        subagentId: "nested-agent",
        payload: { label: "Nested" },
      }),
    ).toBe(true);
  });
});
