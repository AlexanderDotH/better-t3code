import { EventId, ThreadId, SubagentId, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFetchWorkerPrompt,
  isFetchMutationEvent,
  isNestedFetchAgentEvent,
} from "./FetchWorkerPolicy.ts";

const eventBase = {
  eventId: EventId.make("event-policy"),
  provider: ProviderDriverKind.make("codex"),
  threadId: ThreadId.make("thread-fetch"),
  createdAt: "2026-08-29T12:00:00.000Z",
};

describe("Fetch worker event policy", () => {
  it("allows only authenticated workspace reads and bounded native reads", () => {
    for (const tool of [
      "project_context",
      "knowledge_graph_query",
      "workspace_find",
      "workspace_read",
      "workspace_context",
    ]) {
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

  it("rejects untrusted index tools and all command execution", () => {
    for (const itemType of ["command_execution", "mcp_tool_call"] as const) {
      expect(
        isFetchMutationEvent({
          ...eventBase,
          type: "item.completed",
          payload: {
            itemType,
            data: { item: { server: "untrusted", tool: "project_context" } },
          },
        }),
      ).toBe(true);
    }
  });

  it("uses index evidence to locate original code without relaxing read-only policy", () => {
    const prompt = buildFetchWorkerPrompt({
      userRequest: "Find the request decoder",
      scope: "server",
      questions: ["Which decoder rejects invalid requests?"],
    });
    expect(prompt).toContain("project_context");
    expect(prompt).toContain("respect AGENTS instructions");
    expect(prompt).toContain("verify relevant original code with workspace_read");
    expect(prompt).toContain("Do not execute shell or terminal commands");
    expect(prompt).toContain("Do not start or delegate to nested agents");
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
