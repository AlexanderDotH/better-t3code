import { EventId, ThreadId, SubagentId, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isFetchMutationEvent, isNestedFetchAgentEvent } from "./FetchWorkerPolicy.ts";

const eventBase = {
  eventId: EventId.make("event-policy"),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-fetch"),
  createdAt: "2026-08-29T12:00:00.000Z",
};

describe("Fetch worker event policy", () => {
  it("allows only authenticated workspace reads and bounded native reads", () => {
    for (const tool of ["workspace_find", "workspace_read", "workspace_context"]) {
      expect(
        isFetchMutationEvent({
          ...eventBase,
          type: "item.started",
          payload: {
            itemType: "mcp_tool_call",
            data: { item: { server: "t3-code", tool } },
          },
        }),
      ).toBe(false);
    }
    expect(
      isFetchMutationEvent({
        ...eventBase,
        type: "item.started",
        payload: {
          itemType: "mcp_tool_call",
          data: { item: { server: "t3-code", tool: "workspace_edit" } },
        },
      }),
    ).toBe(true);
    expect(
      isFetchMutationEvent({
        ...eventBase,
        type: "item.started",
        payload: {
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
        subagentId: SubagentId.make("nested-agent"),
        payload: {
          subagentId: SubagentId.make("nested-agent"),
          providerThreadId: "nested-provider",
        },
      }),
    ).toBe(true);
  });
});
